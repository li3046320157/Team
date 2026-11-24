/** 周期支出识别：规则匹配程度评分，不宣称为概率。 */
import type {
  Cents,
  ISODate,
  RecurringCandidate,
  ScheduledFlow,
  Settings,
  Transaction,
} from '../types';
import { addDaysISO, addMonthsAnchored, diffDays } from '../days';
import { normalizeMerchantKey } from '../ids';

export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export interface RecurringGroup {
  merchantKey: string;
  merchantLabel: string;
  txns: Transaction[];
  unit: 'week' | 'month' | 'year';
  interval: number;
  intervalDays: number;
  intervalScore: number;
  amountScore: number;
  sampleScore: number;
  score: number;
  amountCv: number;
  estimatedAmount: Cents;
  nextDate: ISODate;
  duplicateDates: number;
}

function classifyPeriod(dates: ISODate[], tolerance: number): { unit: 'week' | 'month' | 'year'; score: number; intervalDays: number } | null {
  if (dates.length < 3) return null;
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i += 1) intervals.push(diffDays(dates[i - 1], dates[i]));
  const nonzero = intervals.filter((n) => n > 0);
  if (nonzero.length < 2) return null;
  const med = medianOf(nonzero);

  // 周：间隔围绕 7 天，允许 ±tolerance
  if (med >= 3 && med <= 11) {
    const devs = nonzero.map((n) => Math.abs(n - 7));
    const avgDev = devs.reduce((a, b) => a + b, 0) / devs.length;
    if (avgDev <= tolerance) {
      return { unit: 'week', score: Math.max(0, 1 - avgDev / Math.max(tolerance, 1)), intervalDays: 7 };
    }
    return null;
  }

  // 月：按日历月，逐月差 1，日号允许月底截断与小幅偏移
  if (med >= 24 && med <= 40) {
    const months: string[] = dates.map((d) => d.slice(0, 7));
    const uniqueMonths = new Set(months);
    if (uniqueMonths.size === dates.length) {
      let ok = true;
      let devSum = 0;
      for (let i = 1; i < dates.length; i += 1) {
        const prev = dates[i - 1];
        const cur = dates[i];
        const monthDiff =
          (Number(cur.slice(0, 4)) - Number(prev.slice(0, 4))) * 12 +
          (Number(cur.slice(5, 7)) - Number(prev.slice(5, 7)));
        if (monthDiff !== 1) {
          ok = false;
          break;
        }
        const dayDev = Math.abs(advanceMonthDay(prev) - Number(cur.slice(8, 10)));
        devSum += dayDev;
        if (dayDev > 3) {
          ok = false;
          break;
        }
      }
      if (ok) {
        const avgDev = devSum / (dates.length - 1);
        return { unit: 'month', score: Math.max(0, 1 - avgDev / 3), intervalDays: 30 };
      }
    }
    return null;
  }

  // 年：同月同日，间隔约一年
  if (med >= 330 && med <= 400) {
    let ok = true;
    let devSum = 0;
    for (let i = 1; i < dates.length; i += 1) {
      const prev = dates[i - 1];
      const cur = dates[i];
      const yearDiff = Number(cur.slice(0, 4)) - Number(prev.slice(0, 4));
      if (yearDiff !== 1) {
        ok = false;
        break;
      }
      const dayDev = Math.abs(Number(cur.slice(5, 7)) * 31 + Number(cur.slice(8, 10)) - (Number(prev.slice(5, 7)) * 31 + Number(prev.slice(8, 10))));
      devSum += Math.min(dayDev, 3);
      if (dayDev > 3) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const avgDev = devSum / (dates.length - 1);
      return { unit: 'year', score: Math.max(0, 1 - avgDev / 3), intervalDays: 365 };
    }
  }
  return null;
}

function advanceMonthDay(date: ISODate): number {
  return Number(date.slice(8, 10));
}

export function detectRecurringCandidates(params: {
  transactions: Transaction[];
  asOfDate: ISODate;
  settings: Settings;
  flows: ScheduledFlow[];
  previous: RecurringCandidate[];
}): RecurringCandidate[] {
  const { transactions, settings, flows, previous } = params;
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.kind !== 'expense' || t.nature === 'one_off' || t.occurrenceId) continue;
    if (t.date > params.asOfDate) continue;
    const key = normalizeMerchantKey(t.merchant);
    if (!key || key.length < 2) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const confirmedFlowKeys = new Map<string, ScheduledFlow>();
  for (const f of flows) {
    if (f.kind !== 'expense') continue;
    const k = normalizeMerchantKey(f.merchant ?? f.title);
    if (k) confirmedFlowKeys.set(`${k}|${f.rule.unit}`, f);
  }

  const prevBySignature = new Map(previous.map((p) => [p.signature, p]));
  const out: RecurringCandidate[] = [];

  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const dates = sorted.map((t) => t.date);
    const uniqueDates = [...new Set(dates)];
    if (uniqueDates.length < 3) continue;
    const duplicateDates = dates.length - uniqueDates.length;
    const period = classifyPeriod(uniqueDates, settings.recurringToleranceDays);
    if (!period) continue;

    const amounts = sorted.map((t) => t.amount);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const cv = mean > 0 ? stdDev(amounts) / mean : 1;
    if (cv > settings.recurringMaxCv * 1.5) continue;
    const amountScore = Math.max(0, Math.min(1, 1 - cv / Math.max(settings.recurringMaxCv, 0.01)));
    const sampleScore = Math.max(0, Math.min(1, (uniqueDates.length - 2) / 3));
    const intervalScore = period.score * (duplicateDates > 0 ? 0.6 : 1);
    const score = Math.max(0, Math.min(1, 0.45 * intervalScore + 0.35 * amountScore + 0.2 * sampleScore));

    const signature = `${key}|${period.unit}`;
    if (confirmedFlowKeys.has(signature)) continue;
    const prev = prevBySignature.get(signature);
    if (prev && prev.status !== 'open') {
      out.push(prev);
      continue;
    }

    const lastDate = uniqueDates[uniqueDates.length - 1];
    const anchorDay = Number(lastDate.slice(8, 10));
    const nextDate =
      period.unit === 'week'
        ? addDaysISO(lastDate, 7)
        : period.unit === 'month'
          ? addMonthsAnchored(lastDate, 1, anchorDay)
          : addMonthsAnchored(lastDate, 12, anchorDay);

    out.push({
      id: prev?.id ?? `cand_${signature}`,
      signature,
      merchantKey: key,
      merchantLabel: sorted[sorted.length - 1].merchant ?? key,
      unit: period.unit,
      interval: 1,
      estimatedAmount: medianOf(amounts),
      lastDate,
      nextDate,
      score,
      scoreParts: {
        interval: Math.round(intervalScore * 100) / 100,
        amount: Math.round(amountScore * 100) / 100,
        sample: Math.round(sampleScore * 100) / 100,
      },
      sampleIds: sorted.map((t) => t.id),
      intervalDays: period.intervalDays,
      amountCv: Math.round(cv * 1000) / 1000,
      status: 'open',
    });
  }

  return out.sort((a, b) => b.score - a.score);
}