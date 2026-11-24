import { describe, expect, it } from 'vitest';
import { backtest, emptyCalibrationState, runCalibration } from '../../src/domain/calibration';
import type { ForecastSnapshot } from '../../src/domain/types';
import { makeSettings, makeTxn } from './fixtures';

function snapshot(over: Partial<ForecastSnapshot> = {}): ForecastSnapshot {
  return {
    id: 'snap1',
    createdAt: '2026-06-29T21:00:00.000Z',
    asOfDate: '2026-06-29',
    horizonDays: 2,
    algoVersion: 'test',
    mode: 'personal',
    auto: true,
    inputSummary: { txnCount: 0, coveredDays: 10, trainingDays: 10, weekdaySamples: {}, safetyReserve: 0, reserved: 0, budget: 0 },
    days: [
      {
        date: '2026-06-30',
        balance: 1_000_000,
        reserved: 0,
        free: 1_000_000,
        income: 0,
        fixedExpense: 0,
        variableEstimate: 10_000,
        variableSource: 'weekday',
        scenarioExpense: 0,
      },
    ],
    calibration: emptyCalibrationState('2026-06-29T21:00:00.000Z'),
    paramsVersion: 'p1',
    ...over,
  };
}

describe('残差校准', () => {
  it('基础预测100、实际140、alpha=0.4 → bias=16', () => {
    const result = runCalibration({
      snapshots: [snapshot()],
      transactions: [makeTxn({ id: 't1', amount: 14_000, date: '2026-06-30' })],
      coverage: [{ start: '2026-06-30', end: '2026-06-30' }],
      asOfDate: '2026-07-01',
      state: emptyCalibrationState('2026-06-29T21:00:00.000Z'),
      existing: [],
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].rawPredicted).toBe(10_000);
    expect(result.records[0].residual).toBe(4_000);
    expect(result.records[0].biasAfter).toBe(1_600);
    expect(result.state.weekdayBias[2]).toBe(1_600);
  });

  it('同一实际日期不会重复学习', () => {
    const first = runCalibration({
      snapshots: [snapshot()],
      transactions: [makeTxn({ id: 't1', amount: 14_000, date: '2026-06-30' })],
      coverage: [{ start: '2026-06-30', end: '2026-06-30' }],
      asOfDate: '2026-07-01',
      state: emptyCalibrationState('2026-06-29T21:00:00.000Z'),
      existing: [],
    });
    const again = runCalibration({
      snapshots: [snapshot()],
      transactions: [makeTxn({ id: 't1', amount: 14_000, date: '2026-06-30' })],
      coverage: [{ start: '2026-06-30', end: '2026-06-30' }],
      asOfDate: '2026-07-01',
      state: first.state,
      existing: first.records,
    });
    expect(again.records).toHaveLength(0);
    expect(again.evaluated).toBe(0);
  });

  it('没有对应快照时不伪造历史预测', () => {
    const result = runCalibration({
      snapshots: [],
      transactions: [makeTxn({ id: 't1', amount: 14_000, date: '2026-06-30' })],
      coverage: [{ start: '2026-06-30', end: '2026-06-30' }],
      asOfDate: '2026-07-01',
      state: emptyCalibrationState('2026-06-29T21:00:00.000Z'),
      existing: [],
    });
    expect(result.records).toHaveLength(0);
    expect(result.skippedNoSnapshot).toBe(1);
  });

  it('可变消费未估计的预测点不参与校准', () => {
    const snap = snapshot({
      days: [
        {
          date: '2026-06-30',
          balance: 1_000_000,
          reserved: 0,
          free: 1_000_000,
          income: 0,
          fixedExpense: 0,
          variableEstimate: null,
          variableSource: 'none',
          scenarioExpense: 0,
        },
      ],
    });
    const result = runCalibration({
      snapshots: [snap],
      transactions: [makeTxn({ id: 't1', amount: 14_000, date: '2026-06-30' })],
      coverage: [{ start: '2026-06-30', end: '2026-06-30' }],
      asOfDate: '2026-07-01',
      state: emptyCalibrationState('2026-06-29T21:00:00.000Z'),
      existing: [],
    });
    expect(result.records).toHaveLength(0);
  });
});

describe('滚动回测', () => {
  it('数据不足时说明还差多少，而不是给漂亮指标', () => {
    const txns = [makeTxn({ id: 'a', date: '2026-06-01', amount: 3000 })];
    const result = backtest({
      transactions: txns,
      coverage: [{ start: '2026-05-25', end: '2026-06-10' }],
      asOfDate: '2026-06-11',
    });
    expect(result.sufficient).toBe(false);
    expect(result.reason).toContain('至少 14');
    expect(result.uncalibrated.samples).toBeLessThan(14);
  });

  it('足够历史时输出 MAE/RMSE 与样本日期', () => {
    const txns = [];
    for (let i = 0; i < 90; i += 1) {
      const d = new Date(2026, 2, 1 + i, 12);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      txns.push(makeTxn({ id: `t${i}`, date: iso, amount: 1000 + d.getDay() * 100 }));
    }
    const result = backtest({
      transactions: txns,
      coverage: [{ start: '2026-03-01', end: '2026-06-30' }],
      asOfDate: '2026-06-01',
      maxDays: 200,
    });
    expect(result.sufficient).toBe(true);
    expect(result.uncalibrated.samples).toBeGreaterThanOrEqual(14);
    expect(result.uncalibrated.mae).toBeGreaterThanOrEqual(0);
    expect(result.calibrated.rmse).toBeGreaterThanOrEqual(0);
    expect(result.note).toContain('仅使用之前数据');
  });

  it('同一份历史重复回测结果一致', () => {
    const txns = [];
    for (let i = 0; i < 70; i += 1) {
      const d = new Date(2026, 0, 1 + i, 12);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      txns.push(makeTxn({ id: `t${i}`, date: iso, amount: 1200 + (i % 4) * 50 }));
    }
    const params = {
      transactions: txns,
      coverage: [{ start: '2026-01-01', end: '2026-04-30' }],
      asOfDate: '2026-04-01',
    };
    expect(backtest(params)).toEqual(backtest(params));
  });
});

describe('设置校验', () => {
  it('机器学习参数在合法范围内', () => {
    const settings = makeSettings();
    expect(settings.calibration.alpha).toBeGreaterThan(0);
    expect(settings.calibration.alpha).toBeLessThanOrEqual(1);
  });
});