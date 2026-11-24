/** 消费决策沙盘：基准 / 立即 / 延期 / 分阶段预留后购买，全部调用同一预测引擎。 */
import type { Cents, ForecastDay, ISODate } from './types';
import { addDaysISO, addMonthsAnchored, diffDays } from './days';
import {
  runForecast,
  assessRisk,
  type ForecastDataset,
  type ForecastResult,
  type ForecastRisk,
} from './forecasting/engine';
import type { CoverageInterval, Settings } from './types';

export type ScenarioType = 'baseline' | 'immediate' | 'delayed' | 'staged';

export interface SandboxPurchase {
  name: string;
  price: Cents;
  purchaseDate: ISODate;
  allowDelay: boolean;
  goalId?: string;
  reserveUnit: 'week' | 'month';
  reserveInterval: number;
}

export interface SandboxParams {
  asOfDate: ISODate;
  dataset: ForecastDataset;
  coverage: CoverageInterval[];
  settings: Settings;
  purchase: SandboxPurchase;
  goalReserved: Cents;
  horizonDays?: number;
}

export interface ScenarioOutcome {
  type: ScenarioType;
  title: string;
  forecast: ForecastResult;
  risk: ForecastRisk;
  purchaseDates: ISODate[];
  completed: boolean;
  reservedAtPurchase: Cents;
  reason?: string;
  summary: string[];
}

export interface SandboxResult {
  baseline: ScenarioOutcome;
  immediate: ScenarioOutcome;
  delayed: ScenarioOutcome;
  staged: ScenarioOutcome;
  earliestSafeDate: ISODate | null;
  horizonDays: number;
  safeWindowDays: number;
}

function balanceMap(days: ForecastDay[]): Map<ISODate, Cents> {
  const map = new Map<ISODate, Cents>();
  for (const d of days) {
    if (d.isToday) continue;
    map.set(d.date, d.balance);
  }
  return map;
}

function minBalanceFrom(days: ForecastDay[], from: ISODate): { value: Cents; date: ISODate } {
  let value = Number.POSITIVE_INFINITY;
  let date = from;
  for (const d of days) {
    if (d.isToday) continue;
    if (d.date < from) continue;
    if (d.balance < value) {
      value = d.balance;
      date = d.date;
    }
  }
  if (!Number.isFinite(value)) return { value: 0, date: from };
  return { value, date };
}

export function findEarliestSafeDate(
  days: ForecastDay[],
  asOfDate: ISODate,
  price: Cents,
  safetyReserve: Cents,
  windowDays: number,
): ISODate | null {
  const byDate = balanceMap(days);
  const dates: ISODate[] = [];
  for (let i = 0; i <= windowDays; i += 1) dates.push(addDaysISO(asOfDate, i));
  const suffixMin: number[] = new Array(dates.length).fill(Number.POSITIVE_INFINITY);
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const b = byDate.get(dates[i]);
    const prev = i + 1 < dates.length ? suffixMin[i + 1] : Number.POSITIVE_INFINITY;
    suffixMin[i] = b === undefined ? prev : Math.min(b, prev);
  }
  for (let i = 0; i < dates.length; i += 1) {
    const min = suffixMin[i];
    if (!Number.isFinite(min)) continue;
    if (min - price >= safetyReserve) return dates[i];
  }
  return null;
}

export function buildReserveSchedule(params: {
  baseline: ForecastResult;
  asOfDate: ISODate;
  price: Cents;
  existingReserved: Cents;
  safetyReserve: Cents;
  unit: 'week' | 'month';
  interval: number;
  windowDays: number;
}): { reserveDates: ISODate[]; amounts: Cents[]; purchaseDate: ISODate | null; startReserved: Cents } {
  const { baseline, asOfDate, price, existingReserved, safetyReserve, unit, interval, windowDays } = params;
  const startReserved = Math.min(Math.max(0, existingReserved), price);
  let remaining = price - startReserved;
  const reserveDates: ISODate[] = [];
  const amounts: Cents[] = [];
  let accumulated = 0;
  let cursor = asOfDate;
  const step = Math.max(1, interval);
  const end = addDaysISO(asOfDate, windowDays);
  let guard = 0;
  while (cursor <= end && remaining > 0 && guard < 200) {
    guard += 1;
    const dayPoint = baseline.days.filter((d) => !d.isToday && d.date === cursor).pop();
    const balance = dayPoint?.balance ?? baseline.startBalance;
    const free = balance - baseline.baseReserved - accumulated - safetyReserve;
    const amount = Math.max(0, Math.min(remaining, free));
    if (amount > 0) {
      reserveDates.push(cursor);
      amounts.push(amount);
      accumulated += amount;
      remaining -= amount;
    }
    if (remaining <= 0) break;
    cursor =
      unit === 'week'
        ? addDaysISO(cursor, 7 * step)
        : addMonthsAnchored(cursor, step, Number(cursor.slice(8, 10)));
  }
  return {
    reserveDates,
    amounts,
    purchaseDate: remaining <= 0 ? cursor : null,
    startReserved,
  };
}

function scenarioText(
  type: ScenarioType,
  risk: ForecastRisk,
  safetyReserve: Cents,
  price: Cents,
  purchaseDate?: ISODate,
  completed = true,
): string[] {
  const lines: string[] = [];
  const riskLine = risk.firstBelowSafety
    ? `预计余额将在 ${risk.firstBelowSafety} 首次低于安全储备 ${(safetyReserve / 100).toFixed(0)} 元`
    : '预测期内不会低于安全储备';
  if (type === 'baseline') {
    lines.push(`不新增购买时，90 天内最低余额为 ¥${(risk.minBalance / 100).toFixed(2)}（${risk.minBalanceDate}）。`);
    lines.push(riskLine + '。');
  } else if (type === 'immediate') {
    lines.push(`立即花费 ¥${(price / 100).toFixed(2)}，预测期最低余额 ¥${(risk.minBalance / 100).toFixed(2)}（${risk.minBalanceDate}）。`);
    lines.push(riskLine + '。');
  } else if (type === 'delayed') {
    lines.push(`推迟到 ${purchaseDate ?? '-'} 购买，最低余额 ¥${(risk.minBalance / 100).toFixed(2)}（${risk.minBalanceDate}）。`);
    lines.push(riskLine + '。');
  } else {
    if (!completed) {
      lines.push('在当前预算与安全储备约束下，90 天内未能筹足购买金额，方案未完成。');
    } else {
      lines.push(`按${purchaseDate ?? ''}完成预留并购买，最低余额 ¥${(risk.minBalance / 100).toFixed(2)}（${risk.minBalanceDate}）。`);
      lines.push(riskLine + '。');
    }
  }
  return lines;
}

export function runSandbox(params: SandboxParams): SandboxResult {
  const { asOfDate, dataset, coverage, settings, purchase, goalReserved } = params;
  const safety = settings.safetyReserve;
  const windowDays = 90;
  const offset = diffDays(asOfDate, purchase.purchaseDate);
  const horizon = params.horizonDays ?? Math.max(90, offset > 0 ? offset + 30 : 90);

  const baseForecast = runForecast({ asOfDate, horizonDays: horizon, dataset, coverage, settings });
  const baseline: ScenarioOutcome = {
    type: 'baseline',
    title: '基准（不购买）',
    forecast: baseForecast,
    risk: baseForecast.risk,
    purchaseDates: [],
    completed: true,
    reservedAtPurchase: 0,
    summary: scenarioText('baseline', baseForecast.risk, safety, purchase.price),
  };

  const consumeForGoal = (reserved: Cents) => (purchase.goalId ? Math.min(reserved, purchase.price) : 0);

  const immediateForecast = runForecast({
    asOfDate,
    horizonDays: horizon,
    dataset,
    coverage,
    settings,
    scenario: {
      purchases: [{ date: asOfDate, amount: purchase.price, consumeReserved: consumeForGoal(goalReserved) }],
    },
  });
  const immediate: ScenarioOutcome = {
    type: 'immediate',
    title: '立即购买',
    forecast: immediateForecast,
    risk: immediateForecast.risk,
    purchaseDates: [asOfDate],
    completed: true,
    reservedAtPurchase: consumeForGoal(goalReserved),
    summary: scenarioText('immediate', immediateForecast.risk, safety, purchase.price),
  };

  const earliestSafeDate = purchase.allowDelay
    ? findEarliestSafeDate(baseForecast.days, asOfDate, purchase.price, safety, windowDays)
    : null;

  const delayedDate =
    offset > 0 ? (purchase.purchaseDate > addDaysISO(asOfDate, horizon) ? addDaysISO(asOfDate, horizon) : purchase.purchaseDate) : asOfDate;
  const delayedForecast = runForecast({
    asOfDate,
    horizonDays: horizon,
    dataset,
    coverage,
    settings,
    scenario: {
      purchases: [{ date: delayedDate, amount: purchase.price, consumeReserved: consumeForGoal(goalReserved) }],
    },
  });
  const delayed: ScenarioOutcome = {
    type: 'delayed',
    title: '延期购买',
    forecast: delayedForecast,
    risk: delayedForecast.risk,
    purchaseDates: [delayedDate],
    completed: true,
    reservedAtPurchase: consumeForGoal(goalReserved),
    reason: !purchase.allowDelay ? '该方案未允许延期' : undefined,
    summary: scenarioText('delayed', delayedForecast.risk, safety, purchase.price, delayedDate),
  };

  const schedule = buildReserveSchedule({
    baseline: baseForecast,
    asOfDate,
    price: purchase.price,
    existingReserved: purchase.goalId ? goalReserved : 0,
    safetyReserve: safety,
    unit: purchase.reserveUnit,
    interval: purchase.reserveInterval,
    windowDays,
  });

  const stagedCompleted = schedule.purchaseDate !== null;
  const reserves = schedule.reserveDates.map((date, i) => ({ date, amount: schedule.amounts[i] }));
  const purchases = stagedCompleted
    ? [
        {
          date: schedule.purchaseDate as ISODate,
          amount: purchase.price,
          consumeReserved: schedule.startReserved + schedule.amounts.reduce((a, b) => a + b, 0),
        },
      ]
    : [];
  const stagedForecast = runForecast({
    asOfDate,
    horizonDays: horizon,
    dataset,
    coverage,
    settings,
    scenario: { reserves, purchases },
  });
  const staged: ScenarioOutcome = {
    type: 'staged',
    title: '分阶段预留后购买',
    forecast: stagedForecast,
    risk: stagedForecast.risk,
    purchaseDates: schedule.purchaseDate ? [schedule.purchaseDate] : [],
    completed: stagedCompleted,
    reservedAtPurchase: schedule.startReserved + schedule.amounts.reduce((a, b) => a + b, 0),
    reason: stagedCompleted
      ? undefined
      : `按${purchase.reserveUnit === 'week' ? '周' : '月'}预留，在 90 天窗口内仍差 ¥${((purchase.price - schedule.startReserved - schedule.amounts.reduce((a, b) => a + b, 0)) / 100).toFixed(2)}`,
    summary: scenarioText('staged', stagedForecast.risk, safety, purchase.price, schedule.purchaseDate ?? undefined, stagedCompleted),
  };

  return {
    baseline,
    immediate,
    delayed,
    staged,
    earliestSafeDate,
    horizonDays: horizon,
    safeWindowDays: windowDays,
  };
}

export function riskLevelFor(risk: ForecastRisk, safetyReserve: Cents): 'safe' | 'warning' | 'danger' {
  if (risk.firstNegative) return 'danger';
  if (risk.firstBelowSafety) return 'warning';
  return safetyReserve > 0 ? 'safe' : 'safe';
}