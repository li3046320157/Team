/** 预测快照、残差校准与无未来泄漏的历史回测。 */
import type {
  CalibrationRecord,
  CalibrationState,
  CoverageInterval,
  Cents,
  ForecastDay,
  ForecastSnapshot,
  ISODate,
  Transaction,
} from './types';
import { addDaysISO, diffDays, isValidISODate, weekdayIndex } from './days';
import { coveredDays, isCovered, variableExpenseByDay } from './ledger';
import { median } from './forecasting/variable';
import type { ForecastResult } from './forecasting/engine';

export const ALGO_VERSION = 'mf-1.0.0';

export function emptyCalibrationState(now: string): CalibrationState {
  return { weekdayBias: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, alpha: 0.4, version: 0, updatedAt: now };
}

export function snapshotFromForecast(params: {
  result: ForecastResult;
  asOfDate: ISODate;
  mode: 'personal' | 'demo';
  auto: boolean;
  calibration: CalibrationState;
  id: string;
  createdAt: string;
  paramsVersion: string;
}): ForecastSnapshot {
  return {
    id: params.id,
    createdAt: params.createdAt,
    asOfDate: params.asOfDate,
    horizonDays: params.result.days.length - 2,
    algoVersion: ALGO_VERSION,
    mode: params.mode,
    auto: params.auto,
    inputSummary: params.result.summary,
    days: params.result.days.map((d) => ({ ...d })),
    calibration: JSON.parse(JSON.stringify(params.calibration)) as CalibrationState,
    paramsVersion: params.paramsVersion,
  };
}

export function dayPrediction(snapshot: ForecastSnapshot, date: ISODate): ForecastDay | undefined {
  return snapshot.days.find((d) => d.date === date && !d.isToday && !d.isTodayEnd);
}

function activeRecordForDate(records: CalibrationRecord[], date: ISODate): CalibrationRecord | undefined {
  return records.find((r) => r.evaluatedDate === date && !r.invalidated);
}

export interface CalibrationRunResult {
  records: CalibrationRecord[];
  state: CalibrationState;
  evaluated: number;
  skippedNoSnapshot: number;
  skippedNotCovered: number;
}

/** 逐日评估：同一实际日期只学习一次；只用前一日基准快照的一天后预测。 */
export function runCalibration(params: {
  snapshots: ForecastSnapshot[];
  transactions: Transaction[];
  coverage: CoverageInterval[];
  asOfDate: ISODate;
  state: CalibrationState;
  existing: CalibrationRecord[];
  days?: number;
}): CalibrationRunResult {
  const { snapshots, transactions, coverage, asOfDate, existing } = params;
  const days = params.days ?? 60;
  const alpha = Math.max(0.01, Math.min(1, params.state.alpha));
  const state: CalibrationState = {
    ...params.state,
    weekdayBias: { ...emptyCalibrationState('').weekdayBias, ...params.state.weekdayBias },
  };
  const records: CalibrationRecord[] = [];
  let evaluated = 0;
  let skippedNoSnapshot = 0;
  let skippedNotCovered = 0;
  const covered = new Set(coveredDays(coverage, addDaysISO(asOfDate, -days), addDaysISO(asOfDate, -1)));
  const actualByDay = variableExpenseByDay(transactions, addDaysISO(asOfDate, -days), addDaysISO(asOfDate, -1), coverage);

  const sortedSnaps = [...snapshots]
    .filter((s) => s.asOfDate < asOfDate)
    .sort((a, b) => (a.asOfDate < b.asOfDate ? -1 : 1));

  const dates = [...covered].sort();
  for (const date of dates) {
    if (activeRecordForDate([...existing, ...records], date)) continue;
    if (!isCovered(date, coverage)) {
      skippedNotCovered += 1;
      continue;
    }
    const prevDate = addDaysISO(date, -1);
    const candidates = sortedSnaps.filter((s) => s.asOfDate === prevDate);
    if (candidates.length === 0) {
      skippedNoSnapshot += 1;
      continue;
    }
    const snapshot = candidates[candidates.length - 1];
    const pred = dayPrediction(snapshot, date);
    if (!pred || pred.variableEstimate === null || pred.variableSource === 'none') {
      skippedNoSnapshot += 1;
      continue;
    }
    const wd = weekdayIndex(date);
    const snapBias = snapshot.calibration.weekdayBias?.[wd] ?? 0;
    const raw = Math.max(0, pred.variableEstimate - snapBias);
    const actual = actualByDay.get(date);
    if (actual === undefined) {
      skippedNotCovered += 1;
      continue;
    }
    const rawResidual = actual - raw;
    const clipLimit = Math.max(5_000, Math.round(raw * 2));
    const residual = Math.max(-clipLimit, Math.min(clipLimit, rawResidual));
    const before = state.weekdayBias[wd] ?? 0;
    const after = Math.round((1 - alpha) * before + alpha * residual);
    state.weekdayBias[wd] = after;
    state.version += 1;
    state.updatedAt = new Date().toISOString();
    const nextVersion = activeRecordForDate(existing, date)?.version ?? 0;
    records.push({
      id: `cal:${snapshot.id}:${date}`,
      evaluatedDate: date,
      sourceSnapshotId: snapshot.id,
      actual,
      rawPredicted: raw,
      predicted: pred.variableEstimate,
      residual: rawResidual,
      biasBefore: before,
      biasAfter: after,
      weekday: wd,
      alpha,
      invalidated: false,
      version: nextVersion + 1,
      createdAt: new Date().toISOString(),
    });
    evaluated += 1;
  }

  return { records, state, evaluated, skippedNoSnapshot, skippedNotCovered };
}

export function invalidateCalibrationsForDate(records: CalibrationRecord[], date: ISODate): CalibrationRecord[] {
  return records.map((r) => (r.evaluatedDate === date && !r.invalidated ? { ...r, invalidated: true } : r));
}

export interface BacktestMetric {
  samples: number;
  start: ISODate | null;
  end: ISODate | null;
  mae: Cents;
  rmse: Cents;
}

export interface BacktestResult {
  sufficient: boolean;
  reason?: string;
  uncalibrated: BacktestMetric;
  calibrated: BacktestMetric;
  evaluatedDays: ISODate[];
  alpha: number;
  note: string;
}

function metrics(errors: number[], dates: ISODate[]): BacktestMetric {
  if (errors.length === 0) {
    return { samples: 0, start: null, end: null, mae: 0, rmse: 0 };
  }
  const mae = Math.round(errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length);
  const rmse = Math.round(Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length));
  return {
    samples: errors.length,
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
    mae,
    rmse,
  };
}

/**
 * 滚动回测：每个预测起点只用之前 6 周的数据；只评估“下一天可变消费”。
 * 开启完整回测需要至少 14 个可评估日期。
 */
export function backtest(params: {
  transactions: Transaction[];
  coverage: CoverageInterval[];
  asOfDate: ISODate;
  alpha?: number;
  maxDays?: number;
}): BacktestResult {
  const alpha = Math.max(0.01, Math.min(1, params.alpha ?? 0.4));
  const maxDays = params.maxDays ?? 180;
  const fullStart = addDaysISO(params.asOfDate, -Math.max(maxDays, 90));
  const daily = variableExpenseByDay(params.transactions, fullStart, addDaysISO(params.asOfDate, -1), params.coverage);
  const evalDates = [...daily.keys()].filter((d) => d < params.asOfDate).sort();
  const bias: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const uncalErrors: number[] = [];
  const calErrors: number[] = [];
  const usedDates: ISODate[] = [];

  for (const date of evalDates) {
    const trainStart = addDaysISO(date, -42);
    const trainDates = evalDates.filter((d) => d >= trainStart && d < date);
    if (trainDates.length < 21) continue;
    const wd = weekdayIndex(date);
    const samples = trainDates.filter((d) => weekdayIndex(d) === wd).map((d) => daily.get(d) ?? 0);
    if (samples.length < 3) continue;
    const raw = median(samples);
    if (raw === null) continue;
    const actual = daily.get(date) ?? 0;
    uncalErrors.push(actual - raw);
    const calPred = Math.max(0, raw + bias[wd]);
    calErrors.push(actual - calPred);
    bias[wd] = Math.round((1 - alpha) * bias[wd] + alpha * (actual - raw));
    usedDates.push(date);
  }

  const sufficient = usedDates.length >= 14;
  return {
    sufficient,
    reason: sufficient ? undefined : `当前只有 ${usedDates.length} 个可评估日期，完整回测需要至少 14 个（需约 8 周完整覆盖历史）`,
    uncalibrated: metrics(uncalErrors, usedDates),
    calibrated: metrics(calErrors, usedDates),
    evaluatedDays: usedDates,
    alpha,
    note: '按当前已整理历史进行离线滚动回测；每个起点仅使用之前数据，校准从零偏置开始。',
  };
}

export function compareSnapshotPrediction(snapshot: ForecastSnapshot, date: ISODate): number | null {
  if (!isValidISODate(date)) return null;
  const d = dayPrediction(snapshot, date);
  return d ? d.variableEstimate : null;
}

export function snapshotCoverage(snapshot: ForecastSnapshot): { from: ISODate; to: ISODate } {
  const days = snapshot.days;
  return {
    from: days[0]?.date ?? snapshot.asOfDate,
    to: days[days.length - 1]?.date ?? addDaysISO(snapshot.asOfDate, snapshot.horizonDays),
  };
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return diffDays(a, b);
}