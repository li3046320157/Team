import { describe, expect, it } from 'vitest';
import { periodOf } from '../../src/domain/period';
import {
  budgetExecution,
  budgetForPeriod,
  categoryTrend,
  reportToCSV,
  savingsRate,
  seriesTotals,
} from '../../src/domain/reportSeries';
import { csvCell } from '../../src/domain/csv';
import { makeCategory, makeTxn } from './fixtures';

describe('预算折算 budgetForPeriod', () => {
  const B = 420000;

  it('整月等于月预算', () => {
    expect(budgetForPeriod(periodOf('month', '2026-11-15'), B)).toBe(B);
  });

  it('单日按当月天数折算', () => {
    expect(budgetForPeriod(periodOf('day', '2026-11-26'), B)).toBe(Math.round(B / 30));
  });

  it('跨月周按天加权', () => {
    const week = periodOf('week', '2026-12-01'); // 2026-11-30 ~ 2026-12-06
    expect(week.start).toBe('2026-11-30');
    expect(week.end).toBe('2026-12-06');
    expect(budgetForPeriod(week, B)).toBe(Math.round(B / 30 + (6 * B) / 31));
  });

  it('整年等于 12 倍月预算', () => {
    expect(budgetForPeriod(periodOf('year', '2026-06-01'), B)).toBe(12 * B);
  });

  it('闰年整年仍等于 12 倍月预算（不是 B×366/30）', () => {
    expect(budgetForPeriod(periodOf('year', '2024-06-01'), B)).toBe(12 * B);
  });

  it('预算为 0 时返回 0', () => {
    expect(budgetForPeriod(periodOf('month', '2026-11-15'), 0)).toBe(0);
  });
});

describe('预算执行 budgetExecution', () => {
  const period = periodOf('month', '2026-11-15');

  it('used 只统计可变消费；固定核销、目标购买、一次性、转账都不计入', () => {
    const txns = [
      makeTxn({ id: 'v', date: '2026-11-05', amount: 1000 }),
      makeTxn({ id: 'occ', date: '2026-11-06', amount: 2000, occurrenceId: 'occ:f:2026-11-06' }),
      makeTxn({ id: 'goal', date: '2026-11-07', amount: 1500, goalId: 'g' }),
      makeTxn({ id: 'once', date: '2026-11-08', amount: 500, nature: 'one_off' }),
      makeTxn({ id: 'tr', date: '2026-11-09', amount: 3000, kind: 'transfer', toAccountId: 'b' }),
      makeTxn({ id: 'rec', date: '2026-11-10', amount: 800, nature: 'recurring' }),
    ];
    const r = budgetExecution({ transactions: txns, period, monthlyBudget: B(), today: '2026-11-26' });
    expect(r.used).toBe(1000);
    expect(r.variableCount).toBe(1);
    expect(r.totalExpense).toBe(5800);
    expect(r.budget).toBe(B());
  });

  function B() {
    return 420000;
  }

  it('status 阈值：0.79→safe、0.8→near、1.0→near、1.01→over', () => {
    const mk = (used: number) =>
      budgetExecution({
        transactions: [makeTxn({ id: 'u', date: '2026-11-05', amount: used })],
        period,
        monthlyBudget: 10000,
        today: '2026-11-26',
      });
    expect(mk(7900).status).toBe('safe');
    expect(mk(8000).status).toBe('near');
    expect(mk(10000).status).toBe('near');
    expect(mk(10100).status).toBe('over');
  });

  it('当前周期 pacing：按已过天数折算月底预计与超支', () => {
    const june = periodOf('month', '2026-06-10');
    const r = budgetExecution({
      transactions: [makeTxn({ id: 'u', date: '2026-06-03', amount: 200000 })],
      period: june,
      monthlyBudget: 420000,
      today: '2026-06-10',
    });
    expect(r.pacing).toEqual({ elapsedDays: 10, totalDays: 30, projected: 600000, projectedOverspend: 180000 });
  });

  it('历史周期 pacing 为 null', () => {
    const aug = periodOf('month', '2026-08-01');
    const r = budgetExecution({
      transactions: [makeTxn({ id: 'u', date: '2026-08-03', amount: 200000 })],
      period: aug,
      monthlyBudget: 420000,
      today: '2026-11-26',
    });
    expect(r.pacing).toBeNull();
  });

  it('预算为 0：ratio null、status unset、pacing null', () => {
    const r = budgetExecution({
      transactions: [makeTxn({ id: 'u', date: '2026-11-05', amount: 1000 })],
      period,
      monthlyBudget: 0,
      today: '2026-11-26',
    });
    expect(r.budget).toBe(0);
    expect(r.ratio).toBeNull();
    expect(r.status).toBe('unset');
    expect(r.pacing).toBeNull();
  });
});

describe('多期序列 seriesTotals', () => {
  it('12 期升序、空期补零、跨年 label 正确', () => {
    const txns = [
      makeTxn({ id: 'i', date: '2026-11-05', amount: 10000, kind: 'income' }),
      makeTxn({ id: 'e', date: '2026-11-06', amount: 4000 }),
      makeTxn({ id: 't', date: '2026-11-07', amount: 900, kind: 'transfer', toAccountId: 'b' }),
    ];
    const points = seriesTotals({
      transactions: txns,
      unit: 'month',
      anchor: '2026-11-26',
      count: 12,
      monthlyBudget: 0,
      today: '2026-11-26',
    });
    expect(points).toHaveLength(12);
    expect(points[0].key).toBe('month:2025-12-01');
    expect(points[0].label).toBe('2025年12月');
    expect(points[11].key).toBe('month:2026-11-01');
    expect(points[11].label).toBe('11月');
    for (let i = 0; i < 11; i += 1) {
      expect(points[i].income).toBe(0);
      expect(points[i].expense).toBe(0);
      expect(points[i].count).toBe(0);
    }
    expect(points[11]).toMatchObject({ income: 10000, expense: 4000, net: 6000, count: 2, variableExpense: 4000 });
  });
});

describe('分类趋势 categoryTrend', () => {
  it('TopN 排序、未分类单独成序列、其余并入其他、合计等于总支出', () => {
    const categories = [
      makeCategory({ id: 'c1', name: '餐饮' }),
      makeCategory({ id: 'c2', name: '交通' }),
      makeCategory({ id: 'c3', name: '娱乐' }),
    ];
    const txns = [
      makeTxn({ id: 'a', date: '2026-10-05', amount: 5000, categoryId: 'c1' }),
      makeTxn({ id: 'b', date: '2026-11-05', amount: 3000, categoryId: 'c2' }),
      makeTxn({ id: 'u', date: '2026-10-06', amount: 2000 }),
      makeTxn({ id: 'd', date: '2026-11-06', amount: 1000, categoryId: 'c3' }),
    ];
    const trend = categoryTrend({
      transactions: txns,
      categories,
      unit: 'month',
      anchor: '2026-11-26',
      count: 2,
      topN: 2,
      today: '2026-11-26',
    });
    expect(trend.buckets).toHaveLength(2);
    const byName = new Map(trend.series.map((s) => [s.name, s]));
    expect(byName.get('餐饮')?.total).toBe(5000);
    expect(byName.get('交通')?.total).toBe(3000);
    expect(byName.get('未分类')?.total).toBe(2000);
    expect(byName.get('其他')?.total).toBe(1000);
    // 每期各序列合计 = 该期总支出
    expect(trend.series.reduce((a, s) => a + s.values[1], 0)).toBe(4000);
    expect(trend.series.reduce((a, s) => a + s.values[0], 0)).toBe(7000);
  });
});

describe('储蓄率 savingsRate', () => {
  it('收入为 0 返回 null，不显示 0%', () => {
    expect(savingsRate(0, 5000)).toBeNull();
  });

  it('正常计算并保留 1 位小数', () => {
    expect(savingsRate(100000, 60000)).toBe(40);
    expect(savingsRate(100000, 50450)).toBe(49.6);
  });
});

describe('报表 CSV', () => {
  it('BOM 开头、含表头与 CRLF；csvCell 防公式注入', () => {
    const csv = reportToCSV([
      {
        key: 'month:2026-11-01',
        label: '2026年11月',
        start: '2026-11-01',
        end: '2026-11-30',
        income: 10000,
        expense: 4000,
        net: 6000,
        count: 2,
        variableExpense: 3000,
        budget: 420000,
      },
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('期数,开始,结束,收入,支出,结余,储蓄率,可变支出,预算,预算执行率');
    expect(csv).toContain('\r\n');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
  });
});
