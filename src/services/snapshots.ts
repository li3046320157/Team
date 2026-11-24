/** 预测快照与校准服务：真实调用预测引擎，不硬编码结果。 */
import type { CalibrationRecord, Dataset, DataMode, ForecastSnapshot, ISODate } from '../domain/types';
import { addDaysISO, todayISO } from '../domain/days';
import { runForecast } from '../domain/forecasting/engine';
import { backtest, runCalibration, snapshotFromForecast, type CalibrationRunResult, type BacktestResult } from '../domain/calibration';
import { emptyCalibrationState } from '../domain/calibration';

const MAX_SNAPSHOTS = 400;

export function snapshotId(mode: DataMode, date: ISODate): string {
  return `snap:${mode}:${date}`;
}

export function buildSnapshot(dataset: Dataset, mode: DataMode, auto: boolean, asOf: ISODate = todayISO()): ForecastSnapshot {
  const result = runForecast({
    asOfDate: asOf,
    horizonDays: 90,
    dataset,
    coverage: dataset.settings.coverage,
    settings: dataset.settings,
  });
  return snapshotFromForecast({
    result,
    asOfDate: asOf,
    mode,
    auto,
    calibration: dataset.settings.calibration,
    id: snapshotId(mode, asOf),
    createdAt: new Date().toISOString(),
    paramsVersion: `settings-v${dataset.settings.settingsVersion}`,
  });
}

/** 每日自动快照：同一天只保留最新一份（覆盖），最多保留 400 份。 */
export function saveDailySnapshot(dataset: Dataset, mode: DataMode, asOf: ISODate = todayISO()): Dataset {
  if (dataset.accounts.length === 0) return dataset;
  const snap = buildSnapshot(dataset, mode, true, asOf);
  const rest = dataset.snapshots.filter((s) => s.id !== snap.id);
  const snapshots = [...rest, snap].sort((a, b) => (a.asOfDate < b.asOfDate ? -1 : 1)).slice(-MAX_SNAPSHOTS);
  return { ...dataset, snapshots };
}

export function saveManualSnapshot(dataset: Dataset, mode: DataMode, asOf: ISODate = todayISO()): Dataset {
  const result = buildSnapshot(dataset, mode, false, asOf);
  const snap = { ...result, id: `${snapshotId(mode, asOf)}:manual:${Date.now().toString(36)}` };
  return { ...dataset, snapshots: [...dataset.snapshots, snap].sort((a, b) => (a.asOfDate < b.asOfDate ? -1 : 1)).slice(-MAX_SNAPSHOTS) };
}

export interface CalibrationOutcome extends CalibrationRunResult {
  dataset: Dataset;
}

/** 逐日校准：同一实际日期只学习一次；返回合并后的数据集与本次统计。 */
export function runCalibrationOnDataset(dataset: Dataset, asOf: ISODate = todayISO(), days = 60): CalibrationOutcome {
  const result = runCalibration({
    snapshots: dataset.snapshots,
    transactions: dataset.transactions,
    coverage: dataset.settings.coverage,
    asOfDate: asOf,
    state: dataset.settings.calibration,
    existing: dataset.calibrations,
    days,
  });
  const byId = new Map<string, CalibrationRecord>();
  for (const r of dataset.calibrations) byId.set(r.id, r);
  for (const r of result.records) byId.set(r.id, r);
  const calibrations = [...byId.values()].sort((a, b) => (a.evaluatedDate < b.evaluatedDate ? -1 : 1)).slice(-1200);
  return {
    ...result,
    dataset: {
      ...dataset,
      calibrations,
      settings: { ...dataset.settings, calibration: result.state, settingsVersion: dataset.settings.settingsVersion + 1 },
    },
  };
}

export function runBacktest(dataset: Dataset, asOf: ISODate = todayISO()): BacktestResult {
  return backtest({
    transactions: dataset.transactions,
    coverage: dataset.settings.coverage,
    asOfDate: asOf,
    alpha: dataset.settings.calibration.alpha,
    maxDays: 180,
  });
}

export function resetCalibration(dataset: Dataset): Dataset {
  const now = new Date().toISOString();
  return {
    ...dataset,
    calibrations: dataset.calibrations.map((r) => ({ ...r, invalidated: true })),
    settings: {
      ...dataset.settings,
      calibration: emptyCalibrationState(now),
      settingsVersion: dataset.settings.settingsVersion + 1,
    },
  };
}

export function coverageSummary(dataset: Dataset): { days: number; from: string | null; to: string | null } {
  if (dataset.settings.coverage.length === 0) return { days: 0, from: null, to: null };
  let days = 0;
  let from: string | null = null;
  let to: string | null = null;
  for (const c of dataset.settings.coverage) {
    const start = c.start;
    const end = c.end;
    const n = Math.max(0, Math.round((new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86_400_000) + 1);
    days += n;
    if (!from || start < from) from = start;
    if (!to || end > to) to = end;
  }
  return { days, from, to };
}

export function recentSnapshots(dataset: Dataset, limit = 12): ForecastSnapshot[] {
  return [...dataset.snapshots].sort((a, b) => (a.asOfDate > b.asOfDate ? -1 : 1)).slice(0, limit);
}

export function tomorrow(date: ISODate): ISODate {
  return addDaysISO(date, 1);
}