/** 本地账户层：用户表存于本机 IndexedDB，密码与找回答案均经 PBKDF2-SHA256 加盐哈希，绝不存明文。 */
import Dexie, { type Table } from 'dexie';
import { makeId, nowISOString } from '../domain/ids';

export interface AuthUser {
  id: string;
  username: string;
  phone: string | null;
  recoveryQuestion: string | null;
}

interface UserRow extends AuthUser {
  usernameLower: string;
  phoneKey: string | null;
  passHash: string;
  salt: string;
  createdAt: string;
  recoveryAnswerHash: string | null;
  recoveryAnswerSalt: string | null;
}

class AuthDB extends Dexie {
  users!: Table<UserRow, string>;

  constructor() {
    super('moneyflow-auth');
    this.version(1).stores({
      users: 'id,usernameLower',
    });
    this.version(2).stores({
      users: 'id,usernameLower,phoneKey',
    });
  }
}

let authDb: AuthDB | null = null;
function db(): AuthDB {
  if (!authDb) authDb = new AuthDB();
  return authDb;
}

export const SESSION_STORAGE_KEY = 'moneyflow.session';
export const PBKDF2_ITERATIONS = 120_000;

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

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return PHONE_RE.test(digits) ? digits : null;
}

function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

function validateRecovery(question: string, answer: string): { question: string; answer: string } {
  const q = question.trim();
  if (!(RECOVERY_QUESTIONS as readonly string[]).includes(q)) throw new Error('请选择找回问题');
  const a = normalizeAnswer(answer);
  if (a.length < 2 || a.length > 40) throw new Error('找回答案需为 2–40 个字符');
  return { question: q, answer: a };
}

function maskUsername(name: string): string {
  if (name.length <= 2) return `${name[0] ?? ''}*`;
  return `${name[0]}***${name[name.length - 1]}`;
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    phone: row.phone ?? null,
    recoveryQuestion: row.recoveryQuestion ?? null,
  };
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return toHex(bits);
}

function randomSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function findRowByIdentifier(identifier: string): Promise<UserRow | null> {
  const value = identifier.trim();
  if (!value) return null;
  const byName = await db().users.where('usernameLower').equals(value.toLowerCase()).first();
  if (byName) return byName;
  const phone = normalizePhone(value);
  if (!phone) return null;
  return (await db().users.where('phoneKey').equals(phone).first()) ?? null;
}

export async function registerUser(username: string, password: string, recovery?: RegistrationDetails): Promise<AuthUser> {
  const invalid = validateCredentials(username, password);
  if (invalid) throw new Error(invalid);
  let phone: string | null = null;
  let recoverySetup: { question: string; answer: string } | null = null;
  if (recovery) {
    recoverySetup = validateRecovery(recovery.question, recovery.answer);
    if (recovery.phone?.trim()) {
      phone = normalizePhone(recovery.phone);
      if (!phone) throw new Error('手机号需为 11 位数字，且以 1 开头');
      const taken = await db().users.where('phoneKey').equals(phone).first();
      if (taken) throw new Error('该手机号已被其他账户绑定');
    }
  }
  const name = username.trim();
  const lower = name.toLowerCase();
  const existing = await db().users.where('usernameLower').equals(lower).first();
  if (existing) throw new Error('该用户名已被注册');
  const salt = randomSaltHex();
  const passHash = await hashPassword(password, salt);
  const recoveryAnswerSalt = recoverySetup ? randomSaltHex() : null;
  const recoveryAnswerHash = recoverySetup && recoveryAnswerSalt
    ? await hashPassword(recoverySetup.answer, recoveryAnswerSalt)
    : null;
  const row: UserRow = {
    id: makeId('user'),
    username: name,
    usernameLower: lower,
    phone,
    phoneKey: phone,
    passHash,
    salt,
    createdAt: nowISOString(),
    recoveryQuestion: recoverySetup?.question ?? null,
    recoveryAnswerSalt,
    recoveryAnswerHash,
  };
  await db().users.put(row);
  return toAuthUser(row);
}

export async function loginUser(identifier: string, password: string): Promise<AuthUser> {
  const row = await findRowByIdentifier(identifier);
  if (!row) throw new Error('用户名或密码不正确');
  const hash = await hashPassword(password, row.salt);
  if (!constantTimeEqual(hash, row.passHash)) throw new Error('用户名或密码不正确');
  return toAuthUser(row);
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const row = await db().users.get(id);
  return row ? toAuthUser(row) : null;
}

export async function updateUsername(userId: string, username: string): Promise<AuthUser> {
  const name = username.trim();
  if (!USERNAME_RE.test(name)) throw new Error('用户名需为 2–20 个字符（中文、字母、数字、下划线或连字符）');
  const lower = name.toLowerCase();
  const existing = await db().users.where('usernameLower').equals(lower).first();
  if (existing && existing.id !== userId) throw new Error('该用户名已被注册');
  const row = await db().users.get(userId);
  if (!row) throw new Error('账户不存在，请重新登录');
  await db().users.update(userId, { username: name, usernameLower: lower });
  return toAuthUser({ ...row, username: name, usernameLower: lower });
}

export async function updateUserPhone(userId: string, phoneInput: string): Promise<AuthUser> {
  const row = await db().users.get(userId);
  if (!row) throw new Error('账户不存在，请重新登录');
  const trimmed = phoneInput.trim();
  let phone: string | null = null;
  if (trimmed) {
    phone = normalizePhone(trimmed);
    if (!phone) throw new Error('手机号需为 11 位数字，且以 1 开头');
    const taken = await db().users.where('phoneKey').equals(phone).first();
    if (taken && taken.id !== userId) throw new Error('该手机号已被其他账户绑定');
  }
  await db().users.update(userId, { phone, phoneKey: phone });
  return toAuthUser({ ...row, phone, phoneKey: phone });
}

export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < 6 || newPassword.length > 64) throw new Error('新密码长度需为 6–64 个字符');
  if (newPassword === currentPassword) throw new Error('新密码不能与当前密码相同');
  const row = await db().users.get(userId);
  if (!row) throw new Error('账户不存在，请重新登录');
  const currentHash = await hashPassword(currentPassword, row.salt);
  if (!constantTimeEqual(currentHash, row.passHash)) throw new Error('当前密码不正确');
  const salt = randomSaltHex();
  const passHash = await hashPassword(newPassword, salt);
  await db().users.update(userId, { passHash, salt });
}

export async function updateRecoverySetup(
  userId: string,
  currentPassword: string,
  question: string,
  answer: string,
): Promise<AuthUser> {
  const row = await db().users.get(userId);
  if (!row) throw new Error('账户不存在，请重新登录');
  const currentHash = await hashPassword(currentPassword, row.salt);
  if (!constantTimeEqual(currentHash, row.passHash)) throw new Error('当前密码不正确');
  const setup = validateRecovery(question, answer);
  const recoveryAnswerSalt = randomSaltHex();
  const recoveryAnswerHash = await hashPassword(setup.answer, recoveryAnswerSalt);
  await db().users.update(userId, {
    recoveryQuestion: setup.question,
    recoveryAnswerSalt,
    recoveryAnswerHash,
  });
  return toAuthUser({ ...row, recoveryQuestion: setup.question });
}

export async function findAccountByIdentifier(identifier: string): Promise<AccountLookup | null> {
  const row = await findRowByIdentifier(identifier);
  if (!row) return null;
  return {
    username: row.username,
    maskedUsername: maskUsername(row.username),
    maskedPhone: row.phone ? maskPhone(row.phone) : null,
    recoveryQuestion: row.recoveryQuestion ?? null,
  };
}

export async function resetPasswordWithAnswer(identifier: string, answer: string, newPassword: string): Promise<AuthUser> {
  if (newPassword.length < 6 || newPassword.length > 64) throw new Error('新密码长度需为 6–64 个字符');
  const row = await findRowByIdentifier(identifier);
  if (!row) throw new Error('没有找到匹配的账户');
  if (!row.recoveryQuestion || !row.recoveryAnswerHash || !row.recoveryAnswerSalt) {
    throw new Error('该账户未设置找回问题，无法自助重置');
  }
  const normalized = normalizeAnswer(answer);
  if (normalized.length < 2) throw new Error('请填写找回答案');
  const answerHash = await hashPassword(normalized, row.recoveryAnswerSalt);
  if (!constantTimeEqual(answerHash, row.recoveryAnswerHash)) throw new Error('找回答案不正确');
  const salt = randomSaltHex();
  const passHash = await hashPassword(newPassword, salt);
  await db().users.update(row.id, { passHash, salt });
  return toAuthUser({ ...row, salt, passHash });
}

export async function countUsers(): Promise<number> {
  return db().users.count();
}

export function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeSession(userId: string): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, userId);
  } catch {
    /* 隐私模式下会话仅保留在内存 */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}

export function personalDbNameFor(userId: string): string {
  return `moneyflow-user-${userId}`;
}

export function closeAuthDb(): void {
  authDb?.close();
  authDb = null;
}