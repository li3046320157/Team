/** 默认设置、内置分类与空数据集工厂。 */
import type { Category, Dataset, DataMode, ISODate, Settings } from '../domain/types';
import { emptyCalibrationState } from '../domain/calibration';

export function createDefaultSettings(now: string): Settings {
  return {
    safetyReserve: 800_000,
    budget: { monthVariableBudget: 400_000, monthlySavingsCap: 200_000 },
    smallThreshold: 3_000,
    smallWindowDays: 30,
    anomalyWindowDays: 90,
    anomalyMinSamples: 5,
    anomalyRobustZ: 3.5,
    recurringToleranceDays: 2,
    recurringMaxCv: 0.35,
    goalAllocDay: 8,
    coverage: [],
    onboardingDone: false,
    quickInputEnabled: true,
    calibration: emptyCalibrationState(now),
    settingsVersion: 1,
  };
}

export const BUILTIN_CATEGORIES: Category[] = [
  { id: 'cat_food', name: '餐饮', kind: 'expense', icon: 'utensils', builtin: true, archived: false },
  { id: 'cat_coffee', name: '咖啡茶饮', kind: 'expense', icon: 'coffee', builtin: true, archived: false },
  { id: 'cat_transport', name: '交通', kind: 'expense', icon: 'train', builtin: true, archived: false },
  { id: 'cat_shopping', name: '购物', kind: 'expense', icon: 'shopping', builtin: true, archived: false },
  { id: 'cat_home', name: '居住', kind: 'expense', icon: 'house', builtin: true, archived: false },
  { id: 'cat_comm', name: '通讯', kind: 'expense', icon: 'phone', builtin: true, archived: false },
  { id: 'cat_fun', name: '娱乐', kind: 'expense', icon: 'film', builtin: true, archived: false },
  { id: 'cat_health', name: '医疗', kind: 'expense', icon: 'heart', builtin: true, archived: false },
  { id: 'cat_study', name: '学习', kind: 'expense', icon: 'book', builtin: true, archived: false },
  { id: 'cat_other_exp', name: '其他支出', kind: 'expense', icon: 'shapes', builtin: true, archived: false },
  { id: 'cat_salary', name: '工资', kind: 'income', icon: 'wallet', builtin: true, archived: false },
  { id: 'cat_side', name: '兼职', kind: 'income', icon: 'briefcase', builtin: true, archived: false },
  { id: 'cat_bonus', name: '奖金', kind: 'income', icon: 'gift', builtin: true, archived: false },
  { id: 'cat_other_inc', name: '其他收入', kind: 'income', icon: 'coins', builtin: true, archived: false },
];

export function createEmptyDataset(mode: DataMode, today: ISODate): Dataset {
  const now = new Date().toISOString();
  const settings = createDefaultSettings(now);
  settings.onboardingDone = mode === 'demo';
  return {
    meta: {
      formatVersion: 1,
      kind: mode,
      createdAt: now,
      demoDate: mode === 'demo' ? today : undefined,
    },
    settings,
    accounts: [],
    categories: BUILTIN_CATEGORIES.map((c) => ({ ...c })),
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
  };
}