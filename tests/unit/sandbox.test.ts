import { describe, expect, it } from 'vitest';
import { findEarliestSafeDate, runSandbox } from '../../src/domain/sandbox';
import type { Dataset } from '../../src/domain/types';
import { makeAccount, makeDataset, makeFlow, makeSettings } from './fixtures';

const asOf = '2026-07-01';

function ds(over: Partial<Dataset> = {}): Dataset {
  return makeDataset({ accounts: [makeAccount({ openingBalance: 1_000_000 })], ...over });
}

function settingsWith(safety: number) {
  return makeSettings({
    safetyReserve: safety,
    budget: { monthVariableBudget: 0, monthlySavingsCap: 0 },
    coverage: [{ start: '2026-06-25', end: '2026-06-30' }],
  });
}

describe('消费决策沙盘', () => {
  it('立即购买只影响一次，但后续所有余额点持续少购买金额', () => {
    const result = runSandbox({
      asOfDate: asOf,
      dataset: ds(),
      coverage: settingsWith(100_000).coverage,
      settings: settingsWith(100_000),
      purchase: { name: '手机', price: 300_000, purchaseDate: asOf, allowDelay: false, reserveUnit: 'month', reserveInterval: 1 },
      goalReserved: 0,
    });
    expect(result.immediate.forecast.days[0].balance).toBe(result.baseline.forecast.days[0].balance);
    for (let i = 1; i < result.baseline.forecast.days.length; i += 1) {
      expect(result.baseline.forecast.days[i].balance - result.immediate.forecast.days[i].balance).toBe(300_000);
    }
    expect(result.immediate.risk.minBalance).toBe(700_000);
  });

  it('立即购买触发安全储备风险时如实报告', () => {
    const settings = settingsWith(800_000);
    const result = runSandbox({
      asOfDate: asOf,
      dataset: ds(),
      coverage: settings.coverage,
      settings,
      purchase: { name: '手机', price: 300_000, purchaseDate: asOf, allowDelay: true, reserveUnit: 'week', reserveInterval: 1 },
      goalReserved: 0,
    });
    expect(result.immediate.risk.firstBelowSafety).toBe(asOf);
    expect(result.immediate.summary.join('')).toContain('低于安全储备');
    expect(result.earliestSafeDate).toBeNull();
  });

  it('搜索 90 天内最早安全购买日', () => {
    const flows = [makeFlow({ id: 'bonus', kind: 'income', title: '奖金', amount: 600_000, startDate: '2026-07-15', anchorDay: 15, rule: { unit: 'day', interval: 1 }, endDate: '2026-07-15' })];
    const settings = settingsWith(100_000);
    const result = runSandbox({
      asOfDate: asOf,
      dataset: ds({ flows }),
      coverage: settings.coverage,
      settings,
      purchase: { name: '相机', price: 1_400_000, purchaseDate: '2026-07-20', allowDelay: true, reserveUnit: 'month', reserveInterval: 1 },
      goalReserved: 0,
    });
    expect(result.earliestSafeDate).toBe('2026-07-15');
    const delayed = runSandbox({
      asOfDate: asOf,
      dataset: ds({ flows }),
      coverage: settings.coverage,
      settings,
      purchase: { name: '相机', price: 1_400_000, purchaseDate: '2026-07-15', allowDelay: true, reserveUnit: 'month', reserveInterval: 1 },
      goalReserved: 0,
    });
    expect(delayed.delayed.risk.firstBelowSafety).toBeNull();
  });

  it('分阶段预留不降低总余额，资金不足时明确未完成', () => {
    const settings = settingsWith(950_000);
    const result = runSandbox({
      asOfDate: asOf,
      dataset: ds(),
      coverage: settings.coverage,
      settings,
      purchase: { name: '电脑', price: 300_000, purchaseDate: asOf, allowDelay: true, reserveUnit: 'month', reserveInterval: 1 },
      goalReserved: 0,
    });
    expect(result.staged.completed).toBe(false);
    expect(result.staged.reason).toContain('仍差');
    // 未完成时没有购买事件，余额与基准一致
    for (let i = 1; i < result.baseline.forecast.days.length; i += 1) {
      expect(result.staged.forecast.days[i].balance).toBe(result.baseline.forecast.days[i].balance);
    }
  });

  it('分阶段预留会先减少可支配金额，购买后不重复扣减', () => {
    const settings = settingsWith(100_000);
    const result = runSandbox({
      asOfDate: asOf,
      dataset: ds(),
      coverage: settings.coverage,
      settings,
      purchase: { name: '耳机', price: 300_000, purchaseDate: asOf, allowDelay: true, reserveUnit: 'month', reserveInterval: 1 },
      goalReserved: 0,
    });
    expect(result.staged.completed).toBe(true);
    const buyDate = result.staged.purchaseDates[0];
    const buyDay = result.staged.forecast.days.find((d) => d.date === buyDate && !d.isToday);
    const baselineBuyDay = result.baseline.forecast.days.find((d) => d.date === buyDate && !d.isToday);
    expect(baselineBuyDay!.balance - buyDay!.balance).toBe(300_000);
    expect(buyDay!.reserved).toBe(0);
    // 购买消耗预留，可支配金额不再因预留额外减少：仅比基准少购买金额
    expect(baselineBuyDay!.free - buyDay!.free).toBe(300_000);
  });

  it('模拟只返回结果，不写入账本数据', () => {
    const dataset = ds();
    const before = JSON.stringify(dataset);
    runSandbox({
      asOfDate: asOf,
      dataset,
      coverage: settingsWith(100_000).coverage,
      settings: settingsWith(100_000),
      purchase: { name: '测试', price: 100_000, purchaseDate: asOf, allowDelay: true, reserveUnit: 'week', reserveInterval: 1 },
      goalReserved: 0,
    });
    expect(JSON.stringify(dataset)).toBe(before);
  });

  it('findEarliestSafeDate 在窗口内无解时返回 null', () => {
    const settings = settingsWith(100_000);
    const result = runSandbox({
      asOfDate: asOf,
      dataset: ds(),
      coverage: settings.coverage,
      settings,
      purchase: { name: '房', price: 5_000_000, purchaseDate: asOf, allowDelay: true, reserveUnit: 'month', reserveInterval: 1 },
      goalReserved: 0,
    });
    expect(result.earliestSafeDate).toBeNull();
    expect(findEarliestSafeDate(result.baseline.forecast.days, asOf, 5_000_000, 100_000, 90)).toBeNull();
  });
});