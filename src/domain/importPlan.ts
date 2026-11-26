/** 账单导入计划层：收支判定、金额/日期校验、分类映射、去重。纯函数，不写库。 */
import type { Account, Category, Cents, ISODate, Transaction } from './types';
import type { ParsedBill, RawBillRow } from './billCsv';
import { extractISODate } from './billCsv';
import { isValidISODate } from './days';
import { parseMoneyInput } from './money';

export type DuplicatePolicy = 'skip' | 'keep';
export type PlannedStatus = 'new' | 'duplicate' | 'skipped';

export interface PlannedRow {
  draftId: string;
  date: ISODate;
  kind: 'income' | 'expense';
  amount: Cents;
  merchant?: string;
  note?: string;
  categoryId?: string;
  status: PlannedStatus;
  reason?: string;
  rawLine: number;
  /** 导入目标账户：spec 的 PlannedRow 未列，但流水必须有 accountId，由 buildImportPlan 的 account 参数盖章。 */
  accountId: string;
}

export interface ImportPlan {
  rows: PlannedRow[];
  summary: {
    total: number;
    newCount: number;
    duplicateCount: number;
    skippedCount: number;
    income: Cents;
    expense: Cents;
    dateRange: { start: ISODate; end: ISODate } | null;
    byCategory: { categoryId: string; count: number; amount: Cents }[];
    reasons: Record<string, number>;
  };
}

/** 内置分类映射：按顺序匹配「交易分类 + 商户 + 商品说明」拼接文本。 */
export const CATEGORY_RULES: { pattern: RegExp; kind: 'income' | 'expense'; categoryId: string }[] = [
  { pattern: /餐饮美食|外卖|餐厅|饭店|火锅|烧烤/, kind: 'expense', categoryId: 'cat_food' },
  { pattern: /咖啡|茶饮|奶茶|星巴克|瑞幸/, kind: 'expense', categoryId: 'cat_coffee' },
  { pattern: /交通|地铁|公交|打车|滴滴|高铁|加油|停车/, kind: 'expense', categoryId: 'cat_transport' },
  { pattern: /购物|超市|便利店|京东|淘宝|天猫|拼多多|百货/, kind: 'expense', categoryId: 'cat_shopping' },
  { pattern: /房租|物业|水费|电费|燃气|家居/, kind: 'expense', categoryId: 'cat_home' },
  { pattern: /话费|流量|宽带|通信|移动|联通|电信/, kind: 'expense', categoryId: 'cat_comm' },
  { pattern: /电影|游戏|娱乐|演出|KTV|会员/, kind: 'expense', categoryId: 'cat_fun' },
  { pattern: /医院|药|体检|医疗|挂号/, kind: 'expense', categoryId: 'cat_health' },
  { pattern: /书店|课程|培训|教育|学习|考试/, kind: 'expense', categoryId: 'cat_study' },
  { pattern: /工资|薪资|代发/, kind: 'income', categoryId: 'cat_salary' },
  { pattern: /兼职|劳务|稿费/, kind: 'income', categoryId: 'cat_side' },
  { pattern: /奖金|红包|退款/, kind: 'income', categoryId: 'cat_bonus' },
];

export interface BuildImportPlanInput {
  parsed: ParsedBill;
  existing: Transaction[];
  categories: Category[];
  account: Account;
  today: ISODate;
  defaultExpenseCategoryId: string;
  defaultIncomeCategoryId: string;
  duplicatePolicy: DuplicatePolicy;
  categoryOverrides?: Record<string, string>;
}

function merchantKeyOf(merchant: string | undefined): string {
  return (merchant ?? '').trim().replace(/\s+/g, '').toLowerCase();
}

function dedupSignature(date: ISODate, kind: 'income' | 'expense', amount: Cents, merchant: string | undefined): string {
  return `${date}|${kind}|${amount}|${merchantKeyOf(merchant)}`;
}

function cleanAmountText(text: string): string {
  return text.replace(/[¥￥,，\s]/g, '').replace(/^-+/, '');
}

function resolveCategory(
  raw: RawBillRow,
  kind: 'income' | 'expense',
  draftId: string,
  input: BuildImportPlanInput,
): string {
  const overrideId = input.categoryOverrides?.[draftId];
  if (overrideId) return overrideId;
  const text = (raw.categoryText ?? '').trim();
  if (text) {
    const exact = input.categories.find((c) => c.kind === kind && !c.archived && c.name === text);
    if (exact) return exact.id;
  }
  const combined = `${raw.categoryText ?? ''}${raw.merchant ?? ''}${raw.note ?? ''}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.kind !== kind) continue;
    if (rule.pattern.test(combined)) return rule.categoryId;
  }
  return kind === 'income' ? input.defaultIncomeCategoryId : input.defaultExpenseCategoryId;
}

export function buildImportPlan(input: BuildImportPlanInput): ImportPlan {
  const { parsed, existing, account, today, duplicatePolicy } = input;

  const existingCounts = new Map<string, number>();
  for (const t of existing) {
    if (t.kind === 'transfer') continue;
    const sig = dedupSignature(t.date, t.kind === 'income' ? 'income' : 'expense', t.amount, t.merchant);
    existingCounts.set(sig, (existingCounts.get(sig) ?? 0) + 1);
  }

  const rows: PlannedRow[] = [];
  for (const raw of parsed.rows) {
    const draftId = `bill_${raw.line}`;
    let status: PlannedStatus = 'new';
    let reason: string | undefined;
    let kind: 'income' | 'expense' = 'expense';
    let amount: Cents = 0;
    let date: ISODate = today;

    const kindText = (raw.kindText ?? '').trim();
    const categoryText = raw.categoryText ?? '';

    if (kindText === '不计收支') {
      status = 'skipped';
      reason = '不计收支（转账/理财等）';
    } else if (kindText.includes('转账') || (parsed.format === 'wechat' && categoryText.includes('转账'))) {
      status = 'skipped';
      reason = '转账请手工核对（涉及转入账户）';
    } else if (kindText === '收入' || kindText === '支出') {
      kind = kindText === '收入' ? 'income' : 'expense';
      if (kind === 'income' && /退款|冲正/.test(`${categoryText}${raw.merchant ?? ''}${raw.note ?? ''}`)) {
        status = 'skipped';
        reason = '退款/冲正，请手工核对';
      }
    } else {
      status = 'skipped';
      reason = '收支类型无法识别';
    }

    if (status === 'new') {
      const parsedAmount = parseMoneyInput(cleanAmountText(raw.amountText));
      if (!parsedAmount.ok || parsedAmount.cents <= 0) {
        status = 'skipped';
        reason = '金额无法识别';
      } else {
        amount = parsedAmount.cents;
      }
    }

    if (status === 'new') {
      const iso = extractISODate(raw.date);
      if (!iso || !isValidISODate(iso)) {
        status = 'skipped';
        reason = '日期无法识别';
      } else if (iso > today) {
        status = 'skipped';
        reason = '未来日期';
      } else if (iso < account.openingDate) {
        status = 'skipped';
        reason = '早于账户期初日';
      } else {
        date = iso;
      }
    }

    if (status === 'new' && raw.status && /关闭|失败|已退款/.test(raw.status)) {
      status = 'skipped';
      reason = '交易未成功或已退款';
    }

    let categoryId: string | undefined;
    if (status === 'new') {
      categoryId = resolveCategory(raw, kind, draftId, input);
      const sig = dedupSignature(date, kind, amount, raw.merchant);
      const remaining = existingCounts.get(sig) ?? 0;
      if (remaining > 0) {
        existingCounts.set(sig, remaining - 1);
        if (duplicatePolicy === 'keep') {
          reason = '与已有流水重复';
        } else {
          status = 'duplicate';
        }
      }
    }

    rows.push({
      draftId,
      date,
      kind,
      amount,
      merchant: raw.merchant || undefined,
      note: raw.note || undefined,
      categoryId,
      status,
      reason,
      rawLine: raw.line,
      accountId: account.id,
    });
  }

  const newRows = rows.filter((r) => r.status === 'new');
  const byCategory: { categoryId: string; count: number; amount: Cents }[] = [];
  for (const r of newRows) {
    let entry = byCategory.find((e) => e.categoryId === r.categoryId);
    if (!entry) {
      entry = { categoryId: r.categoryId ?? '', count: 0, amount: 0 };
      byCategory.push(entry);
    }
    entry.count += 1;
    entry.amount += r.amount;
  }

  const reasons: Record<string, number> = {};
  for (const r of rows) {
    if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  }

  let start: ISODate | null = null;
  let end: ISODate | null = null;
  for (const r of newRows) {
    if (start === null || r.date < start) start = r.date;
    if (end === null || r.date > end) end = r.date;
  }
  const dateRange = start === null || end === null ? null : { start, end };

  return {
    rows,
    summary: {
      total: rows.length,
      newCount: newRows.length,
      duplicateCount: rows.filter((r) => r.status === 'duplicate').length,
      skippedCount: rows.filter((r) => r.status === 'skipped').length,
      income: newRows.filter((r) => r.kind === 'income').reduce((a, r) => a + r.amount, 0),
      expense: newRows.filter((r) => r.kind === 'expense').reduce((a, r) => a + r.amount, 0),
      dateRange,
      byCategory,
      reasons,
    },
  };
}
