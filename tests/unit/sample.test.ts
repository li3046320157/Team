import { describe, expect, it } from 'vitest';
import { createDemoDataset, DEMO_MONTHS } from '../../src/data/sample';
import { createBackup, validateBackupText } from '../../src/domain/backup';
import { addDaysISO } from '../../src/domain/days';

const today = '2026-11-26';

describe('示例数据生成器', () => {
  it('确定性：同一 today 两次生成结果深相等', () => {
    expect(createDemoDataset(today)).toEqual(createDemoDataset(today));
  });

  it('引用完整、无未来流水、无早于期初、金额为正整数', () => {
    const ds = createDemoDataset(today);
    const accountIds = new Set(ds.accounts.map((a) => a.id));
    const categoryIds = new Set(ds.categories.map((c) => c.id));
    const flowIds = new Set(ds.flows.map((f) => f.id));
    const goalIds = new Set(ds.goals.map((g) => g.id));
    const openingByAccount = new Map(ds.accounts.map((a) => [a.id, a.openingDate]));
    for (const t of ds.transactions) {
      expect(accountIds.has(t.accountId)).toBe(true);
      expect(Number.isInteger(t.amount)).toBe(true);
      expect(t.amount).toBeGreaterThan(0);
      expect(t.date <= today).toBe(true);
      expect(t.date >= openingByAccount.get(t.accountId)!).toBe(true);
      if (t.categoryId) expect(categoryIds.has(t.categoryId)).toBe(true);
      if (t.goalId) expect(goalIds.has(t.goalId)).toBe(true);
    }
    for (const f of ds.flows) expect(accountIds.has(f.accountId)).toBe(true);
    for (const o of ds.occurrenceRecords) expect(flowIds.has(o.flowId)).toBe(true);
    for (const e of ds.goalEvents) {
      if (e.goalId) expect(goalIds.has(e.goalId)).toBe(true);
    }
  });

  it('生成的数据集能通过备份校验', () => {
    const ds = createDemoDataset(today);
    const result = validateBackupText(createBackup(ds));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('coverage 覆盖近 6 个月、meta.kind 为 demo、demoDate 锚定今天', () => {
    const ds = createDemoDataset(today);
    expect(ds.settings.coverage).toEqual([{ start: addDaysISO(today, -180), end: addDaysISO(today, -1) }]);
    expect(ds.meta.kind).toBe('demo');
    expect(ds.meta.demoDate).toBe(today);
    expect(DEMO_MONTHS).toBe(6);
    expect(ds.settings.onboardingDone).toBe(true);
    expect(ds.snapshots).toEqual([]);
    expect(ds.calibrations).toEqual([]);
  });

  it('交易条数在 150–240 之间，且计划 5 个、目标 3 个', () => {
    const ds = createDemoDataset(today);
    expect(ds.transactions.length).toBeGreaterThanOrEqual(150);
    expect(ds.transactions.length).toBeLessThanOrEqual(240);
    expect(ds.flows.length).toBe(5);
    expect(ds.goals.length).toBe(3);
    expect(ds.plans.length).toBe(1);
    expect(ds.accounts.length).toBe(3);
  });
});
