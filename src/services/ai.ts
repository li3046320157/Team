/** AI 智能分析：用户自带 API 地址与密钥（官方或中转均可），请求只发往用户填写的地址，密钥仅存本机。 */
import type { Dataset, DataMode } from '../domain/types';
import { todayISO } from '../domain/days';
import { formatMoney } from '../domain/money';
import { goalViews, totalBalanceAt, totalReservedAt } from '../domain/ledger';
import { runForecast } from '../domain/forecasting/engine';

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

export function chatEndpoint(config: AiConfig): string {
  return `${normalizeApiBase(config.baseUrl)}/chat/completions`;
}

export function modelsEndpoint(config: AiConfig): string {
  return `${normalizeApiBase(config.baseUrl)}/models`;
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
  let response: Response;
  try {
    response = await fetch(chatEndpoint(config), {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({ model: config.model.trim(), messages, stream: true, temperature: 0.6 }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new AiError('无法连接 API 地址：请检查网络、地址是否正确，以及该服务是否允许浏览器跨域（CORS）访问。');
  }
  if (!response.ok) throw friendlyHttpError(response.status, await readErrorBody(response));

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
  let response: Response;
  try {
    response = await fetch(modelsEndpoint(config), {
      headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
    });
  } catch {
    throw new AiError('无法连接 API 地址，请检查网络与跨域设置；也可以直接手动填写模型名称。');
  }
  if (!response.ok) throw friendlyHttpError(response.status, await readErrorBody(response));
  const payload = (await response.json()) as { data?: { id?: string }[] };
  const ids = (payload.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) throw new AiError('该地址没有返回模型列表，请直接手动填写模型名称。');
  return ids.sort();
}

const yuan = (cents: number): string => formatMoney(cents);

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
    `截至日期：${today}`,
    `总余额：${yuan(balance)}（${dataset.accounts.length} 个账户）`,
    `目标预留合计：${yuan(reserved)}；安全储备线：${yuan(dataset.settings.safetyReserve)}；自由可支配：${yuan(free)}`,
    `本月（${month}）收入：${yuan(income)}；支出：${yuan(expense)}；结余：${yuan(income - expense)}`,
  ];
  if (topCategories.length > 0) {
    lines.push(`本月支出分类前列：${topCategories.map(([name, cents]) => `${name} ${yuan(cents)}`).join('、')}`);
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
    lines.push(
      `未来 90 天预测：期末余额 ${yuan(risk.end90)}；最低余额 ${yuan(risk.minBalance)}（${risk.minBalanceDate}）；${risk.firstNegative ? `预计 ${risk.firstNegative} 出现负余额` : risk.firstBelowSafety ? `预计 ${risk.firstBelowSafety} 跌破安全储备线` : '预测期内不低于安全储备线'}`,
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
  '你是 MoneyFlow 钱流的本地财务分析助手。用户会提供一份由其本机账本生成的中文摘要，请基于摘要回答。',
  '要求：',
  '1. 金额单位均为人民币元；引用数字时与摘要保持一致，不要编造摘要中没有的数据。',
  '2. 先给结论，再给依据与建议；建议要具体可执行（如调整哪类支出、何时购买更稳妥）。',
  '3. 摘要标注为合成示例数据时，提醒用户当前分析的是演示数据。',
  '4. 预测只是规划参考，不构成投资建议或收益承诺；涉及风险时如实说明不确定性。',
  '5. 使用简体中文，条理清晰，避免空泛套话。',
].join('\n');