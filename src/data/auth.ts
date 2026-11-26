/** 账户资料与校验规则：账户由云端账户服务托管；账本流水仍只保存在本机浏览器。 */
export type UserRole = 'user' | 'admin';

export interface AuthUser {
  id: string;
  username: string;
  phone: string | null;
  role: UserRole;
  mustChangePassword: boolean;
  recoveryQuestion: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
}

export const RECOVERY_QUESTIONS = [
  '我的第一笔零花钱买了什么？',
  '我的第一只宠物叫什么名字？',
  '我小学班主任姓什么？',
  '我最想存钱去的城市是哪里？',
  '我最喜欢的一本书是什么？',
] as const;

export interface RegistrationDetails {
  phone?: string;
  question: string;
  answer: string;
}

export interface AccountLookup {
  username: string;
  maskedUsername: string;
  maskedPhone: string | null;
  recoveryQuestion: string | null;
}

const USERNAME_RE = /^[\w\u4e00-\u9fa5-]{2,20}$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

export function validateCredentials(username: string, password: string): string | null {
  const name = username.trim();
  if (!USERNAME_RE.test(name)) return '用户名需为 2–20 个字符（中文、字母、数字、下划线或连字符）';
  if (password.length < 6 || password.length > 64) return '密码长度需为 6–64 个字符';
  return null;
}

export function validateNewPassword(password: string): string | null {
  if (password.length < 6 || password.length > 64) return '密码长度需为 6–64 个字符';
  return null;
}

export function validateAdminPassword(password: string): string | null {
  const base = validateNewPassword(password);
  if (base) return base;
  if ([...password].length < 10) return '管理员密码至少 10 个字符';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return '管理员密码需同时包含字母和数字';
  return null;
}

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return PHONE_RE.test(digits) ? digits : null;
}

export function validateRecoveryAnswer(answer: string): string | null {
  const length = [...answer.trim()].length;
  if (length < 2 || length > 40) return '找回答案需为 2–40 个字符';
  return null;
}

export function personalDbNameFor(userId: string): string {
  return `moneyflow-user-${userId}`;
}