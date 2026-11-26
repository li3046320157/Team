/** 云端账户接口：注册、登录、资料与恢复。账本数据不经过这里。 */
import { apiRequest } from './api-core';
import type { AccountLookup, AuthUser, RegistrationDetails, UserRole } from './auth';

interface UserEnvelope {
  user: AuthUser;
}

interface RawUser {
  id?: unknown;
  username?: unknown;
  phone?: unknown;
  role?: unknown;
  mustChangePassword?: unknown;
  recoveryQuestion?: unknown;
  createdAt?: unknown;
  lastLoginAt?: unknown;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function normalizeUser(raw: RawUser | null | undefined): AuthUser {
  if (!raw || typeof raw.id !== 'string' || typeof raw.username !== 'string' || !raw.id || !raw.username) {
    throw new Error('账户服务返回了无效的用户信息');
  }
  const role: UserRole = raw.role === 'admin' ? 'admin' : 'user';
  return {
    id: raw.id,
    username: raw.username,
    phone: textOrNull(raw.phone),
    role,
    mustChangePassword: raw.mustChangePassword === true,
    recoveryQuestion: textOrNull(raw.recoveryQuestion),
    createdAt: textOrNull(raw.createdAt),
    lastLoginAt: textOrNull(raw.lastLoginAt),
  };
}

export async function apiMe(): Promise<AuthUser | null> {
  try {
    const data = await apiRequest<UserEnvelope>('/api/me', { auth: false });
    return normalizeUser(data.user);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401) return null;
    throw error;
  }
}

export async function apiLogin(identifier: string, password: string): Promise<AuthUser> {
  const data = await apiRequest<UserEnvelope>('/api/login', {
    method: 'POST',
    auth: false,
    body: { identifier, password },
  });
  return normalizeUser(data.user);
}

export async function apiRegister(username: string, password: string, details: RegistrationDetails): Promise<AuthUser> {
  const data = await apiRequest<UserEnvelope>('/api/register', {
    method: 'POST',
    auth: false,
    body: {
      username,
      password,
      phone: details.phone?.trim() || null,
      recovery: { question: details.question, answer: details.answer },
    },
  });
  return normalizeUser(data.user);
}

export async function apiLogout(): Promise<void> {
  await apiRequest<{ ok: boolean }>('/api/logout', { method: 'POST', auth: false });
}

export async function apiLookupRecovery(identifier: string): Promise<AccountLookup | null> {
  const data = await apiRequest<{
    found?: boolean;
    account?: {
      username?: unknown;
      maskedUsername?: unknown;
      maskedPhone?: unknown;
      recoveryQuestion?: unknown;
    };
  }>('/api/recovery/lookup', {
    method: 'POST',
    auth: false,
    body: { identifier },
  });
  if (!data.found || !data.account) return null;
  const account = data.account;
  if (typeof account.username !== 'string' || typeof account.maskedUsername !== 'string') return null;
  return {
    username: account.username,
    maskedUsername: account.maskedUsername,
    maskedPhone: textOrNull(account.maskedPhone),
    recoveryQuestion: textOrNull(account.recoveryQuestion),
  };
}

export async function apiResetPassword(identifier: string, answer: string, newPassword: string): Promise<string> {
  const data = await apiRequest<{ username?: unknown }>('/api/recovery/reset', {
    method: 'POST',
    auth: false,
    body: { identifier, answer, newPassword },
  });
  if (typeof data.username !== 'string' || !data.username) throw new Error('密码已重置，请直接登录');
  return data.username;
}

export async function apiUpdateProfile(username: string): Promise<AuthUser> {
  const data = await apiRequest<UserEnvelope>('/api/account/profile', {
    method: 'POST',
    body: { username },
  });
  return normalizeUser(data.user);
}

export async function apiBindPhone(phone: string): Promise<AuthUser> {
  const data = await apiRequest<UserEnvelope>('/api/account/phone', {
    method: 'POST',
    body: { phone: phone.trim() || null },
  });
  return normalizeUser(data.user);
}

export async function apiChangePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest<{ ok: boolean }>('/api/account/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
}

export async function apiUpdateRecovery(currentPassword: string, question: string, answer: string): Promise<AuthUser> {
  const data = await apiRequest<UserEnvelope>('/api/account/recovery', {
    method: 'POST',
    body: { currentPassword, recovery: { question, answer } },
  });
  return normalizeUser(data.user);
}

export async function apiPingUsage(): Promise<void> {
  try {
    await apiRequest<{ ok: boolean }>('/api/usage/ping', { method: 'POST', body: {} });
  } catch {
    // 使用统计失败不影响账本使用。
  }
}