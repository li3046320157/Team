import { AppError, errorJson, json, readJson, rows } from './http.mjs';
import { consume } from './limiter.mjs';
import { hashPassword, verifyPassword } from './passwords.mjs';
import {
  countActiveSessions,
  revokeAllSessions,
  revokeOtherSessions,
} from './sessions.mjs';
import {
  SessionRequired,
  loadUserFullById,
  recordEvent,
  requireUser,
  toPublicUser,
  userAgentOf,
} from './accounts.mjs';
import {
  isUuid,
  maskPhone,
  pageNumber,
  parseUsername,
  sanitizeSearch,
  shanghaiDay,
  shiftDay,
  validateAdminPassword,
} from './validate.mjs';

const PAGE_SIZE = 20;
const SEARCH_LIMIT = 200;
const USER_LIST_COLUMNS = 'id,username,phone,status,created_at,last_login_at,last_active_at,login_count';
const USER_DETAIL_COLUMNS = 'id,username,phone,role,status,must_change_password,recovery_question,created_at,updated_at,last_login_at,last_active_at,login_count';
const MAX_PASSWORD_BYTES = 256;
const encoder = new TextEncoder();

function boundedPassword(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || encoder.encode(raw).length > MAX_PASSWORD_BYTES) return null;
  return raw;
}

export async function requireAdmin(db, request, { allowPasswordChange = false } = {}) {
  const { session, user } = await requireUser(db, request);
  if (user.role !== 'admin') throw new AppError('forbidden', 403);
  if (user.must_change_password === true && !allowPasswordChange) {
    throw new AppError('admin_password_change_required', 403);
  }
  return { session, user };
}

function adminSummary(row) {
  return {
    id: row.id,
    username: row.username,
    phoneMasked: row.phone ? maskPhone(row.phone) : null,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
    lastActiveAt: row.last_active_at ?? null,
    loginCount: Number.isSafeInteger(row.login_count) ? row.login_count : 0,
  };
}

async function countRows(db, table, apply) {
  let query = db.from(table).select('id', { count: 'exact' });
  if (apply) query = apply(query);
  const result = await query.limit(1);
  if (result?.error || !Number.isSafeInteger(result?.count) || result.count < 0) {
    throw new AppError('database_unavailable', 503);
  }
  return result.count;
}

async function fetchSafeUserById(db, id) {
  if (!id) return null;
  const found = rows(await db.from('users').select('id,username,role').eq('id', id).limit(1));
  return found.length === 1 ? found[0] : null;
}

async function actorNames(db, events) {
  const ids = [...new Set(events.map((event) => event.actor_id).filter(Boolean))];
  const entries = await Promise.all(ids.map(async (id) => {
    try {
      const actor = await fetchSafeUserById(db, id);
      return [id, actor?.username ?? null];
    } catch {
      return [id, null];
    }
  }));
  return new Map(entries);
}

async function activityWindow(db, today, days = 7) {
  const start = shiftDay(today, -(days - 1));
  const usage = rows(await db.from('usage_daily')
    .select('user_id,day,views,last_seen_at')
    .gte('day', start).lte('day', today)
    .order('day')
    .limit(5000));

  const byDay = new Map();
  for (let offset = 0; offset < days; offset += 1) {
    const day = shiftDay(start, offset);
    byDay.set(day, { day, users: new Set(), views: 0 });
  }
  for (const row of usage) {
    const bucket = byDay.get(row.day);
    if (!bucket) continue;
    if (typeof row.user_id === 'string') bucket.users.add(row.user_id);
    bucket.views += Number.isSafeInteger(row.views) ? row.views : 0;
  }
  return {
    start,
    today,
    days: [...byDay.values()].map((bucket) => ({
      day: bucket.day,
      activeUsers: bucket.users.size,
      views: bucket.views,
    })),
    activeUsers: new Set(usage.map((row) => row.user_id).filter(Boolean)).size,
    complete: usage.length < 5000,
  };
}

export async function adminOverview(db, request) {
  await requireAdmin(db, request);
  const today = shanghaiDay();
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [totalUsers, disabledUsers, newUsers, activity, recentUsers, recentLoginEvents] = await Promise.all([
    countRows(db, 'users', (query) => query.eq('role', 'user')),
    countRows(db, 'users', (query) => query.eq('role', 'user').eq('status', 'disabled')),
    countRows(db, 'users', (query) => query.eq('role', 'user').gte('created_at', sevenDaysAgoIso)),
    activityWindow(db, today, 7),
    db.from('users').select(USER_LIST_COLUMNS).eq('role', 'user')
      .order('created_at', { ascending: false }).limit(5).then(rows),
    db.from('auth_events').select('id,user_id,kind,at,user_agent').eq('kind', 'login')
      .order('at', { ascending: false }).limit(20).then(rows),
  ]);

  const recentLogins = [];
  for (const event of recentLoginEvents) {
    if (recentLogins.length >= 8) break;
    try {
      const user = await fetchSafeUserById(db, event.user_id);
      if (!user || user.role !== 'user') continue;
      recentLogins.push({
        id: event.id,
        username: user.username,
        at: event.at,
        userAgent: event.user_agent ?? null,
      });
    } catch {
      continue;
    }
  }

  const todayBucket = activity.days.find((day) => day.day === today);
  return json({
    generatedAt: new Date().toISOString(),
    stats: {
      totalUsers,
      disabledUsers,
      newUsers7d: newUsers,
      activeToday: todayBucket?.activeUsers ?? 0,
      active7d: activity.activeUsers,
    },
    activity: { days: activity.days, complete: activity.complete },
    recentUsers: recentUsers.map(adminSummary),
    recentLogins,
  });
}

async function searchUsers(db, query) {
  const pattern = `${query}*`;
  const [nameHits, phoneHits] = await Promise.all([
    db.from('users').select(USER_LIST_COLUMNS).eq('role', 'user')
      .ilike('username_lower', pattern).order('created_at', { ascending: false }).limit(SEARCH_LIMIT).then(rows),
    /^\d+$/.test(query)
      ? db.from('users').select(USER_LIST_COLUMNS).eq('role', 'user')
        .ilike('phone', pattern).order('created_at', { ascending: false }).limit(SEARCH_LIMIT).then(rows)
      : Promise.resolve([]),
  ]);
  const merged = new Map();
  for (const row of [...nameHits, ...phoneHits]) merged.set(row.id, row);
  const list = [...merged.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return {
    list,
    truncated: nameHits.length >= SEARCH_LIMIT || phoneHits.length >= SEARCH_LIMIT,
  };
}

export async function adminUsers(db, request) {
  await requireAdmin(db, request);
  const url = new URL(request.url);
  const page = pageNumber(url.searchParams.get('page'));
  const query = sanitizeSearch(url.searchParams.get('q'));

  if (query) {
    const { list, truncated } = await searchUsers(db, query);
    const from = (page - 1) * PAGE_SIZE;
    return json({
      items: list.slice(from, from + PAGE_SIZE).map(adminSummary),
      total: list.length,
      page,
      pageSize: PAGE_SIZE,
      hasMore: from + PAGE_SIZE < list.length,
      truncated,
    });
  }

  const total = await countRows(db, 'users', (q) => q.eq('role', 'user'));
  const from = (page - 1) * PAGE_SIZE;
  const list = rows(await db.from('users').select(USER_LIST_COLUMNS).eq('role', 'user')
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1));
  return json({
    items: list.map(adminSummary),
    total,
    page,
    pageSize: PAGE_SIZE,
    hasMore: from + PAGE_SIZE < total,
    truncated: false,
  });
}

export async function adminUserDetail(db, request, id) {
  await requireAdmin(db, request);
  if (!isUuid(id)) return errorJson('user_not_found', 404);
  const found = rows(await db.from('users').select(USER_DETAIL_COLUMNS)
    .eq('id', id).eq('role', 'user').limit(1));
  if (found.length !== 1) return errorJson('user_not_found', 404);
  const user = found[0];

  const today = shanghaiDay();
  const start = shiftDay(today, -29);
  const [activeSessions, events, usage] = await Promise.all([
    countActiveSessions(db, user.id),
    db.from('auth_events').select('id,actor_id,kind,at,user_agent')
      .eq('user_id', user.id).order('at', { ascending: false }).limit(20).then(rows),
    db.from('usage_daily').select('day,views,last_seen_at')
      .eq('user_id', user.id).gte('day', start).lte('day', today)
      .order('day').limit(60).then(rows),
  ]);
  const actors = await actorNames(db, events);
  const usageByDay = new Map(usage.map((row) => [row.day, Number.isSafeInteger(row.views) ? row.views : 0]));
  const daily = Array.from({ length: 14 }, (_, index) => {
    const day = shiftDay(today, -(13 - index));
    return { day, views: usageByDay.get(day) ?? 0 };
  });

  return json({
    user: {
      id: user.id,
      username: user.username,
      phone: user.phone ?? null,
      status: user.status === 'disabled' ? 'disabled' : 'active',
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      lastLoginAt: user.last_login_at ?? null,
      lastActiveAt: user.last_active_at ?? null,
      loginCount: Number.isSafeInteger(user.login_count) ? user.login_count : 0,
      hasRecovery: Boolean(user.recovery_question),
      recoveryQuestion: user.recovery_question ?? null,
    },
    activeSessions,
    usage: {
      activeDays30d: usage.length,
      totalViews30d: usage.reduce((sum, row) => sum + (Number.isSafeInteger(row.views) ? row.views : 0), 0),
      lastSeenAt: usage.reduce((latest, row) => {
        if (!row.last_seen_at) return latest;
        return !latest || String(row.last_seen_at) > latest ? String(row.last_seen_at) : latest;
      }, null),
      daily,
    },
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      at: event.at,
      actorName: event.actor_id ? actors.get(event.actor_id) ?? null : null,
      userAgent: event.user_agent ?? null,
    })),
  });
}

export async function adminSetStatus(db, request, id) {
  const { user: admin } = await requireAdmin(db, request);
  if (!isUuid(id)) return errorJson('user_not_found', 404);
  if (id === admin.id) return errorJson('admin_cannot_disable_self', 409);
  const body = await readJson(request);
  const status = body?.status;
  if (status !== 'active' && status !== 'disabled') throw new AppError('invalid_input', 400);

  const found = rows(await db.from('users').select(USER_DETAIL_COLUMNS)
    .eq('id', id).eq('role', 'user').limit(1));
  if (found.length !== 1) return errorJson('user_not_found', 404);
  const target = found[0];
  if (target.status === status) return json({ user: adminSummary(target), sessionsRevoked: 0 });

  let updated;
  try {
    updated = await db.from('users').update({
      status,
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('role', 'user').select(USER_LIST_COLUMNS);
  } catch {
    return errorJson('service_unavailable', 503);
  }
  if (updated.error || !Array.isArray(updated.data) || updated.data.length !== 1) {
    return errorJson('service_unavailable', 503);
  }

  let sessionsRevoked = 0;
  if (status === 'disabled') {
    try {
      sessionsRevoked = await revokeAllSessions(db, id);
    } catch {
      sessionsRevoked = 0;
    }
  }
  await recordEvent(db, {
    userId: id,
    actorId: admin.id,
    kind: status === 'disabled' ? 'user_disabled' : 'user_enabled',
    userAgent: userAgentOf(request),
  });
  return json({ user: adminSummary(updated.data[0]), sessionsRevoked });
}

export async function adminRevokeSessions(db, request, id) {
  const { user: admin } = await requireAdmin(db, request);
  if (!isUuid(id)) return errorJson('user_not_found', 404);
  if (id === admin.id) return errorJson('admin_cannot_disable_self', 409);
  const found = rows(await db.from('users').select('id').eq('id', id).eq('role', 'user').limit(1));
  if (found.length !== 1) return errorJson('user_not_found', 404);

  let sessionsRevoked = 0;
  try {
    sessionsRevoked = await revokeAllSessions(db, id);
  } catch {
    return errorJson('service_unavailable', 503);
  }
  await recordEvent(db, {
    userId: id,
    actorId: admin.id,
    kind: 'sessions_revoked',
    userAgent: userAgentOf(request),
  });
  return json({ ok: true, sessionsRevoked });
}

export async function adminSecurity(db, request) {
  const { session, user } = await requireAdmin(db, request);
  const [activeSessions, events] = await Promise.all([
    countActiveSessions(db, user.id),
    db.from('auth_events').select('id,kind,at,user_agent')
      .eq('user_id', user.id).order('at', { ascending: false }).limit(10).then(rows),
  ]);
  return json({
    admin: {
      ...toPublicUser(user),
      lastActiveAt: user.last_active_at ?? null,
      loginCount: Number.isSafeInteger(user.login_count) ? user.login_count : 0,
    },
    session: { expiresAt: session.expiresAt },
    activeSessions,
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      at: event.at,
      userAgent: event.user_agent ?? null,
    })),
  });
}

export async function adminCredentials(db, request) {
  const { session, user } = await requireAdmin(db, request, { allowPasswordChange: true });
  const limit = await consume(db, 'admin_credentials', user.id);
  if (!limit.allowed) {
    return errorJson('rate_limited', 429, {
      'retry-after': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))),
    });
  }

  const body = await readJson(request);
  const currentPassword = boundedPassword(body?.currentPassword);
  if (!currentPassword) return errorJson('current_password_incorrect', 400);

  const full = await loadUserFullById(db, user.id);
  if (!full) throw new SessionRequired('invalid');
  const valid = await verifyPassword(currentPassword, {
    salt: full.password_salt,
    hash: full.password_hash,
    iterations: full.password_iterations,
  });
  if (!valid) return errorJson('current_password_incorrect', 400);

  const rawUsername = typeof body?.username === 'string' ? body.username.trim() : '';
  let usernameChange = null;
  if (rawUsername && rawUsername !== user.username) {
    usernameChange = parseUsername(rawUsername, { allowReserved: true });
    const existing = rows(await db.from('users').select('id')
      .eq('username_lower', usernameChange.usernameLower).limit(1));
    if (existing.some((row) => row.id !== user.id)) return errorJson('username_taken', 409);
  }

  const rawPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (user.must_change_password === true && !rawPassword) {
    return errorJson('admin_password_change_required', 403);
  }
  let derived = null;
  if (rawPassword) {
    const newPassword = validateAdminPassword(rawPassword);
    if (newPassword === currentPassword) return errorJson('password_unchanged', 409);
    derived = await hashPassword(newPassword);
  }
  if (!usernameChange && !derived) return errorJson('credentials_unchanged', 400);

  const nowIso = new Date().toISOString();
  const patch = { must_change_password: false, updated_at: nowIso };
  if (usernameChange) {
    patch.username = usernameChange.username;
    patch.username_lower = usernameChange.usernameLower;
  }
  if (derived) {
    patch.password_salt = derived.salt;
    patch.password_hash = derived.hash;
    patch.password_iterations = derived.iterations;
  }

  let updated;
  try {
    updated = await db.from('users').update(patch)
      .eq('id', user.id).eq('role', 'admin').select(USER_DETAIL_COLUMNS);
  } catch {
    return errorJson('service_unavailable', 503);
  }
  if (updated.error) {
    if (usernameChange) {
      const winner = rows(await db.from('users').select('id')
        .eq('username_lower', usernameChange.usernameLower).limit(1));
      if (winner.some((row) => row.id !== user.id)) return errorJson('username_taken', 409);
    }
    return errorJson('service_unavailable', 503);
  }
  if (!Array.isArray(updated.data) || updated.data.length !== 1) {
    return errorJson('service_unavailable', 503);
  }

  let otherSessionsRevoked = 0;
  if (derived) {
    try {
      otherSessionsRevoked = await revokeOtherSessions(db, user.id, session.digest);
    } catch {
      otherSessionsRevoked = 0;
    }
  }
  await recordEvent(db, {
    userId: user.id,
    actorId: user.id,
    kind: 'admin_credentials_changed',
    userAgent: userAgentOf(request),
  });
  return json({
    user: toPublicUser(updated.data[0]),
    otherSessionsRevoked,
  });
}

export async function handleAdminRoute(db, request, { path, method }) {
  if (!path.startsWith('/api/admin')) return null;
  const url = new URL(request.url);

  if (path === '/api/admin/overview') {
    if (method !== 'GET') throw new AppError('method_not_allowed', 405);
    return adminOverview(db, request);
  }
  if (path === '/api/admin/users') {
    if (method !== 'GET') throw new AppError('method_not_allowed', 405);
    return adminUsers(db, request);
  }
  if (path === '/api/admin/security') {
    if (method !== 'GET') throw new AppError('method_not_allowed', 405);
    return adminSecurity(db, request);
  }
  if (path === '/api/admin/credentials') {
    if (method !== 'POST') throw new AppError('method_not_allowed', 405);
    return adminCredentials(db, request);
  }

  const detail = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (detail) {
    if (method !== 'GET') throw new AppError('method_not_allowed', 405);
    return adminUserDetail(db, request, detail[1]);
  }
  const status = path.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if (status) {
    if (method !== 'POST') throw new AppError('method_not_allowed', 405);
    return adminSetStatus(db, request, status[1]);
  }
  const revoke = path.match(/^\/api\/admin\/users\/([^/]+)\/revoke-sessions$/);
  if (revoke) {
    if (method !== 'POST') throw new AppError('method_not_allowed', 405);
    return adminRevokeSessions(db, request, revoke[1]);
  }

  // 未识别的管理员路径同样需要管理员身份，避免通过 404/403 差异探测路径。
  await requireAdmin(db, request, { allowPasswordChange: true });
  throw new AppError('not_found', 404);
}