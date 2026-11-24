import { describe, expect, it } from 'vitest';
import { countOpportunities, monthlyNeed, planAllocation, type AllocGoalInput } from '../../src/domain/allocation/allocate';
import { projectGoals } from '../../src/domain/allocation/plan';
import { makeAccount, makeDataset, makeSettings } from './fixtures';

const asOf = '2026-06-10';

function goal(over: Partial<AllocGoalInput> = {}): AllocGoalInput {
  return {
    goalId: 'g1',
    name: '目标',
    target: 10_000,
    reserved: 0,
    deadline: '2026-06-20',
    priority: 3,
    overdue: false,
    archived: false,
    ...over,
  };
}

describe('月度需求与分配机会', () => {
  it('本月从当前日期起算一次机会', () => {
    expect(countOpportunities(asOf, '2026-06-20', 25)).toBe(1);
    expect(monthlyNeed(10_000, 1)).toBe(10_000);
  });

  it('分配日越过月底时截断', () => {
    expect(countOpportunities('2026-01-01', '2026-03-31', 31)).toBe(3);
  });

  it('逾期目标按全部缺口处理', () => {
    expect(countOpportunities(asOf, '2026-05-01', 25)).toBe(0);
    expect(monthlyNeed(10_000, 0)).toBe(10_000);
  });
});

describe('三类策略分配（手算例）', () => {
  it('R1=100, R2=300，预算200，均衡', () => {
    const plan = planAllocation({
      goals: [goal({ goalId: 'g1', target: 10_000 }), goal({ goalId: 'g2', target: 30_000 })],
      asOfDate: asOf,
      budget: 20_000,
      allocDay: 25,
      strategy: 'balanced',
    });
    expect(plan.goals.map((g) => g.allocated)).toEqual([10_000, 10_000]);
    expect(plan.unallocated).toBe(0);
  });

  it('R1=50, R2=300，预算200，先满足上限', () => {
    const plan = planAllocation({
      goals: [goal({ goalId: 'g1', target: 5_000 }), goal({ goalId: 'g2', target: 30_000 })],
      asOfDate: asOf,
      budget: 20_000,
      allocDay: 25,
      strategy: 'balanced',
    });
    expect(plan.goals.map((g) => g.allocated)).toEqual([5_000, 15_000]);
  });

  it('总需求150，预算200，剩余标为未分配', () => {
    const plan = planAllocation({
      goals: [goal({ goalId: 'g1', target: 5_000 }), goal({ goalId: 'g2', target: 10_000 })],
      asOfDate: asOf,
      budget: 20_000,
      allocDay: 25,
      strategy: 'balanced',
    });
    expect(plan.allocatedTotal).toBe(15_000);
    expect(plan.unallocated).toBe(5_000);
    expect(plan.notes.join('')).toContain('未分配');
  });

  it('零预算与零目标', () => {
    const plan = planAllocation({ goals: [goal()], asOfDate: asOf, budget: 0, allocDay: 25, strategy: 'balanced' });
    expect(plan.goals[0].allocated).toBe(0);
    const empty = planAllocation({ goals: [], asOfDate: asOf, budget: 10_000, allocDay: 25, strategy: 'balanced' });
    expect(empty.goals).toHaveLength(0);
    expect(empty.notes.join('')).toContain('暂无可分配目标');
  });

  it('1 分预算不丢失也不超分', () => {
    const plan = planAllocation({
      goals: [goal({ goalId: 'g1' }), goal({ goalId: 'g2' }), goal({ goalId: 'g3' })],
      asOfDate: asOf,
      budget: 1,
      allocDay: 25,
      strategy: 'balanced',
    });
    expect(plan.allocatedTotal).toBe(1);
    expect(plan.goals.reduce((a, g) => a + g.allocated, 0)).toBe(1);
  });

  it('优先级影响分配结果', () => {
    const goals = [
      goal({ goalId: 'high', target: 10_000, priority: 5, deadline: '2026-08-20' }),
      goal({ goalId: 'low', target: 10_000, priority: 1, deadline: '2026-08-20' }),
    ];
    const priority = planAllocation({ goals, asOfDate: asOf, budget: 6_000, allocDay: 25, strategy: 'priority' });
    const balanced = planAllocation({ goals, asOfDate: asOf, budget: 6_000, allocDay: 25, strategy: 'balanced' });
    const highP = priority.goals.find((g) => g.goalId === 'high')!.allocated;
    const lowP = priority.goals.find((g) => g.goalId === 'low')!.allocated;
    expect(highP).toBeGreaterThan(lowP);
    expect(balanced.goals[0].allocated).toBe(3_000);
  });

  it('不超预算、不超单目标上限', () => {
    const plan = planAllocation({
      goals: [
        goal({ goalId: 'g1', target: 10_000, deadline: '2026-12-31' }),
        goal({ goalId: 'g2', target: 30_000, deadline: '2026-12-31' }),
      ],
      asOfDate: asOf,
      budget: 100_000,
      allocDay: 25,
      strategy: 'balanced',
    });
    expect(plan.allocatedTotal).toBeLessThanOrEqual(100_000);
    for (const g of plan.goals) expect(g.allocated).toBeLessThanOrEqual(g.remaining);
  });
});

describe('目标条件性完成时间', () => {
  const dataset = () =>
    makeDataset({
      accounts: [makeAccount({ openingBalance: 1_000_000 })],
      settings: makeSettings({
        safetyReserve: 100_000,
        budget: { monthVariableBudget: 0, monthlySavingsCap: 50_000 },
        coverage: [{ start: '2026-06-25', end: '2026-06-30' }],
      }),
    });

  it('有资金空间时给出完成日期', () => {
    const data = dataset();
    const result = projectGoals({
      goals: [goal({ goalId: 'g1', target: 100_000, deadline: '2026-12-31' })],
      asOfDate: '2026-06-30',
      dataset: data,
      coverage: data.settings.coverage,
      settings: data.settings,
      strategy: 'balanced',
    });
    expect(result.outcomes[0].completionDate).not.toBeNull();
    expect(result.outcomes[0].windowLimited).toBe(false);
    expect(result.outcomes[0].finalReserved).toBe(100_000);
  });

  it('无资金空间时明确窗口内无法估计，而不是伪造日期', () => {
    const data = makeDataset({
      accounts: [makeAccount({ openingBalance: 1_000_000 })],
      settings: makeSettings({
        safetyReserve: 1_000_000,
        budget: { monthVariableBudget: 0, monthlySavingsCap: 50_000 },
        coverage: [{ start: '2026-06-25', end: '2026-06-30' }],
      }),
    });
    const result = projectGoals({
      goals: [goal({ goalId: 'g1', target: 100_000, deadline: '2026-12-31' })],
      asOfDate: '2026-06-30',
      dataset: data,
      coverage: data.settings.coverage,
      settings: data.settings,
      strategy: 'balanced',
    });
    expect(result.outcomes[0].completionDate).toBeNull();
    expect(result.outcomes[0].windowLimited).toBe(true);
    expect(result.outcomes[0].series).toHaveLength(0);
  });
});