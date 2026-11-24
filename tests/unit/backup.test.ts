import { describe, expect, it } from 'vitest';
import { createBackup, validateBackupText } from '../../src/domain/backup';
import { makeAccount, makeCategory, makeDataset, makeGoal, makeGoalEvent, makeTxn } from './fixtures';

function sample() {
  return makeDataset({
    transactions: [
      makeTxn({ id: 't1', amount: 2800, date: '2026-06-01', categoryId: 'cat_food', merchant: '食堂' }),
      makeTxn({ id: 't2', kind: 'income', amount: 300000, date: '2026-06-10', categoryId: 'cat_salary' }),
    ],
    categories: [makeCategory(), makeCategory({ id: 'cat_salary', name: '工资', kind: 'income' })],
    goals: [makeGoal({ id: 'goal_travel' })],
    goalEvents: [makeGoalEvent({ id: 'e1', goalId: 'goal_travel', amount: 100000 })],
  });
}

describe('JSON 完整备份与恢复校验', () => {
  it('完整往返一致', () => {
    const dataset = sample();
    const text = createBackup(dataset);
    const result = validateBackupText(text, 'personal');
    expect(result.ok).toBe(true);
    expect(result.dataset?.transactions).toHaveLength(2);
    expect(result.dataset?.goalEvents).toHaveLength(1);
    expect(result.preview).toMatchObject({ mode: 'personal', accounts: 1, transactions: 2, goals: 1 });
    expect(result.preview?.startDate).toBe('2026-06-01');
    expect(result.preview?.endDate).toBe('2026-06-10');
  });

  it('拒绝非法 JSON', () => {
    const result = validateBackupText('{oops', 'personal');
    expect(result.ok).toBe(false);
    expect(result.errors.join('')).toContain('JSON');
  });

  it('拒绝未来格式版本', () => {
    const raw = JSON.parse(createBackup(sample()));
    raw.formatVersion = 99;
    const result = validateBackupText(JSON.stringify(raw), 'personal');
    expect(result.ok).toBe(false);
    expect(result.errors.join('')).toContain('不支持');
  });

  it('拒绝重复 ID', () => {
    const raw = JSON.parse(createBackup(sample()));
    raw.dataset.accounts.push(makeAccount());
    const result = validateBackupText(JSON.stringify(raw), 'personal');
    expect(result.ok).toBe(false);
    expect(result.errors.join('')).toContain('重复 ID');
  });

  it('拒绝无效引用', () => {
    const raw = JSON.parse(createBackup(sample()));
    raw.dataset.transactions[0].accountId = 'nope';
    const result = validateBackupText(JSON.stringify(raw), 'personal');
    expect(result.ok).toBe(false);
    expect(result.errors.join('')).toContain('不存在的账户');
  });

  it('拒绝预留释放超过已预留', () => {
    const raw = JSON.parse(createBackup(sample()));
    raw.dataset.goalEvents.push(makeGoalEvent({ id: 'e2', type: 'release', amount: 200000, date: '2026-06-20' }));
    const result = validateBackupText(JSON.stringify(raw), 'personal');
    expect(result.ok).toBe(false);
    expect(result.errors.join('')).toContain('预留释放超过');
  });

  it('不静默覆盖：模式不一致时给出警告', () => {
    const raw = JSON.parse(createBackup(sample()));
    raw.dataset.meta.kind = 'demo';
    const result = validateBackupText(JSON.stringify(raw), 'personal');
    expect(result.ok).toBe(true);
    expect(result.warnings.join('')).toContain('演示');
  });

  it('拒绝金额超过上限', () => {
    const raw = JSON.parse(createBackup(sample()));
    raw.dataset.transactions[0].amount = 1e15;
    const result = validateBackupText(JSON.stringify(raw), 'personal');
    expect(result.ok).toBe(false);
  });

  it('拒绝转账缺少转入账户', () => {
    const raw = JSON.parse(createBackup(sample()));
    raw.dataset.transactions[0].kind = 'transfer';
    raw.dataset.transactions[0].toAccountId = undefined;
    const result = validateBackupText(JSON.stringify(raw), 'personal');
    expect(result.ok).toBe(false);
    expect(result.errors.join('')).toContain('转入账户');
  });
});