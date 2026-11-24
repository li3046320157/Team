/** 高频小额消费聚合与异常消费检测（MAD 稳健 Z）。 */
import type { Cents, Category, InsightReview, ISODate, Settings, Transaction } from '../types';
import { addDaysISO } from '../days';

export interface AnomalyInsight {
  txId: string;
  date: ISODate;
  amount: Cents;
  merchant?: string;
  categoryId?: string;
  categoryName?: string;
  median: Cents;
  mad: Cents;
  iqr: Cents;
  robustZ: number | null;
  rule: 'mad' | 'iqr' | 'fallback';
  poolSize: number;
  review?: InsightReview;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < s.length) return s[base] + rest * (s[base + 1] - s[base]);
  return s[base];
}

export interface AnomalyResult {
  insights: AnomalyInsight[];
  insufficient: number;
  evaluated: number;
}

/**
 * 只用评估交易之前的历史作为基准，避免未来数据泄漏。
 * 评估范围为最近 60 天的实际支出。
 */
export function detectAnomalies(params: {
  transactions: Transaction[];
  categories: Category[];
  asOfDate: ISODate;
  settings: Settings;
  reviews: InsightReview[];
  lookbackDays?: number;
}): AnomalyResult {
  const { transactions, categories, asOfDate, settings, reviews } = params;
  const lookback = params.lookbackDays ?? 60;
  const from = addDaysISO(asOfDate, -lookback);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const reviewById = new Map(reviews.map((r) => [r.id, r]));

  const expenses = transactions
    .filter((t) => t.kind === 'expense' && t.date <= asOfDate)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const insights: AnomalyInsight[] = [];
  let insufficient = 0;
  let evaluated = 0;

  for (const t of expenses) {
    if (t.date < from) continue;
    evaluated += 1;
    const poolStart = addDaysISO(t.date, -settings.anomalyWindowDays);
    const pool = expenses.filter(
      (o) =>
        o.id !== t.id &&
        o.date < t.date &&
        o.date >= poolStart &&
        (t.categoryId ? o.categoryId === t.categoryId : normalizeMerchant(o.merchant) === normalizeMerchant(t.merchant)),
    );
    if (pool.length < settings.anomalyMinSamples) {
      insufficient += 1;
      continue;
    }
    const values = pool.map((o) => o.amount);
    const med = medianOf(values);
    const mad = medianOf(values.map((v) => Math.abs(v - med)));
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    const iqr = q3 - q1;

    let flagged = false;
    let robustZ: number | null = null;
    let rule: AnomalyInsight['rule'] = 'mad';
    if (mad > 0) {
      robustZ = (0.6745 * (t.amount - med)) / mad;
      flagged = robustZ > settings.anomalyRobustZ;
      rule = 'mad';
    } else if (iqr > 0) {
      const upper = q3 + 1.5 * iqr;
      flagged = t.amount > upper;
      rule = 'iqr';
    } else {
      flagged = t.amount > med * 3 && t.amount > med + 10_000;
      rule = 'fallback';
    }
    if (!flagged) continue;
    const review = reviewById.get(`anomaly:${t.id}`);
    insights.push({
      txId: t.id,
      date: t.date,
      amount: t.amount,
      merchant: t.merchant,
      categoryId: t.categoryId,
      categoryName: t.categoryId ? catById.get(t.categoryId)?.name : undefined,
      median: med,
      mad,
      iqr,
      robustZ: robustZ === null ? null : Math.round(robustZ * 100) / 100,
      rule,
      poolSize: pool.length,
      review,
    });
  }

  return {
    insights: insights.sort((a, b) => (a.date < b.date ? 1 : -1)),
    insufficient,
    evaluated,
  };
}

function normalizeMerchant(m?: string): string {
  return (m ?? '').trim().toLowerCase();
}