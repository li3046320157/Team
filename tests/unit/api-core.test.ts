import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiErrorMessage, apiRequest, setSessionExpiredHandler } from '../../src/data/api-core';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionExpiredHandler(null);
});

describe('账户 API 客户端', () => {
  it('同源请求并解析 JSON 响应', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await apiRequest<{ ok: boolean }>('/api/me');
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
  });

  it('将错误响应转换为带错误码的 ApiError', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ error: 'invalid_credentials' }, 401));
    const error = await apiRequest('/api/auth/login', { method: 'POST', body: {}, auth: false })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('invalid_credentials');
    expect((error as ApiError).status).toBe(401);
  });

  it('只有已登录请求的 login_required 才通知登录过期', async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    vi.stubGlobal('fetch', async () => jsonResponse({ error: 'login_required' }, 401));
    await expect(apiRequest('/api/me')).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledTimes(1);
    await expect(apiRequest('/api/auth/login', { method: 'POST', body: {}, auth: false })).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('网络失败返回 network_error', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    const error = await apiRequest('/api/me').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('network_error');
  });

  it('限流错误附带等待分钟数', () => {
    const message = apiErrorMessage(new ApiError('rate_limited', 429, 125));
    expect(message).toContain('操作过于频繁');
    expect(message).toContain('约 3 分钟');
  });

  it('未知错误码回退到通用提示', () => {
    expect(apiErrorMessage(new ApiError('unknown_code', 500), '请稍后重试')).toBe('请稍后重试');
    expect(apiErrorMessage(new Error('boom'), '请稍后重试')).toBe('boom');
  });
});