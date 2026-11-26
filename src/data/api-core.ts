/** 账户服务客户端基础层：同源调用 Qoder Site Function，统一错误与登录过期处理。 */
const API_BASE = '/functions/v1/app';
const REQUEST_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  code: string;
  status: number;
  retryAfterSeconds: number | null;

  constructor(code: string, status: number, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

let sessionExpiredHandler: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

interface ApiRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** 已登录接口在 401 时通知应用清理本地登录态。 */
  auth?: boolean;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    throw new ApiError('network_error', 0);
  } finally {
    clearTimeout(timer);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
    const code = typeof record?.error === 'string' ? record.error : 'service_unavailable';
    const retryHeader = Number(response.headers.get('retry-after'));
    const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : null;
    if (response.status === 401 && auth && code === 'login_required') sessionExpiredHandler?.();
    throw new ApiError(code, response.status, retryAfter);
  }

  return (payload ?? {}) as T;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: '用户名或密码不正确',
  account_disabled: '该账户已被停用，请联系管理员',
  rate_limited: '操作过于频繁，请稍后再试',
  username_taken: '该用户名已被注册',
  username_unchanged: '新用户名与当前用户名相同',
  phone_taken: '该手机号已被其他账户绑定',
  phone_unchanged: '该手机号已绑定到当前账户',
  invalid_username: '用户名需为 2–20 个字符（中文、字母、数字、下划线或连字符）',
  invalid_phone: '手机号需为 11 位数字，且以 1 开头',
  invalid_password: '密码长度需为 6–64 个字符',
  weak_admin_password: '管理员密码至少 10 个字符，且同时包含字母和数字',
  invalid_recovery: '请选择有效的找回问题，答案需为 2–40 个字符',
  invalid_recovery_answer: '找回答案不正确',
  recovery_not_found: '没有找到可自助重置的账户',
  current_password_incorrect: '当前密码不正确',
  confirmation_mismatch: '用户名确认不匹配，请重新输入',
  delete_unconfirmed: '账号注销未完成，请稍后重试',
  password_unchanged: '新密码不能与当前密码相同',
  credentials_unchanged: '用户名与密码均未变化',
  login_required: '登录已过期，请重新登录',
  forbidden: '没有权限执行此操作',
  admin_password_change_required: '请先修改管理员初始密码',
  admin_cannot_disable_self: '不能停用当前管理员账户',
  user_not_found: '没有找到该用户',
  origin_forbidden: '当前来源无法访问账户服务',
  registration_unconfirmed: '注册结果未确认，请稍后重试',
  logout_unconfirmed: '退出登录未确认，请检查网络后重试',
  service_unavailable: '账户服务暂不可用，请稍后重试',
  database_unavailable: '账户服务暂不可用，请稍后重试',
  application_auth_not_configured: '账户服务尚未完成配置',
  payload_too_large: '提交内容过大',
  invalid_input: '提交内容无效',
  not_found: '请求的账户服务不存在',
  method_not_allowed: '请求方式无效',
  network_error: '无法连接账户服务，请检查网络后重试',
};

export function apiErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (error instanceof ApiError) {
    const base = ERROR_MESSAGES[error.code] ?? fallback;
    if (error.retryAfterSeconds && error.code === 'rate_limited') {
      const minutes = Math.ceil(error.retryAfterSeconds / 60);
      return `${base}（约 ${minutes} 分钟后重试）`;
    }
    return base;
  }
  return error instanceof Error ? error.message : fallback;
}