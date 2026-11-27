/** 管理员接口：独立打包，普通用户界面不会加载。 */
import { apiRequest } from '../data/api-core';
import type { AuthUser } from '../data/auth';

export interface AdminStats {
  totalUsers: number;
  disabledUsers: number;
  newUsers7d: number;
  activeToday: number;
  active7d: number;
  viewsToday: number;
  views7d: number;
  totalAdmins: number;
}

export interface AdminActivityDay {
  day: string;
  activeUsers: number;
  views: number;
}

export interface AdminUsageSummary {
  views: number;
  activeDays: number;
  lastSeenAt: string | null;
}

export interface AdminUsageUser extends AdminUsageSummary {
  userId: string;
  username: string;
  status: 'active' | 'disabled';
}

export interface AdminUserSummary {
  id: string;
  username: string;
  phoneMasked: string | null;
  status: 'active' | 'disabled';
  createdAt: string | null;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  loginCount: number;
  usage7d: AdminUsageSummary;
}

export interface AdminRecentLogin {
  id: string;
  username: string;
  at: string;
  userAgent: string | null;
}

export interface AdminRecentEvent {
  id: string;
  kind: string;
  username: string;
  actorName: string | null;
  at: string;
  userAgent: string | null;
}

export interface AdminOverview {
  generatedAt: string;
  stats: AdminStats;
  activity: { days: AdminActivityDay[]; complete: boolean };
  usageTop: AdminUsageUser[];
  recentUsers: AdminUserSummary[];
  recentLogins: AdminRecentLogin[];
  recentEvents: AdminRecentEvent[];
}

export interface AdminUserPage {
  items: AdminUserSummary[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  truncated: boolean;
}

export interface AdminEvent {
  id: string;
  kind: string;
  at: string;
  actorName?: string | null;
  userAgent: string | null;
}

export interface AdminUserDetail {
  user: {
    id: string;
    username: string;
    phone: string | null;
    status: 'active' | 'disabled';
    createdAt: string | null;
    updatedAt: string | null;
    lastLoginAt: string | null;
    lastActiveAt: string | null;
    loginCount: number;
    hasRecovery: boolean;
    recoveryQuestion: string | null;
  };
  activeSessions: number;
  usage: {
    activeDays30d: number;
    totalViews30d: number;
    lastSeenAt: string | null;
    daily: Array<{ day: string; views: number }>;
  };
  events: AdminEvent[];
}

export interface AdminSecurityInfo {
  admin: AuthUser & { lastActiveAt: string | null; loginCount: number };
  isRoot: boolean;
  session: { expiresAt: string };
  activeSessions: number;
  events: AdminEvent[];
}

export interface AdminAccount {
  id: string;
  username: string;
  status: 'active' | 'disabled';
  isRoot: boolean;
  mustChangePassword: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  loginCount: number;
  activeSessions: number;
}

export interface AdminTeamInfo {
  you: { id: string; isRoot: boolean };
  items: AdminAccount[];
}

export interface AdminCreateResult {
  admin: AdminAccount;
}

export interface AdminCredentialsResult {
  user: AuthUser;
  otherSessionsRevoked: number;
}

export function apiAdminOverview(): Promise<AdminOverview> {
  return apiRequest<AdminOverview>('/api/admin/overview');
}

export function apiAdminUsers(page: number, query: string): Promise<AdminUserPage> {
  const params = new URLSearchParams({ page: String(page) });
  if (query.trim()) params.set('q', query.trim());
  return apiRequest<AdminUserPage>(`/api/admin/users?${params.toString()}`);
}

export function apiAdminUserDetail(id: string): Promise<AdminUserDetail> {
  return apiRequest<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`);
}

export function apiAdminSetStatus(id: string, status: 'active' | 'disabled'): Promise<{ user: AdminUserSummary; sessionsRevoked: number }> {
  return apiRequest(`/api/admin/users/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: { status },
  });
}

export function apiAdminRevokeSessions(id: string): Promise<{ ok: boolean; sessionsRevoked: number }> {
  return apiRequest(`/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`, {
    method: 'POST',
    body: {},
  });
}

export function apiAdminSecurity(): Promise<AdminSecurityInfo> {
  return apiRequest<AdminSecurityInfo>('/api/admin/security');
}

export function apiAdminTeam(): Promise<AdminTeamInfo> {
  return apiRequest<AdminTeamInfo>('/api/admin/admins');
}

export function apiAdminCreateAdmin(input: { username: string; password: string }): Promise<AdminCreateResult> {
  return apiRequest<AdminCreateResult>('/api/admin/admins', {
    method: 'POST',
    body: { username: input.username, password: input.password },
  });
}

export function apiAdminSetAdminStatus(id: string, status: 'active' | 'disabled'): Promise<{ admin: AdminAccount; sessionsRevoked: number }> {
  return apiRequest(`/api/admin/admins/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: { status },
  });
}

export function apiAdminRevokeAdminSessions(id: string): Promise<{ ok: boolean; sessionsRevoked: number }> {
  return apiRequest(`/api/admin/admins/${encodeURIComponent(id)}/revoke-sessions`, {
    method: 'POST',
    body: {},
  });
}

export function apiAdminCredentials(input: {
  currentPassword: string;
  username?: string;
  newPassword?: string;
}): Promise<AdminCredentialsResult> {
  return apiRequest<AdminCredentialsResult>('/api/admin/credentials', {
    method: 'POST',
    body: {
      currentPassword: input.currentPassword,
      ...(input.username ? { username: input.username } : {}),
      ...(input.newPassword ? { newPassword: input.newPassword } : {}),
    },
  });
}