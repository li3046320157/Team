import { describe, expect, it } from 'vitest';
import { runForecast } from '../../src/domain/forecasting/engine';
import { assessRisk } from '../../src/domain/forecasting/engine';
import type { Dataset } from '../../src/domain/types';
import { makeAccount, makeCategory, makeDataset, makeFlow, makeSettings, makeTxn } from './fixtures';

const asOf = '2026-06-30';

function ds(over: Partial<Dataset> = {}): Dataset {
  return makeDataset({ accounts: [makeAccount({ openingBalance: 1_000_000 })], ...over });
}

function run(dataset: Dataset, settings = makeSettings({ budget: { monthVariableBudget: 0, monthlySavingsCap: 0 }, coverage: [{ start: '2026-06-25', end: '2026-06-30' }] })) {
  return runForecast({ asOfDate: asOf, dataset, coverage: settings.coverage, settings, horizonDays: 90 });
}

describe('现金流预测引擎', () => {
  it('起点严格等于当前真实余额', () => {
    const r = run(ds({ transactions: [makeTxn({ amount: 100_000, date: '2026-06-10' })] }));
    expect(r.startBalance).toBe(900_000);
    expect(r.days[0].date).toBe(asOf);
    expect(r.days[0].balance).toBe(900_000);
    expect(r.days[1].isTodayEnd).toBe(true);
  });

  it('逾期支出按今日待付计入，逾期收入不当成已到账', () => {
    const flows = [
      makeFlow({ id: 'rent', kind: 'expense', amount: 200_000, startDate: '2026-05-01', anchorDay: 1 }),
      makeFlow({ id: 'salary', kind: 'income', amount: 300_000, startDate: '2026-05-10', anchorDay: 10, title: '工资', accountId: 'acc_main' }),
    ];
    const r = run(ds({ flows }));
    expect(r.days[1].balance).toBe(1_000_000 - 400_000);
    const jul1 = r.days.find((d) => d.date === '2026-07-01');
    expect(jul1?.balance).toBe(600_000 - 200_000);
    const jul10 = r.days.find((d) => d.date === '2026-07-10');
    expect(jul10?.income).toBe(300_000);
  });

  it('已核销实例不再次扣款', () => {
    const txn = makeTxn({
      id: 'settled_tx',
      amount: 200_000,
      date: '2026-06-01',
      occurrenceId: 'occ:rent:2026-06-01',
      nature: 'recurring',
    });
    const flows = [makeFlow({ id: 'rent', amount: 200_000, startDate: '2026-05-01', anchorDay: 1 })];
    const occurrenceRecords = [
      {
        id: 'occ:rent:2026-06-01',
        flowId: 'rent',
        originalDueDate: '2026-06-01',
        dueDate: '2026-06-01',
        amount: 200_000,
        status: 'settled' as const,
        transactionId: 'settled_tx',
      },
    ];
    const r = run(ds({ flows, transactions: [txn], occurrenceRecords }));
    expect(r.startBalance).toBe(800_000);
    expect(r.days[1].balance).toBe(600_000); // 只扣 5 月逾期一笔
    expect(r.days.find((d) => d.date === '2026-06-01')).toBeUndefined();
  });

  it('无足够历史时降级到月预算日均，并标注来源', () => {
    const settings = makeSettings({
      budget: { monthVariableBudget: 140_000, monthlySavingsCap: 0 },
      coverage: [{ start: '2026-06-20', end: '2026-06-30' }],
    });
    const r = run(ds(), settings);
    const d = r.days.find((x) => x.date === '2026-07-01');
    expect(d?.variableSource).toBe('budget');
    expect(d?.variableEstimate).toBe(Math.round(140_000 / 31));
  });

  it('同星期中位数优先于预算', () => {
    const settings = makeSettings({
      budget: { monthVariableBudget: 500_000, monthlySavingsCap: 0 },
      coverage: [{ start: '2026-05-01', end: '2026-06-30' }],
    });
    const txns = ['2026-06-02', '2026-06-09', '2026-06-16', '2026-06-23'].map((date, i) =>
      makeTxn({ id: `t${i}`, date, amount: 3000 }),
    );
    const r = run(ds({ transactions: txns }), settings);
    const tue = r.days.find((x) => x.date === '2026-07-07');
    expect(tue?.variableSource).toBe('weekday');
    expect(tue?.variableEstimate).toBe(3000);
  });

  it('数据不足且无预算时明确未估计，而不是零消费', () => {
    const r = run(ds());
    const future = r.days.find((d) => d.date === '2026-07-01');
    expect(future?.variableEstimate).toBeNull();
    expect(future?.variableSource).toBe('none');
    expect(r.assumptions.some((a) => a.includes('未估计'))).toBe(true);
  });

  it('相同输入产生完全相同的输出', () => {
    const dataset = ds({ transactions: [makeTxn({ amount: 5000, date: '2026-06-20' })] });
    const a = run(dataset);
    const b = run(dataset);
    expect(a.days).toEqual(b.days);
    expect(a.risk).toEqual(b.risk);
  });

  it('风险统计区分低于安全线与负余额', () => {
    const base = { budget: { monthVariableBudget: 0, monthlySavingsCap: 0 }, coverage: [{ start: '2026-06-25', end: '2026-06-30' }] };
    const r = run(ds(), makeSettings({ ...base, safetyReserve: 1_050_000 }));
    expect(r.risk.firstBelowSafety).toBe(asOf);
    expect(r.risk.firstNegative).toBeNull();

    const flows = [makeFlow({ id: 'big', kind: 'expense', amount: 1_500_000, startDate: '2026-07-01', anchorDay: 1 })];
    const r2 = run(ds({ flows }), makeSettings({ ...base, safetyReserve: 0 }));
    expect(r2.risk.firstNegative).toBe('2026-07-01');
  });

  it('支出与收入同日时保守检查覆盖能力', () => {
    const flows = [
      makeFlow({ id: 'rent', amount: 200_000, startDate: '2026-07-01', anchorDay: 1, kind: 'expense' }),
      makeFlow({ id: 'salary', amount: 200_000, startDate: '2026-07-01', anchorDay: 1, kind: 'income', title: '工资', accountId: 'acc_main' }),
    ];
    const settings = makeSettings({
      safetyReserve: 950_000,
      budget: { monthVariableBudget: 0, monthlySavingsCap: 0 },
      coverage: [{ start: '2026-06-25', end: '2026-06-30' }],
    });
    const r = run(ds({ flows }), settings);
    expect(r.risk.firstBelowSafety).toBeNull();
    expect(r.coverageRisks.some((c) => c.date === '2026-07-01')).toBe(true);
    expect(r.assumptions.some((a) => a.includes('支出先于收入'))).toBe(true);
  });

  it('90 天边界与最低余额日期正确', () => {
    const r = run(ds());
    expect(r.days[r.days.length - 1].date).toBe('2026-09-28');
    expect(r.risk.minBalance).toBe(1_000_000);
    expect(r.risk.minBalanceDate).toBe(asOf);
    expect(assessRisk(r.days, asOf, 0).end90).toBe(1_000_000);
  });
});