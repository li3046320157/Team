import { AppError, errorJson, json, readJson, rows } from './http.mjs';
import { consume } from './limiter.mjs';
import { PBKDF2_ITERATIONS, hashPassword, verifyPassword, verifyPasswordAgainstDummy } from './passwords.mjs';
import {
  ADMIN_SESSION_TTL_MS,
  SESSION_TTL_MS,
  clearSessionCookie,
  createSession,
  revokeAllSessions,
  revokeSession,
  sessionCookie,
  validateSession,
} from './sessions.mjs';
import {
  maskPhone,
  maskUsername,
  normalizeRecoveryAnswer,
  parseLoginIdentifier,
  parseOptionalPhone,
  parseRecoverySetup,
  parseUsername,
  limiterSubject,
  safeUserAgent,
  validatePassword,
} from './validate.mjs';

const USER_COLUMNS = 'id,username,username_lower,phone,role,status,must_change_password,recovery_question,created_at,updated_at,last_login_at,last_active_at,login_count';
const FULL_COLUMNS = `${USER_COLUMNS},password_salt,password_hash,password_iterations,recovery_answer_salt,recovery_answer_hash`;
const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
const ADMIN_SESSION_TTL_SECONDS = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
const encoder = new TextEncoder();

export class SessionRequired extends Error {
  constructor(state) {
    super('login_required');
    this.state = state;
  }
}

export function unauthorized(state) {
  return state === 'invalid'
    ? errorJson('login_required', 401, { 'set-cookie': clearSessionCookie() })
    : errorJson('login_required', 401);
}

export function toPublicUser(row) {
  return {
    id: row.id,
    username: row.username,
    phone: row.phone ?? null,
    role: row.role === 'admin' ? 'admin' : 'user',
    mustChangePassword: row.must_change_password === true,
    recoveryQuestion: row.recovery_question ?? null,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

export function userAgentOf(request) {
  return safeUserAgent(request.headers.get('user-agent'));
}

export async function recordEvent(db, { userId, actorId = null, kind, userAgent = null, at = Date.now() }) {
  try {
    await db.from('auth_events').insertIfAbsent({
      id: crypto.randomUUID(),
      user_id: userId,
      actor_id: actorId,
      kind,
      at: new Date(at).toISOString(),
      user_agent: userAgent,
    }, { onConflict: 'id' }).select('id');
  } catch {
    // 审计写入失败不能改变登录或密码修改的结果。
  }
}

export async function requireUser(db, request) {
  const result = await validateSession(db, request);
  if (result.state !== 'valid' || !result.session) throw new SessionRequired(result.state);
  const found = rows(await db.from('users').select(USER_COLUMNS).eq('id', result.session.userId).limit(1));
  if (found.length !== 1) throw new SessionRequired('invalid');
  const user = found[0];
  if (user.status !== 'active') throw new SessionRequired('invalid');
  return { session: result.session, user };
}

export async function loadUserFullById(db, id) {
  const found = rows(await db.from('users').select(FULL_COLUMNS).eq('id', id).limit(1));
  return found.length === 1 ? found[0] : null;
}

export async function findFullByIdentifier(db, identifier) {
  if (!identifier) return null;
  const query = identifier.kind === 'phone'
    ? db.from('users').select(FULL_COLUMNS).eq('phone', identifier.phone)
    : db.from('users').select(FULL_COLUMNS).eq('username_lower', identifier.usernameLower);
  const found = rows(await query.limit(1));
  return found.length === 1 ? found[0] : null;
}

function boundedPassword(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || encoder.encode(raw).length > 256) return null;
  return raw;
}

function retryAfter(limit) {
  return { 'retry-after': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) };
}

async function usernameExists(db, lower) {
  return rows(await db.from('users').select('id').eq('username_lower', lower).limit(1));
}

async function phoneExists(db, phone) {
  return rows(await db.from('users').select('id').eq('phone', phone).limit(1));
}

export async function registerAccount(db, request) {
  const body = await readJson(request);
  const { username, usernameLower } = parseUsername(body?.username);
  const password = validatePassword(body?.password);
  const phone = parseOptionalPhone(body?.phone);
  const recovery = parseRecoverySetup(body?.recovery);

  const limit = await consume(db, 'register', usernameLower);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));

  const existing = await usernameExists(db, usernameLower);
  if (existing.length > 0) return errorJson('username_taken', 409);
  if (phone) {
    const taken = await phoneExists(db, phone);
    if (taken.length > 0) return errorJson('phone_taken', 409);
  }

  const derived = await hashPassword(password);
  let recoverySalt = null;
  let recoveryHash = null;
  if (recovery) {
    const answer = await hashPassword(recovery.answer);
    recoverySalt = answer.salt;
    recoveryHash = answer.hash;
  }

  const nowIso = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    username,
    username_lower: usernameLower,
    phone,
    role: 'user',
    status: 'active',
    must_change_password: false,
    password_salt: derived.salt,
    password_hash: derived.hash,
    password_iterations: derived.iterations,
    recovery_question: recovery?.question ?? null,
    recovery_answer_salt: recoverySalt,
    recovery_answer_hash: recoveryHash,
    created_at: nowIso,
    updated_at: nowIso,
    last_login_at: null,
    last_active_at: null,
    login_count: 0,
  };

  let created;
  try {
    created = await db.from('users').insertIfAbsent(row, { onConflict: 'username_lower' }).select(USER_COLUMNS);
  } catch {
    return errorJson('registration_unconfirmed', 503);
  }

  if (created.error) {
    const winner = await usernameExists(db, usernameLower);
    if (winner.length > 0) return errorJson('username_taken', 409);
    if (phone) {
      const phoneWinner = await phoneExists(db, phone);
      if (phoneWinner.length > 0) return errorJson('phone_taken', 409);
    }
    return errorJson('registration_unconfirmed', 503);
  }
  if (!Array.isArray(created.data) || created.data.length !== 1) {
    const winner = await usernameExists(db, usernameLower);
    if (winner.length > 0) return errorJson('username_taken', 409);
    return errorJson('registration_unconfirmed', 503);
  }

  const user = created.data[0];
  await recordEvent(db, {
    userId: user.id,
    kind: 'register',
    userAgent: userAgentOf(request),
  });
  return json({ user: toPublicUser(user) }, 201);
}

export async function loginAccount(db, request) {
  const body = await readJson(request);
  const identifier = parseLoginIdentifier(body?.identifier ?? body?.username);
  const subject = identifier
    ? `${identifier.kind === 'phone' ? 'phone' : 'user'}:${identifier.kind === 'phone' ? identifier.phone : identifier.usernameLower}`
    : `invalid:${limiterSubject(body?.identifier ?? body?.username)}`;

  const limit = await consume(db, 'login', subject);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));

  const password = boundedPassword(body?.password);
  if (!identifier || !password) {
    await verifyPasswordAgainstDummy(password ?? '');
    return errorJson('invalid_credentials', 401);
  }

  const user = await findFullByIdentifier(db, identifier);
  if (!user) {
    await verifyPasswordAgainstDummy(password);
    return errorJson('invalid_credentials', 401);
  }

  const valid = await verifyPassword(password, {
    salt: user.password_salt,
    hash: user.password_hash,
    iterations: user.password_iterations,
  });
  if (!valid) return errorJson('invalid_credentials', 401);
  if (user.status !== 'active') return errorJson('account_disabled', 403);

  const nowIso = new Date().toISOString();
  try {
    await db.from('users').update({
      last_login_at: nowIso,
      last_active_at: nowIso,
      login_count: Number(user.login_count) + 1,
      updated_at: nowIso,
    }).eq('id', user.id).eq('login_count', user.login_count).select('id');
  } catch {
    // 登录统计不是登录成功的必要条件。
  }

  await recordEvent(db, {
    userId: user.id,
    kind: 'login',
    userAgent: userAgentOf(request),
    at: Date.now(),
  });

  const isAdmin = user.role === 'admin';
  const session = await createSession(db, user.id, {
    ttlMs: isAdmin ? ADMIN_SESSION_TTL_MS : SESSION_TTL_MS,
  });
  return json({ user: toPublicUser({ ...user, last_login_at: nowIso, last_active_at: nowIso }) }, 200, {
    'set-cookie': sessionCookie(session.token, isAdmin ? ADMIN_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS),
  });
}

export async function logoutAccount(db, request) {
  const result = await validateSession(db, request);
  if (result.state === 'valid' && result.session) {
    try {
      await revokeSession(db, result.session.digest);
    } catch {
      // 即使服务端撤销未确认，也必须让浏览器丢掉会话 Cookie。
      return errorJson('logout_unconfirmed', 503, { 'set-cookie': clearSessionCookie() });
    }
  }
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}

export async function currentUser(db, request) {
  const { user } = await requireUser(db, request);
  return json({ user: toPublicUser(user) });
}

function requireNormalUser(sessionUser) {
  if (sessionUser.role !== 'user') throw new AppError('forbidden', 403);
}

export async function updateProfile(db, request) {
  const { user } = await requireUser(db, request);
  requireNormalUser(user);
  const body = await readJson(request);
  const { username, usernameLower } = parseUsername(body?.username);
  if (username === user.username) return errorJson('username_unchanged', 409);

  const existing = await usernameExists(db, usernameLower);
  if (existing.some((row) => row.id !== user.id)) return errorJson('username_taken', 409);

  const nowIso = new Date().toISOString();
  let updated;
  try {
    updated = await db.from('users').update({
      username,
      username_lower: usernameLower,
      updated_at: nowIso,
    }).eq('id', user.id).select(USER_COLUMNS);
  } catch {
    return errorJson('service_unavailable', 503);
  }
  if (updated.error) {
    const winner = await usernameExists(db, usernameLower);
    if (winner.some((row) => row.id !== user.id)) return errorJson('username_taken', 409);
    return errorJson('service_unavailable', 503);
  }
  if (!Array.isArray(updated.data) || updated.data.length !== 1) return errorJson('service_unavailable', 503);

  await recordEvent(db, {
    userId: user.id,
    kind: 'username_changed',
    userAgent: userAgentOf(request),
  });
  return json({ user: toPublicUser(updated.data[0]) });
}

export async function bindPhone(db, request) {
  const { user } = await requireUser(db, request);
  requireNormalUser(user);
  const body = await readJson(request);
  const phone = parseOptionalPhone(body?.phone);
  if ((phone ?? null) === (user.phone ?? null)) return errorJson('phone_unchanged', 409);

  if (phone) {
    const existing = await phoneExists(db, phone);
    if (existing.some((row) => row.id !== user.id)) return errorJson('phone_taken', 409);
  }

  const nowIso = new Date().toISOString();
  let updated;
  try {
    updated = await db.from('users').update({
      phone,
      updated_at: nowIso,
    }).eq('id', user.id).select(USER_COLUMNS);
  } catch {
    return errorJson('service_unavailable', 503);
  }
  if (updated.error) {
    if (phone) {
      const winner = await phoneExists(db, phone);
      if (winner.some((row) => row.id !== user.id)) return errorJson('phone_taken', 409);
    }
    return errorJson('service_unavailable', 503);
  }
  if (!Array.isArray(updated.data) || updated.data.length !== 1) return errorJson('service_unavailable', 503);

  await recordEvent(db, {
    userId: user.id,
    kind: phone ? 'phone_bound' : 'phone_unbound',
    userAgent: userAgentOf(request),
  });
  return json({ user: toPublicUser(updated.data[0]) });
}

export async function changePassword(db, request) {
  const { user } = await requireUser(db, request);
  requireNormalUser(user);
  const body = await readJson(request);
  const currentPassword = boundedPassword(body?.currentPassword);
  const newPassword = validatePassword(body?.newPassword);
  if (!currentPassword) return errorJson('current_password_incorrect', 400);

  const full = await loadUserFullById(db, user.id);
  if (!full) throw new SessionRequired('invalid');
  const valid = await verifyPassword(currentPassword, {
    salt: full.password_salt,
    hash: full.password_hash,
    iterations: full.password_iterations,
  });
  if (!valid) return errorJson('current_password_incorrect', 400);
  if (newPassword === currentPassword) return errorJson('password_unchanged', 409);

  const derived = await hashPassword(newPassword);
  let updated;
  try {
    updated = await db.from('users').update({
      password_salt: derived.salt,
      password_hash: derived.hash,
      password_iterations: derived.iterations,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id).select('id');
  } catch {
    return errorJson('service_unavailable', 503);
  }
  if (updated.error || !Array.isArray(updated.data) || updated.data.length !== 1) {
    return errorJson('service_unavailable', 503);
  }

  let sessionsRevoked = 0;
  try {
    sessionsRevoked = await revokeAllSessions(db, user.id);
  } catch {
    sessionsRevoked = 0;
  }
  await recordEvent(db, {
    userId: user.id,
    kind: 'password_changed',
    userAgent: userAgentOf(request),
  });
  return json({ ok: true, sessionsRevoked });
}

export async function updateRecovery(db, request) {
  const { user } = await requireUser(db, request);
  requireNormalUser(user);
  const body = await readJson(request);
  const currentPassword = boundedPassword(body?.currentPassword);
  if (!currentPassword) return errorJson('current_password_incorrect', 400);
  const recovery = parseRecoverySetup(body?.recovery, { required: true });

  const full = await loadUserFullById(db, user.id);
  if (!full) throw new SessionRequired('invalid');
  const valid = await verifyPassword(currentPassword, {
    salt: full.password_salt,
    hash: full.password_hash,
    iterations: full.password_iterations,
  });
  if (!valid) return errorJson('current_password_incorrect', 400);

  const derived = await hashPassword(recovery.answer);
  let updated;
  try {
    updated = await db.from('users').update({
      recovery_question: recovery.question,
      recovery_answer_salt: derived.salt,
      recovery_answer_hash: derived.hash,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id).select(USER_COLUMNS);
  } catch {
    return errorJson('service_unavailable', 503);
  }
  if (updated.error || !Array.isArray(updated.data) || updated.data.length !== 1) {
    return errorJson('service_unavailable', 503);
  }

  await recordEvent(db, {
    userId: user.id,
    kind: 'recovery_updated',
    userAgent: userAgentOf(request),
  });
  return json({ user: toPublicUser(updated.data[0]) });
}

async function eraseRows(db, table, column, value) {
  try {
    await db.from(table).delete().eq(column, value);
  } catch {
    // 单表清理失败不阻断账户主体删除；用户行删除后残留行也无法再关联登录。
  }
}

function accountLimiterKeys(user) {
  const lower = user.username_lower;
  const keys = [
    `register:${lower}`,
    `login:user:${lower}`,
    `usage:${user.id}`,
    `delete_account:${user.id}`,
    `recovery:lookup:user:${lower}`,
    `recovery:reset:user:${lower}`,
  ];
  if (user.phone) {
    keys.push(`login:phone:${user.phone}`);
    keys.push(`recovery:lookup:phone:${user.phone}`);
    keys.push(`recovery:reset:phone:${user.phone}`);
  }
  return keys;
}

export async function deleteAccount(db, request) {
  const { user } = await requireUser(db, request);
  requireNormalUser(user);
  const body = await readJson(request);
  const currentPassword = boundedPassword(body?.currentPassword);
  const confirmation = typeof body?.confirmUsername === 'string' ? body.confirmUsername.trim() : '';

  const limit = await consume(db, 'delete_account', user.id);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));
  if (!currentPassword) return errorJson('current_password_incorrect', 400);
  if (!confirmation || confirmation !== user.username) return errorJson('confirmation_mismatch', 400);

  const full = await loadUserFullById(db, user.id);
  if (!full) throw new SessionRequired('invalid');
  const valid = await verifyPassword(currentPassword, {
    salt: full.password_salt,
    hash: full.password_hash,
    iterations: full.password_iterations,
  });
  if (!valid) return errorJson('current_password_incorrect', 400);

  try {
    await revokeAllSessions(db, user.id);
  } catch {
    // 即使撤销失败，随后删除会话行与用户行也会让旧会话失效。
  }
  await eraseRows(db, 'sessions', 'user_id', user.id);
  await eraseRows(db, 'usage_daily', 'user_id', user.id);
  await eraseRows(db, 'auth_events', 'user_id', user.id);
  await eraseRows(db, 'auth_events', 'actor_id', user.id);
  for (const key of accountLimiterKeys(user)) {
    await eraseRows(db, 'auth_limiter', 'key', key);
  }

  let deleted;
  try {
    deleted = await db.from('users').delete().eq('id', user.id).eq('role', 'user');
  } catch {
    return errorJson('delete_unconfirmed', 503);
  }
  if (deleted?.error) return errorJson('delete_unconfirmed', 503);

  let remaining;
  try {
    remaining = rows(await db.from('users').select('id').eq('id', user.id).limit(1));
  } catch {
    return errorJson('delete_unconfirmed', 503);
  }
  if (remaining.length !== 0) return errorJson('delete_unconfirmed', 503);

  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}

export async function lookupRecovery(db, request) {
  const body = await readJson(request);
  const identifier = parseLoginIdentifier(body?.identifier);
  const subject = `lookup:${identifier
    ? `${identifier.kind === 'phone' ? 'phone' : 'user'}:${identifier.kind === 'phone' ? identifier.phone : identifier.usernameLower}`
    : `invalid:${limiterSubject(body?.identifier)}`}`;
  const limit = await consume(db, 'recovery', subject);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));
  if (!identifier) return json({ found: false });

  const query = identifier.kind === 'phone'
    ? db.from('users').select('id,username,phone,role,recovery_question').eq('phone', identifier.phone)
    : db.from('users').select('id,username,phone,role,recovery_question').eq('username_lower', identifier.usernameLower);
  const found = rows(await query.limit(1));
  if (found.length !== 1 || found[0].role !== 'user') return json({ found: false });

  const row = found[0];
  return json({
    found: true,
    account: {
      username: row.username,
      maskedUsername: maskUsername(row.username),
      maskedPhone: row.phone ? maskPhone(row.phone) : null,
      recoveryQuestion: row.recovery_question ?? null,
    },
  });
}

export async function resetPassword(db, request) {
  const body = await readJson(request);
  const identifier = parseLoginIdentifier(body?.identifier);
  const subject = `reset:${identifier
    ? `${identifier.kind === 'phone' ? 'phone' : 'user'}:${identifier.kind === 'phone' ? identifier.phone : identifier.usernameLower}`
    : `invalid:${limiterSubject(body?.identifier)}`}`;
  const limit = await consume(db, 'recovery', subject);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));

  const newPassword = validatePassword(body?.newPassword);
  if (!identifier) return errorJson('recovery_not_found', 404);
  const user = await findFullByIdentifier(db, identifier);
  if (!user || user.role !== 'user' || !user.recovery_answer_salt || !user.recovery_answer_hash) {
    return errorJson('recovery_not_found', 404);
  }

  let answer;
  try {
    answer = normalizeRecoveryAnswer(body?.answer);
  } catch {
    return errorJson('invalid_recovery_answer', 400);
  }
  const valid = await verifyPassword(answer, {
    salt: user.recovery_answer_salt,
    hash: user.recovery_answer_hash,
    iterations: PBKDF2_ITERATIONS,
  });
  if (!valid) return errorJson('invalid_recovery_answer', 400);

  const derived = await hashPassword(newPassword);
  let updated;
  try {
    updated = await db.from('users').update({
      password_salt: derived.salt,
      password_hash: derived.hash,
      password_iterations: derived.iterations,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id).select('id');
  } catch {
    return errorJson('service_unavailable', 503);
  }
  if (updated.error || !Array.isArray(updated.data) || updated.data.length !== 1) {
    return errorJson('service_unavailable', 503);
  }

  try {
    await revokeAllSessions(db, user.id);
  } catch {
    // 密码已轮换；撤销失败不把密码重置报告为失败。
  }
  await recordEvent(db, {
    userId: user.id,
    kind: 'password_reset',
    userAgent: userAgentOf(request),
  });
  return json({ username: user.username });
}

async function incrementUsage(db, userId, day, nowIso) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const found = rows(await db.from('usage_daily')
      .select('user_id,day,views')
      .eq('user_id', userId).eq('day', day).limit(1));
    if (found.length === 0) {
      const inserted = await db.from('usage_daily').insertIfAbsent({
        user_id: userId,
        day,
        views: 1,
        last_seen_at: nowIso,
      }, { onConflict: 'user_id,day' }).select('user_id,views');
      if (inserted.error) throw new AppError('database_unavailable', 503);
      if (Array.isArray(inserted.data) && inserted.data.length === 1) return true;
      continue;
    }
    const row = found[0];
    const updated = rows(await db.from('usage_daily').update({
      views: Number(row.views) + 1,
      last_seen_at: nowIso,
    }).eq('user_id', userId).eq('day', day).eq('views', row.views).select('user_id'));
    if (updated.length === 1) return true;
  }
  return false;
}

export async function pingUsage(db, request, dayForNow) {
  const { user } = await requireUser(db, request);
  if (user.role !== 'user') return json({ ok: true, tracked: false });

  try {
    const limit = await consume(db, 'usage', user.id);
    if (!limit.allowed) return json({ ok: true, tracked: false });
  } catch {
    return json({ ok: true, tracked: false });
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let tracked = false;
  try {
    tracked = await incrementUsage(db, user.id, dayForNow(now), nowIso);
  } catch {
    tracked = false;
  }
  try {
    await db.from('users').update({ last_active_at: nowIso }).eq('id', user.id).select('id');
  } catch {
    // 使用统计失败不阻断账本使用。
  }
  return json({ ok: true, tracked });
}