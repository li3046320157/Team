/** 领域动作：输入校验 + 不可变数据集更新。所有金额以整数分写入。 */
import type {
  Cents,
  Dataset,
  FinancialGoal,
  ISODate,
  OccurrenceView,
  PurchasePlan,
  RecurringCandidate,
  ScheduledFlow,
  TxnKind,
  TxnNature,
  Transaction,
} from '../domain/types';
import { addDaysISO, diffDays, isValidISODate, parseISODate, todayISO } from '../domain/days';
import { makeId, nowISOString } from '../domain/ids';
import { invalidateCalibrationsForDate } from '../domain/calibration';
import { freeDisposable, reservedByGoal, totalBalanceAt, totalReservedAt } from '../domain/ledger';
import { occurrenceId } from '../domain/occurrences';
import { isValidCents } from '../domain/money';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function invalidateFor(dataset: Dataset, date: ISODate): Dataset {
  return { ...dataset, calibrations: invalidateCalibrationsForDate(dataset.calibrations, date) };
}

function ensureAccount(dataset: Dataset, accountId: string): void {
  assert(dataset.accounts.some((a) => a.id === accountId), '账户不存在');
}

function ensureCategory(dataset: Dataset, categoryId: string | undefined, kind: 'income' | 'expense'): void {
  if (!categoryId) return;
  const cat = dataset.categories.find((c) => c.id === categoryId);
  assert(cat, '分类不存在');
  assert(cat.kind === kind, '分类类型与收支类型不一致');
}

function ensureAmount(amount: Cents): void {
  assert(isValidCents(amount) && amount > 0, '金额必须为大于零的整数分');
}

export interface TxnInput {
  kind: TxnKind;
  date: ISODate;
  amount: Cents;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  merchant?: string;
  note?: string;
  nature: TxnNature;
}

/** 供账单导入等批量写入复用的统一校验，避免两套规则漂移。 */
export function validateTxnInput(dataset: Dataset, input: TxnInput, today: ISODate): void {
  ensureAmount(input.amount);
  assert(isValidISODate(input.date), '日期无效');
  assert(input.date <= today, '实际交易不能记录在未来日期，请改用固定计划');
  ensureAccount(dataset, input.accountId);
  if (input.kind === 'transfer') {
    assert(input.toAccountId, '转账需要选择转入账户');
    ensureAccount(dataset, input.toAccountId);
    assert(input.toAccountId !== input.accountId, '转出与转入账户不能相同');
    assert(!input.categoryId, '转账不需要分类');
  } else {
    assert(!input.toAccountId, '仅转账可以设置转入账户');
    ensureCategory(dataset, input.categoryId, input.kind);
  }
}

export function addTransaction(dataset: Dataset, input: TxnInput, today: ISODate = todayISO()): Dataset {
  validateTxnInput(dataset, input, today);
  const now = nowISOString();
  const txn: Transaction = {
    id: makeId('txn'),
    kind: input.kind,
    date: input.date,
    amount: input.amount,
    accountId: input.accountId,
    toAccountId: input.toAccountId,
    categoryId: input.kind === 'transfer' ? undefined : input.categoryId,
    merchant: input.merchant?.trim() || undefined,
    note: input.note?.trim() || undefined,
    nature: input.nature,
    createdAt: now,
    updatedAt: now,
  };
  const next = { ...dataset, transactions: [...dataset.transactions, txn] };
  return invalidateFor(next, txn.date);
}

export function updateTransaction(dataset: Dataset, txnId: string, input: TxnInput, today: ISODate = todayISO()): Dataset {
  const existing = dataset.transactions.find((t) => t.id === txnId);
  assert(existing, '流水不存在');
  validateTxnInput(dataset, input, today);
  const updated: Transaction = {
    ...existing,
    kind: input.kind,
    date: input.date,
    amount: input.amount,
    accountId: input.accountId,
    toAccountId: input.kind === 'transfer' ? input.toAccountId : undefined,
    categoryId: input.kind === 'transfer' ? undefined : input.categoryId,
    merchant: input.merchant?.trim() || undefined,
    note: input.note?.trim() || undefined,
    nature: input.nature,
    updatedAt: nowISOString(),
  };
  const next: Dataset = {
    ...dataset,
    transactions: dataset.transactions.map((t) => (t.id === txnId ? updated : t)),
    occurrenceRecords: dataset.occurrenceRecords.map((r) =>
      r.transactionId === txnId ? { ...r, amount: updated.amount, dueDate: updated.date } : r,
    ),
  };
  return invalidateFor(invalidateFor(next, existing.date), updated.date);
}

/** 删除流水；若来自计划核销，同时撤销核销记录，让该期恢复待发生。 */
export function deleteTransaction(dataset: Dataset, txnId: string): Dataset {
  const existing = dataset.transactions.find((t) => t.id === txnId);
  assert(existing, '流水不存在');
  const next: Dataset = {
    ...dataset,
    transactions: dataset.transactions.filter((t) => t.id !== txnId),
    occurrenceRecords: dataset.occurrenceRecords.filter((r) => r.transactionId !== txnId),
  };
  return invalidateFor(next, existing.date);
}

export interface AccountInput {
  name: string;
  type: 'cash' | 'savings' | 'ewallet';
  openingBalance: Cents;
  openingDate: ISODate;
}
export function addAccount(dataset: Dataset, input: AccountInput): Dataset {
  assert(input.name.trim().length > 0 && input.name.trim().length <= 20, '账户名称需为 1-20 个字符');
  assert(isValidCents(input.openingBalance) && input.openingBalance >= 0, '期初余额无效');
  assert(isValidISODate(input.openingDate), '期初日期无效');
  return {
    ...dataset,
    accounts: [
      ...dataset.accounts,
      {
        id: makeId('acc'),
        name: input.name.trim(),
        type: input.type,
        openingDate: input.openingDate,
        openingBalance: input.openingBalance,
        archived: false,
        createdAt: nowISOString(),
      },
    ],
  };
}

export interface FlowInput {
  kind: 'income' | 'expense';
  title: string;
  amount: Cents;
  accountId: string;
  categoryId?: string;
  merchant?: string;
  note?: string;
  startDate: ISODate;
  endDate?: ISODate;
  rule: { unit: 'day' | 'week' | 'month' | 'year'; interval: number };
  enabled: boolean;
}

function validateFlow(dataset: Dataset, input: FlowInput): void {
  ensureAmount(input.amount);
  assert(input.title.trim().length > 0 && input.title.trim().length <= 30, '计划名称需为 1-30 个字符');
  ensureAccount(dataset, input.accountId);
  ensureCategory(dataset, input.categoryId, input.kind);
  assert(isValidISODate(input.startDate), '开始日期无效');
  if (input.endDate) {
    assert(isValidISODate(input.endDate) && input.endDate >= input.startDate, '结束日期不早于开始日期');
  }
  assert(Number.isInteger(input.rule.interval) && input.rule.interval >= 1 && input.rule.interval <= 365, '重复间隔需为 1-365');
}

function buildFlow(input: FlowInput, overrides: Partial<ScheduledFlow> = {}): ScheduledFlow {
  const now = nowISOString();
  return {
    id: makeId('flow'),
    kind: input.kind,
    title: input.title.trim(),
    amount: input.amount,
    accountId: input.accountId,
    categoryId: input.categoryId,
    merchant: input.merchant?.trim() || undefined,
    note: input.note?.trim() || undefined,
    startDate: input.startDate,
    endDate: input.endDate,
    rule: { ...input.rule },
    anchorDay: Number(input.startDate.slice(8, 10)),
    enabled: input.enabled,
    source: 'manual',
    createdAt: now,
    ...overrides,
  };
}

export function addFlow(dataset: Dataset, input: FlowInput): Dataset {
  validateFlow(dataset, input);
  return { ...dataset, flows: [...dataset.flows, buildFlow(input)] };
}

export function updateFlow(dataset: Dataset, flowId: string, input: FlowInput): Dataset {
  validateFlow(dataset, input);
  const existing = dataset.flows.find((f) => f.id === flowId);
  assert(existing, '计划不存在');
  const updated: ScheduledFlow = {
    ...existing,
    ...buildFlow(input),
    id: existing.id,
    source: existing.source,
    createdAt: existing.createdAt,
  };
  return {
    ...dataset,
    flows: dataset.flows.map((f) => (f.id === flowId ? updated : f)),
    occurrenceRecords: dataset.occurrenceRecords.map((r) => (r.flowId === flowId ? { ...r, amount: input.amount } : r)),
  };
}

/** 从某期起改为新规则：旧计划在该期前一日结束，新计划从该期开始。 */
export function splitFlow(dataset: Dataset, flowId: string, fromDate: ISODate, input: FlowInput): Dataset {
  validateFlow(dataset, input);
  assert(isValidISODate(fromDate), '日期无效');
  const existing = dataset.flows.find((f) => f.id === flowId);
  assert(existing, '计划不存在');
  if (fromDate <= existing.startDate) return updateFlow(dataset, flowId, input);
  const trimmed: ScheduledFlow = { ...existing, endDate: addDaysISO(fromDate, -1) };
  const next = buildFlow({ ...input, startDate: fromDate, endDate: input.endDate }, { source: existing.source });
  return {
    ...dataset,
    flows: dataset.flows.map((f) => (f.id === flowId ? trimmed : f)).concat(next),
  };
}

export function deleteFlow(dataset: Dataset, flowId: string): Dataset {
  const hasSettled = dataset.occurrenceRecords.some(
    (r) => r.flowId === flowId && r.status === 'settled',
  );
  assert(!hasSettled, '该计划已有核销记录，不能直接删除；可将其停用');
  return {
    ...dataset,
    flows: dataset.flows.filter((f) => f.id !== flowId),
    occurrenceRecords: dataset.occurrenceRecords.filter((r) => r.flowId !== flowId),
  };
}

export function toggleFlow(dataset: Dataset, flowId: string, enabled: boolean): Dataset {
  return { ...dataset, flows: dataset.flows.map((f) => (f.id === flowId ? { ...f, enabled } : f)) };
}

function upsertRecord(dataset: Dataset, record: Dataset['occurrenceRecords'][number]): Dataset['occurrenceRecords'] {
  const exists = dataset.occurrenceRecords.some((r) => r.id === record.id);
  return exists ? dataset.occurrenceRecords.map((r) => (r.id === record.id ? record : r)) : [...dataset.occurrenceRecords, record];
}

export interface SettleOptions {
  date?: ISODate;
  amount?: Cents;
  accountId?: string;
  note?: string;
}

export function settleOccurrence(dataset: Dataset, view: OccurrenceView, options: SettleOptions = {}, today: ISODate = todayISO()): Dataset {
  assert(view.status === 'pending', '该期已被处理，请刷新后重试');
  const date = options.date ?? today;
  const amount = options.amount ?? view.amount;
  const accountId = options.accountId ?? view.flow.accountId;
  ensureAmount(amount);
  assert(isValidISODate(date) && date <= today, '核销日期不能在未来');
  ensureAccount(dataset, accountId);
  const txnId = makeId('txn');
  const now = nowISOString();
  const txn: Transaction = {
    id: txnId,
    kind: view.flow.kind,
    date,
    amount,
    accountId,
    categoryId: view.flow.categoryId,
    merchant: view.flow.merchant,
    note: options.note?.trim() || view.flow.title,
    occurrenceId: view.id,
    nature: 'recurring',
    createdAt: now,
    updatedAt: now,
  };
  const record = {
    id: view.id,
    flowId: view.flow.id,
    originalDueDate: view.originalDueDate,
    dueDate: view.dueDate,
    amount,
    status: 'settled' as const,
    transactionId: txnId,
    resolvedAt: now,
    note: options.note?.trim() || undefined,
  };
  const next: Dataset = {
    ...dataset,
    transactions: [...dataset.transactions, txn],
    occurrenceRecords: upsertRecord(dataset, record),
  };
  return invalidateFor(next, date);
}

export function skipOccurrence(dataset: Dataset, view: OccurrenceView, note?: string): Dataset {
  assert(view.status === 'pending', '该期已被处理');
  const record = {
    id: view.id,
    flowId: view.flow.id,
    originalDueDate: view.originalDueDate,
    dueDate: view.dueDate,
    amount: view.amount,
    status: 'skipped' as const,
    resolvedAt: nowISOString(),
    note,
  };
  return { ...dataset, occurrenceRecords: upsertRecord(dataset, record) };
}

export function rescheduleOccurrence(dataset: Dataset, view: OccurrenceView, newDate: ISODate, today: ISODate = todayISO()): Dataset {
  assert(view.status === 'pending', '该期已被处理');
  assert(isValidISODate(newDate), '日期无效');
  assert(newDate >= today, '只能改期到今天或以后');
  const record = {
    id: view.id,
    flowId: view.flow.id,
    originalDueDate: view.originalDueDate,
    dueDate: newDate,
    amount: view.amount,
    status: 'pending' as const,
    resolvedAt: nowISOString(),
    note: '改期',
  };
  return { ...dataset, occurrenceRecords: upsertRecord(dataset, record) };
}

/** 撤销“仅本次”的改期/跳过记录（已核销需在流水中删除）。 */
export function resetOccurrence(dataset: Dataset, occurrenceIdValue: string): Dataset {
  return { ...dataset, occurrenceRecords: dataset.occurrenceRecords.filter((r) => r.id !== occurrenceIdValue || r.status === 'settled') };
}

export interface CandidateConfirmInput {
  accountId: string;
  categoryId?: string;
  amount?: Cents;
  nextDate?: ISODate;
}

export function confirmCandidate(dataset: Dataset, candidate: RecurringCandidate, input: CandidateConfirmInput): Dataset {
  ensureAccount(dataset, input.accountId);
  ensureCategory(dataset, input.categoryId, 'expense');
  const amount = input.amount ?? candidate.estimatedAmount;
  ensureAmount(amount);
  const nextDate = input.nextDate ?? candidate.nextDate;
  assert(isValidISODate(nextDate), '日期无效');
  const flow = buildFlow(
    {
      kind: 'expense',
      title: candidate.merchantLabel,
      amount,
      accountId: input.accountId,
      categoryId: input.categoryId,
      merchant: candidate.merchantLabel,
      startDate: nextDate,
      rule: { unit: candidate.unit === 'week' || candidate.unit === 'month' || candidate.unit === 'year' ? candidate.unit : 'month', interval: candidate.interval },
      enabled: true,
    },
    { source: 'recurring_candidate' },
  );
  return {
    ...dataset,
    flows: [...dataset.flows, flow],
    candidates: dataset.candidates.map((c) =>
      c.id === candidate.id || c.signature === candidate.signature ? { ...c, status: 'confirmed' as const, flowId: flow.id } : c,
    ),
  };
}

export function setCandidateStatus(dataset: Dataset, candidate: RecurringCandidate, status: 'open' | 'ignored'): Dataset {
  const exists = dataset.candidates.some((c) => c.id === candidate.id || c.signature === candidate.signature);
  return {
    ...dataset,
    candidates: exists
      ? dataset.candidates.map((c) => (c.id === candidate.id || c.signature === candidate.signature ? { ...c, ...candidate, status } : c))
      : [...dataset.candidates, { ...candidate, status }],
  };
}

export function setReview(dataset: Dataset, txId: string, status: 'confirmed' | 'ignored' | 'open', note?: string): Dataset {
  const id = `anomaly:${txId}`;
  const existing = dataset.reviews.find((r) => r.id === id);
  const review = {
    id,
    kind: 'anomaly' as const,
    status,
    note: note ?? existing?.note,
    resolvedAt: status === 'open' ? undefined : nowISOString(),
  };
  return {
    ...dataset,
    reviews: existing ? dataset.reviews.map((r) => (r.id === id ? review : r)) : [...dataset.reviews, review],
  };
}

export interface GoalInput {
  name: string;
  targetAmount: Cents;
  deadline: ISODate;
  priority: number;
}
function validateGoal(input: GoalInput): void {
  assert(input.name.trim().length > 0 && input.name.trim().length <= 20, '目标名称需为 1-20 个字符');
  ensureAmount(input.targetAmount);
  assert(isValidISODate(input.deadline), '截止日期无效');
  assert(Number.isInteger(input.priority) && input.priority >= 1 && input.priority <= 5, '重要性需为 1-5');
}

export function addGoal(dataset: Dataset, input: GoalInput, today: ISODate = todayISO()): Dataset {
  validateGoal(input);
  assert(input.deadline >= today, '截止日期不能早于今天');
  const goal: FinancialGoal = {
    id: makeId('goal'),
    name: input.name.trim(),
    targetAmount: input.targetAmount,
    deadline: input.deadline,
    priority: input.priority,
    status: 'active',
    createdAt: nowISOString(),
  };
  return { ...dataset, goals: [...dataset.goals, goal] };
}

export function updateGoal(dataset: Dataset, goalId: string, input: GoalInput): Dataset {
  validateGoal(input);
  const goal = dataset.goals.find((g) => g.id === goalId);
  assert(goal, '目标不存在');
  return {
    ...dataset,
    goals: dataset.goals.map((g) => (g.id === goalId ? { ...g, ...input, name: input.name.trim() } : g)),
  };
}

export function setGoalArchived(dataset: Dataset, goalId: string, archived: boolean): Dataset {
  return { ...dataset, goals: dataset.goals.map((g) => (g.id === goalId ? { ...g, status: archived ? 'archived' : 'active' } : g)) };
}

export function maxReservable(dataset: Dataset, asOf: ISODate = todayISO()): Cents {
  const balance = totalBalanceAt(dataset.accounts, dataset.transactions, asOf);
  const reserved = totalReservedAt(dataset.goalEvents, asOf);
  return Math.max(0, freeDisposable(balance, reserved, dataset.settings.safetyReserve));
}

export function reserveForGoal(dataset: Dataset, goalId: string, amount: Cents, note?: string, asOf: ISODate = todayISO()): Dataset {
  const goal = dataset.goals.find((g) => g.id === goalId);
  assert(goal, '目标不存在');
  ensureAmount(amount);
  const reserved = reservedByGoal(dataset.goalEvents, asOf).get(goalId) ?? 0;
  assert(reserved < goal.targetAmount, '目标已筹足');
  const max = maxReservable(dataset, asOf);
  assert(amount <= max, `最多可再预留 ¥${(max / 100).toFixed(2)}（受可支配金额与安全储备限制）`);
  return {
    ...dataset,
    goalEvents: [
      ...dataset.goalEvents,
      { id: makeId('fund'), goalId, type: 'reserve', amount, date: asOf, note: note?.trim() || undefined, createdAt: nowISOString() },
    ],
  };
}

export function releaseFromGoal(dataset: Dataset, goalId: string, amount: Cents, note?: string, asOf: ISODate = todayISO()): Dataset {
  const reserved = reservedByGoal(dataset.goalEvents, asOf).get(goalId) ?? 0;
  ensureAmount(amount);
  assert(amount <= reserved, `该目标当前仅预留 ¥${(reserved / 100).toFixed(2)}`);
  return {
    ...dataset,
    goalEvents: [
      ...dataset.goalEvents,
      { id: makeId('fund'), goalId, type: 'release', amount, date: asOf, note: note?.trim() || undefined, createdAt: nowISOString() },
    ],
  };
}

/** 从预留中实际支出：同时记账并消耗预留，可支配金额保持不变。 */
export function consumeGoal(dataset: Dataset, goalId: string, amount: Cents, input: { accountId: string; categoryId?: string; note?: string }, asOf: ISODate = todayISO()): Dataset {
  const goal = dataset.goals.find((g) => g.id === goalId);
  assert(goal, '目标不存在');
  const reserved = reservedByGoal(dataset.goalEvents, asOf).get(goalId) ?? 0;
  ensureAmount(amount);
  assert(amount <= reserved, `该目标仅预留 ¥${(reserved / 100).toFixed(2)}，不足以支出`);
  ensureAccount(dataset, input.accountId);
  ensureCategory(dataset, input.categoryId, 'expense');
  const now = nowISOString();
  const txnId = makeId('txn');
  const txn: Transaction = {
    id: txnId,
    kind: 'expense',
    date: asOf,
    amount,
    accountId: input.accountId,
    categoryId: input.categoryId,
    note: input.note?.trim() || `${goal.name} 支出`,
    goalId,
    nature: 'one_off',
    createdAt: now,
    updatedAt: now,
  };
  const next: Dataset = {
    ...dataset,
    transactions: [...dataset.transactions, txn],
    goalEvents: [
      ...dataset.goalEvents,
      { id: makeId('fund'), goalId, type: 'consume', amount, date: asOf, transactionId: txnId, note: input.note?.trim() || undefined, createdAt: now },
    ],
  };
  return invalidateFor(next, asOf);
}

export interface PlanInput {
  name: string;
  price: Cents;
  purchaseDate: ISODate;
  allowDelay: boolean;
  goalId?: string;
  reserveUnit: 'week' | 'month';
  reserveInterval: number;
}
export function savePlan(dataset: Dataset, input: PlanInput, existingId?: string): Dataset {
  assert(input.name.trim().length > 0, '请填写方案名称');
  ensureAmount(input.price);
  assert(isValidISODate(input.purchaseDate), '购买日期无效');
  assert(Number.isInteger(input.reserveInterval) && input.reserveInterval >= 1, '预留间隔无效');
  const now = nowISOString();
  if (existingId) {
    const existing = dataset.plans.find((p) => p.id === existingId);
    assert(existing, '方案不存在');
    const updated: PurchasePlan = {
      ...existing,
      name: input.name.trim(),
      price: input.price,
      purchaseDate: input.purchaseDate,
      allowDelay: input.allowDelay,
      goalId: input.goalId,
      reserveUnit: input.reserveUnit,
      reserveInterval: input.reserveInterval,
      updatedAt: now,
    };
    return { ...dataset, plans: dataset.plans.map((p) => (p.id === existingId ? updated : p)) };
  }
  const plan: PurchasePlan = {
    id: makeId('plan'),
    name: input.name.trim(),
    price: input.price,
    purchaseDate: input.purchaseDate,
    allowDelay: input.allowDelay,
    goalId: input.goalId,
    reserveUnit: input.reserveUnit,
    reserveInterval: input.reserveInterval,
    baselineVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  return { ...dataset, plans: [...dataset.plans, plan] };
}

export function deletePlan(dataset: Dataset, planId: string): Dataset {
  return { ...dataset, plans: dataset.plans.filter((p) => p.id !== planId) };
}

export function applyOnboarding(
  dataset: Dataset,
  input: { accountName: string; openingBalance: Cents; safetyReserve: Cents; monthVariableBudget: Cents; coverageStart?: ISODate },
  today: ISODate = todayISO(),
): Dataset {
  let next = dataset;
  if (next.accounts.length === 0) {
    next = addAccount(next, { name: input.accountName || '日常账户', type: 'savings', openingBalance: input.openingBalance, openingDate: addDaysISO(today, -30) });
  }
  const coverage = input.coverageStart && isValidISODate(input.coverageStart) && input.coverageStart <= addDaysISO(today, -1)
    ? [{ start: input.coverageStart, end: addDaysISO(today, -1) }]
    : next.settings.coverage;
  return {
    ...next,
    settings: {
      ...next.settings,
      safetyReserve: Math.max(0, input.safetyReserve),
      budget: { ...next.settings.budget, monthVariableBudget: Math.max(0, input.monthVariableBudget) },
      coverage,
      onboardingDone: true,
      settingsVersion: next.settings.settingsVersion + 1,
    },
  };
}

export function daysBetween(a: ISODate, b: ISODate): number {
  if (!isValidISODate(a) || !isValidISODate(b)) return 0;
  return diffDays(a, b);
}

export function parseDateSafe(s: string): ISODate | null {
  try {
    parseISODate(s);
    return s;
  } catch {
    return null;
  }
}

export function occurrenceKey(flowId: string, date: ISODate): string {
  return occurrenceId(flowId, date);
}