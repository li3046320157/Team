/** 账本守恒与派生统计：账户余额、预留、自由可支配、覆盖区间。 */
import type {
  Account,
  Cents,
  CoverageInterval,
  FinancialGoal,
  GoalFundEvent,
  ISODate,
  Settings,
  Transaction,
} from './types';
import { addDaysISO, diffDays, isValidISODate, monthKey } from './days';

export function accountBalanceAt(account: Account, transactions: Transaction[], asOf: ISODate): Cents {
  let balance = account.openingBalance;
  for (const t of transactions) {
    if (t.date < account.openingDate || t.date > asOf) continue;
    if (t.kind === 'income' && t.accountId === account.id) balance += t.amount;
    else if (t.kind === 'expense' && t.accountId === account.id) balance -= t.amount;
    else if (t.kind === 'transfer') {
      if (t.accountId === account.id) balance -= t.amount;
      if (t.toAccountId === account.id) balance += t.amount;
    }
  }
  return balance;
}

export function totalBalanceAt(accounts: Account[], transactions: Transaction[], asOf: ISODate): Cents {
  return accounts
    .filter((a) => !a.archived)
    .reduce((sum, a) => sum + accountBalanceAt(a, transactions, asOf), 0);
}

export function monthIncomeExpense(
  transactions: Transaction[],
  month: string,
): { income: Cents; expense: Cents; net: Cents } {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    if (t.kind === 'transfer') continue;
    if (monthKey(t.date) !== month) continue;
    if (t.kind === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, net: income - expense };
}

/** 统计任意闭区间 [start, end] 的收入、支出与结余，转账不计入。 */
export function rangeIncomeExpense(
  transactions: Transaction[],
  start: ISODate,
  end: ISODate,
): { income: Cents; expense: Cents; net: Cents } {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    if (t.kind === 'transfer') continue;
    if (t.date < start || t.date > end) continue;
    if (t.kind === 'income') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, net: income - expense };
}

export function reservedByGoal(events: GoalFundEvent[], asOf: ISODate): Map<string, Cents> {
  const map = new Map<string, Cents>();
  for (const e of events) {
    if (!e.goalId) continue;
    if (e.date > asOf) continue;
    const prev = map.get(e.goalId) ?? 0;
    const sign = e.type === 'reserve' ? 1 : -1;
    map.set(e.goalId, prev + sign * e.amount);
  }
  return map;
}

export function consumedByGoal(events: GoalFundEvent[], asOf: ISODate): Map<string, Cents> {
  const map = new Map<string, Cents>();
  for (const e of events) {
    if (!e.goalId || e.type !== 'consume' || e.date > asOf) continue;
    map.set(e.goalId, (map.get(e.goalId) ?? 0) + e.amount);
  }
  return map;
}

export function totalReservedAt(events: GoalFundEvent[], asOf: ISODate): Cents {
  let total = 0;
  for (const e of events) {
    if (e.date > asOf) continue;
    total += (e.type === 'reserve' ? 1 : -1) * e.amount;
  }
  return Math.max(0, total);
}

export interface GoalView {
  goal: FinancialGoal;
  reserved: Cents;
  consumed: Cents;
  remaining: Cents;
  status: 'funding' | 'funded' | 'purchased' | 'overdue' | 'archived';
  overdue: boolean;
}

export function goalViews(goals: FinancialGoal[], events: GoalFundEvent[], asOf: ISODate): GoalView[] {
  const reservedMap = reservedByGoal(events, asOf);
  const consumedMap = consumedByGoal(events, asOf);
  return goals.map((goal) => {
    const reserved = Math.max(0, reservedMap.get(goal.id) ?? 0);
    const consumed = consumedMap.get(goal.id) ?? 0;
    const remaining = Math.max(0, goal.targetAmount - reserved - consumed);
    const totalFunded = reserved + consumed;
    const overdue = goal.status === 'active' && goal.deadline < asOf && remaining > 0;
    let status: GoalView['status'] = 'funding';
    if (goal.status === 'archived') status = 'archived';
    else if (consumed > 0 && remaining === 0) status = 'purchased';
    else if (totalFunded >= goal.targetAmount) status = 'funded';
    else if (overdue) status = 'overdue';
    return { goal, reserved, consumed, remaining, status, overdue };
  });
}

export function freeDisposable(
  totalBalance: Cents,
  totalReserved: Cents,
  safetyReserve: Cents,
): Cents {
  return totalBalance - totalReserved - safetyReserve;
}

export function allocationHeadroom(
  balances: Cents[],
  reserved: Cents,
  safetyReserve: Cents,
): Cents {
  if (balances.length === 0) return 0;
  const min = Math.min(...balances);
  return Math.max(0, min - reserved - safetyReserve);
}

export function isCovered(date: ISODate, coverage: CoverageInterval[]): boolean {
  return coverage.some((c) => c.start <= date && date <= c.end);
}

export function coveredDays(coverage: CoverageInterval[], from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (const c of coverage) {
    let cur = c.start > from ? c.start : from;
    const end = c.end < to ? c.end : to;
    while (cur <= end && out.length < 4000) {
      out.push(cur);
      cur = addDaysISO(cur, 1);
    }
  }
  return out.sort();
}

export function extendCoverageToToday(settings: Settings, today: ISODate): Settings {
  if (settings.coverage.length === 0) return settings;
  const sorted = [...settings.coverage].sort((a, b) => (a.start < b.start ? -1 : 1));
  const last = sorted[sorted.length - 1];
  if (last.end >= today) return settings;
  const gap = diffDays(last.end, today);
  if (gap > 31) return settings; // 中断太久不擅自视为完整覆盖
  const next = [...sorted];
  next[next.length - 1] = { start: last.start, end: today };
  return { ...settings, coverage: next };
}

/** 可变消费样本：仅实际支出，排除转账、已核销固定账单、目标购买、一次性标记。 */
export function isVariableExpense(t: Transaction): boolean {
  return t.kind === 'expense' && t.nature === 'variable' && !t.occurrenceId && !t.goalId;
}

export function variableExpenseByDay(
  transactions: Transaction[],
  from: ISODate,
  to: ISODate,
  coverage: CoverageInterval[],
): Map<ISODate, Cents> {
  const map = new Map<ISODate, Cents>();
  for (const d of coveredDays(coverage, from, to)) map.set(d, 0);
  for (const t of transactions) {
    if (!isVariableExpense(t)) continue;
    if (t.date < from || t.date > to) continue;
    if (!isCovered(t.date, coverage)) continue;
    map.set(t.date, (map.get(t.date) ?? 0) + t.amount);
  }
  return map;
}

export function validateCoverage(intervals: CoverageInterval[]): string | null {
  for (const c of intervals) {
    if (!isValidISODate(c.start) || !isValidISODate(c.end)) return '覆盖区间日期无效';
    if (c.start > c.end) return '覆盖区间开始日期晚于结束日期';
  }
  const sorted = [...intervals].sort((a, b) => (a.start < b.start ? -1 : 1));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start <= sorted[i - 1].end) return '覆盖区间存在重叠';
  }
  return null;
}