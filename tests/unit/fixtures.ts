import type {
  Account,
  Category,
  Dataset,
  FinancialGoal,
  GoalFundEvent,
  ScheduledFlow,
  Settings,
  Transaction,
} from '../../src/domain/types';
import { emptyCalibrationState } from '../../src/domain/calibration';

export function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    safetyReserve: 100_000,
    budget: { monthVariableBudget: 150_000, monthlySavingsCap: 100_000 },
    smallThreshold: 3_000,
    smallWindowDays: 14,
    anomalyWindowDays: 90,
    anomalyMinSamples: 8,
    anomalyRobustZ: 3.5,
    recurringToleranceDays: 3,
    recurringMaxCv: 0.15,
    goalAllocDay: 25,
    coverage: [{ start: '2026-01-01', end: '2026-06-30' }],
    onboardingDone: true,
    quickInputEnabled: true,
    calibration: emptyCalibrationState('2026-06-30T00:00:00.000Z'),
    settingsVersion: 1,
    ...over,
  };
}

export function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: 'acc_main',
    name: '我的钱包',
    type: 'ewallet',
    openingDate: '2026-01-01',
    openingBalance: 1_000_000,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

export function makeTxn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'expense',
    date: '2026-06-01',
    amount: 2_800,
    accountId: 'acc_main',
    nature: 'variable',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

export function makeCategory(over: Partial<Category> = {}): Category {
  return {
    id: 'cat_food',
    name: '餐饮',
    kind: 'expense',
    icon: 'utensils',
    builtin: true,
    archived: false,
    ...over,
  };
}

export function makeFlow(over: Partial<ScheduledFlow> = {}): ScheduledFlow {
  return {
    id: 'flow_rent',
    kind: 'expense',
    title: '房租',
    amount: 200_000,
    accountId: 'acc_main',
    categoryId: 'cat_home',
    startDate: '2026-07-01',
    rule: { unit: 'month', interval: 1 },
    anchorDay: 1,
    enabled: true,
    source: 'manual',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

export function makeGoal(over: Partial<FinancialGoal> = {}): FinancialGoal {
  return {
    id: 'goal_travel',
    name: '旅行基金',
    targetAmount: 500_000,
    deadline: '2026-12-31',
    priority: 2,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

export function makeGoalEvent(over: Partial<GoalFundEvent> = {}): GoalFundEvent {
  return {
    id: `ev_${Math.random().toString(36).slice(2, 8)}`,
    goalId: 'goal_travel',
    type: 'reserve',
    amount: 100_000,
    date: '2026-06-01',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

export function makeDataset(over: Partial<Dataset> = {}): Dataset {
  return {
    meta: { formatVersion: 1, kind: 'personal', createdAt: '2026-01-01T00:00:00.000Z' },
    settings: makeSettings(),
    accounts: [makeAccount()],
    categories: [makeCategory(), makeCategory({ id: 'cat_home', name: '居住' })],
    transactions: [],
    flows: [],
    occurrenceRecords: [],
    candidates: [],
    reviews: [],
    goals: [],
    goalEvents: [],
    plans: [],
    snapshots: [],
    calibrations: [],
    ...over,
  };
}