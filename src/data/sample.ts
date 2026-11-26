/** 合成示例数据生成器：固定种子、锚定今天、结构完整、可通过备份校验。 */
import type {
  Account,
  Dataset,
  FinancialGoal,
  GoalFundEvent,
  ISODate,
  PurchasePlan,
  ScheduleOccurrence,
  ScheduledFlow,
  Transaction,
  TxnKind,
} from '../domain/types';
import { addDaysISO, addMonthsAnchored, addYearsAnchored, clampDayToMonth } from '../domain/days';
import { BUILTIN_CATEGORIES, createDefaultSettings } from './defaults';
import { emptyCalibrationState } from '../domain/calibration';
import { nextOccurrenceDate, occurrenceId } from '../domain/occurrences';

export const DEMO_MONTHS = 6;
const DEMO_SEED = 20261126;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rand: () => number, min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));
const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const yuan = (value: number): number => Math.round(value * 100);

interface FlowSpec {
  id: string;
  kind: 'income' | 'expense';
  title: string;
  amount: number;
  accountId: string;
  categoryId: string;
  merchant: string;
  unit: 'month' | 'year';
  anchorDay: number;
  anchorMonth?: number;
}

const FLOW_SPECS: FlowSpec[] = [
  { id: 'flow_rent', kind: 'expense', title: '房租', amount: yuan(3200), accountId: 'acc_daily', categoryId: 'cat_home', merchant: '房东', unit: 'month', anchorDay: 5 },
  { id: 'flow_salary', kind: 'income', title: '月薪', amount: yuan(15000), accountId: 'acc_daily', categoryId: 'cat_salary', merchant: '示例科技公司', unit: 'month', anchorDay: 10 },
  { id: 'flow_gym', kind: 'expense', title: '健身房', amount: yuan(299), accountId: 'acc_daily', categoryId: 'cat_health', merchant: '乐刻健身', unit: 'month', anchorDay: 12 },
  { id: 'flow_broadband', kind: 'expense', title: '宽带', amount: yuan(1200), accountId: 'acc_daily', categoryId: 'cat_comm', merchant: '电信宽带', unit: 'year', anchorDay: 15, anchorMonth: 8 },
  { id: 'flow_video', kind: 'expense', title: '视频会员', amount: yuan(25), accountId: 'acc_wallet', categoryId: 'cat_fun', merchant: '视频平台', unit: 'month', anchorDay: 22 },
];

const COFFEE_MERCHANTS = ['瑞幸咖啡', '库迪咖啡', '星巴克', '蜜雪冰城'] as const;
const FOOD_MERCHANTS = ['麦当劳', '肯德基', '沙县小吃', '兰州拉面', '盒马鲜生', '美团外卖'] as const;
const TRANSPORT_MERCHANTS = ['地铁', '公交', '滴滴出行', '共享单车'] as const;
const SHOPPING_MERCHANTS = ['优衣库', '淘宝', '京东', '名创优品', '无印良品', '小米之家'] as const;
const DAILY_MERCHANTS = ['便利店', '超市', '屈臣氏'] as const;
const FUN_MERCHANTS = ['电影院', '游戏充值', 'KTV'] as const;
const STUDY_MERCHANTS = ['书店', '网课平台', '文具店'] as const;
const SIDE_MERCHANTS = ['家教', '设计外包', '文案兼职'] as const;

function shuffle<T>(rand: () => number, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createDemoDataset(today: ISODate): Dataset {
  const now = `${today}T08:00:00.000Z`;
  const rand = mulberry32(DEMO_SEED);
  const opening = addDaysISO(today, -180);
  const openingYear = Number(opening.slice(0, 4));
  const openingMonth = Number(opening.slice(5, 7));

  const accounts: Account[] = [
    { id: 'acc_daily', name: '日常账户', type: 'ewallet', openingDate: opening, openingBalance: yuan(12500), archived: false, createdAt: now },
    { id: 'acc_savings', name: '储蓄卡', type: 'savings', openingDate: opening, openingBalance: yuan(48000), archived: false, createdAt: now },
    { id: 'acc_wallet', name: '零钱钱包', type: 'cash', openingDate: opening, openingBalance: yuan(320), archived: false, createdAt: now },
  ];

  const transactions: Transaction[] = [];
  const occurrenceRecords: ScheduleOccurrence[] = [];
  const txnId = (prefix: string, key: string): string => `txn_${prefix}_${key}`;

  const pushTxn = (t: Omit<Transaction, 'createdAt' | 'updatedAt'> & { id: string }): void => {
    transactions.push({ ...t, createdAt: now, updatedAt: now });
  };

  const flows: ScheduledFlow[] = FLOW_SPECS.map((spec) => {
    let first = clampDayToMonth(openingYear, spec.anchorMonth ?? openingMonth, spec.anchorDay);
    while (first < opening) {
      first = spec.unit === 'year' ? addYearsAnchored(first, first, 1, spec.anchorDay) : addMonthsAnchored(first, 1, spec.anchorDay);
    }
    const flow: ScheduledFlow = {
      id: spec.id,
      kind: spec.kind,
      title: spec.title,
      amount: spec.amount,
      accountId: spec.accountId,
      categoryId: spec.categoryId,
      merchant: spec.merchant,
      startDate: first,
      rule: { unit: spec.unit, interval: 1 },
      anchorDay: spec.anchorDay,
      enabled: true,
      source: 'manual',
      createdAt: now,
    };
    let cur = first;
    let guard = 0;
    while (cur <= today && cur >= opening && guard < 4000) {
      guard += 1;
      const id = txnId(spec.id, cur);
      pushTxn({
        id,
        kind: spec.kind as TxnKind,
        date: cur,
        amount: spec.amount,
        accountId: spec.accountId,
        categoryId: spec.categoryId,
        merchant: spec.merchant,
        occurrenceId: occurrenceId(spec.id, cur),
        nature: 'recurring',
      });
      occurrenceRecords.push({
        id: occurrenceId(spec.id, cur),
        flowId: spec.id,
        originalDueDate: cur,
        dueDate: cur,
        amount: spec.amount,
        status: 'settled',
        transactionId: id,
        resolvedAt: now,
      });
      cur = nextOccurrenceDate(flow, cur);
    }
    return flow;
  });

  const monthDaysInWindow = (anchorDay: number): ISODate[] => {
    const out: ISODate[] = [];
    for (let back = DEMO_MONTHS; back >= 0; back -= 1) {
      const d = addMonthsAnchored(today, -back, anchorDay);
      if (d >= opening && d <= today) out.push(d);
    }
    return out;
  };

  for (const d of monthDaysInWindow(8)) {
    pushTxn({ id: txnId('phone', d), kind: 'expense', date: d, amount: yuan(99), accountId: 'acc_daily', categoryId: 'cat_comm', merchant: '中国移动', nature: 'recurring' });
  }

  const weekStarts: ISODate[] = [];
  for (let w = 0; w < 26; w += 1) {
    const ws = addDaysISO(opening, w * 7);
    if (ws > today) break;
    weekStarts.push(ws);
  }
  weekStarts.forEach((ws, w) => {
    const offsets = shuffle(rand, [0, 1, 2, 3, 4, 5, 6]);
    const trio = 2 + (rand() < 0.5 ? 1 : 0);
    for (let j = 0; j < trio; j += 1) {
      const date = addDaysISO(ws, offsets[j]);
      if (date > today) continue;
      const roll = rand();
      if (roll < 0.42) {
        pushTxn({ id: txnId('coffee', `${w}_${j}`), kind: 'expense', date, amount: int(rand, 990, 3800), accountId: 'acc_daily', categoryId: 'cat_coffee', merchant: pick(rand, COFFEE_MERCHANTS), nature: 'variable' });
      } else if (roll < 0.78) {
        pushTxn({ id: txnId('food', `${w}_${j}`), kind: 'expense', date, amount: int(rand, 1500, 8000), accountId: 'acc_daily', categoryId: 'cat_food', merchant: pick(rand, FOOD_MERCHANTS), nature: 'variable' });
      } else {
        pushTxn({ id: txnId('trans', `${w}_${j}`), kind: 'expense', date, amount: int(rand, 200, 3000), accountId: 'acc_daily', categoryId: 'cat_transport', merchant: pick(rand, TRANSPORT_MERCHANTS), nature: 'variable' });
      }
    }
    const dailyDate = addDaysISO(ws, offsets[3]);
    if (dailyDate <= today) {
      pushTxn({ id: txnId('daily', String(w)), kind: 'expense', date: dailyDate, amount: int(rand, 1000, 6000), accountId: 'acc_daily', categoryId: 'cat_other_exp', merchant: pick(rand, DAILY_MERCHANTS), nature: 'variable' });
    }
    if (w % 2 === 1) {
      const funDate = addDaysISO(ws, offsets[4]);
      if (funDate <= today) {
        pushTxn({ id: txnId('fun', String(w)), kind: 'expense', date: funDate, amount: int(rand, 4900, 8800), accountId: 'acc_daily', categoryId: 'cat_fun', merchant: pick(rand, FUN_MERCHANTS), nature: 'variable' });
      }
    } else {
      const studyDate = addDaysISO(ws, offsets[4]);
      if (studyDate <= today) {
        pushTxn({ id: txnId('study', String(w)), kind: 'expense', date: studyDate, amount: int(rand, 2000, 9900), accountId: 'acc_daily', categoryId: 'cat_study', merchant: pick(rand, STUDY_MERCHANTS), nature: 'variable' });
      }
    }
    if (w % 2 === 0) {
      const sideDate = addDaysISO(ws, offsets[5]);
      if (sideDate <= today) {
        pushTxn({ id: txnId('side', String(w)), kind: 'income', date: sideDate, amount: int(rand, 40000, 90000), accountId: 'acc_daily', categoryId: 'cat_side', merchant: pick(rand, SIDE_MERCHANTS), nature: 'one_off' });
      }
    }
  });

  for (const d of monthDaysInWindow(18)) {
    pushTxn({ id: txnId('health', d), kind: 'expense', date: d, amount: int(rand, 3000, 9000), accountId: 'acc_daily', categoryId: 'cat_health', merchant: '药店', nature: 'variable' });
  }
  for (const d of monthDaysInWindow(20)) {
    pushTxn({ id: txnId('otherinc', d), kind: 'income', date: d, amount: int(rand, 500, 5000), accountId: 'acc_daily', categoryId: 'cat_other_inc', merchant: '利息红包', nature: 'one_off' });
  }
  for (const d of monthDaysInWindow(25)) {
    pushTxn({ id: txnId('shop', d), kind: 'expense', date: d, amount: int(rand, 5000, 60000), accountId: 'acc_daily', categoryId: 'cat_shopping', merchant: pick(rand, SHOPPING_MERCHANTS), nature: 'variable' });
    if (rand() < 0.6) {
      pushTxn({ id: txnId('shop2', d), kind: 'expense', date: d, amount: int(rand, 3000, 30000), accountId: 'acc_daily', categoryId: 'cat_shopping', merchant: pick(rand, SHOPPING_MERCHANTS), nature: 'variable' });
    }
  }

  const anomalyDate = addDaysISO(today, -int(rand, 1, 10));
  pushTxn({ id: 'txn_anomaly', kind: 'expense', date: anomalyDate, amount: yuan(6800), accountId: 'acc_daily', categoryId: 'cat_shopping', merchant: '华为商城', note: '数码产品', nature: 'one_off' });

  const goals: FinancialGoal[] = [
    { id: 'goal_travel', name: '旅行基金', targetAmount: yuan(12000), deadline: addDaysISO(today, 220), priority: 2, status: 'active', createdAt: now },
    { id: 'goal_emergency', name: '应急储备', targetAmount: yuan(30000), deadline: addDaysISO(today, 365), priority: 1, status: 'active', createdAt: now },
    { id: 'goal_gadget', name: '新电脑', targetAmount: yuan(8000), deadline: addDaysISO(today, 130), priority: 3, status: 'active', createdAt: now },
  ];

  const goalEvents: GoalFundEvent[] = [
    { id: 'ev_travel_1', goalId: 'goal_travel', type: 'reserve', amount: yuan(1000), date: addDaysISO(today, -50), createdAt: now },
    { id: 'ev_travel_2', goalId: 'goal_travel', type: 'reserve', amount: yuan(1000), date: addDaysISO(today, -20), createdAt: now },
    { id: 'ev_emergency_1', goalId: 'goal_emergency', type: 'reserve', amount: yuan(1500), date: addDaysISO(today, -35), createdAt: now },
    { id: 'ev_gadget_1', goalId: 'goal_gadget', type: 'reserve', amount: yuan(600), date: addDaysISO(today, -12), createdAt: now },
  ];

  const plans: PurchasePlan[] = [
    { id: 'plan_phone', name: '新手机', price: yuan(6999), purchaseDate: addDaysISO(today, 45), allowDelay: true, reserveUnit: 'month', reserveInterval: 1, baselineVersion: 1, createdAt: now, updatedAt: now },
  ];

  const settings = {
    ...createDefaultSettings(now),
    safetyReserve: yuan(8000),
    budget: { monthVariableBudget: yuan(4200), monthlySavingsCap: yuan(2500) },
    coverage: [{ start: opening, end: addDaysISO(today, -1) }],
    onboardingDone: true,
    calibration: emptyCalibrationState(now),
    settingsVersion: 1,
  };

  return {
    meta: { formatVersion: 1, kind: 'demo', createdAt: now, demoDate: today },
    settings,
    accounts,
    categories: BUILTIN_CATEGORIES.map((c) => ({ ...c })),
    transactions,
    flows,
    occurrenceRecords,
    candidates: [],
    reviews: [],
    goals,
    goalEvents,
    plans,
    snapshots: [],
    calibrations: [],
  };
}
