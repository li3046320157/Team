/** 周期聚合、分类、分解与环比。纯函数：输入输出只用 ISODate，不取当前时间。 */
import type { Cents, ISODate, Transaction } from './types';
import { addDaysISO, endOfMonthISO, minISO } from './days';
import type { Period } from './period';

export interface PeriodTotals {
  income: Cents;
  expense: Cents;
  net: Cents;
  count: number; // 不含转账
  maxExpense: Cents;
}

export function periodTotals(transactions: Transaction[], period: Period): PeriodTotals {
  let income = 0;
  let expense = 0;
  let count = 0;
  let maxExpense = 0;
  for (const t of transactions) {
    if (t.date < period.start || t.date > period.end) continue;
    if (t.kind === 'transfer') continue;
    count += 1;
    if (t.kind === 'income') {
      income += t.amount;
    } else {
      expense += t.amount;
      if (t.amount > maxExpense) maxExpense = t.amount;
    }
  }
  return { income, expense, net: income - expense, count, maxExpense };
}

export interface CategoryTotal {
  categoryId: string | null; // null = 未分类
  amount: Cents;
  count: number;
}

export function categoryTotals(
  transactions: Transaction[],
  period: Period,
  kind: 'expense' | 'income',
): CategoryTotal[] {
  const map = new Map<string | null, CategoryTotal>();
  for (const t of transactions) {
    if (t.kind !== kind || t.date < period.start || t.date > period.end) continue;
    const key = t.categoryId ?? null;
    const cur = map.get(key);
    if (cur) {
      cur.amount += t.amount;
      cur.count += 1;
    } else {
      map.set(key, { categoryId: key, amount: t.amount, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export interface BreakdownBucket {
  key: string;
  label: string;
  start: ISODate;
  end: ISODate;
  income: Cents;
  expense: Cents;
}

function shortLabel(d: ISODate): string {
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)}`;
}

/** 年 → 12 个月；月 → 按周（周一起，首尾周可不足 7 天）；周 → 7 天；日 → 单桶。桶完整覆盖周期且不重叠。 */
export function periodBreakdown(transactions: Transaction[], period: Period): BreakdownBucket[] {
  const buckets: BreakdownBucket[] = [];
  if (period.unit === 'year') {
    for (let m = 1; m <= 12; m += 1) {
      const start = `${period.start.slice(0, 4)}-${String(m).padStart(2, '0')}-01`;
      const end = endOfMonthISO(start);
      buckets.push({ key: `${period.key}:${m}`, label: `${m}月`, start, end, income: 0, expense: 0 });
    }
  } else if (period.unit === 'month') {
    let cur = period.start;
    while (cur <= period.end && buckets.length < 64) {
      const end = minISO(addDaysISO(cur, 6), period.end);
      buckets.push({
        key: `${period.key}:${cur}`,
        label: cur === end ? shortLabel(cur) : `${shortLabel(cur)}–${shortLabel(end)}`,
        start: cur,
        end,
        income: 0,
        expense: 0,
      });
      cur = addDaysISO(end, 1);
    }
  } else if (period.unit === 'week') {
    for (let i = 0; i < 7; i += 1) {
      const d = addDaysISO(period.start, i);
      buckets.push({ key: `${period.key}:${d}`, label: shortLabel(d), start: d, end: d, income: 0, expense: 0 });
    }
  } else {
    buckets.push({ key: period.key, label: shortLabel(period.start), start: period.start, end: period.end, income: 0, expense: 0 });
  }
  for (const t of transactions) {
    if (t.kind === 'transfer' || t.date < period.start || t.date > period.end) continue;
    const b = buckets.find((x) => t.date >= x.start && t.date <= x.end);
    if (!b) continue;
    if (t.kind === 'income') b.income += t.amount;
    else b.expense += t.amount;
  }
  return buckets;
}

export interface PeriodDelta {
  incomeDelta: Cents;
  expenseDelta: Cents;
  netDelta: Cents;
  incomePct: number | null; // 上期为 0 时为 null
  expensePct: number | null;
}

export function compareTotals(current: PeriodTotals, previous: PeriodTotals): PeriodDelta {
  const incomeDelta = current.income - previous.income;
  const expenseDelta = current.expense - previous.expense;
  return {
    incomeDelta,
    expenseDelta,
    netDelta: current.net - previous.net,
    incomePct: previous.income === 0 ? null : Math.round((incomeDelta / previous.income) * 100),
    expensePct: previous.expense === 0 ? null : Math.round((expenseDelta / previous.expense) * 100),
  };
}
