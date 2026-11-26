import { describe, expect, it } from 'vitest';
import { parseBillCsv, type ParsedBill, type RawBillRow } from '../../src/domain/billCsv';
import { transactionsToCSV } from '../../src/domain/csv';
import { buildImportPlan } from '../../src/domain/importPlan';
import { makeAccount, makeCategory, makeTxn } from './fixtures';
import type { Category } from '../../src/domain/types';
import alipayCsv from '../fixtures/bills/alipay-utf8.csv?raw';
import wechatCsv from '../fixtures/bills/wechat-utf8.csv?raw';

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

const CATS: Category[] = [
  makeCategory({ id: 'cat_food', name: '餐饮' }),
  makeCategory({ id: 'cat_coffee', name: '咖啡茶饮' }),
  makeCategory({ id: 'cat_transport', name: '交通' }),
  makeCategory({ id: 'cat_shopping', name: '购物' }),
  makeCategory({ id: 'cat_study', name: '学习' }),
  makeCategory({ id: 'cat_other_exp', name: '其他支出' }),
  makeCategory({ id: 'cat_salary', name: '工资', kind: 'income' }),
  makeCategory({ id: 'cat_bonus', name: '奖金', kind: 'income' }),
  makeCategory({ id: 'cat_other_inc', name: '其他收入', kind: 'income' }),
];

function row(over: Partial<RawBillRow>): RawBillRow {
  return {
    date: '2026-11-20',
    kindText: '支出',
    amountText: '28.50',
    merchant: '美团外卖',
    note: '',
    line: 1,
    ...over,
  };
}

function bill(rows: RawBillRow[]): ParsedBill {
  return { format: 'generic', rows, headerLine: 0, warnings: [], skippedLines: 0, encoding: 'utf-8' };
}

type PlanInput = Parameters<typeof buildImportPlan>[0];

function planFor(parsed: ParsedBill, over: Partial<PlanInput> = {}) {
  return buildImportPlan({
    parsed,
    existing: [],
    categories: CATS,
    account: makeAccount(),
    today: '2026-11-25',
    defaultExpenseCategoryId: 'cat_other_exp',
    defaultIncomeCategoryId: 'cat_other_inc',
    duplicatePolicy: 'skip',
    ...over,
  });
}

describe('账单导入计划层 buildImportPlan', () => {
  it('支付宝样例：5 新增 / 3 跳过，reason 与分类映射正确', () => {
    const plan = planFor(parseBillCsv(bytesOf(alipayCsv)));
    expect(plan.rows).toHaveLength(8);
    expect(plan.summary.total).toBe(8);
    expect(plan.summary.newCount).toBe(5);
    expect(plan.summary.duplicateCount).toBe(0);
    expect(plan.summary.skippedCount).toBe(3);
    expect(plan.summary.income).toBe(1_500_000);
    expect(plan.summary.expense).toBe(128_650);
    expect(plan.summary.dateRange).toEqual({ start: '2026-11-20', end: '2026-11-25' });

    const byMerchant = new Map(plan.rows.map((r) => [r.merchant, r]));
    expect(byMerchant.get('美团外卖')?.categoryId).toBe('cat_food');
    expect(byMerchant.get('地铁')?.categoryId).toBe('cat_transport');
    expect(byMerchant.get('京东')?.categoryId).toBe('cat_shopping');
    expect(byMerchant.get('京东')?.amount).toBe(123_450);
    expect(byMerchant.get('示例科技有限公司')?.kind).toBe('income');
    expect(byMerchant.get('示例科技有限公司')?.categoryId).toBe('cat_salary');

    const skipped = plan.rows.filter((r) => r.status === 'skipped');
    expect(skipped.find((r) => r.merchant === '张三')?.reason).toBe('不计收支（转账/理财等）');
    expect(skipped.find((r) => r.merchant === '淘宝')?.reason).toBe('交易未成功或已退款');
    expect(skipped.find((r) => r.merchant === '肯德基')?.reason).toBe('未来日期');
    expect(plan.summary.reasons['未来日期']).toBe(1);
    expect(plan.summary.reasons['交易未成功或已退款']).toBe(1);
    expect(plan.summary.reasons['不计收支（转账/理财等）']).toBe(1);

    for (const r of plan.rows.filter((x) => x.status === 'new')) {
      expect(r.accountId).toBe('acc_main');
      expect(r.draftId).toBe(`bill_${r.rawLine}`);
    }
  });

  it('微信样例：转账与已退款跳过，红包收入归奖金，无规则命中归默认分类', () => {
    const plan = planFor(parseBillCsv(bytesOf(wechatCsv)));
    expect(plan.summary.newCount).toBe(4);
    expect(plan.summary.skippedCount).toBe(2);
    expect(plan.summary.reasons['转账请手工核对（涉及转入账户）']).toBe(1);
    expect(plan.summary.reasons['交易未成功或已退款']).toBe(1);

    const byMerchant = new Map(plan.rows.map((r) => [r.merchant, r]));
    expect(byMerchant.get('张三')?.status).toBe('skipped');
    expect(byMerchant.get('淘宝')?.status).toBe('skipped');
    expect(byMerchant.get('李四')?.kind).toBe('income');
    expect(byMerchant.get('李四')?.amount).toBe(6_600);
    expect(byMerchant.get('李四')?.categoryId).toBe('cat_bonus');
    expect(byMerchant.get('瑞幸咖啡')?.categoryId).toBe('cat_coffee');
    expect(byMerchant.get('地铁')?.categoryId).toBe('cat_transport');
    expect(byMerchant.get('肯德基')?.categoryId).toBe('cat_other_exp');
  });

  it('同一天同金额两笔已存在 + 导入三笔 → 2 重复 + 1 新增', () => {
    const existing = [
      makeTxn({ id: 'e1', date: '2026-11-20', kind: 'expense', amount: 2_850, merchant: '美团外卖' }),
      makeTxn({ id: 'e2', date: '2026-11-20', kind: 'expense', amount: 2_850, merchant: '美团外卖' }),
    ];
    const plan = planFor(bill([row({ line: 1 }), row({ line: 2 }), row({ line: 3 })]), { existing });
    expect(plan.summary.newCount).toBe(1);
    expect(plan.summary.duplicateCount).toBe(2);
    expect(plan.rows.filter((r) => r.status === 'duplicate')).toHaveLength(2);
    expect(plan.rows.filter((r) => r.status === 'new')).toHaveLength(1);
  });

  it('重复策略「仍然导入」：重复行转为新增并保留标黄原因', () => {
    const existing = [makeTxn({ id: 'e1', date: '2026-11-20', kind: 'expense', amount: 2_850, merchant: '美团外卖' })];
    const plan = planFor(bill([row({ line: 1 })]), { existing, duplicatePolicy: 'keep' });
    expect(plan.summary.newCount).toBe(1);
    expect(plan.summary.duplicateCount).toBe(0);
    expect(plan.rows[0].status).toBe('new');
    expect(plan.rows[0].reason).toBe('与已有流水重复');
    expect(plan.summary.reasons['与已有流水重复']).toBe(1);
  });

  it('categoryOverrides 优先级最高', () => {
    const plan = planFor(bill([row({ line: 1 })]), { categoryOverrides: { bill_1: 'cat_study' } });
    expect(plan.rows[0].categoryId).toBe('cat_study');
  });

  it('金额与日期无法识别、早于账户期初日、未知收支类型均跳过', () => {
    const plan = planFor(
      bill([
        row({ line: 1, amountText: 'abc' }),
        row({ line: 2, amountText: '0' }),
        row({ line: 3, date: '2026-13-45' }),
        row({ line: 4, date: '2025-12-01' }),
        row({ line: 5, kindText: '未知' }),
      ]),
    );
    const reasons = plan.summary.reasons;
    expect(reasons['金额无法识别']).toBe(2);
    expect(reasons['日期无法识别']).toBe(1);
    expect(reasons['早于账户期初日']).toBe(1);
    expect(reasons['收支类型无法识别']).toBe(1);
    expect(plan.summary.newCount).toBe(0);
  });

  it('收入行含退款/冲正字样整体跳过，不参与去重与统计', () => {
    const existing = [makeTxn({ id: 'e1', date: '2026-11-20', kind: 'income', amount: 10_000, merchant: '淘宝' })];
    const plan = planFor(
      bill([row({ line: 1, kindText: '收入', amountText: '100.00', merchant: '淘宝', note: '订单退款' })]),
      { existing },
    );
    expect(plan.rows[0].status).toBe('skipped');
    expect(plan.rows[0].reason).toBe('退款/冲正，请手工核对');
    expect(plan.summary.duplicateCount).toBe(0);
    expect(plan.summary.newCount).toBe(0);
  });

  it('日期兼容斜杠与时分秒，去重签名忽略商户空格与大小写', () => {
    const existing = [makeTxn({ id: 'e1', date: '2026-11-20', kind: 'expense', amount: 2_850, merchant: '美团外卖' })];
    const plan = planFor(bill([row({ line: 1, date: '2026/11/20 12:33:01', merchant: ' 美团 外卖 ' })]), { existing });
    expect(plan.rows[0].status).toBe('duplicate');
    expect(plan.rows[0].date).toBe('2026-11-20');
  });

  it('MoneyFlow 导出 round-trip：分类精确同名匹配、金额千分位被去掉', () => {
    const csv = transactionsToCSV({
      transactions: [
        makeTxn({ id: 't1', amount: 500_000, date: '2026-06-01', kind: 'income', merchant: '示例公司', categoryId: 'cat_salary' }),
        makeTxn({ id: 't2', amount: 12_345, date: '2026-06-02', categoryId: 'cat_food' }),
      ],
      accounts: [makeAccount()],
      categories: CATS,
      flows: [],
      goals: [],
    });
    const plan = planFor(parseBillCsv(new TextEncoder().encode(csv).buffer), { existing: [] });
    expect(plan.summary.newCount).toBe(2);
    const income = plan.rows.find((r) => r.kind === 'income');
    expect(income?.amount).toBe(500_000);
    expect(income?.categoryId).toBe('cat_salary');
  });
});
