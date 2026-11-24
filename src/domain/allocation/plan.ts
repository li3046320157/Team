/** 目标条件性完成时间：沿同一条预测现金路径，按月滚动虚拟预留，最多 24 个月。 */
import type { Cents, ISODate } from '../types';
import { addDaysISO } from '../days';
import { runForecast, type ForecastDataset } from '../forecasting/engine';
import type { CoverageInterval, Settings } from '../types';
import {
  countOpportunities,
  monthlyNeed,
  nextAllocationDates,
  planAllocation,
  strategyWeight,
  type AllocationStrategy,
  type AllocGoalInput,
} from './allocate';
import { allocateByWeights } from '../money';

export interface ProjectionParams {
  goals: AllocGoalInput[];
  asOfDate: ISODate;
  dataset: ForecastDataset;
  coverage: CoverageInterval[];
  settings: Settings;
  strategy: AllocationStrategy;
  months?: number;
}

export interface ProjectionOutcome {
  goalId: string;
  completionDate: ISODate | null;
  monthsNeeded: number | null;
  windowLimited: boolean;
  finalReserved: Cents;
  series: { date: ISODate; allocated: Cents; reserved: Cents }[];
}

export interface GoalsProjection {
  outcomes: ProjectionOutcome[];
  notes: string[];
  horizonMonths: number;
}

export function projectGoals(params: ProjectionParams): GoalsProjection {
  const months = params.months ?? 24;
  const { goals, asOfDate, dataset, coverage, settings, strategy } = params;
  const safety = settings.safetyReserve;
  const savingsCap = settings.budget.monthlySavingsCap;

  // 一条 24 个月的现金路径；可变消费模型冻结在生成时已知数据
  const forecast = runForecast({
    asOfDate,
    horizonDays: months * 31 + 5,
    dataset,
    coverage,
    settings,
  });
  const balanceByDate = new Map<ISODate, Cents>();
  for (const d of forecast.days) {
    if (!d.isToday) balanceByDate.set(d.date, d.balance);
  }
  const balanceAt = (date: ISODate): Cents => {
    let last: Cents | undefined;
    for (const d of forecast.days) {
      if (d.isToday) continue;
      if (d.date <= date) last = d.balance;
    }
    return last ?? forecast.startBalance;
  };

  const active = goals.filter((g) => !g.archived);
  const virtualReserved = new Map<string, Cents>();
  for (const g of active) virtualReserved.set(g.goalId, Math.max(0, Math.min(g.reserved, g.target)));

  const dates = nextAllocationDates(asOfDate, settings.goalAllocDay, months);
  const series = new Map<string, { date: ISODate; allocated: Cents; reserved: Cents }[]>();
  const completion = new Map<string, ISODate | null>();
  for (const g of active) {
    series.set(g.goalId, []);
    completion.set(g.goalId, virtualReserved.get(g.goalId)! >= g.target ? asOfDate : null);
  }

  const notes: string[] = [];
  const baseReserved = forecast.baseReserved;
  let virtualTotal = 0;

  for (let idx = 0; idx < dates.length; idx += 1) {
    const date = dates[idx];
    if (date > addDaysISO(asOfDate, months * 31)) break;
    const open = active.filter((g) => {
      const reserved = virtualReserved.get(g.goalId) ?? 0;
      return reserved < g.target;
    });
    if (open.length === 0) break;

    const endOfWindow = addDaysISO(date, 90);
    let minHeadroom = Number.POSITIVE_INFINITY;
    for (const d of forecast.days) {
      if (d.isToday) continue;
      if (d.date < date || d.date > endOfWindow) continue;
      minHeadroom = Math.min(minHeadroom, d.balance - baseReserved - virtualTotal - safety);
    }
    const headroom = Number.isFinite(minHeadroom) ? Math.max(0, minHeadroom) : 0;
    const cap = savingsCap > 0 ? savingsCap : Number.POSITIVE_INFINITY;

    const rows = open.map((g) => {
      const reserved = virtualReserved.get(g.goalId) ?? 0;
      const remaining = Math.max(0, g.target - reserved);
      const opp = g.deadline < date ? 1 : countOpportunities(date, g.deadline, settings.goalAllocDay);
      return {
        goal: g,
        remaining,
        need: monthlyNeed(remaining, opp),
        weight: strategyWeight(strategy, g.priority, opp),
      };
    });
    const demands = rows.map((r) => r.need);
    const weights = rows.map((r) => r.weight);
    const budget = Math.min(Math.max(0, Math.floor(headroom)), Number.isFinite(cap) ? cap : Number.MAX_SAFE_INTEGER);
    const allocation = allocateByWeights(demands, weights, budget);

    rows.forEach((r, i) => {
      const amount = allocation[i];
      if (amount <= 0) return;
      const prev = virtualReserved.get(r.goal.goalId) ?? 0;
      const next = Math.min(r.goal.target, prev + amount);
      virtualReserved.set(r.goal.goalId, next);
      virtualTotal += next - prev;
      const list = series.get(r.goal.goalId)!;
      list.push({ date, allocated: next - prev, reserved: next });
      if (next >= r.goal.target && completion.get(r.goal.goalId) === null) {
        completion.set(r.goal.goalId, date);
      }
    });
  }

  const outcomes: ProjectionOutcome[] = active.map((g) => {
    const reserved = virtualReserved.get(g.goalId) ?? 0;
    const list = series.get(g.goalId) ?? [];
    const completionDate = completion.get(g.goalId) ?? null;
    const diff = completionDate ? indexOfMonth(dates, completionDate) : null;
    if (!completionDate) {
      notes.push(`「${g.name}」在 24 个月窗口内无法估计完成日期`);
    }
    return {
      goalId: g.goalId,
      completionDate,
      monthsNeeded: diff,
      windowLimited: !completionDate,
      finalReserved: reserved,
      series: list,
    };
  });

  if (savingsCap === 0) {
    notes.push('未设置每月储蓄上限：仅按未来 90 天最低可用空间分配');
  }

  return { outcomes, notes, horizonMonths: months };
}

function indexOfMonth(dates: ISODate[], date: ISODate): number {
  let count = 0;
  for (const d of dates) {
    if (d <= date) count += 1;
  }
  return Math.max(0, count - 1);
}

/** 单一策略分配（供目标页直接调用）。 */
export function allocateForMonth(
  goals: AllocGoalInput[],
  asOfDate: ISODate,
  budget: Cents,
  allocDay: number,
  strategy: AllocationStrategy,
) {
  return planAllocation({ goals, asOfDate, budget, allocDay, strategy });
}