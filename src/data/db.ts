/** IndexedDB（Dexie）持久层：个人库与演示库完全隔离，整库快照事务化写入。 */
import Dexie, { type Table } from 'dexie';
import type {
  Account,
  CalibrationRecord,
  Category,
  Dataset,
  DatasetMeta,
  DataMode,
  FinancialGoal,
  ForecastSnapshot,
  GoalFundEvent,
  InsightReview,
  PurchasePlan,
  RecurringCandidate,
  ScheduleOccurrence,
  ScheduledFlow,
  Settings,
  Transaction,
} from '../domain/types';

interface MetaRow extends DatasetMeta {
  key: 1;
}
interface SettingsRow extends Settings {
  key: 1;
}

class MoneyFlowDB extends Dexie {
  meta!: Table<MetaRow, number>;
  settings!: Table<SettingsRow, number>;
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  flows!: Table<ScheduledFlow, string>;
  occurrenceRecords!: Table<ScheduleOccurrence, string>;
  candidates!: Table<RecurringCandidate, string>;
  reviews!: Table<InsightReview, string>;
  goals!: Table<FinancialGoal, string>;
  goalEvents!: Table<GoalFundEvent, string>;
  plans!: Table<PurchasePlan, string>;
  snapshots!: Table<ForecastSnapshot, string>;
  calibrations!: Table<CalibrationRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      meta: 'key',
      settings: 'key',
      accounts: 'id',
      categories: 'id',
      transactions: 'id,date,accountId,categoryId,occurrenceId,goalId',
      flows: 'id',
      occurrenceRecords: 'id,flowId,status',
      candidates: 'id,status',
      reviews: 'id',
      goals: 'id',
      goalEvents: 'id,goalId,date',
      plans: 'id',
      snapshots: 'id,asOfDate',
      calibrations: 'id,evaluatedDate',
    });
  }
}

const dbs: Record<DataMode, MoneyFlowDB | null> = { personal: null, demo: null };

function dbFor(mode: DataMode): MoneyFlowDB {
  if (!dbs[mode]) {
    dbs[mode] = new MoneyFlowDB(mode === 'personal' ? 'moneyflow-personal' : 'moneyflow-demo');
  }
  return dbs[mode] as MoneyFlowDB;
}

export const MODE_STORAGE_KEY = 'moneyflow.mode';

export function readStoredMode(): DataMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    return v === 'demo' ? 'demo' : 'personal';
  } catch {
    return 'personal';
  }
}

export function storeMode(mode: DataMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* 忽略隐私模式下的存储失败 */
  }
}

export async function readDataset(mode: DataMode): Promise<Dataset | null> {
  const db = dbFor(mode);
  const meta = await db.meta.get(1);
  if (!meta) return null;
  const [settings, accounts, categories, transactions, flows, occurrenceRecords, candidates, reviews, goals, goalEvents, plans, snapshots, calibrations] =
    await Promise.all([
      db.settings.get(1),
      db.accounts.toArray(),
      db.categories.toArray(),
      db.transactions.toArray(),
      db.flows.toArray(),
      db.occurrenceRecords.toArray(),
      db.candidates.toArray(),
      db.reviews.toArray(),
      db.goals.toArray(),
      db.goalEvents.toArray(),
      db.plans.toArray(),
      db.snapshots.toArray(),
      db.calibrations.toArray(),
    ]);
  if (!settings) return null;
  const { key: _metaKey, ...metaData } = meta;
  const { key: _settingsKey, ...settingsData } = settings;
  return {
    meta: metaData,
    settings: settingsData,
    accounts,
    categories,
    transactions,
    flows,
    occurrenceRecords,
    candidates,
    reviews,
    goals,
    goalEvents,
    plans,
    snapshots,
    calibrations,
  };
}

/** 整库覆盖写入：所有表处于同一事务，失败则整体回滚。 */
export async function writeDataset(mode: DataMode, dataset: Dataset): Promise<void> {
  const db = dbFor(mode);
  const metaRow: MetaRow = { ...dataset.meta, key: 1 };
  const settingsRow: SettingsRow = { ...dataset.settings, key: 1 };
  await db.transaction(
    'rw',
    [db.meta, db.settings, db.accounts, db.categories, db.transactions, db.flows, db.occurrenceRecords, db.candidates, db.reviews, db.goals, db.goalEvents, db.plans, db.snapshots, db.calibrations],
    async () => {
      await Promise.all([
        db.meta.clear(),
        db.settings.clear(),
        db.accounts.clear(),
        db.categories.clear(),
        db.transactions.clear(),
        db.flows.clear(),
        db.occurrenceRecords.clear(),
        db.candidates.clear(),
        db.reviews.clear(),
        db.goals.clear(),
        db.goalEvents.clear(),
        db.plans.clear(),
        db.snapshots.clear(),
        db.calibrations.clear(),
      ]);
      await Promise.all([
        db.meta.put(metaRow),
        db.settings.put(settingsRow),
        db.accounts.bulkPut(dataset.accounts),
        db.categories.bulkPut(dataset.categories),
        db.transactions.bulkPut(dataset.transactions),
        db.flows.bulkPut(dataset.flows),
        db.occurrenceRecords.bulkPut(dataset.occurrenceRecords),
        db.candidates.bulkPut(dataset.candidates),
        db.reviews.bulkPut(dataset.reviews),
        db.goals.bulkPut(dataset.goals),
        db.goalEvents.bulkPut(dataset.goalEvents),
        db.plans.bulkPut(dataset.plans),
        db.snapshots.bulkPut(dataset.snapshots),
        db.calibrations.bulkPut(dataset.calibrations),
      ]);
    },
  );
}

export async function clearDataset(mode: DataMode): Promise<void> {
  const db = dbFor(mode);
  await db.transaction(
    'rw',
    [db.meta, db.settings, db.accounts, db.categories, db.transactions, db.flows, db.occurrenceRecords, db.candidates, db.reviews, db.goals, db.goalEvents, db.plans, db.snapshots, db.calibrations],
    async () => {
      await Promise.all([
        db.meta.clear(),
        db.settings.clear(),
        db.accounts.clear(),
        db.categories.clear(),
        db.transactions.clear(),
        db.flows.clear(),
        db.occurrenceRecords.clear(),
        db.candidates.clear(),
        db.reviews.clear(),
        db.goals.clear(),
        db.goalEvents.clear(),
        db.plans.clear(),
        db.snapshots.clear(),
        db.calibrations.clear(),
      ]);
    },
  );
}

export function describeDbError(error: unknown): string {
  if (error instanceof Error) {
    const name = (error as { name?: string }).name ?? '';
    if (name === 'QuotaExceededError') return '浏览器存储空间不足，请先导出备份并清理旧快照';
    if (name === 'DatabaseClosedError') return '数据库已关闭，请刷新页面后重试';
    return error.message || '本地数据库操作失败';
  }
  return '本地数据库操作失败';
}