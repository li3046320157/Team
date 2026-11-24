import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import {
  SESSION_STORAGE_KEY,
  clearSession,
  countUsers,
  getUserById,
  loginUser,
  personalDbNameFor,
  readSession,
  registerUser,
  storeSession,
  validateCredentials,
} from '../../src/data/auth';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, String(value)),
    removeItem: (key: string) => void memory.delete(key),
  },
});

describe('凭据校验', () => {
  it('拒绝过短或含非法字符的用户名', () => {
    expect(validateCredentials('a', 'abc123')).not.toBeNull();
    expect(validateCredentials('有 空格', 'abc123')).not.toBeNull();
    expect(validateCredentials('a'.repeat(21), 'abc123')).not.toBeNull();
  });

  it('拒绝过短或过长的密码', () => {
    expect(validateCredentials('xiaoming', '12345')).not.toBeNull();
    expect(validateCredentials('xiaoming', 'a'.repeat(65))).not.toBeNull();
  });

  it('接受中文、字母、数字、下划线与连字符', () => {
    expect(validateCredentials('小明', 'abc123')).toBeNull();
    expect(validateCredentials('user_01-A', 'abc123')).toBeNull();
  });
});

describe('注册与登录', () => {
  it('注册后可用正确密码登录，且返回同一用户', async () => {
    const created = await registerUser('alice', 'secret123');
    expect(created.username).toBe('alice');
    const loggedIn = await loginUser('alice', 'secret123');
    expect(loggedIn.id).toBe(created.id);
    expect(await getUserById(created.id)).toEqual(created);
    expect(await getUserById('missing')).toBeNull();
  });

  it('用户名大小写不敏感去重', async () => {
    await registerUser('Bob', 'secret123');
    await expect(registerUser('bob', 'other456')).rejects.toThrow('已被注册');
    const loggedIn = await loginUser('BOB', 'secret123');
    expect(loggedIn.username).toBe('Bob');
  });

  it('错误密码与不存在用户返回同一模糊提示', async () => {
    await registerUser('carol', 'secret123');
    await expect(loginUser('carol', 'wrong-pass')).rejects.toThrow('用户名或密码不正确');
    await expect(loginUser('nobody', 'secret123')).rejects.toThrow('用户名或密码不正确');
  });

  it('密码不以明文存储，且每个用户盐值不同', async () => {
    const u1 = await registerUser('dave', 'same-pass-1');
    const u2 = await registerUser('erin', 'same-pass-1');
    const db = new Dexie('moneyflow-auth');
    db.version(1).stores({ users: 'id,usernameLower' });
    const r1 = await db.table('users').get(u1.id);
    const r2 = await db.table('users').get(u2.id);
    db.close();
    expect(r1.passHash).not.toContain('same-pass-1');
    expect(r1.passHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r1.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(r1.salt).not.toBe(r2.salt);
    expect(r1.passHash).not.toBe(r2.passHash);
    expect(await countUsers()).toBeGreaterThanOrEqual(2);
  });

  it('非法凭据注册直接抛错', async () => {
    await expect(registerUser('x', 'abc123')).rejects.toThrow();
    await expect(registerUser('valid-name', '123')).rejects.toThrow();
  });
});

describe('会话与用户库命名', () => {
  it('会话写入、读取与清除', () => {
    storeSession('user_abc');
    expect(readSession()).toBe('user_abc');
    expect(memory.get(SESSION_STORAGE_KEY)).toBe('user_abc');
    clearSession();
    expect(readSession()).toBeNull();
  });

  it('个人库按用户隔离命名', () => {
    expect(personalDbNameFor('user_abc')).toBe('moneyflow-user-user_abc');
    expect(personalDbNameFor('a')).not.toBe(personalDbNameFor('b'));
  });
});