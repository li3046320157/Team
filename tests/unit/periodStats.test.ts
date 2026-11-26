import { describe, expect, it } from 'vitest';
import { categoryTotals, compareTotals, periodBreakdown, periodTotals } from '../../src/domain/periodStats';
import { periodOf } from '../../src/domain/period';
import { makeTxn } from './fixtures';

describe('周期聚合', () => {
  it('收入/支出/结余正确，且排除转账', () => {
    const txns = [
      makeTxn({ id: 'i1', kind: 'income', amount: 50_000, date: '2026-11-10' }),
      makeTxn({ id: 'e1', kind: 'expense', amount: 20_000, date: '2026-11-11' }),
      makeTxn({ id: 't1', kind: 'transfer', amount: 30_000, date: '2026-11-12', toAccountId: 'b' }),
      makeTxn({ id: 'out', kind: 'expense', amount: 9_999, date: '2026-10-31' }),
    ];
    const totals = periodTotals(txns, periodOf('month', '2026-11-26'));
    expect(totals.income).toBe(50_000);
    expect(totals.expense).toBe(20_000);
    expect(totals.net).toBe(30_000);
    expect(totals.count).toBe(2);
  });

  it('count 不含转账，maxExpense 取最大单笔支出', () => {
    const txns = [
      makeTxn({ id: 'e1', kind: 'expense', amount: 2_800, date: '2026-11-02' }),
      makeTxn({ id: 'e2', kind: 'expense', amount: 9_900, date: '2026-11-03' }),
      makeTxn({ id: 'e3', kind: 'expense', amount: 4_500, date: '2026-11-04' }),
      makeTxn({ id: 'i1', kind: 'income', amount: 100_000, date: '2026-11-05' }),
      makeTxn({ id: 't1', kind: 'transfer', amount: 10_000, date: '2026-11-06', toAccountId: 'b' }),
    ];
    const totals = periodTotals(txns, periodOf('month', '2026-11-26'));
    expect(totals.count).toBe(4);
    expect(totals.maxExpense).toBe(9_900);
  });

  it('分类聚合按金额降序，未分类的 categoryId 为 null', () => {
    const txns = [
      makeTxn({ id: 'a', kind: 'expense', amount: 3_000, date: '2026-11-02', categoryId: 'cat_a' }),
      makeTxn({ id: 'b', kind: 'expense', amount: 5_000, date: '2026-11-03', categoryId: 'cat_b' }),
      makeTxn({ id: 'c', kind: 'expense', amount: 2_000, date: '2026-11-04', categoryId: undefined }),
      makeTxn({ id: 'i', kind: 'income', amount: 9_000, date: '2026-11-05', categoryId: 'cat_b' }),
    ];
    const rows = categoryTotals(txns, periodOf('month', '2026-11-26'), 'expense');
    expect(rows.map((r) => r.categoryId)).toEqual(['cat_b', 'cat_a', null]);
    expect(rows.map((r) => r.amount)).toEqual([5_000, 3_000, 2_000]);
    expect(rows.find((r) => r.categoryId === null)?.count).toBe(1);
  });

  it('年视图 12 个桶，桶之和等于全年总额', () => {
    const txns = [
      makeTxn({ id: 'e1', kind: 'expense', amount: 1_000, date: '2026-01-15' }),
      makeTxn({ id: 'e2', kind: 'expense', amount: 2_000, date: '2026-12-20' }),
      makeTxn({ id: 'i1', kind: 'income', amount: 50_000, date: '2026-06-01' }),
    ];
    const period = periodOf('year', '2026-06-01');
    const buckets = periodBreakdown(txns, period);
    expect(buckets).toHaveLength(12);
    expect(buckets[0].start).toBe('2026-01-01');
    expect(buckets[11].end).toBe('2026-12-31');
    expect(buckets.reduce((s, b) => s + b.expense, 0)).toBe(periodTotals(txns, period).expense);
    expect(buckets.reduce((s, b) => s + b.income, 0)).toBe(50_000);
    expect(buckets[5].label).toBe('6月');
  });

  it('周视图 7 个桶，跨月周首尾日期正确', () => {
    const txns = [
      makeTxn({ id: 'a', kind: 'expense', amount: 1_000, date: '2026-11-30' }),
      makeTxn({ id: 'b', kind: 'expense', amount: 2_000, date: '2026-12-03' }),
      makeTxn({ id: 'c', kind: 'expense', amount: 4_000, date: '2026-12-06' }),
    ];
    const period = periodOf('week', '2026-12-01'); // 2026-11-30 .. 2026-12-06
    const buckets = periodBreakdown(txns, period);
    expect(buckets).toHaveLength(7);
    expect(buckets[0].start).toBe('2026-11-30');
    expect(buckets[0].end).toBe('2026-11-30');
    expect(buckets[6].start).toBe('2026-12-06');
    expect(buckets[6].end).toBe('2026-12-06');
    expect(buckets.reduce((s, b) => s + b.expense, 0)).toBe(7_000);
  });

  it('compareTotals：上期为 0 时百分比为 null', () => {
    const cur = periodTotals([makeTxn({ id: 'a', kind: 'expense', amount: 1_000, date: '2026-11-02' })], periodOf('month', '2026-11-26'));
    const prev = periodTotals([], periodOf('month', '2026-10-26'));
    const delta = compareTotals(cur, prev);
    expect(delta.expenseDelta).toBe(1_000);
    expect(delta.netDelta).toBe(-1_000);
    expect(delta.incomePct).toBeNull();
    expect(delta.expensePct).toBeNull();
  });

  it('compareTotals：有上期时给出差额与百分比', () => {
    const cur = periodTotals(
      [makeTxn({ id: 'a', kind: 'expense', amount: 3_000, date: '2026-11-02' })],
      periodOf('month', '2026-11-26'),
    );
    const prev = periodTotals(
      [makeTxn({ id: 'b', kind: 'expense', amount: 2_000, date: '2026-10-02' })],
      periodOf('month', '2026-10-26'),
    );
    const delta = compareTotals(cur, prev);
    expect(delta.expenseDelta).toBe(1_000);
    expect(delta.expensePct).toBe(50);
    expect(delta.incomeDelta).toBe(0);
    expect(delta.incomePct).toBeNull();
  });
});
