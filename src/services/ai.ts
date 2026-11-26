/** AI 智能分析：用户自带 API 地址与密钥（官方或中转均可），请求只发往用户填写的地址，密钥仅存本机。 */
import type { Dataset, DataMode } from '../domain/types';
import { todayISO } from '../domain/days';
import { formatMoney } from '../domain/money';
import { goalViews, totalBalanceAt, totalReservedAt } from '../domain/ledger';
import { runForecast } from '../domain/forecasting/engine';
import { periodLabel, periodOf, previousPeriod } from '../domain/period';
import { compareTotals, periodTotals } from '../domain/periodStats';
import { budgetExecution, savingsRate, seriesTotals } from '../domain/reportSeries';

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiError';
  }
}

export function aiConfigKey(userId: string): string {
  return `moneyflow.ai.${userId}`;
}

export function loadAiConfig(userId: string): AiConfig | null {
  try {
    const raw = localStorage.getItem(aiConfigKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    if (typeof parsed.baseUrl !== 'string' || typeof parsed.apiKey !== 'string' || typeof parsed.model !== 'string') return null;
    return { baseUrl: parsed.baseUrl, apiKey: parsed.apiKey, model: parsed.model };
  } catch {
    return null;
  }
}

export function saveAiConfig(userId: string, config: AiConfig): void {
  localStorage.setItem(aiConfigKey(userId), JSON.stringify(config));
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const CHAT_HISTORY_LIMIT = 100;

export function aiChatKey(userId: string): string {
  return `moneyflow.ai.chat.${userId}`;
}

/** 对话仅在本次登录周期内保留：登录时清空、退出即删；接口配置不受影响。 */
export function loadAiChat(userId: string): AiChatMessage[] {
  try {
    const raw = localStorage.getItem(aiChatKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is AiChatMessage =>
          typeof m === 'object' &&
          m !== null &&
          ((m as AiChatMessage).role === 'user' || (m as AiChatMessage).role === 'assistant') &&
          typeof (m as AiChatMessage).content === 'string',
      )
      .slice(-CHAT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveAiChat(userId: string, messages: AiChatMessage[]): void {
  try {
    const kept = messages.filter((m) => m.content.length > 0).slice(-CHAT_HISTORY_LIMIT);
    if (kept.length === 0) {
      localStorage.removeItem(aiChatKey(userId));
      return;
    }
    localStorage.setItem(aiChatKey(userId), JSON.stringify(kept));
  } catch {
    /* 存储不可用或已满时不影响对话继续 */
  }
}

export function clearAiChat(userId: string): void {
  try {
    localStorage.removeItem(aiChatKey(userId));
  } catch {
    /* 隐私模式下忽略存储清理失败 */
  }
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

/** 归一化 API 根地址：去掉末尾斜杠与误填的 /chat/completions 后缀。 */
export function normalizeApiBase(input: string): string {
  let base = input.trim().replace(/\/+$/, '');
  base = base.replace(/\/chat\/completions$/, '');
  return base.replace(/\/+$/, '');
}

export function validateAiConfig(config: AiConfig): string | null {
  const base = normalizeApiBase(config.baseUrl);
  if (!base) return '请填写 API 访问地址';
  if (!/^https?:\/\/.+/i.test(base)) return 'API 地址需以 http:// 或 https:// 开头';
  if (!config.apiKey.trim()) return '请填写 API 密钥';
  if (!config.model.trim()) return '请填写模型名称，如 gpt-4o-mini、deepseek-chat';
  return null;
}

/** 候选地址：优先用户填写的根地址；未带 /v1 时再尝试 /v1 前缀，兼容常见中转。 */
export function endpointCandidates(baseUrl: string, path: string): string[] {
  const base = normalizeApiBase(baseUrl);
  if (!base) return [];
  const urls = [`${base}${path}`];
  if (!/\/v\d+$/i.test(base)) urls.push(`${base}/v1${path}`);
  return [...new Set(urls)];
}

export function chatEndpoint(config: AiConfig): string {
  return endpointCandidates(config.baseUrl, '/chat/completions')[0] ?? '';
}

export function modelsEndpoint(config: AiConfig): string {
  return endpointCandidates(config.baseUrl, '/models')[0] ?? '';
}

/** 用 no-cors 探测服务器是否可达：能到达但正常请求被拦，说明是 CORS 限制。 */
async function probeReachable(baseUrl: string): Promise<boolean> {
  const [url] = endpointCandidates(baseUrl, '/models');
  if (!url) return false;
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

async function unreachableError(config: AiConfig): Promise<AiError> {
  if (await probeReachable(config.baseUrl)) {
    return new AiError(
      '服务器可达，但拒绝了浏览器的跨域请求（CORS），网页端无法绕过。请更换支持跨域的官方 API 或中转地址；模型名称也可以手动填写后保存。',
    );
  }
  return new AiError('无法连接 API 地址：请检查网络、地址拼写与跨域设置；也可以直接手动填写模型名称。');
}

/** 增量 SSE 解析器：跨 chunk 缓冲不完整行，返回内容增量与是否结束。 */
export function createSseParser() {
  let buffer = '';
  let done = false;
  return {
    push(text: string): string[] {
      buffer += text;
      const deltas: string[] = [];
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            done = true;
          } else if (payload) {
            try {
              const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] };
              const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
              if (typeof delta === 'string' && delta) deltas.push(delta);
            } catch {
              /* 忽略不完整或注释行 */
            }
          }
        }
        newline = buffer.indexOf('\n');
      }
      return deltas;
    },
    get done(): boolean {
      return done;
    },
  };
}

function friendlyHttpError(status: number, body: string): AiError {
  if (status === 401 || status === 403) return new AiError('API 密钥无效或没有权限（401/403），请检查密钥是否正确、是否过期。');
  if (status === 404) return new AiError('接口或模型不存在（404），请检查 API 地址与模型名称是否匹配。');
  if (status === 429) return new AiError('请求被限流（429），请稍后重试或检查账户额度。');
  const snippet = body.slice(0, 160);
  return new AiError(`API 返回错误（${status}）${snippet ? `：${snippet}` : ''}`);
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** 流式对话；部分中转不支持 stream 时自动按整段 JSON 返回。 */
export async function streamChat(params: {
  config: AiConfig;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta: (delta: string) => void;
}): Promise<string> {
  const { config, messages, signal, onDelta } = params;
  const candidates = endpointCandidates(config.baseUrl, '/chat/completions');
  let response: Response | null = null;
  for (let i = 0; i < candidates.length; i += 1) {
    try {
      const attempt = await fetch(candidates[i], {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify({ model: config.model.trim(), messages, stream: true, temperature: 0.6 }),
      });
      if (!attempt.ok) {
        const error = friendlyHttpError(attempt.status, await readErrorBody(attempt));
        if (attempt.status === 404 && i < candidates.length - 1) continue;
        throw error;
      }
      response = attempt;
      break;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (error instanceof AiError) throw error;
      /* 网络或跨域错误：继续尝试下一个候选地址 */
    }
  }
  if (!response) throw await unreachableError(config);

  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content ?? '';
    if (!content) throw new AiError('API 返回了空内容，请检查模型名称或稍后重试。');
    onDelta(content);
    return content;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const delta of parser.push(decoder.decode(value, { stream: true }))) {
      full += delta;
      onDelta(delta);
    }
    if (parser.done) break;
  }
  if (!full) throw new AiError('API 返回了空内容，请检查模型名称或稍后重试。');
  return full;
}

export async function fetchModelList(config: AiConfig): Promise<string[]> {
  const candidates = endpointCandidates(config.baseUrl, '/models');
  let networkFailed = false;
  for (let i = 0; i < candidates.length; i += 1) {
    let response: Response;
    try {
      response = await fetch(candidates[i], {
        headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
      });
    } catch {
      networkFailed = true;
      continue;
    }
    if (!response.ok) {
      const error = friendlyHttpError(response.status, await readErrorBody(response));
      if (response.status === 404 && i < candidates.length - 1) continue;
      throw error;
    }
    const payload = (await response.json()) as { data?: { id?: string }[] };
    const ids = (payload.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) throw new AiError('该地址没有返回模型列表，请直接手动填写模型名称。');
    return ids.sort();
  }
  if (networkFailed) throw await unreachableError(config);
  throw new AiError('该地址没有返回模型列表，请直接手动填写模型名称。');
}

const yuan = (cents: number): string => formatMoney(cents);

const pctText = (value: number | null): string => (value === null ? '—' : `${value > 0 ? '+' : ''}${value}%`);

/** 把当前账本压缩成一段可解释的中文摘要，作为 AI 分析上下文（不含账户名以外的个人信息）。 */
export function buildAnalysisContext(dataset: Dataset, mode: DataMode): string {
  const today = todayISO();
  const month = today.slice(0, 7);
  const balance = totalBalanceAt(dataset.accounts, dataset.transactions, today);
  const reserved = totalReservedAt(dataset.goalEvents, today);
  const free = balance - reserved - dataset.settings.safetyReserve;

  const monthTxns = dataset.transactions.filter((t) => t.date.slice(0, 7) === month && t.kind !== 'transfer');
  const income = monthTxns.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = monthTxns.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount, 0);

  const catName = new Map(dataset.categories.map((c) => [c.id, c.name]));
  const byCategory = new Map<string, number>();
  for (const t of monthTxns) {
    if (t.kind !== 'expense') continue;
    const name = (t.categoryId ? catName.get(t.categoryId) : undefined) ?? '其他';
    byCategory.set(name, (byCategory.get(name) ?? 0) + t.amount);
  }
  const topCategories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  const lines: string[] = [
    `数据模式：${mode === 'demo' ? '合成示例数据（非真实账单）' : '用户个人账本'}`,
    '统计周期：日/周/月/年自然周期（周一开始）；多期报表可看近 12 期，年视图可看近 5 年。',
    `截至日期：${today}`,
    `总余额：${yuan(balance)}（${dataset.accounts.length} 个账户）`,
    `目标预留合计：${yuan(reserved)}；安全储备线：${yuan(dataset.settings.safetyReserve)}；自由可支配：${yuan(free)}`,
  ];
  if (dataset.transactions.length > 0) {
    let first = dataset.transactions[0].date;
    let last = dataset.transactions[0].date;
    for (const t of dataset.transactions) {
      if (t.date < first) first = t.date;
      if (t.date > last) last = t.date;
    }
    lines.push(`流水记录：共 ${dataset.transactions.length} 笔，覆盖 ${first} 至 ${last}`);
  }

  const units = [
    { unit: 'day', label: '今日' },
    { unit: 'week', label: '本周' },
    { unit: 'month', label: '本月' },
    { unit: 'year', label: '本年' },
  ] as const;
  for (const { unit, label } of units) {
    const period = periodOf(unit, today);
    const totals = periodTotals(dataset.transactions, period);
    const delta = compareTotals(totals, periodTotals(dataset.transactions, previousPeriod(period)));
    const rate = savingsRate(totals.income, totals.expense);
    lines.push(
      `${label}（${periodLabel(period)}）：收入 ${yuan(totals.income)}，支出 ${yuan(totals.expense)}，结余 ${yuan(totals.net)}，储蓄率 ${rate === null ? '—' : `${rate}%`}；较上期收入 ${pctText(delta.incomePct)}、支出 ${pctText(delta.expensePct)}`,
    );
  }

  const months = seriesTotals({
    transactions: dataset.transactions,
    unit: 'month',
    anchor: today,
    count: 12,
    monthlyBudget: 0,
    today,
  });
  lines.push(
    `近 12 个月（含本月，旧→新）：${months.map((m) => `${m.label} 收${yuan(m.income)}/支${yuan(m.expense)}/结${yuan(m.net)}`).join('；')}`,
  );

  if (topCategories.length > 0) {
    lines.push(`本月支出分类前列：${topCategories.map(([name, cents]) => `${name} ${yuan(cents)}`).join('、')}`);
  }

  const budget = budgetExecution({
    transactions: dataset.transactions,
    period: periodOf('month', today),
    monthlyBudget: dataset.settings.budget.monthVariableBudget,
    today,
  });
  if (budget.status === 'unset') {
    lines.push('每月可变消费预算：未设置（报告中预算执行显示为空）。');
  } else {
    const pacing = budget.pacing
      ? `；按当前速度预计月底可变支出 ${yuan(budget.pacing.projected)}${budget.pacing.projectedOverspend > 0 ? `，超预算 ${yuan(budget.pacing.projectedOverspend)}` : '，仍在预算内'}`
      : '';
    lines.push(
      `本月可变消费预算：${yuan(budget.budget)}；已用 ${yuan(budget.used)}，剩余 ${yuan(budget.remaining)}，执行率 ${Math.round((budget.ratio ?? 0) * 100)}%${pacing}`,
    );
  }

  try {
    const forecast = runForecast({
      asOfDate: today,
      horizonDays: 90,
      dataset: {
        accounts: dataset.accounts,
        transactions: dataset.transactions,
        flows: dataset.flows,
        occurrenceRecords: dataset.occurrenceRecords,
        goalEvents: dataset.goalEvents,
      },
      coverage: dataset.settings.coverage,
      settings: dataset.settings,
    });
    const risk = forecast.risk;
    lines.push(`未来 30 天预测：期末余额 ${yuan(risk.end30)}。`);
    lines.push(
      `未来 90 天预测：期末余额 ${yuan(risk.end90)}；最低余额 ${yuan(risk.minBalance)}（${risk.minBalanceDate}）；${risk.firstNegative ? `预计 ${risk.firstNegative} 出现负余额` : risk.firstBelowSafety ? `预计 ${risk.firstBelowSafety} 跌破安全储备线` : '预测期内不低于安全储备线'}`,
    );
    const suf = forecast.sufficiency;
    lines.push(
      suf.level === 'insufficient'
        ? `数据充足度：不足（仅覆盖 ${suf.coveredDays} 天，训练 ${suf.trainingDays} 天）；样本不足，以下结论仅供参考`
        : `数据充足度：${suf.level === 'limited' ? '有限（样本偏少，结论精度有限）' : '良好'}（覆盖 ${suf.coveredDays} 天，训练 ${suf.trainingDays} 天）`,
    );
  } catch {
    lines.push('预测引擎暂不可用（历史数据不足）。');
  }

  const views = goalViews(dataset.goals, dataset.goalEvents, today).filter((g) => g.goal.status === 'active');
  if (views.length > 0) {
    lines.push(
      `进行中的储蓄目标：${views.map((g) => `${g.goal.name}（目标 ${yuan(g.goal.targetAmount)}，已预留 ${yuan(g.reserved)}，截止 ${g.goal.deadline}${g.overdue ? '，已逾期' : ''}）`).join('、')}`,
    );
  }
  const activeFlows = dataset.flows.filter((f) => f.enabled);
  if (activeFlows.length > 0) {
    lines.push(`固定收支计划 ${activeFlows.length} 个：${activeFlows.slice(0, 8).map((f) => `${f.title} ${yuan(f.amount)}`).join('、')}`);
  }
  return lines.join('\n');
}

export const ANALYSIS_SYSTEM_PROMPT = [
  '你是金钱流水的本地财务分析助手。用户会提供一份由其本机账本生成的中文摘要，请基于摘要回答。',
  '账本按日/周/月/年自然周期统计（周一开始），支持近 12 期多期报表（年视图近 5 年）、可变消费预算执行、分类趋势与 30/60/90 天现金流预测。',
  '要求：',
  '1. 金额单位均为人民币元；引用数字时与摘要保持一致，不要编造摘要中没有的数据。',
  '2. 先判断问题对应的周期（日/周/月/年或近 N 期），再引用摘要中同口径的数据；跨周期对比时说明各自区间，不要假设只有月度数据。',
  '3. 先给结论，再给依据与建议；建议要具体可执行（如调整哪类支出、何时购买更稳妥）。',
  '4. 摘要标注为合成示例数据时，提醒用户当前分析的是演示数据。',
  '5. 预测只是规划参考，不构成投资建议或收益承诺；涉及风险时如实说明不确定性。',
  '6. 使用简体中文，条理清晰，避免空泛套话。',
].join('\n');