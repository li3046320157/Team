/** 领域类型定义：金额一律为整数分（Cents），业务日期一律为本地日历 YYYY-MM-DD。 */

export type Cents = number;
export type ISODate = string; // YYYY-MM-DD，本地日历
export type ID = string;

export type AccountType = 'cash' | 'savings' | 'ewallet';

export interface Account {
  id: ID;
  name: string;
  type: AccountType;
  openingDate: ISODate;
  openingBalance: Cents;
  archived: boolean;
  createdAt: string;
}

export type TxnKind = 'income' | 'expense' | 'transfer';
export type TxnNature = 'variable' | 'recurring' | 'one_off';

export interface Transaction {
  id: ID;
  kind: TxnKind;
  date: ISODate;
  amount: Cents; // 恒 > 0
  accountId: ID;
  toAccountId?: ID;
  categoryId?: ID;
  merchant?: string;
  note?: string;
  occurrenceId?: ID;
  goalId?: ID;
  nature: TxnNature;
  seriesId?: ID;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: ID;
  name: string;
  kind: 'income' | 'expense';
  icon: string; // lucide 图标名
  builtin: boolean;
  archived: boolean;
}

export type FreqUnit = 'day' | 'week' | 'month' | 'year';

export interface RecurRule {
  unit: FreqUnit;
  interval: number; // >= 1
}

export interface ScheduledFlow {
  id: ID;
  kind: 'income' | 'expense';
  title: string;
  amount: Cents;
  accountId: ID;
  categoryId?: ID;
  merchant?: string;
  note?: string;
  startDate: ISODate;
  endDate?: ISODate;
  rule: RecurRule;
  anchorDay: number; // 月度/年度重复的原始日号 1-31
  enabled: boolean;
  source: 'manual' | 'recurring_candidate';
  createdAt: string;
}

export type OccurrenceStatus = 'pending' | 'settled' | 'skipped' | 'canceled';

/** 仅在实际被处理（核销/跳过/取消/改期）时落库；待发生实例由计划确定性推导。 */
export interface ScheduleOccurrence {
  id: ID; // 稳定 ID：occ:${flowId}:${originalDueDate}
  flowId: ID;
  originalDueDate: ISODate;
  dueDate: ISODate; // 改期后的实际到期日
  amount: Cents;
  status: OccurrenceStatus;
  transactionId?: ID;
  resolvedAt?: string;
  note?: string;
}

export interface RecurringCandidate {
  id: ID;
  signature: string;
  merchantKey: string;
  merchantLabel: string;
  unit: FreqUnit;
  interval: number;
  estimatedAmount: Cents;
  lastDate: ISODate;
  nextDate: ISODate;
  score: number;
  scoreParts: { interval: number; amount: number; sample: number };
  sampleIds: ID[];
  intervalDays: number;
  amountCv: number;
  status: 'open' | 'confirmed' | 'ignored';
  flowId?: ID;
}

export type ReviewKind = 'anomaly';

export interface InsightReview {
  id: ID; // `${kind}:${txId}`
  kind: ReviewKind;
  status: 'open' | 'confirmed' | 'ignored';
  note?: string;
  resolvedAt?: string;
}

export interface Budget {
  monthVariableBudget: Cents; // 每月可变消费预算，0 表示未设置
  monthlySavingsCap: Cents; // 每月储蓄分配上限，0 表示未设置
}

export type GoalStatus = 'active' | 'archived';

export interface FinancialGoal {
  id: ID;
  name: string;
  targetAmount: Cents;
  deadline: ISODate;
  priority: number; // 1..5
  status: GoalStatus;
  createdAt: string;
}

export type GoalFundType = 'reserve' | 'release' | 'consume';

export interface GoalFundEvent {
  id: ID;
  goalId?: ID;
  planId?: ID;
  type: GoalFundType;
  amount: Cents;
  date: ISODate;
  transactionId?: ID;
  note?: string;
  createdAt: string;
}

export interface PurchasePlan {
  id: ID;
  name: string;
  price: Cents;
  purchaseDate: ISODate;
  allowDelay: boolean;
  goalId?: ID;
  reserveUnit: 'week' | 'month';
  reserveInterval: number;
  baselineVersion: number;
  createdAt: string;
  updatedAt: string;
}

export type VariableSource = 'weekday' | 'budget' | 'daily_avg' | 'none';

export interface ForecastDay {
  date: ISODate;
  balance: Cents;
  reserved: Cents;
  free: Cents;
  income: Cents;
  fixedExpense: Cents;
  variableEstimate: Cents | null;
  variableSource: VariableSource;
  scenarioExpense: Cents;
  isToday?: boolean;
  isTodayEnd?: boolean;
}

export interface ForecastInputsSummary {
  txnCount: number;
  coveredDays: number;
  trainingDays: number;
  weekdaySamples: Record<number, number>;
  safetyReserve: Cents;
  reserved: Cents;
  budget: Cents;
}

export interface CalibrationState {
  weekdayBias: Record<number, Cents>;
  alpha: number;
  version: number;
  updatedAt: string;
}

export interface ForecastSnapshot {
  id: ID;
  createdAt: string;
  asOfDate: ISODate;
  horizonDays: number;
  algoVersion: string;
  mode: 'personal' | 'demo';
  auto: boolean;
  inputSummary: ForecastInputsSummary;
  days: ForecastDay[];
  calibration: CalibrationState;
  paramsVersion: string;
}

export interface CalibrationRecord {
  id: ID; // cal:${snapshotId}:${evaluatedDate}
  evaluatedDate: ISODate;
  sourceSnapshotId: ID;
  actual: Cents;
  rawPredicted: Cents;
  predicted: Cents;
  residual: Cents;
  biasBefore: Cents;
  biasAfter: Cents;
  weekday: number;
  alpha: number;
  invalidated: boolean;
  version: number;
  createdAt: string;
}

export interface CoverageInterval {
  start: ISODate;
  end: ISODate;
}

export interface Settings {
  safetyReserve: Cents;
  budget: Budget;
  smallThreshold: Cents;
  smallWindowDays: number;
  anomalyWindowDays: number;
  anomalyMinSamples: number;
  anomalyRobustZ: number;
  recurringToleranceDays: number;
  recurringMaxCv: number;
  goalAllocDay: number; // 1..31
  coverage: CoverageInterval[];
  onboardingDone: boolean;
  quickInputEnabled: boolean;
  calibration: CalibrationState;
  settingsVersion: number;
}

export interface DatasetMeta {
  formatVersion: number;
  kind: 'personal' | 'demo';
  createdAt: string;
  restoredAt?: string;
  demoDate?: ISODate; // 演示数据的锚定日期
}

export interface Dataset {
  meta: DatasetMeta;
  settings: Settings;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  flows: ScheduledFlow[];
  occurrenceRecords: ScheduleOccurrence[];
  candidates: RecurringCandidate[];
  reviews: InsightReview[];
  goals: FinancialGoal[];
  goalEvents: GoalFundEvent[];
  plans: PurchasePlan[];
  snapshots: ForecastSnapshot[];
  calibrations: CalibrationRecord[];
}

export type DataMode = 'personal' | 'demo';

export interface OccurrenceView {
  id: ID;
  flow: ScheduledFlow;
  dueDate: ISODate;
  originalDueDate: ISODate;
  amount: Cents;
  status: OccurrenceStatus;
  transactionId?: ID;
  overdue: boolean;
  daysUntilDue: number;
}