/** 高频小额消费聚合。 */
import type { Cents, Category, ISODate, Transaction } from '../types';
import { addDaysISO } from '../days';

export interface SmallSpendGroup {
  key: string;
  label: string;
  count: number;
  total: Cents;
  average: Cents;
  perWeek: number;
  transactionIds: string[];
}

export interface SmallSpendResult {
  windowDays: number;
  threshold: Cents;
  from: ISODate;
  to: ISODate;
  total: Cents;
  count: number;
  byMerchant: SmallSpendGroup[];
  byCategory: SmallSpendGroup[];
  reminder: boolean;
}

function groupSmall(txns: Transaction[], labelOf: (t: Transaction) => string): SmallSpendGroup[] {
  const map = new Map<string, { label: string; txns: Transaction[] }>();
  for (const t of txns) {
    const label = labelOf(t) || '未分类';
    const entry = map.get(label) ?? { label, txns: [] };
    entry.txns.push(t);
    map.set(label, entry);
  }
  return [...map.entries()]
    .map(([key, v]) => {
      const total = v.txns.reduce((a, t) => a + t.amount, 0);
      return {
        key,
        label: v.label,
        count: v.txns.length,
        total,
        average: Math.round(total / v.txns.length),
        perWeek: 0,
        transactionIds: v.txns.map((t) => t.id),
      };
    })
    .sort((a, b) => b.total - a.total);
}

export function detectSmallSpending(params: {
  transactions: Transaction[];
  asOfDate: ISODate;
  threshold: Cents;
  windowDays: number;
  categories: Category[];
}): SmallSpendResult {
  const { transactions, asOfDate, threshold, windowDays, categories } = params;
  const from = addDaysISO(asOfDate, -(Math.max(1, windowDays) - 1));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const txns = transactions.filter(
    (t) =>
      t.kind === 'expense' &&
      t.date >= from &&
      t.date <= asOfDate &&
      t.amount > 0 &&
      t.amount <= threshold,
  );
  const byMerchant = groupSmall(txns, (t) => t.merchant?.trim() ?? '');
  const byCategory = groupSmall(txns, (t) => {
    const c = t.categoryId ? catById.get(t.categoryId) : undefined;
    return c?.name ?? '';
  });
  for (const g of [...byMerchant, ...byCategory]) {
    g.perWeek = Math.round((g.count / Math.max(1, windowDays)) * 7 * 10) / 10;
  }
  const total = txns.reduce((a, t) => a + t.amount, 0);
  return {
    windowDays,
    threshold,
    from,
    to: asOfDate,
    total,
    count: txns.length,
    byMerchant,
    byCategory,
    reminder: txns.length >= 3,
  };
}

