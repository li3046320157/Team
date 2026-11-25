import { describe, expect, it } from 'vitest';
import { detectRecurringCandidates } from '../../src/domain/insights/recurring';
import { detectAnomalies } from '../../src/domain/insights/anomaly';
import { detectSmallSpending } from '../../src/domain/insights/small';
import { setCandidateStatus } from '../../src/services/mutations';
import { makeCategory, makeDataset, makeFlow, makeSettings, makeTxn } from './fixtures';

const baseSettings = makeSettings();

describe('周期支出识别', () => {
  it('三笔稳定月度交易形成候选', () => {
    const txns = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) =>
      makeTxn({ id: `t${i}`, date, amount: 1500, merchant: '网易云音乐' }),
    );
    const result = detectRecurringCandidates({
      transactions: txns,
      asOfDate: '2026-04-01',
      settings: baseSettings,
      flows: [],
      previous: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].unit).toBe('month');
    expect(result[0].estimatedAmount).toBe(1500);
    expect(result[0].nextDate).toBe('2026-04-15');
    expect(result[0].sampleIds).toHaveLength(3);
  });

  it('不足三笔不输出', () => {
    const txns = ['2026-01-15', '2026-02-15'].map((date, i) =>
      makeTxn({ id: `t${i}`, date, amount: 1500, merchant: '网易云音乐' }),
    );
    expect(
      detectRecurringCandidates({ transactions: txns, asOfDate: '2026-04-01', settings: baseSettings, flows: [], previous: [] }),
    ).toHaveLength(0);
  });

  it('缺月不误判为月度订阅', () => {
    const txns = ['2026-01-15', '2026-03-15', '2026-04-15'].map((date, i) =>
      makeTxn({ id: `t${i}`, date, amount: 1500, merchant: '缺月商户' }),
    );
    expect(
      detectRecurringCandidates({ transactions: txns, asOfDate: '2026-05-01', settings: baseSettings, flows: [], previous: [] }),
    ).toHaveLength(0);
  });

  it('同日重复不形成高置信周期', () => {
    const txns = [
      makeTxn({ id: 'a', date: '2026-01-15', amount: 1000, merchant: '便利店' }),
      makeTxn({ id: 'b', date: '2026-01-15', amount: 1000, merchant: '便利店' }),
      makeTxn({ id: 'c', date: '2026-02-15', amount: 1000, merchant: '便利店' }),
      makeTxn({ id: 'd', date: '2026-03-15', amount: 1000, merchant: '便利店' }),
    ];
    const result = detectRecurringCandidates({
      transactions: txns,
      asOfDate: '2026-04-01',
      settings: baseSettings,
      flows: [],
      previous: [],
    });
    expect(result.every((r) => r.score < 0.9)).toBe(true);
  });

  it('金额波动过大不识别', () => {
    const txns = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) =>
      makeTxn({ id: `t${i}`, date, amount: i === 2 ? 3000 : 1500, merchant: '价格波动商户' }),
    );
    expect(
      detectRecurringCandidates({ transactions: txns, asOfDate: '2026-04-01', settings: baseSettings, flows: [], previous: [] }),
    ).toHaveLength(0);
  });

  it('已存在对应固定账单时不重复创建', () => {
    const txns = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) =>
      makeTxn({ id: `t${i}`, date, amount: 1500, merchant: '网易云音乐' }),
    );
    const flows = [makeFlow({ merchant: '网易云音乐', title: '会员', rule: { unit: 'month', interval: 1 } })];
    expect(
      detectRecurringCandidates({ transactions: txns, asOfDate: '2026-04-01', settings: baseSettings, flows, previous: [] }),
    ).toHaveLength(0);
  });

  it('确认后才建账单：检测本身不产生计划', () => {
    const flows: unknown[] = [];
    const txns = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) =>
      makeTxn({ id: `t${i}`, date, amount: 1500, merchant: '周卡' }),
    );
    detectRecurringCandidates({ transactions: txns, asOfDate: '2026-04-01', settings: baseSettings, flows: flows as never[], previous: [] });
    expect(flows).toHaveLength(0);
  });
});

describe('候选状态持久化', () => {
  const monthlyTxns = ['2026-01-15', '2026-02-15', '2026-03-15'].map((date, i) =>
    makeTxn({ id: `p${i}`, date, amount: 1500, merchant: '网易云音乐' }),
  );

  it('忽略检测出的新候选后，重新检测不再列为待确认', () => {
    let dataset = makeDataset({ transactions: monthlyTxns });
    const detected = detectRecurringCandidates({
      transactions: dataset.transactions,
      asOfDate: '2026-04-01',
      settings: dataset.settings,
      flows: [],
      previous: dataset.candidates,
    });
    expect(detected).toHaveLength(1);

    dataset = setCandidateStatus(dataset, detected[0], 'ignored');

    const redetected = detectRecurringCandidates({
      transactions: dataset.transactions,
      asOfDate: '2026-04-01',
      settings: dataset.settings,
      flows: [],
      previous: dataset.candidates,
    });
    expect(redetected.filter((c) => c.status === 'open')).toHaveLength(0);
    expect(redetected.some((c) => c.status === 'ignored')).toBe(true);
  });

  it('候选已在列表中时只更新状态并保留其他字段', () => {
    const stored = {
      id: 'cand_old',
      signature: 'wangyiyun|month',
      merchantKey: 'wangyiyun',
      merchantLabel: '网易云音乐',
      unit: 'month' as const,
      interval: 1,
      estimatedAmount: 1500,
      lastDate: '2026-03-15',
      nextDate: '2026-04-15',
      score: 0.87,
      scoreParts: { interval: 1, amount: 1, sample: 0.33 },
      sampleIds: ['p0', 'p1', 'p2'],
      intervalDays: 30,
      amountCv: 0,
      status: 'open' as const,
      flowId: 'flow_x',
    };
    const dataset = makeDataset({ candidates: [stored] });
    const next = setCandidateStatus(dataset, { ...stored, nextDate: '2026-05-15' }, 'ignored');
    expect(next.candidates).toHaveLength(1);
    expect(next.candidates[0]).toMatchObject({ status: 'ignored', flowId: 'flow_x', nextDate: '2026-05-15' });
  });

  it('同签名不同 id 的存量候选也能被匹配忽略', () => {
    const stored = {
      id: 'cand_legacy',
      signature: 'wangyiyun|month',
      merchantKey: 'wangyiyun',
      merchantLabel: '网易云音乐',
      unit: 'month' as const,
      interval: 1,
      estimatedAmount: 1500,
      lastDate: '2026-03-15',
      nextDate: '2026-04-15',
      score: 0.87,
      scoreParts: { interval: 1, amount: 1, sample: 0.33 },
      sampleIds: ['p0', 'p1', 'p2'],
      intervalDays: 30,
      amountCv: 0,
      status: 'open' as const,
    };
    const dataset = makeDataset({ candidates: [stored] });
    const next = setCandidateStatus(dataset, { ...stored, id: 'cand_wangyiyun|month' }, 'ignored');
    expect(next.candidates).toHaveLength(1);
    expect(next.candidates[0].status).toBe('ignored');
  });
});

describe('异常消费检测', () => {
  const category = makeCategory({ id: 'cat_food', name: '餐饮' });

  it('只用过去的样本，异常本身不参与基准', () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      makeTxn({
        id: `h${i}`,
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
        amount: 2000 + (i % 3) * 100,
        categoryId: 'cat_food',
      }),
    );
    const big = makeTxn({ id: 'big', date: '2026-06-01', amount: 50000, categoryId: 'cat_food' });
    const later = makeTxn({ id: 'later', date: '2026-06-02', amount: 90000, categoryId: 'cat_food' });
    const result = detectAnomalies({
      transactions: [...history, big, later],
      categories: [category],
      asOfDate: '2026-06-30',
      settings: baseSettings,
      reviews: [],
      lookbackDays: 60,
    });
    expect(result.insights.some((i) => i.txId === 'big')).toBe(true);
    // 早期正常交易不应被判异常
    expect(result.insights.some((i) => i.txId === 'h0')).toBe(false);
  });

  it('样本不足时给出数据不足，不输出结论', () => {
    const txns = [
      makeTxn({ id: 'h1', date: '2026-05-01', amount: 2000, categoryId: 'cat_food' }),
      makeTxn({ id: 'h2', date: '2026-05-02', amount: 2100, categoryId: 'cat_food' }),
      makeTxn({ id: 'big', date: '2026-06-01', amount: 50000, categoryId: 'cat_food' }),
    ];
    const result = detectAnomalies({
      transactions: txns,
      categories: [category],
      asOfDate: '2026-06-30',
      settings: baseSettings,
      reviews: [],
    });
    expect(result.insights).toHaveLength(0);
    expect(result.insufficient).toBeGreaterThan(0);
  });

  it('MAD 与 IQR 全为零时使用备用判断', () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      makeTxn({ id: `h${i}`, date: `2026-05-${String(i + 1).padStart(2, '0')}`, amount: 1000, categoryId: 'cat_food' }),
    );
    const big = makeTxn({ id: 'big', date: '2026-06-01', amount: 20000, categoryId: 'cat_food' });
    const result = detectAnomalies({
      transactions: [...history, big],
      categories: [category],
      asOfDate: '2026-06-30',
      settings: baseSettings,
      reviews: [],
    });
    const insight = result.insights.find((i) => i.txId === 'big');
    expect(insight?.rule).toBe('fallback');
  });

  it('筛选窗口与阈值可配置', () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      makeTxn({ id: `h${i}`, date: `2026-05-${String(i + 1).padStart(2, '0')}`, amount: 2000 + (i % 3) * 100, categoryId: 'cat_food' }),
    );
    const big = makeTxn({ id: 'big', date: '2026-06-01', amount: 50000, categoryId: 'cat_food' });
    const strict = detectAnomalies({
      transactions: [...history, big],
      categories: [category],
      asOfDate: '2026-06-30',
      settings: makeSettings({ anomalyRobustZ: 1 }),
      reviews: [],
    });
    const loose = detectAnomalies({
      transactions: [...history, big],
      categories: [category],
      asOfDate: '2026-06-30',
      settings: makeSettings({ anomalyRobustZ: 10 }),
      reviews: [],
    });
    expect(strict.insights.length).toBeGreaterThanOrEqual(loose.insights.length);
  });
});

describe('高频小额消费', () => {
  it('笔数、金额、频率与明细一致', () => {
    const txns = [
      makeTxn({ id: 'a', date: '2026-06-20', amount: 1200, merchant: '便利店', categoryId: 'cat_food' }),
      makeTxn({ id: 'b', date: '2026-06-21', amount: 1200, merchant: '便利店', categoryId: 'cat_food' }),
      makeTxn({ id: 'c', date: '2026-06-22', amount: 1200, merchant: '便利店', categoryId: 'cat_food' }),
      makeTxn({ id: 'd', date: '2026-06-22', amount: 9900, merchant: '商场', categoryId: 'cat_food' }),
    ];
    const result = detectSmallSpending({
      transactions: txns,
      asOfDate: '2026-06-30',
      threshold: 3000,
      windowDays: 14,
      categories: [makeCategory()],
    });
    expect(result.count).toBe(3);
    expect(result.total).toBe(3600);
    expect(result.byMerchant[0]).toMatchObject({ label: '便利店', count: 3, total: 3600, average: 1200 });
    expect(result.reminder).toBe(true);
    expect(result.byMerchant[0].transactionIds).toHaveLength(3);
  });

  it('窗口外交易不进入统计', () => {
    const txns = [makeTxn({ id: 'a', date: '2026-05-01', amount: 1200, merchant: '便利店' })];
    const result = detectSmallSpending({
      transactions: txns,
      asOfDate: '2026-06-30',
      threshold: 3000,
      windowDays: 14,
      categories: [makeCategory()],
    });
    expect(result.count).toBe(0);
  });
});