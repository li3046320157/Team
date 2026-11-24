/** 统一现金流预测引擎：基准与所有购买方案共用。 */
import type {
  Account,
  Cents,
  CoverageInterval,
  ForecastDay,
  ForecastInputsSummary,
  GoalFundEvent,
  ISODate,
  OccurrenceView,
  ScheduleOccurrence,
  ScheduledFlow,
  Settings,
  Transaction,
} from '../types';
import { addDaysISO, diffDays, weekdayIndex } from '../days';
import { totalBalanceAt, totalReservedAt } from '../ledger';
import { buildOccurrenceViews } from '../occurrences';
import { applyBias, buildVariableModel, type VariableModel } from './variable';

export interface ScenarioInput {
  purchases?: { date: ISODate; amount: Cents; consumeReserved?: Cents }[];
  reserves?: { date: ISODate; amount: Cents }[];
}

export interface ForecastRisk {
  minBalance: Cents;
  minBalanceDate: ISODate;
  minFree: Cents;
  minFreeDate: ISODate;
  firstBelowSafety: ISODate | null;
  firstNegative: ISODate | null;
  daysBelowSafety: number;
  end30: Cents;
  end60: Cents;
  end90: Cents;
}

export interface ForecastDataset {
  accounts: Account[];
  transactions: Transaction[];
  flows: ScheduledFlow[];
  occurrenceRecords: ScheduleOccurrence[];
  goalEvents: GoalFundEvent[];
}

export interface ForecastParams {
  asOfDate: ISODate;
  horizonDays?: number;
  dataset: ForecastDataset;
  coverage: CoverageInterval[];
  settings: Settings;
  scenario?: ScenarioInput;
}

export interface CoverageRisk {
  date: ISODate;
  availableBefore: Cents;
  expense: Cents;
  income: Cents;
  shortfall: Cents;
}

export interface ForecastResult {
  days: ForecastDay[];
  todayEnd: Cents;
  risk: ForecastRisk;
  model: VariableModel;
  summary: ForecastInputsSummary;
  startBalance: Cents;
  baseReserved: Cents;
  todayItems: OccurrenceView[];
  coverageRisks: CoverageRisk[];
  assumptions: string[];
}

export function assessRisk(days: ForecastDay[], asOfDate: ISODate, safetyReserve: Cents): ForecastRisk {
  const usable = days.filter((d) => !d.isToday);
  const list = usable.length > 0 ? usable : days;
  let minBalance = Number.POSITIVE_INFINITY;
  let minBalanceDate = asOfDate;
  let minFree = Number.POSITIVE_INFINITY;
  let minFreeDate = asOfDate;
  let firstBelowSafety: ISODate | null = null;
  let firstNegative: ISODate | null = null;
  let below = 0;
  for (const d of list) {
    if (d.balance < minBalance) {
      minBalance = d.balance;
      minBalanceDate = d.date;
    }
    if (d.free < minFree) {
      minFree = d.free;
      minFreeDate = d.date;
    }
    if (d.balance < 0 && !firstNegative) firstNegative = d.date;
    if (d.balance < safetyReserve && !firstBelowSafety) firstBelowSafety = d.date;
    if (d.balance < safetyReserve) below += 1;
  }
  if (!Number.isFinite(minBalance)) minBalance = 0;
  if (!Number.isFinite(minFree)) minFree = 0;
  const balanceAt = (date: ISODate): Cents => {
    let last: ForecastDay | undefined;
    for (const d of days) if (d.date <= date) last = d;
    return last?.balance ?? days[days.length - 1]?.balance ?? 0;
  };
  return {
    minBalance,
    minBalanceDate,
    minFree,
    minFreeDate,
    firstBelowSafety,
    firstNegative,
    daysBelowSafety: below,
    end30: balanceAt(addDaysISO(asOfDate, 30)),
    end60: balanceAt(addDaysISO(asOfDate, 60)),
    end90: balanceAt(addDaysISO(asOfDate, 90)),
  };
}

export function runForecast(params: ForecastParams): ForecastResult {
  const { asOfDate, settings, dataset, coverage } = params;
  const horizonDays = params.horizonDays ?? 90;
  const safetyReserve = settings.safetyReserve;

  const startBalance = totalBalanceAt(dataset.accounts, dataset.transactions, asOfDate);
  const baseReserved = totalReservedAt(dataset.goalEvents, asOfDate);
  const model = buildVariableModel({
    transactions: dataset.transactions,
    coverage,
    asOfDate,
    budgetMonthly: settings.budget.monthVariableBudget,
  });

  const from = addDaysISO(asOfDate, -400);
  const to = addDaysISO(asOfDate, horizonDays);
  const views = buildOccurrenceViews(dataset.flows, dataset.occurrenceRecords, from, to, asOfDate);

  const incomeByDay = new Map<ISODate, Cents>();
  const expenseByDay = new Map<ISODate, Cents>();
  let todayIncome = 0;
  let todayExpense = 0;
  const todayItems: OccurrenceView[] = [];
  const assumptions: string[] = [];

  for (const v of views) {
    if (v.status !== 'pending') continue;
    if (v.flow.kind === 'income') {
      if (v.dueDate < asOfDate) {
        // 逾期收入不默认当成已经到账
        continue;
      }
      if (v.dueDate === asOfDate) {
        todayIncome += v.amount;
        todayItems.push(v);
      } else {
        incomeByDay.set(v.dueDate, (incomeByDay.get(v.dueDate) ?? 0) + v.amount);
      }
    } else if (v.dueDate <= asOfDate) {
      // 逾期未确认支出按“今日待付”保守计入，并明确标注为假设
      todayExpense += v.amount;
      todayItems.push(v);
      if (v.dueDate < asOfDate) assumptions.push(`逾期支出「${v.flow.title}」按今日待付计入预计`);
    } else {
      expenseByDay.set(v.dueDate, (expenseByDay.get(v.dueDate) ?? 0) + v.amount);
    }
  }

  const purchases = [...(params.scenario?.purchases ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const scenarioByDay = new Map<ISODate, Cents>();
  const reservedDeltaByDay = new Map<ISODate, Cents>();
  for (const p of purchases) {
    if (p.date > to) continue;
    scenarioByDay.set(p.date, (scenarioByDay.get(p.date) ?? 0) + p.amount);
    if (p.consumeReserved) {
      reservedDeltaByDay.set(p.date, (reservedDeltaByDay.get(p.date) ?? 0) - p.consumeReserved);
    }
  }
  for (const r of params.scenario?.reserves ?? []) {
    if (r.date > to) continue;
    reservedDeltaByDay.set(r.date, (reservedDeltaByDay.get(r.date) ?? 0) + r.amount);
  }

  const days: ForecastDay[] = [];
  days.push({
    date: asOfDate,
    balance: startBalance,
    reserved: Math.max(0, baseReserved),
    free: startBalance - baseReserved - safetyReserve,
    income: 0,
    fixedExpense: 0,
    variableEstimate: null,
    variableSource: 'none',
    scenarioExpense: 0,
    isToday: true,
  });

  let balance =
    startBalance +
    todayIncome -
    todayExpense -
    (scenarioByDay.get(asOfDate) ?? 0);
  const reservedToday = Math.max(0, baseReserved + (reservedDeltaByDay.get(asOfDate) ?? 0));
  days.push({
    date: asOfDate,
    balance,
    reserved: reservedToday,
    free: balance - reservedToday - safetyReserve,
    income: todayIncome,
    fixedExpense: todayExpense,
    variableEstimate: 0,
    variableSource: 'none',
    scenarioExpense: scenarioByDay.get(asOfDate) ?? 0,
    isTodayEnd: true,
  });

  for (let i = 1; i <= horizonDays; i += 1) {
    const date = addDaysISO(asOfDate, i);
    const income = incomeByDay.get(date) ?? 0;
    const fixed = expenseByDay.get(date) ?? 0;
    const pred = model.predict(date);
    const variable = applyBias(pred.raw, weekdayIndex(date), settings.calibration.weekdayBias);
    const effective = variable ?? 0;
    const scenarioExpense = scenarioByDay.get(date) ?? 0;
    balance = balance + income - fixed - effective - scenarioExpense;
    const reserved = Math.max(0, baseReserved + (reservedDeltaByDay.get(date) ?? 0));
    days.push({
      date,
      balance,
      reserved,
      free: balance - reserved - safetyReserve,
      income,
      fixedExpense: fixed,
      variableEstimate: variable,
      variableSource: pred.source,
      scenarioExpense,
    });
  }

  const todayEnd = days[1].balance;
  const risk = assessRisk(days, asOfDate, safetyReserve);

  // 同一天的固定收入与支出只有日期时，按“支出先于收入”的保守顺序检查当日覆盖能力
  const coverageRisks: CoverageRisk[] = [];
  const todayDip = startBalance - todayExpense;
  if (todayDip < Math.min(safetyReserve, 0) || (todayDip < safetyReserve && todayEnd >= safetyReserve)) {
    coverageRisks.push({ date: asOfDate, availableBefore: startBalance, expense: todayExpense, income: todayIncome, shortfall: safetyReserve - todayDip });
  }
  const sameDayFixed = new Map<ISODate, { income: Cents; expense: Cents }>();
  for (const [date, amount] of incomeByDay) {
    const entry = sameDayFixed.get(date) ?? { income: 0, expense: 0 };
    entry.income += amount;
    sameDayFixed.set(date, entry);
  }
  for (const [date, amount] of expenseByDay) {
    const entry = sameDayFixed.get(date) ?? { income: 0, expense: 0 };
    entry.expense += amount;
    sameDayFixed.set(date, entry);
  }
  for (let i = 1; i <= horizonDays; i += 1) {
    const date = addDaysISO(asOfDate, i);
    const combo = sameDayFixed.get(date);
    if (!combo || combo.expense === 0) continue;
    const before = days.filter((d) => d.date < date).pop()?.balance ?? startBalance;
    const end = days.find((d) => d.date === date)?.balance ?? before;
    const dip = before - combo.expense;
    if (dip < Math.min(safetyReserve, 0) || (dip < safetyReserve && end >= safetyReserve)) {
      coverageRisks.push({ date, availableBefore: before, expense: combo.expense, income: combo.income, shortfall: safetyReserve - dip });
    }
  }

  const coveredCount = (() => {
    let n = 0;
    for (const c of coverage) n += Math.max(0, Math.min(diffDays(c.start, c.end), 4000) + 1);
    return n;
  })();
  const weekdaySamples: Record<number, number> = {};
  for (const s of model.weekdayStats) weekdaySamples[s.weekday] = s.samples;

  const summary: ForecastInputsSummary = {
    txnCount: dataset.transactions.length,
    coveredDays: coveredCount,
    trainingDays: model.trainingDayCount,
    weekdaySamples,
    safetyReserve,
    reserved: baseReserved,
    budget: settings.budget.monthVariableBudget,
  };

  assumptions.push('首版不估计当天还会发生的零散可变消费，今日日终只含已记录交易和待付计划');
  assumptions.push('同日固定收入与支出按“支出先于收入到账”的保守顺序检查覆盖能力；日终按净额计算');
  if (model.avgDaily === null && settings.budget.monthVariableBudget === 0) {
    assumptions.push('可变消费数据不足且未设置月预算：未来可变支出未估计，并非预测为零消费');
  }
  if (purchases.length > 0) assumptions.push('购买方案为虚拟模拟，未写入正式账本');

  return {
    days,
    todayEnd,
    risk,
    model,
    summary,
    startBalance,
    baseReserved,
    todayItems,
    coverageRisks,
    assumptions,
  };
}

export function sumReservedEvents(events: GoalFundEvent[], asOf: ISODate): Cents {
  let total = 0;
  for (const e of events) {
    if (e.date > asOf) continue;
    total += (e.type === 'reserve' ? 1 : -1) * e.amount;
  }
  return Math.max(0, total);
}