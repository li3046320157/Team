import { describe, expect, it } from 'vitest';
import type { CalibrationRecord, Dataset, ISODate } from '../../src/domain/types';
import type { PlannedRow } from '../../src/domain/importPlan';
import { importBills } from '../../src/services/bills';
import { totalBalanceAt } from '../../src/domain/ledger';
import { makeAccount, makeCategory, makeDataset } from './fixtures';

const TODAY = '2026-11-25';

function prow(over: Partial<PlannedRow> = {}): PlannedRow {
  return {
    draftId: 'bill_1',
    date: '2026-06-01',
    kind: 'expense',
    amount: 1_000,
    merchant: '测试商户',
    categoryId: 'cat_food',
    status: 'new',
    rawLine: 1,
    accountId: 'acc_main',
    ...over,
  };
}

function calRecord(evaluatedDate: ISODate, invalidated = false): CalibrationRecord {
  return {
    id: `cal:x:${evaluatedDate}`,
    evaluatedDate,
    sourceSnapshotId: 'snap',
    actual: 1_000,
    rawPredicted: 900,
    predicted: 950,
    residual: 100,
    biasBefore: 0,
    biasAfter: 10,
    weekday: 1,
    alpha: 0.4,
    invalidated,
    version: 1,
    createdAt: 'x',
  };
}

function baseDataset(): Dataset {
  return makeDataset({
    settings: {
      ...makeDataset().settings,
      coverage: [{ start: '2026-01-01', end: '2026-06-30' }],
    },
    accounts: [makeAccount({ openingBalance: 1_000_000 })],
    categories: [
      makeCategory({ id: 'cat_food', name: '餐饮' }),
      makeCategory({ id: 'cat_other_inc', name: '其他收入', kind: 'income' }),
    ],
    calibrations: [calRecord('2026-06-01'), calRecord('2026-06-02'), calRecord('2026-06-03')],
  });
}

describe('账单导入写入层 importBills', () => {
  it('1000 行一次性导入：数量、余额手算一致，仅受影响日期的校准失效', () => {
    const dataset = baseDataset();
    const rows: PlannedRow[] = Array.from({ length: 1000 }, (_, i) =>
      i % 2 === 0
        ? prow({ draftId: `bill_${i}`, rawLine: i, date: '2026-06-01', kind: 'expense', amount: 1_000, categoryId: 'cat_food' })
        : prow({ draftId: `bill_${i}`, rawLine: i, date: '2026-06-01', kind: 'income', amount: 2_000, categoryId: 'cat_other_inc' }),
    );
    const next = importBills(dataset, rows, TODAY);
    expect(next.transactions).toHaveLength(1000);
    // 期初 1,000,000 + 收入 500×2,000 - 支出 500×1,000 = 1,500,000
    expect(totalBalanceAt(next.accounts, next.transactions, TODAY)).toBe(1_500_000);
    const byDate = new Map(next.calibrations.map((c) => [c.evaluatedDate, c.invalidated]));
    expect(byDate.get('2026-06-01')).toBe(true);
    expect(byDate.get('2026-06-02')).toBe(false);
    expect(byDate.get('2026-06-03')).toBe(false);
    const ids = new Set(next.transactions.map((t) => t.id));
    expect(ids.size).toBe(1000);
  });

  it('含一条非法行（未来日期）时整体抛错，dataset 原对象未被修改', () => {
    const dataset = baseDataset();
    const before = JSON.stringify(dataset);
    expect(() =>
      importBills(dataset, [prow(), prow({ draftId: 'bill_2', rawLine: 2, date: '2027-01-01' })], TODAY),
    ).toThrow();
    expect(JSON.stringify(dataset)).toBe(before);
    expect(dataset.transactions).toHaveLength(0);
  });

  it('非 new 行（skipped/duplicate）不落库', () => {
    const dataset = baseDataset();
    const next = importBills(
      dataset,
      [prow({ status: 'skipped' }), prow({ draftId: 'bill_2', rawLine: 2, status: 'duplicate' })],
      TODAY,
    );
    expect(next.transactions).toHaveLength(0);
  });

  it('nature 规则：收入一次性、房租/话费/会员商户标周期、其余支出可变', () => {
    const dataset = baseDataset();
    const next = importBills(
      dataset,
      [
        prow({ draftId: 'b1', rawLine: 1, kind: 'income', categoryId: 'cat_other_inc', merchant: undefined }),
        prow({ draftId: 'b2', rawLine: 2, merchant: '链家房租' }),
        prow({ draftId: 'b3', rawLine: 3, merchant: '中国移动话费' }),
        prow({ draftId: 'b4', rawLine: 4, merchant: '普通商户' }),
      ],
      TODAY,
    );
    const byId = new Map(next.transactions.map((t) => [t.merchant, t.nature]));
    expect(byId.get(undefined)).toBe('one_off');
    expect(byId.get('链家房租')).toBe('recurring');
    expect(byId.get('中国移动话费')).toBe('recurring');
    expect(byId.get('普通商户')).toBe('variable');
  });
});
