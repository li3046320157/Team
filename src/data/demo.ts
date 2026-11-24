/** 确定性合成示例数据：不含任何真实账单，锚定“今天”生成约 6 个月流水。 */
import type {
  Account,
  Cents,
  Dataset,
  FinancialGoal,
  GoalFundEvent,
  ISODate,
  PurchasePlan,
  ScheduledFlow,
  Settings,
  Transaction,
  ScheduleOccurrence,
  ForecastSnapshot,
} from '../domain/types';
import { addDaysISO, addMonthsAnchored, clampDayToMonth, listMonthStarts, parseISODate, todayISO } from '../domain/days';
import { expandFlowDates, occurrenceId } from '../domain/occurrences';
import { BUILTIN_CATEGORIES, createDefaultSettings } from './defaults';
import { runForecast } from '../domain/forecasting/engine';
import { emptyCalibrationState, runCalibration, snapshotFromForecast } from '../domain/calibration';
import { detectRecurringCandidates } from '../domain/insights/recurring';
import { detectAnomalies } from '../domain/insights/anomaly';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_START_OFFSET_DAYS = 180;
export const DEMO_SNAPSHOT_DAYS = 62;
export const DEMO_GENERATOR_VERSION = 'demo-v1';

export function generateDemoDataset(today: ISODate = todayISO()): Dataset {
  const rng = mulberry32(20261124);
  const pick = <T,>(items: T[]): T => items[Math.floor(rng() * items.length) % items.length];
  const chance = (p: number) => rng() < p;
  const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const now = new Date().toISOString();
  const start = addDaysISO(today, -DEMO_START_OFFSET_DAYS);
  const yesterday = addDaysISO(today, -1);
  const coverageStart = addDaysISO(start, 7);
  const settings: Settings = {
    ...createDefaultSettings(now),
    safetyReserve: 1_200_000,
    budget: { monthVariableBudget: 450_000, monthlySavingsCap: 200_000 },
    smallThreshold: 3_000,
    smallWindowDays: 30,
    anomalyWindowDays: 90,
    anomalyMinSamples: 5,
    anomalyRobustZ: 3.5,
    recurringToleranceDays: 2,
    recurringMaxCv: 0.35,
    goalAllocDay: 8,
    coverage: [{ start: coverageStart, end: yesterday }],
    onboardingDone: true,
  };

  const accounts: Account[] = [
    { id: 'acc_bank', name: '招行储蓄卡', type: 'savings', openingDate: start, openingBalance: 600_000, archived: false, createdAt: now },
    { id: 'acc_alipay', name: '支付宝', type: 'ewallet', openingDate: start, openingBalance: 160_000, archived: false, createdAt: now },
    { id: 'acc_wechat', name: '微信零钱', type: 'ewallet', openingDate: start, openingBalance: 40_000, archived: false, createdAt: now },
  ];

  const transactions: Transaction[] = [];
  const occurrenceRecords: ScheduleOccurrence[] = [];
  let varSeq = 0;

  const addVar = (
    date: ISODate,
    amount: Cents,
    categoryId: string,
    merchant: string,
    accountId = 'acc_alipay',
    nature: 'variable' | 'one_off' = 'variable',
    note?: string,
  ) => {
    varSeq += 1;
    const t: Transaction = {
      id: `txn_demo_v_${varSeq}`,
      kind: 'expense',
      date,
      amount,
      accountId,
      categoryId,
      merchant,
      note,
      nature,
      createdAt: `${date}T09:10:00.000Z`,
      updatedAt: `${date}T09:10:00.000Z`,
    };
    transactions.push(t);
    return t;
  };

  const flows: ScheduledFlow[] = [];
  const addFlow = (
    id: string,
    kind: 'income' | 'expense',
    title: string,
    amount: Cents,
    accountId: string,
    categoryId: string,
    firstDate: ISODate,
    rule: { unit: 'day' | 'week' | 'month' | 'year'; interval: number },
    merchant: string,
    source: 'manual' | 'recurring_candidate' = 'manual',
    endDate?: ISODate,
  ) => {
    const flow: ScheduledFlow = {
      id,
      kind,
      title,
      amount,
      accountId,
      categoryId,
      merchant,
      startDate: firstDate,
      endDate,
      rule,
      anchorDay: Number(firstDate.slice(8, 10)),
      enabled: true,
      source,
      createdAt: now,
    };
    flows.push(flow);
    return flow;
  };

  const firstMonth = `${start.slice(0, 7)}-01`;
  const salary = addFlow('flow_salary', 'income', '月薪', 1_200_000, 'acc_bank', 'cat_salary', clampDayToMonth(Number(firstMonth.slice(0, 4)), Number(firstMonth.slice(5, 7)), 10), { unit: 'month', interval: 1 }, '示例科技');
  if (salary.startDate < start) salary.startDate = addMonthsAnchored(firstMonth, 1, 10);
  salary.anchorDay = Number(salary.startDate.slice(8, 10));
  const rent = addFlow('flow_rent', 'expense', '房租', 420_000, 'acc_bank', 'cat_home', clampDayToMonth(Number(firstMonth.slice(0, 4)), Number(firstMonth.slice(5, 7)), 5), { unit: 'month', interval: 1 }, '房东');
  if (rent.startDate < start) rent.startDate = addMonthsAnchored(firstMonth, 1, 5);
  const utilities = addFlow('flow_utilities', 'expense', '水电燃气', 18_000, 'acc_alipay', 'cat_home', clampDayToMonth(Number(firstMonth.slice(0, 4)), Number(firstMonth.slice(5, 7)), 12), { unit: 'month', interval: 1 }, '城市公共事业');
  const phone = addFlow('flow_phone', 'expense', '话费', 6_000, 'acc_wechat', 'cat_comm', clampDayToMonth(Number(firstMonth.slice(0, 4)), Number(firstMonth.slice(5, 7)), 25), { unit: 'month', interval: 1 }, '中国移动');
  const video = addFlow('flow_video', 'expense', '视频会员', 2_500, 'acc_alipay', 'cat_fun', clampDayToMonth(Number(firstMonth.slice(0, 4)), Number(firstMonth.slice(5, 7)), 15), { unit: 'month', interval: 1 }, '示例视频');
  const music = addFlow('flow_music', 'expense', '音乐会员', 1_500, 'acc_wechat', 'cat_fun', clampDayToMonth(Number(firstMonth.slice(0, 4)), Number(firstMonth.slice(5, 7)), 20), { unit: 'month', interval: 1 }, '示例音乐');
  const gym = addFlow('flow_gym', 'expense', '健身房', 29_900, 'acc_bank', 'cat_health', clampDayToMonth(Number(firstMonth.slice(0, 4)), Number(firstMonth.slice(5, 7)), 8), { unit: 'month', interval: 1 }, '邻里健身');
  for (const flow of [utilities, phone, video, music, gym]) {
    if (flow.startDate < start) {
      flow.startDate = addMonthsAnchored(firstMonth, 1, flow.anchorDay);
    }
  }
  addFlow('flow_checkup', 'expense', '年度体检', 680_000, 'acc_bank', 'cat_health', addDaysISO(today, 10), { unit: 'day', interval: 1 }, '市立体检中心', 'manual', addDaysISO(today, 10));
  addFlow('flow_flight', 'expense', '旅行机票', 380_000, 'acc_alipay', 'cat_fun', addDaysISO(today, 18), { unit: 'day', interval: 1 }, '示例航空', 'manual', addDaysISO(today, 18));

  const settleFlow = (flow: ScheduledFlow, skipDates: Set<ISODate> = new Set()) => {
    const dates = expandFlowDates(flow, flow.startDate, yesterday);
    for (const date of dates) {
      const id = occurrenceId(flow.id, date);
      if (skipDates.has(date)) {
        occurrenceRecords.push({
          id,
          flowId: flow.id,
          originalDueDate: date,
          dueDate: date,
          amount: flow.amount,
          status: 'skipped',
          resolvedAt: `${date}T20:00:00.000Z`,
          note: '示例数据：本次跳过',
        });
        continue;
      }
      const txnId = `txn_demo_f_${flow.id}_${date}`;
      transactions.push({
        id: txnId,
        kind: flow.kind,
        date,
        amount: flow.amount,
        accountId: flow.accountId,
        categoryId: flow.categoryId,
        merchant: flow.merchant,
        note: flow.title,
        occurrenceId: id,
        nature: 'recurring',
        createdAt: `${date}T08:00:00.000Z`,
        updatedAt: `${date}T08:00:00.000Z`,
      });
      occurrenceRecords.push({
        id,
        flowId: flow.id,
        originalDueDate: date,
        dueDate: date,
        amount: flow.amount,
        status: 'settled',
        transactionId: txnId,
        resolvedAt: `${date}T08:00:00.000Z`,
      });
    }
  };

  const skippedMusic = expandFlowDates(music, music.startDate, yesterday)[2];
  settleFlow(music, new Set(skippedMusic ? [skippedMusic] : []));
  const skippedGym = expandFlowDates(gym, gym.startDate, yesterday)[1];
  settleFlow(gym, new Set(skippedGym ? [skippedGym] : []));
  for (const flow of [salary, rent, utilities, phone, video]) settleFlow(flow);

  // 可变消费：工作日/周末模式 + 零消费日，金额为整数分
  let date = coverageStart;
  while (date <= yesterday) {
    const weekday = parseISODate(date).getDay();
    const weekend = weekday === 0 || weekday === 6;
    const zeroDay = weekend ? chance(0.2) : chance(0.1);
    if (!zeroDay) {
      if (!weekend && chance(0.82)) {
        addVar(date, pick([1_900, 2_200, 2_500, 3_200]), 'cat_coffee', chance(0.35) ? '瑞幸咖啡' : 'Manner 咖啡', chance(0.7) ? 'acc_alipay' : 'acc_wechat');
      }
      if (!weekend && chance(0.85)) {
        addVar(date, pick([2_600, 3_200, 4_500]), 'cat_food', chance(0.5) ? '公司食堂' : '美团外卖', 'acc_alipay');
      }
      if (chance(weekend ? 0.75 : 0.6)) {
        addVar(date, weekend ? pick([8_800, 12_800, 6_800]) : pick([4_200, 5_600, 7_200]), 'cat_food', weekend ? pick(['海底捞', '巷口小馆', '城南面馆']) : pick(['美团外卖', '楼下面馆', '轻食沙拉']), 'acc_alipay');
      }
      if (chance(weekend ? 0.25 : 0.55)) {
        addVar(date, between(400, 800), 'cat_transport', '地铁出行', 'acc_alipay');
      }
      if (weekend && chance(0.16)) {
        addVar(date, between(2_600, 4_800), 'cat_transport', '滴滴出行', 'acc_alipay');
      }
      if (chance(0.35)) {
        addVar(date, pick([4_500, 7_900, 9_800, 12_500, 3_900]), 'cat_shopping', pick(['盒马鲜生', '京东', '淘宝', '全家便利店']), 'acc_alipay');
      }
      if (chance(0.3)) {
        addVar(date, pick([1_500, 1_800, 2_200]), 'cat_coffee', pick(['蜜雪冰城', '喜茶', '茶百道']), 'acc_wechat');
      }
      if (chance(0.06)) {
        addVar(date, pick([3_800, 4_500, 5_200]), 'cat_fun', '万达影城', 'acc_wechat');
      }
      if (chance(0.035)) {
        addVar(date, between(2_800, 6_900), 'cat_health', '益丰大药房', 'acc_wechat');
      }
      if (chance(0.02)) {
        addVar(date, pick([1_900, 3_900, 6_800]), 'cat_study', pick(['微信读书', '得到', '极客时间']), 'acc_alipay');
      }
    }
    date = addDaysISO(date, 1);
  }

  // 异常消费：有足够同类历史，MAD 稳健 Z 可识别
  const anomalyDate = addDaysISO(today, -43);
  if (anomalyDate >= coverageStart) addVar(anomalyDate, 68_800, 'cat_food', '鮨一日本料理', 'acc_bank', 'one_off', '朋友聚餐');

  // 周期候选：连续 3 个月同商户、同金额、同日号（未核销，故可被识别）
  const keepMonths = listMonthStarts(addDaysISO(today, -130), today);
  const keepDates = keepMonths
    .map((m) => clampDayToMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 18))
    .filter((d) => d <= yesterday && d >= coverageStart)
    .slice(-3);
  for (const d of keepDates) addVar(d, 2_800, 'cat_fun', 'Keep 会员', 'acc_alipay');

  // 每月从工资卡向电子钱包补充余额：转账不改变总余额，只让示例账户更贴近真实使用
  const topupMonths = listMonthStarts(start, yesterday);
  topupMonths.forEach((month, idx) => {
    const day = clampDayToMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 11);
    if (day < start || day > yesterday) return;
    const pairs: { accountId: string; toAccountId: string; amount: Cents; label: string }[] = [
      { accountId: 'acc_bank', toAccountId: 'acc_alipay', amount: 450_000, label: '转入支付宝' },
      { accountId: 'acc_bank', toAccountId: 'acc_wechat', amount: 120_000, label: '转入微信零钱' },
    ];
    for (const p of pairs) {
      transactions.push({
        id: `txn_demo_topup_${idx}_${p.toAccountId}`,
        kind: 'transfer',
        date: day,
        amount: p.amount,
        accountId: p.accountId,
        toAccountId: p.toAccountId,
        note: p.label,
        nature: 'one_off',
        createdAt: `${day}T09:00:00.000Z`,
        updatedAt: `${day}T09:00:00.000Z`,
      });
    }
  });

  // 目标与预留事件（预留只做资金 earmark，不改变账户余额）
  const goals: FinancialGoal[] = [
    { id: 'goal_travel', name: '旅行基金', targetAmount: 600_000, deadline: addDaysISO(today, 150), priority: 3, status: 'active', createdAt: now },
    { id: 'goal_pc', name: '新电脑', targetAmount: 500_000, deadline: addDaysISO(today, 90), priority: 4, status: 'active', createdAt: now },
    { id: 'goal_emergency', name: '应急金', targetAmount: 3_000_000, deadline: addDaysISO(today, 365), priority: 5, status: 'active', createdAt: now },
  ];
  const goalEvents: GoalFundEvent[] = [];
  const allocMonths = listMonthStarts(addDaysISO(today, -120), today).slice(-4);
  allocMonths.forEach((month, idx) => {
    const day = clampDayToMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)), settings.goalAllocDay);
    if (day > yesterday) return;
    goalEvents.push({ id: `fund_demo_em_${idx}`, goalId: 'goal_emergency', type: 'reserve', amount: 60_000, date: day, note: '每月自动预留', createdAt: `${day}T08:30:00.000Z` });
    if (idx >= 1) {
      goalEvents.push({ id: `fund_demo_travel_${idx}`, goalId: 'goal_travel', type: 'reserve', amount: 40_000, date: day, note: '每月自动预留', createdAt: `${day}T08:30:00.000Z` });
      goalEvents.push({ id: `fund_demo_pc_${idx}`, goalId: 'goal_pc', type: 'reserve', amount: 25_000, date: day, note: '每月自动预留', createdAt: `${day}T08:30:00.000Z` });
    }
  });

  const plans: PurchasePlan[] = [
    {
      id: 'plan_demo_camera',
      name: '相机',
      price: 799_000,
      purchaseDate: addDaysISO(today, 20),
      allowDelay: true,
      reserveUnit: 'month',
      reserveInterval: 1,
      baselineVersion: 1,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const forecastDataset = { accounts, transactions, flows, occurrenceRecords, goalEvents };
  const snapshots: ForecastSnapshot[] = [];
  for (let i = DEMO_SNAPSHOT_DAYS - 1; i >= 0; i -= 1) {
    const d = addDaysISO(today, -i);
    const result = runForecast({ asOfDate: d, horizonDays: 90, dataset: forecastDataset, coverage: settings.coverage, settings });
    snapshots.push(
      snapshotFromForecast({
        result,
        asOfDate: d,
        mode: 'demo',
        auto: true,
        calibration: emptyCalibrationState(now),
        id: `snap:demo:${d}`,
        createdAt: `${d}T21:00:00.000Z`,
        paramsVersion: DEMO_GENERATOR_VERSION,
      }),
    );
  }
  const calibration = runCalibration({
    snapshots,
    transactions,
    coverage: settings.coverage,
    asOfDate: today,
    state: emptyCalibrationState(now),
    existing: [],
    days: 60,
  });
  settings.calibration = calibration.state;

  const anomalies = detectAnomalies({ transactions, categories: BUILTIN_CATEGORIES, asOfDate: today, settings, reviews: [] });
  const reviews = anomalies.insights.slice(0, 1).map((insight) => ({
    id: `anomaly:${insight.txId}`,
    kind: 'anomaly' as const,
    status: 'confirmed' as const,
    note: '示例中已确认：计划外聚餐',
    resolvedAt: now,
  }));
  const candidates = detectRecurringCandidates({ transactions, asOfDate: today, settings, flows, previous: [] });

  transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    meta: { formatVersion: 1, kind: 'demo', createdAt: now, demoDate: today },
    settings,
    accounts,
    categories: BUILTIN_CATEGORIES.map((c) => ({ ...c })),
    transactions,
    flows,
    occurrenceRecords,
    candidates,
    reviews,
    goals,
    goalEvents,
    plans,
    snapshots,
    calibrations: calibration.records,
  };
}