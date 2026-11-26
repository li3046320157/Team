import { describe, expect, it } from 'vitest';
import {
  normalizePhone,
  personalDbNameFor,
  validateAdminPassword,
  validateCredentials,
  validateNewPassword,
  validateRecoveryAnswer,
} from '../../src/data/auth';

describe('登录与注册凭据校验', () => {
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
    expect(validateNewPassword('abc123')).toBeNull();
  });

  it('新密码沿用 6–64 位长度限制', () => {
    expect(validateNewPassword('12345')).not.toBeNull();
    expect(validateNewPassword('b'.repeat(65))).not.toBeNull();
  });
});

describe('管理员密码规则', () => {
  it('至少 10 位且同时包含字母和数字', () => {
    expect(validateAdminPassword('abc1234567')).toBeNull();
    expect(validateAdminPassword('abcdefghij')).not.toBeNull();
    expect(validateAdminPassword('1234567890')).not.toBeNull();
    expect(validateAdminPassword('a1b2c3d4')).not.toBeNull();
  });

  it('拒绝超过 64 位的密码', () => {
    expect(validateAdminPassword('a1'.repeat(33))).not.toBeNull();
  });
});

describe('手机号与找回答案', () => {
  it('手机号去除空格和连字符后校验 11 位格式', () => {
    expect(normalizePhone('138 0013 8000')).toBe('13800138000');
    expect(normalizePhone('138-0013-8000')).toBe('13800138000');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('23800138000')).toBeNull();
  });

  it('找回答案按去空白后的字符数限制 2–40 位', () => {
    expect(validateRecoveryAnswer('小白')).toBeNull();
    expect(validateRecoveryAnswer(' 小白 ')).toBeNull();
    expect(validateRecoveryAnswer('白')).not.toBeNull();
    expect(validateRecoveryAnswer('长'.repeat(41))).not.toBeNull();
  });
});

describe('个人账本库命名', () => {
  it('按云端账户 ID 隔离命名', () => {
    expect(personalDbNameFor('user_abc')).toBe('moneyflow-user-user_abc');
    expect(personalDbNameFor('a')).not.toBe(personalDbNameFor('b'));
  });
});