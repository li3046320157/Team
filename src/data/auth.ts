/** 本地账户层：用户表存于本机 IndexedDB，密码经 PBKDF2-SHA256 加盐哈希，绝不存明文。 */
import Dexie, { type Table } from 'dexie';
import { makeId, nowISOString } from '../domain/ids';

export interface AuthUser {
  id: string;
  username: string;
}

interface UserRow extends AuthUser {
  usernameLower: string;
  passHash: string;
  salt: string;
  createdAt: string;
}

class AuthDB extends Dexie {
  users!: Table<UserRow, string>;

  constructor() {
    super('moneyflow-auth');
    this.version(1).stores({
      users: 'id,usernameLower',
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

const USERNAME_RE = /^[\w\u4e00-\u9fa5-]{2,20}$/;

export function validateCredentials(username: string, password: string): string | null {
  const name = username.trim();
  if (!USERNAME_RE.test(name)) return '用户名需为 2–20 个字符（中文、字母、数字、下划线或连字符）';
  if (password.length < 6 || password.length > 64) return '密码长度需为 6–64 个字符';
  return null;
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

export async function registerUser(username: string, password: string): Promise<AuthUser> {
  const invalid = validateCredentials(username, password);
  if (invalid) throw new Error(invalid);
  const name = username.trim();
  const lower = name.toLowerCase();
  const existing = await db().users.where('usernameLower').equals(lower).first();
  if (existing) throw new Error('该用户名已被注册');
  const salt = randomSaltHex();
  const passHash = await hashPassword(password, salt);
  const row: UserRow = { id: makeId('user'), username: name, usernameLower: lower, passHash, salt, createdAt: nowISOString() };
  await db().users.put(row);
  return { id: row.id, username: row.username };
}

export async function loginUser(username: string, password: string): Promise<AuthUser> {
  const row = await db().users.where('usernameLower').equals(username.trim().toLowerCase()).first();
  if (!row) throw new Error('用户名或密码不正确');
  const hash = await hashPassword(password, row.salt);
  if (!constantTimeEqual(hash, row.passHash)) throw new Error('用户名或密码不正确');
  return { id: row.id, username: row.username };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const row = await db().users.get(id);
  return row ? { id: row.id, username: row.username } : null;
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