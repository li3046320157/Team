/** 报表页数据层：多期序列、预算折算与执行、分类趋势、CSV。全部纯函数，只读不写。 */
import type { Cents, Category, ISODate, Transaction } from './types';
import { addDaysISO, daysInMonthOf, diffDays, minISO } from './days';
import { periodCardLabel, periodOf, shiftPeriod, type Period, type PeriodUnit } from './period';
import { isVariableExpense } from './ledger';
import { csvCell } from './csv';
import { centsToYuan } from './money';

export const SERIES_COUNT: Record<PeriodUnit, number> = { day: 12, week: 12, month: 12, year: 5 };

export interface SeriesPoint {
  key: string;
  label: string;
  start: ISODate;
  end: ISODate;
  income: Cents;
  expense: Cents;
  net: Cents;
  count: number;
  variableExpense: Cents;
  budget: Cents;
}

function windowPeriods(unit: PeriodUnit, anchor: ISODate, count: number): Period[] {
  const anchorPeriod = periodOf(unit, anchor);
  const periods: Period[] = [];
  for (let i = 0; i < count; i += 1) {
    periods.push(shiftPeriod(anchorPeriod, -(count - 1 - i)));
  }
  return periods;
}

/** 从 anchor 所在周期往前数 count 期，按时间升序返回，空周期补零。 */
export function seriesTotals(input: {
  transactions: Transaction[];
  unit: PeriodUnit;
  anchor: ISODate;
  count: number;
  monthlyBudget: Cents;
  today: ISODate;
}): SeriesPoint[] {
  const { transactions, unit, anchor, count, monthlyBudget, today } = input;
  const periods = windowPeriods(unit, anchor, count);
  const points: SeriesPoint[] = periods.map((p) => ({
    key: p.key,
    label: periodCardLabel(p, today),
    start: p.start,
    end: p.end,
    income: 0,
    expense: 0,
    net: 0,
    count: 0,
    variableExpense: 0,
    budget: budgetForPeriod(p, monthlyBudget),
  }));
  const first = points[0];
  const last = points[points.length - 1];
  for (const t of transactions) {
    if (t.date < first.start || t.date > last.end) continue;
    const idx = points.findIndex((pt) => t.date >= pt.start && t.date <= pt.end);
    if (idx < 0) continue;
    const pt = points[idx];
    if (t.kind === 'transfer') continue;
    pt.count += 1;
    if (t.kind === 'income') {
      pt.income += t.amount;
    } else {
      pt.expense += t.amount;
      if (isVariableExpense(t)) pt.variableExpense += t.amount;
    }
  }
  for (const pt of points) pt.net = pt.income - pt.expense;
  return points;
}

/** 把「每月可变消费预算」按天折算到任意周期：整月取整月预算，跨月按天加权，只在最后取整。 */
export function budgetForPeriod(period: Period, monthlyBudget: Cents): Cents {
  if (monthlyBudget <= 0) return 0;
  let sum = 0;
  let cur = period.start;
  while (cur <= period.end) {
    sum += monthlyBudget / daysInMonthOf(cur);
    cur = addDaysISO(cur, 1);
  }
  return Math.round(sum);
}

export interface BudgetExecution {
  monthlyBudget: Cents;
  budget: Cents;
  used: Cents;
  remaining: Cents;
  ratio: number | null;
  totalExpense: Cents;
  variableCount: number;
  status: 'unset' | 'safe' | 'near' | 'over';
  pacing: {
    elapsedDays: number;
    totalDays: number;
    projected: Cents;
    projectedOverspend: Cents;
  } | null;
}

export function budgetExecution(input: {
  transactions: Transaction[];
  period: Period;
  monthlyBudget: Cents;
  today: ISODate;
}): BudgetExecution {
  const { transactions, period, monthlyBudget, today } = input;
  const budget = budgetForPeriod(period, monthlyBudget);
  let used = 0;
  let totalExpense = 0;
  let variableCount = 0;
  for (const t of transactions) {
    if (t.date < period.start || t.date > period.end || t.kind === 'transfer') continue;
    if (t.kind !== 'expense') continue;
    totalExpense += t.amount;
    if (isVariableExpense(t)) {
      used += t.amount;
      variableCount += 1;
    }
  }
  const ratio = budget > 0 ? used / budget : null;
  let status: BudgetExecution['status'];
  if (monthlyBudget <= 0) status = 'unset';
  else if (budget === 0) status = used > 0 ? 'over' : 'safe';
  else if (ratio! < 0.8) status = 'safe';
  else if (ratio! <= 1) status = 'near';
  else status = 'over';
  let pacing: BudgetExecution['pacing'] = null;
  if (monthlyBudget > 0 && period.end >= today) {
    const elapsedDays = diffDays(period.start, minISO(period.end, today)) + 1;
    const totalDays = diffDays(period.start, period.end) + 1;
    const projected = Math.round((used / Math.max(1, elapsedDays)) * totalDays);
    pacing = {
      elapsedDays,
      totalDays,
      projected,
      projectedOverspend: Math.max(0, projected - budget),
    };
  }
  return { monthlyBudget, budget, used, remaining: budget - used, ratio, totalExpense, variableCount, status, pacing };
}

/** 净储蓄 / 总收入；收入为 0 时为 null（不显示 0%）。保留 1 位小数。 */
export function savingsRate(income: Cents, expense: Cents): number | null {
  if (income === 0) return null;
  return Math.round(((income - expense) / income) * 1000) / 10;
}

export interface CategoryTrendSeries {
  categoryId: string | null; // null=未分类；'__other__'=其他
  name: string;
  values: Cents[];
  total: Cents;
}

export interface CategoryTrend {
  buckets: { key: string; label: string }[];
  series: CategoryTrendSeries[];
}

const OTHER_ID = '__other__';

/** 窗口内 TopN 已命名分类 + 「未分类」单独成序列（不占 TopN 名额）+ 其余并入「其他」。 */
export function categoryTrend(input: {
  transactions: Transaction[];
  categories: Category[];
  unit: PeriodUnit;
  anchor: ISODate;
  count: number;
  topN?: number;
  today: ISODate;
}): CategoryTrend {
  const { transactions, categories, unit, anchor, count, today } = input;
  const topN = input.topN ?? 6;
  const pts = seriesTotals({ transactions, unit, anchor, count, monthlyBudget: 0, today });
  const buckets = pts.map((p) => ({ key: p.key, label: p.label }));
  const perPeriod = pts.map(() => new Map<string | null, Cents>());
  const totals = new Map<string | null, Cents>();
  const first = pts[0];
  const last = pts[pts.length - 1];
  for (const t of transactions) {
    if (t.kind !== 'expense' || t.date < first.start || t.date > last.end) continue;
    const idx = pts.findIndex((pt) => t.date >= pt.start && t.date <= pt.end);
    if (idx < 0) continue;
    const key = t.categoryId ?? null;
    perPeriod[idx].set(key, (perPeriod[idx].get(key) ?? 0) + t.amount);
    totals.set(key, (totals.get(key) ?? 0) + t.amount);
  }
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const named: Array<[string, Cents]> = [];
  for (const [k, v] of totals) if (k !== null) named.push([k, v]);
  named.sort((a, b) => b[1] - a[1]);
  const top = named.slice(0, topN);
  const restTotal = named.slice(topN).reduce((a, [, v]) => a + v, 0);
  const unclassifiedTotal = totals.get(null) ?? 0;
  const series: CategoryTrendSeries[] = [];
  for (const [id, total] of top) {
    series.push({
      categoryId: id,
      name: nameOf.get(id) ?? '未命名',
      values: perPeriod.map((m) => m.get(id) ?? 0),
      total,
    });
  }
  if (unclassifiedTotal > 0) {
    series.push({ categoryId: null, name: '未分类', values: perPeriod.map((m) => m.get(null) ?? 0), total: unclassifiedTotal });
  }
  if (restTotal > 0) {
    series.push({ categoryId: OTHER_ID, name: '其他', values: perPeriod.map((m) => 0), total: restTotal });
    // 「其他」逐期 = 该期总支出 − 已列序列之和，保证堆叠总和与总支出一致
    const restIdx = series.length - 1;
    for (let i = 0; i < perPeriod.length; i += 1) {
      let known = 0;
      for (let s = 0; s < restIdx; s += 1) known += series[s].values[i];
      const bucketExpense = pts[i].expense;
      series[restIdx].values[i] = Math.max(0, bucketExpense - known);
    }
  }
  return { buckets, series };
}

/** 报表 CSV：UTF-8 BOM + CRLF；金额列元、百分比保留 1 位小数、无预算为空。 */
export function reportToCSV(points: SeriesPoint[]): string {
  const header = ['期数', '开始', '结束', '收入', '支出', '结余', '储蓄率', '可变支出', '预算', '预算执行率'];
  const rows = [header.join(',')];
  for (const p of points) {
    const rate = savingsRate(p.income, p.expense);
    const exec = p.budget > 0 ? Math.round((p.variableExpense / p.budget) * 1000) / 10 : null;
    rows.push(
      [
        csvCell(p.label),
        csvCell(p.start),
        csvCell(p.end),
        csvCell(centsToYuan(p.income), true),
        csvCell(centsToYuan(p.expense), true),
        csvCell(centsToYuan(p.net), true),
        csvCell(rate === null ? '' : rate.toFixed(1)),
        csvCell(centsToYuan(p.variableExpense), true),
        csvCell(centsToYuan(p.budget), true),
        csvCell(exec === null ? '' : exec.toFixed(1)),
      ].join(','),
    );
  }
  return '\uFEFF' + rows.join('\r\n');
}
