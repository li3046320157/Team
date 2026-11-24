/** 可变消费模型：六周同星期中位数 → 月预算日均 → 覆盖率日均 → 未估计 的明确降级链。 */
import type { Cents, CoverageInterval, ISODate, Transaction, VariableSource } from '../types';
import { addDaysISO, daysInMonthOf, weekdayIndex } from '../days';
import { coveredDays, variableExpenseByDay } from '../ledger';

export interface WeekdayStat {
  weekday: number;
  samples: number;
  median: Cents | null;
  values: Cents[];
}

export interface VariableModel {
  weekdayStats: WeekdayStat[];
  coveredDayCount: number;
  trainingDayCount: number;
  budgetMonthly: Cents;
  avgDaily: Cents | null;
  sourceByWeekday: VariableSource[];
  predict: (date: ISODate) => { raw: Cents | null; source: VariableSource };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function buildVariableModel(params: {
  transactions: Transaction[];
  coverage: CoverageInterval[];
  asOfDate: ISODate;
  budgetMonthly: Cents;
  trainingWeeks?: number;
}): VariableModel {
  const { transactions, coverage, asOfDate, budgetMonthly } = params;
  const trainingStart = addDaysISO(asOfDate, -7 * (params.trainingWeeks ?? 6));
  const trainingEnd = addDaysISO(asOfDate, -1);
  const dailyMap = variableExpenseByDay(transactions, trainingStart, trainingEnd, coverage);
  const trainingDays = [...dailyMap.keys()].sort();

  const stats: WeekdayStat[] = Array.from({ length: 7 }, (_, w) => ({
    weekday: w,
    samples: 0,
    median: null,
    values: [],
  }));
  for (const [date, amount] of dailyMap) {
    const w = weekdayIndex(date);
    stats[w].values.push(amount);
    stats[w].samples += 1;
  }
  for (const s of stats) s.median = median(s.values);

  const totalCovered = coveredDays(coverage, '1970-01-01', asOfDate).length;
  const allTrainValues = trainingDays.map((d) => dailyMap.get(d) ?? 0);
  const avgDaily =
    trainingDays.length >= 7
      ? Math.round(allTrainValues.reduce((a, b) => a + b, 0) / trainingDays.length)
      : null;

  const sourceByWeekday: VariableSource[] = stats.map((s) => {
    if (s.samples >= 3 && s.median !== null) return 'weekday';
    if (budgetMonthly > 0) return 'budget';
    if (avgDaily !== null) return 'daily_avg';
    return 'none';
  });

  const predict = (date: ISODate): { raw: Cents | null; source: VariableSource } => {
    const w = weekdayIndex(date);
    const s = stats[w];
    if (s.samples >= 3 && s.median !== null) return { raw: s.median, source: 'weekday' };
    if (budgetMonthly > 0) {
      const dim = daysInMonthOf(date);
      return { raw: Math.round(budgetMonthly / dim), source: 'budget' };
    }
    if (avgDaily !== null) return { raw: avgDaily, source: 'daily_avg' };
    return { raw: null, source: 'none' };
  };

  return {
    weekdayStats: stats,
    coveredDayCount: totalCovered,
    trainingDayCount: trainingDays.length,
    budgetMonthly,
    avgDaily,
    sourceByWeekday,
    predict,
  };
}

export function applyBias(
  raw: Cents | null,
  weekday: number,
  weekdayBias: Record<number, Cents>,
): Cents | null {
  if (raw === null) return null;
  return Math.max(0, Math.round(raw + (weekdayBias[weekday] ?? 0)));
}