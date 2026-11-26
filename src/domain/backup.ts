/** JSON 完整备份与覆盖恢复：结构校验 + 引用完整性 + 不变量校验。 */
import { z } from 'zod';
import type { Dataset, ISODate } from './types';
import { isValidISODate } from './days';
import { isValidCents } from './money';

export const BACKUP_FORMAT_VERSION = 1;
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

const dateStr = z.string().refine((v) => isValidISODate(v), '日期格式必须为 YYYY-MM-DD');
const cents = z.number().int().min(0).refine((v) => isValidCents(v), '金额超出范围');
const anyCents = z.number().int().refine((v) => isValidCents(v), '金额超出范围');

const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['cash', 'savings', 'ewallet']),
  openingDate: dateStr,
  openingBalance: anyCents,
  archived: z.boolean(),
  createdAt: z.string(),
});

const txnSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['income', 'expense', 'transfer']),
  date: dateStr,
  amount: cents,
  accountId: z.string().min(1),
  toAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  merchant: z.string().optional(),
  note: z.string().optional(),
  occurrenceId: z.string().optional(),
  goalId: z.string().optional(),
  nature: z.enum(['variable', 'recurring', 'one_off']),
  seriesId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const categorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['income', 'expense']),
  icon: z.string(),
  builtin: z.boolean(),
  archived: z.boolean(),
});

const flowSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['income', 'expense']),
  title: z.string().min(1),
  amount: cents,
  accountId: z.string().min(1),
  categoryId: z.string().optional(),
  merchant: z.string().optional(),
  note: z.string().optional(),
  startDate: dateStr,
  endDate: dateStr.optional(),
  rule: z.object({ unit: z.enum(['day', 'week', 'month', 'year']), interval: z.number().int().min(1).max(120) }),
  anchorDay: z.number().int().min(1).max(31),
  enabled: z.boolean(),
  source: z.enum(['manual', 'recurring_candidate']),
  createdAt: z.string(),
});

const occSchema = z.object({
  id: z.string().min(1),
  flowId: z.string().min(1),
  originalDueDate: dateStr,
  dueDate: dateStr,
  amount: cents,
  status: z.enum(['pending', 'settled', 'skipped', 'canceled']),
  transactionId: z.string().optional(),
  resolvedAt: z.string().optional(),
  note: z.string().optional(),
});

const candidateSchema = z.object({
  id: z.string(),
  signature: z.string(),
  merchantKey: z.string(),
  merchantLabel: z.string(),
  unit: z.enum(['day', 'week', 'month', 'year']),
  interval: z.number(),
  estimatedAmount: cents,
  lastDate: dateStr,
  nextDate: dateStr,
  score: z.number(),
  scoreParts: z.object({ interval: z.number(), amount: z.number(), sample: z.number() }),
  sampleIds: z.array(z.string()),
  intervalDays: z.number(),
  amountCv: z.number(),
  status: z.enum(['open', 'confirmed', 'ignored']),
  flowId: z.string().optional(),
});

const reviewSchema = z.object({
  id: z.string(),
  kind: z.enum(['anomaly']),
  status: z.enum(['open', 'confirmed', 'ignored']),
  note: z.string().optional(),
  resolvedAt: z.string().optional(),
});

const goalSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  targetAmount: cents,
  deadline: dateStr,
  priority: z.number().int().min(1).max(5),
  status: z.enum(['active', 'archived']),
  createdAt: z.string(),
});

const goalEventSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().optional(),
  planId: z.string().optional(),
  type: z.enum(['reserve', 'release', 'consume']),
  amount: cents,
  date: dateStr,
  transactionId: z.string().optional(),
  note: z.string().optional(),
  createdAt: z.string(),
});

const planSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  price: cents,
  purchaseDate: dateStr,
  allowDelay: z.boolean(),
  goalId: z.string().optional(),
  reserveUnit: z.enum(['week', 'month']),
  reserveInterval: z.number().int().min(1).max(24),
  baselineVersion: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const calStateSchema = z.object({
  weekdayBias: z.record(z.string(), z.number().int()),
  alpha: z.number().min(0.01).max(1),
  version: z.number().int().min(0),
  updatedAt: z.string(),
});

const daySchema = z.object({
  date: dateStr,
  balance: anyCents,
  reserved: anyCents,
  free: anyCents,
  income: anyCents,
  fixedExpense: anyCents,
  variableEstimate: anyCents.nullable(),
  variableSource: z.enum(['weekday', 'budget', 'daily_avg', 'none']),
  scenarioExpense: anyCents,
  isToday: z.boolean().optional(),
  isTodayEnd: z.boolean().optional(),
});

const snapshotSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  asOfDate: dateStr,
  horizonDays: z.number().int().min(0).max(1000),
  algoVersion: z.string(),
  mode: z.enum(['personal', 'demo']),
  auto: z.boolean(),
  inputSummary: z.object({
    txnCount: z.number(),
    coveredDays: z.number(),
    trainingDays: z.number(),
    weekdaySamples: z.record(z.string(), z.number()),
    safetyReserve: anyCents,
    reserved: anyCents,
    budget: anyCents,
  }),
  days: z.array(daySchema),
  calibration: calStateSchema,
  paramsVersion: z.string(),
});

const calibrationSchema = z.object({
  id: z.string().min(1),
  evaluatedDate: dateStr,
  sourceSnapshotId: z.string(),
  actual: cents,
  rawPredicted: cents,
  predicted: cents,
  residual: anyCents,
  biasBefore: anyCents,
  biasAfter: anyCents,
  weekday: z.number().int().min(0).max(6),
  alpha: z.number(),
  invalidated: z.boolean(),
  version: z.number().int().min(1),
  createdAt: z.string(),
});

const settingsSchema = z.object({
  safetyReserve: cents,
  budget: z.object({ monthVariableBudget: cents, monthlySavingsCap: cents }),
  smallThreshold: cents,
  smallWindowDays: z.number().int().min(1).max(365),
  anomalyWindowDays: z.number().int().min(7).max(730),
  anomalyMinSamples: z.number().int().min(3).max(100),
  anomalyRobustZ: z.number().min(1).max(20),
  recurringToleranceDays: z.number().int().min(1).max(15),
  recurringMaxCv: z.number().min(0.01).max(1),
  goalAllocDay: z.number().int().min(1).max(31),
  coverage: z.array(z.object({ start: dateStr, end: dateStr })),
  onboardingDone: z.boolean(),
  quickInputEnabled: z.boolean(),
  calibration: calStateSchema,
  settingsVersion: z.number(),
});

const datasetSchema = z.object({
  meta: z.object({
    formatVersion: z.number().int().min(1),
    kind: z.enum(['personal', 'demo']),
    createdAt: z.string(),
    restoredAt: z.string().optional(),
    demoDate: dateStr.optional(),
  }),
  settings: settingsSchema,
  accounts: z.array(accountSchema),
  categories: z.array(categorySchema),
  transactions: z.array(txnSchema),
  flows: z.array(flowSchema),
  occurrenceRecords: z.array(occSchema),
  candidates: z.array(candidateSchema),
  reviews: z.array(reviewSchema),
  goals: z.array(goalSchema),
  goalEvents: z.array(goalEventSchema),
  plans: z.array(planSchema),
  snapshots: z.array(snapshotSchema),
  calibrations: z.array(calibrationSchema),
});

export interface BackupPreview {
  mode: 'personal' | 'demo';
  accounts: number;
  transactions: number;
  goals: number;
  flows: number;
  snapshots: number;
  startDate: ISODate | null;
  endDate: ISODate | null;
  warnings: string[];
}

export interface BackupValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  dataset?: Dataset;
  preview?: BackupPreview;
}

export function createBackup(dataset: Dataset): string {
  return JSON.stringify(
    {
      app: '金钱流水',
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      currency: 'CNY',
      dataMode: dataset.meta.kind,
      dataset,
    },
    null,
    2,
  );
}

export function validateBackupText(text: string, expectedMode?: 'personal' | 'demo'): BackupValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (text.length > MAX_BACKUP_BYTES) {
    return { ok: false, errors: ['备份文件超过 20MB 限制'], warnings };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['不是合法的 JSON 文件'], warnings };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['备份根对象无效'], warnings };
  const file = raw as Record<string, unknown>;
  if (typeof file.formatVersion !== 'number') return { ok: false, errors: ['缺少格式版本号'], warnings };
  if (file.formatVersion > BACKUP_FORMAT_VERSION) {
    return { ok: false, errors: [`不支持的备份格式版本 ${file.formatVersion}，请升级应用或使用旧版本导出`], warnings };
  }
  if (file.formatVersion < 1) return { ok: false, errors: ['格式版本无效'], warnings };

  const parsed = datasetSchema.safeParse(file.dataset);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 8)) {
      errors.push(`${issue.path.join('.') || '数据'}：${issue.message}`);
    }
    errors.push('结构校验未通过，已保留原数据');
    return { ok: false, errors, warnings };
  }
  const dataset = parsed.data as Dataset;

  const ids = new Set<string>();
  const dupCheck = (list: { id: string }[], label: string) => {
    for (const item of list) {
      if (ids.has(item.id)) errors.push(`${label} 存在重复 ID：${item.id}`);
      ids.add(item.id);
    }
  };
  dupCheck(dataset.accounts, '账户');
  dupCheck(dataset.categories, '分类');
  dupCheck(dataset.transactions, '交易');
  dupCheck(dataset.flows, '计划');
  dupCheck(dataset.occurrenceRecords, '计划实例');
  dupCheck(dataset.goals, '目标');
  dupCheck(dataset.goalEvents, '资金事件');
  dupCheck(dataset.plans, '购买方案');
  dupCheck(dataset.snapshots, '预测快照');
  dupCheck(dataset.calibrations, '校准记录');

  const accountIds = new Set(dataset.accounts.map((a) => a.id));
  const categoryIds = new Set(dataset.categories.map((c) => c.id));
  const flowIds = new Set(dataset.flows.map((f) => f.id));
  const goalIds = new Set(dataset.goals.map((g) => g.id));
  const planIds = new Set(dataset.plans.map((p) => p.id));
  const txnIds = new Set(dataset.transactions.map((t) => t.id));
  const snapshotIds = new Set(dataset.snapshots.map((s) => s.id));

  const usedOccurrences = new Set<string>();
  for (const t of dataset.transactions) {
    if (!accountIds.has(t.accountId)) errors.push(`交易 ${t.id} 引用了不存在的账户`);
    if (t.kind === 'transfer') {
      if (!t.toAccountId || !accountIds.has(t.toAccountId)) errors.push(`转账 ${t.id} 缺少有效转入账户`);
      if (t.toAccountId === t.accountId) errors.push(`转账 ${t.id} 的转入转出账户相同`);
    }
    if (t.categoryId && !categoryIds.has(t.categoryId)) errors.push(`交易 ${t.id} 引用了不存在的分类`);
    if (t.goalId && !goalIds.has(t.goalId)) errors.push(`交易 ${t.id} 引用了不存在的目标`);
    if (t.occurrenceId) {
      if (usedOccurrences.has(t.occurrenceId)) errors.push(`计划实例 ${t.occurrenceId} 被多笔交易核销`);
      usedOccurrences.add(t.occurrenceId);
      if (!dataset.occurrenceRecords.some((o) => o.id === t.occurrenceId)) {
        errors.push(`交易 ${t.id} 关联的计划实例不存在`);
      }
    }
    const acct = dataset.accounts.find((a) => a.id === t.accountId);
    if (acct && t.date < acct.openingDate) errors.push(`交易 ${t.id} 早于账户期初日期`);
  }

  for (const f of dataset.flows) {
    if (!accountIds.has(f.accountId)) errors.push(`计划 ${f.id} 引用了不存在的账户`);
    if (f.categoryId && !categoryIds.has(f.categoryId)) errors.push(`计划 ${f.id} 引用了不存在的分类`);
  }
  for (const o of dataset.occurrenceRecords) {
    if (!flowIds.has(o.flowId)) errors.push(`计划实例 ${o.id} 引用了不存在的计划`);
    if (o.status === 'settled' && !o.transactionId) errors.push(`实例 ${o.id} 标记核销但缺少交易`);
    if (o.transactionId && !txnIds.has(o.transactionId)) errors.push(`实例 ${o.id} 关联的交易不存在`);
  }
  for (const e of dataset.goalEvents) {
    if (!e.goalId && !e.planId) errors.push(`资金事件 ${e.id} 既不属于目标也不属于购买方案`);
    if (e.goalId && e.planId) errors.push(`资金事件 ${e.id} 同时归属目标与购买方案`);
    if (e.goalId && !goalIds.has(e.goalId)) errors.push(`资金事件 ${e.id} 引用了不存在的目标`);
    if (e.planId && !planIds.has(e.planId)) errors.push(`资金事件 ${e.id} 引用了不存在的购买方案`);
    if (e.transactionId && !txnIds.has(e.transactionId)) errors.push(`资金事件 ${e.id} 关联的交易不存在`);
  }
  for (const p of dataset.plans) {
    if (p.goalId && !goalIds.has(p.goalId)) errors.push(`购买方案 ${p.id} 引用了不存在的目标`);
  }
  for (const c of dataset.calibrations) {
    if (!snapshotIds.has(c.sourceSnapshotId)) errors.push(`校准记录 ${c.id} 引用了不存在的快照`);
  }
  for (const s of dataset.snapshots) {
    if (s.days.length === 0) errors.push(`快照 ${s.id} 缺少每日结果`);
    if (s.mode !== dataset.meta.kind) warnings.push(`快照 ${s.id} 的模式与数据集不一致`);
  }

  // 预留不变量：每个目标不得释放超过已预留
  const reserved = new Map<string, number>();
  for (const e of [...dataset.goalEvents].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (!e.goalId) continue;
    const prev = reserved.get(e.goalId) ?? 0;
    const next = prev + (e.type === 'reserve' ? e.amount : -e.amount);
    if (next < 0) errors.push(`目标 ${e.goalId} 的预留释放超过已预留金额`);
    reserved.set(e.goalId, Math.max(0, next));
  }

  if (dataset.meta.kind !== dataset.meta.kind) errors.push('数据模式无效');
  if (expectedMode && dataset.meta.kind !== expectedMode) {
    warnings.push(
      `该备份来自${dataset.meta.kind === 'demo' ? '演示' : '个人'}数据集，将覆盖当前${expectedMode === 'demo' ? '演示' : '个人'}数据集`,
    );
  }

  const txDates = dataset.transactions.map((t) => t.date).sort();
  const preview: BackupPreview = {
    mode: dataset.meta.kind,
    accounts: dataset.accounts.length,
    transactions: dataset.transactions.length,
    goals: dataset.goals.length,
    flows: dataset.flows.length,
    snapshots: dataset.snapshots.length,
    startDate: txDates[0] ?? null,
    endDate: txDates[txDates.length - 1] ?? null,
    warnings,
  };

  if (errors.length > 0) {
    return { ok: false, errors: errors.slice(0, 12), warnings, preview };
  }
  return { ok: true, errors, warnings, dataset, preview };
}