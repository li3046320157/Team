import { describe, expect, it } from 'vitest';
import {
  accountBalanceAt,
  freeDisposable,
  goalViews,
  isVariableExpense,
  monthIncomeExpense,
  rangeIncomeExpense,
  totalBalanceAt,
  totalReservedAt,
  variableExpenseByDay,
} from '../../src/domain/ledger';
import { makeAccount, makeGoal, makeGoalEvent, makeSettings, makeTxn } from './fixtures';

describe('账户余额与资金守恒', () => {
  it('期初 + 收入 - 支出 = 当前余额', () => {
    const acc = makeAccount({ openingBalance: 100_000 });
    const txns = [
      makeTxn({ id: 't1', kind: 'income', amount: 50_000, date: '2026-01-05' }),
      makeTxn({ id: 't2', kind: 'expense', amount: 20_000, date: '2026-01-06' }),
    ];
    expect(accountBalanceAt(acc, txns, '2026-01-31')).toBe(130_000);
    expect(monthIncomeExpense(txns, '2026-01')).toEqual({ income: 50_000, expense: 20_000, net: 30_000 });
  });

  it('区间统计按闭区间汇总，边界日期与转账口径正确', () => {
    const txns = [
      makeTxn({ id: 'in', kind: 'income', amount: 80_000, date: '2026-06-01' }),
      makeTxn({ id: 'out', kind: 'expense', amount: 20_000, date: '2026-06-30' }),
      makeTxn({ id: 'next', kind: 'expense', amount: 30_000, date: '2026-07-01' }),
      makeTxn({ id: 'tr', kind: 'transfer', amount: 50_000, date: '2026-06-15', toAccountId: 'b' }),
    ];
    expect(rangeIncomeExpense(txns, '2026-06-01', '2026-06-30')).toEqual({ income: 80_000, expense: 20_000, net: 60_000 });
    expect(rangeIncomeExpense(txns, '2026-06-01', '2026-06-01')).toEqual({ income: 80_000, expense: 0, net: 80_000 });
  });

  it('转账不改变总资产、收入与支出统计', () => {
    const a = makeAccount({ id: 'a', openingBalance: 100_000 });
    const b = makeAccount({ id: 'b', openingBalance: 0, type: 'savings' });
    const transfer = makeTxn({ kind: 'transfer', amount: 30_000, accountId: 'a', toAccountId: 'b', nature: 'variable' });
    const txns = [transfer];
    expect(accountBalanceAt(a, txns, '2026-06-30')).toBe(70_000);
    expect(accountBalanceAt(b, txns, '2026-06-30')).toBe(30_000);
    expect(totalBalanceAt([a, b], txns, '2026-06-30')).toBe(100_000);
    expect(monthIncomeExpense(txns, '2026-06')).toEqual({ income: 0, expense: 0, net: 0 });
  });

  it('交易日期早于期初不计入', () => {
    const acc = makeAccount({ openingDate: '2026-06-01', openingBalance: 50_000 });
    const txns = [makeTxn({ amount: 10_000, date: '2026-05-01' })];
    expect(accountBalanceAt(acc, txns, '2026-06-30')).toBe(50_000);
  });

  it('预留守恒：预留不减少总余额；购买消耗后仍守恒', () => {
    const acc = makeAccount({ openingBalance: 1_000_000 });
    const settings = makeSettings({ safetyReserve: 100_000 });
    const reserved = [makeGoalEvent({ amount: 200_000, type: 'reserve' })];
    expect(totalReservedAt(reserved, '2026-06-30')).toBe(200_000);
    expect(freeDisposable(1_000_000, totalReservedAt(reserved, '2026-06-30'), settings.safetyReserve)).toBe(700_000);

    const purchase = makeTxn({ amount: 200_000, date: '2026-06-10', goalId: 'goal_travel', nature: 'one_off' });
    const after = [
      ...reserved,
      makeGoalEvent({ amount: 200_000, type: 'consume', date: '2026-06-10', transactionId: purchase.id }),
    ];
    const balance = accountBalanceAt(acc, [purchase], '2026-06-30');
    expect(balance).toBe(800_000);
    expect(totalReservedAt(after, '2026-06-30')).toBe(0);
    expect(freeDisposable(balance, totalReservedAt(after, '2026-06-30'), settings.safetyReserve)).toBe(700_000);
  });

  it('目标视图区分筹集中、已筹足、已完成购买与逾期', () => {
    const goals = [
      makeGoal({ id: 'g1' }),
      makeGoal({ id: 'g2', targetAmount: 100_000 }),
      makeGoal({ id: 'g3', targetAmount: 100_000 }),
      makeGoal({ id: 'g4', deadline: '2026-01-01' }),
    ];
    const events = [
      makeGoalEvent({ id: 'e1', goalId: 'g2', amount: 100_000 }),
      makeGoalEvent({ id: 'e2', goalId: 'g3', type: 'consume', amount: 100_000 }),
    ];
    const views = goalViews(goals, events, '2026-06-30');
    expect(views.find((v) => v.goal.id === 'g1')?.status).toBe('funding');
    expect(views.find((v) => v.goal.id === 'g2')?.status).toBe('funded');
    expect(views.find((v) => v.goal.id === 'g3')?.status).toBe('purchased');
    expect(views.find((v) => v.goal.id === 'g4')?.status).toBe('overdue');
  });
});

describe('可变消费样本口径', () => {
  it('排除转账、核销交易、目标购买和一次性标记', () => {
    const txns = [
      makeTxn({ id: 'ok', amount: 1000, date: '2026-06-10' }),
      makeTxn({ id: 'tr', kind: 'transfer', amount: 1000, date: '2026-06-10', toAccountId: 'x' }),
      makeTxn({ id: 'occ', amount: 1000, date: '2026-06-10', occurrenceId: 'occ:flow:2026-06-10' }),
      makeTxn({ id: 'goal', amount: 1000, date: '2026-06-10', goalId: 'g' }),
      makeTxn({ id: 'once', amount: 1000, date: '2026-06-10', nature: 'one_off' }),
      makeTxn({ id: 'rec', amount: 1000, date: '2026-06-10', nature: 'recurring' }),
    ];
    expect(txns.filter(isVariableExpense).map((t) => t.id)).toEqual(['ok']);
  });

  it('完整覆盖的零消费日记为零；覆盖外日期不记零', () => {
    const coverage = [{ start: '2026-06-01', end: '2026-06-05' }];
    const txns = [makeTxn({ amount: 1500, date: '2026-06-02' })];
    const map = variableExpenseByDay(txns, '2026-06-01', '2026-06-10', coverage);
    expect(map.get('2026-06-01')).toBe(0);
    expect(map.get('2026-06-02')).toBe(1500);
    expect(map.has('2026-06-06')).toBe(false);
  });
});