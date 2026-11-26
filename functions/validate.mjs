import { AppError } from './http.mjs';

export const USERNAME_RE = /^[\w\u4e00-\u9fa5-]{2,20}$/;
export const PHONE_RE = /^1[3-9]\d{9}$/;
export const PASSWORD_MIN_CHARS = 6;
export const PASSWORD_MAX_CHARS = 64;
export const ADMIN_PASSWORD_MIN_CHARS = 10;
export const USER_AGENT_MAX_CHARS = 200;

export const RESERVED_USERNAMES = new Set([
  'root',
  'admin',
  'administrator',
  'system',
  'moneyflow',
  'support',
  'official',
  '管理员',
  '官方',
]);

export const RECOVERY_QUESTIONS = [
  '我的第一笔零花钱买了什么？',
  '我的第一只宠物叫什么名字？',
  '我小学班主任姓什么？',
  '我最想存钱去的城市是哪里？',
  '我最喜欢的一本书是什么？',
];

function codePointLength(text) {
  return [...text].length;
}

export function usernameLower(raw) {
  return raw.toLowerCase();
}

// allowReserved 只用于管理员；普通用户注册/改名永远不能占用保留名。
export function parseUsername(raw, { allowReserved = false } = {}) {
  if (typeof raw !== 'string') throw new AppError('invalid_username', 400);
  const username = raw.trim();
  if (!USERNAME_RE.test(username)) throw new AppError('invalid_username', 400);
  const lower = usernameLower(username);
  if (!allowReserved && RESERVED_USERNAMES.has(lower)) throw new AppError('username_taken', 409);
  return { username, usernameLower: lower };
}

export function isPhone(raw) {
  return typeof raw === 'string' && PHONE_RE.test(raw.replace(/[\s-]/g, ''));
}

export function parseLoginIdentifier(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 64) return null;
  if (isPhone(value)) {
    return { kind: 'phone', phone: value.replace(/[\s-]/g, '') };
  }
  if (!USERNAME_RE.test(value)) return null;
  return { kind: 'username', username: value, usernameLower: usernameLower(value) };
}

export function limiterSubject(raw) {
  if (typeof raw !== 'string') return 'invalid';
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, '').slice(0, 40);
  return normalized || 'invalid';
}

export function validatePassword(raw) {
  if (typeof raw !== 'string') throw new AppError('invalid_password', 400);
  const length = codePointLength(raw);
  if (length < PASSWORD_MIN_CHARS || length > PASSWORD_MAX_CHARS) throw new AppError('invalid_password', 400);
  if (new TextEncoder().encode(raw).length > 256) throw new AppError('invalid_password', 400);
  return raw;
}

export function validateAdminPassword(raw) {
  const password = validatePassword(raw);
  if (codePointLength(password) < ADMIN_PASSWORD_MIN_CHARS) throw new AppError('weak_admin_password', 400);
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new AppError('weak_admin_password', 400);
  return password;
}

export function parseOptionalPhone(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') throw new AppError('invalid_phone', 400);
  const digits = raw.replace(/[\s-]/g, '');
  if (!digits) return null;
  if (!PHONE_RE.test(digits)) throw new AppError('invalid_phone', 400);
  return digits;
}

export const RECOVERY_QUESTION_MIN_CHARS = 2;
export const RECOVERY_QUESTION_MAX_CHARS = 40;

export function normalizeRecoveryQuestion(raw) {
  const question = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  const length = codePointLength(question);
  if (length < RECOVERY_QUESTION_MIN_CHARS || length > RECOVERY_QUESTION_MAX_CHARS) {
    throw new AppError('invalid_recovery', 400);
  }
  if (/[\u0000-\u001f\u007f]/.test(question)) throw new AppError('invalid_recovery', 400);
  return question;
}

export function normalizeRecoveryAnswer(raw) {
  const answer = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const length = codePointLength(answer);
  if (length < 2 || length > 40) throw new AppError('invalid_recovery', 400);
  return answer;
}

export function parseRecoverySetup(raw, { required = false } = {}) {
  if (raw == null) {
    if (required) throw new AppError('invalid_recovery', 400);
    return null;
  }
  if (typeof raw !== 'object') throw new AppError('invalid_recovery', 400);
  return {
    question: normalizeRecoveryQuestion(raw.question),
    answer: normalizeRecoveryAnswer(raw.answer),
  };
}

export function maskUsername(name) {
  if (name.length <= 2) return `${name[0] ?? ''}*`;
  return `${name[0]}***${name[name.length - 1]}`;
}

export function maskPhone(phone) {
  const digits = String(phone ?? '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

export function safeUserAgent(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, USER_AGENT_MAX_CHARS) : null;
}

export function sanitizeSearch(raw) {
  if (typeof raw !== 'string') return '';
  return [...raw.trim().toLowerCase()]
    .filter((char) => /[\p{L}\p{N}_-]/u.test(char))
    .join('')
    .slice(0, 32);
}

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function shanghaiDay(now = Date.now()) {
  return new Date(now + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function shiftDay(day, delta) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

export function pageNumber(raw, fallback = 1) {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 10000 ? parsed : fallback;
}