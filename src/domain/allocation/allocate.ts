/** 多目标储蓄分配：带上限的加权水位分配 + 三类策略。 */
import type { Cents, ISODate } from '../types';
import { addMonthsAnchored, daysInMonthOf, listMonthStarts, parseISODate } from '../days';
import { allocateByWeights } from '../money';

export type AllocationStrategy = 'balanced' | 'deadline' | 'priority';

export const STRATEGY_LABELS: Record<AllocationStrategy, string> = {
  balanced: '均衡型',
  deadline: '期限优先',
  priority: '重要性优先',
};

export interface AllocGoalInput {
  goalId: string;
  name: string;
  target: Cents;
  reserved: Cents;
  deadline: ISODate;
  priority: number;
  overdue: boolean;
  archived: boolean;
}

export interface GoalAllocation {
  goalId: string;
  name: string;
  remaining: Cents;
  monthlyNeed: Cents;
  opportunities: number;
  allocated: Cents;
  weight: number;
  status: 'active' | 'funded' | 'overdue' | 'archived';
}

export interface AllocationPlan {
  strategy: AllocationStrategy;
  budget: Cents;
  totalDemand: Cents;
  allocatedTotal: Cents;
  unallocated: Cents;
  goals: GoalAllocation[];
  notes: string[];
}

/** 截止日前剩余分配机会数（含本月一次）。逾期目标按 1 次处理。 */
export function countOpportunities(asOf: ISODate, deadline: ISODate, allocDay: number): number {
  if (deadline < asOf) return 0;
  const months = listMonthStarts(asOf, deadline);
  if (months.length === 0) return 0;
  let count = 1; // 本月从当前日期起仍有一次机会
  for (let i = 1; i < months.length; i += 1) {
    const m = months[i];
    const y = Number(m.slice(0, 4));
    const mo = Number(m.slice(5, 7));
    const day = Math.min(Math.max(1, allocDay), daysInMonthOf(m));
    const date = `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (date >= asOf && date <= deadline) count += 1;
  }
  return Math.min(count, 600);
}

export function monthlyNeed(remaining: Cents, opportunities: number): Cents {
  if (remaining <= 0) return 0;
  if (opportunities <= 0) return remaining;
  return Math.min(remaining, Math.ceil(remaining / opportunities));
}

export function strategyWeight(strategy: AllocationStrategy, priority: number, opportunities: number): number {
  const m = Math.max(opportunities, 1);
  if (strategy === 'balanced') return 1;
  if (strategy === 'deadline') return 1 / m;
  return Math.max(1, Math.min(5, priority)) / Math.sqrt(m);
}

export function planAllocation(params: {
  goals: AllocGoalInput[];
  asOfDate: ISODate;
  budget: Cents;
  allocDay: number;
  strategy: AllocationStrategy;
}): AllocationPlan {
  const { goals, asOfDate, budget, allocDay, strategy } = params;
  const notes: string[] = [];
  const active = goals.filter((g) => !g.archived);
  const rows = active.map((g) => {
    const remaining = Math.max(0, g.target - g.reserved);
    const opportunities = countOpportunities(asOfDate, g.deadline, allocDay);
    const monthly = monthlyNeed(remaining, opportunities);
    const status: GoalAllocation['status'] = remaining === 0 ? 'funded' : g.overdue ? 'overdue' : 'active';
    return {
      goalId: g.goalId,
      name: g.name,
      remaining,
      monthlyNeed: monthly,
      opportunities: opportunities === 0 ? 1 : opportunities,
      allocated: 0,
      weight: strategyWeight(strategy, g.priority, opportunities),
      status,
    };
  });

  const demands = rows.map((r) => r.monthlyNeed);
  const weights = rows.map((r) => r.weight);
  const cappedBudget = Math.max(0, budget);
  const allocated = allocateByWeights(demands, weights, cappedBudget);
  const totalDemand = demands.reduce((a, b) => a + b, 0);
  const allocatedTotal = allocated.reduce((a, b) => a + b, 0);

  rows.forEach((r, i) => {
    r.allocated = allocated[i];
  });

  if (totalDemand > cappedBudget) {
    notes.push(`本期可分配资金不足以覆盖全部月度需求，缺口 ¥${((totalDemand - cappedBudget) / 100).toFixed(2)}`);
  }
  if (cappedBudget > totalDemand) {
    notes.push(`本期需求 ¥${(totalDemand / 100).toFixed(2)}，剩余 ¥${((cappedBudget - totalDemand) / 100).toFixed(2)} 未分配`);
  }
  if (rows.some((r) => r.status === 'overdue')) notes.push('存在逾期未完成目标：未筹足金额全部显示为当前缺口');
  if (rows.length === 0) notes.push('暂无可分配目标');

  return {
    strategy,
    budget: cappedBudget,
    totalDemand,
    allocatedTotal,
    unallocated: Math.max(0, cappedBudget - allocatedTotal),
    goals: rows.map((r) => ({ ...r, opportunities: r.opportunities })),
    notes,
  };
}

export interface GoalProjection {
  goalId: string;
  completionDate: ISODate | null;
  monthsNeeded: number | null;
  windowLimited: boolean;
  projectedReserved: Cents;
  series: { date: ISODate; allocated: Cents; reserved: Cents }[];
}

export interface ProjectionResult {
  projections: GoalProjection[];
  months: ISODate[];
  notes: string[];
}

export function nextAllocationDates(asOf: ISODate, allocDay: number, months: number): ISODate[] {
  const dates: ISODate[] = [asOf];
  let cursor = asOf;
  for (let i = 0; i < months; i += 1) {
    cursor = addMonthsAnchored(cursor, 1, allocDay);
    dates.push(cursor);
  }
  return dates;
}

export function clampPriority(p: number): number {
  return Math.max(1, Math.min(5, Math.round(p)));
}

export function monthsBetween(a: ISODate, b: ISODate): number {
  const da = parseISODate(a);
  const db = parseISODate(b);
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
}