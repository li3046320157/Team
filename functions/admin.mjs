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
const ADMIN_LIST_COLUMNS = 'id,username,status,must_change_password,created_at,updated_at,last_login_at,last_active_at,login_count';
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

// 初始管理员（最早创建的 admin）作为超级管理员，负责维护其他管理员账号。
async function rootAdminId(db) {
  const found = rows(await db.from('users').select('id').eq('role', 'admin')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1));
  return found[0]?.id ?? null;
}

async function requireRoot(db, request) {
  const context = await requireAdmin(db, request);
  const rootId = await rootAdminId(db);
  if (!rootId || context.user.id !== rootId) throw new AppError('forbidden', 403);
  return context;
}

function adminAccountSummary(row, { isRoot = false, activeSessions = 0 } = {}) {
  return {
    id: row.id,
    username: row.username,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    isRoot,
    mustChangePassword: row.must_change_password === true,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
    lastActiveAt: row.last_active_at ?? null,
    loginCount: Number.isSafeInteger(row.login_count) ? row.login_count : 0,
    activeSessions,
  };
}

function usageSummary(entry) {
  return {
    views: entry?.views ?? 0,
    activeDays: entry?.days?.size ?? 0,
    lastSeenAt: entry?.lastSeenAt ?? null,
  };
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

const COUNT_PAGE = 200;
const COUNT_MAX_PAGES = 50;

// 线上数据库网关对 count exact 支持不稳定，改为分页读取主键计数。
async function countRows(db, table, apply) {
  let total = 0;
  for (let page = 0; page < COUNT_MAX_PAGES; page += 1) {
    let query = db.from(table).select('id');
    if (apply) query = apply(query);
    const batch = rows(await query
      .order('id', { ascending: true })
      .range(total, total + COUNT_PAGE - 1));
    total += batch.length;
    if (batch.length < COUNT_PAGE) break;
  }
  return total;
}

async function fetchSafeUserById(db, id) {
  if (!id) return null;
  const found = rows(await db.from('users').select('id,username,role,status').eq('id', id).limit(1));
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

const USAGE_DAY_PAGE = 100;
const USAGE_DAY_MAX_PAGES = 10;

// 线上数据库网关不接受超大范围查询，使用记录按天分页读取。
async function usageOfDay(db, day) {
  const collected = [];
  for (let page = 0; page < USAGE_DAY_MAX_PAGES; page += 1) {
    const from = page * USAGE_DAY_PAGE;
    const batch = rows(await db.from('usage_daily')
      .select('user_id,day,views,last_seen_at')
      .eq('day', day)
      .order('user_id', { ascending: true })
      .range(from, from + USAGE_DAY_PAGE - 1));
    collected.push(...batch);
    if (batch.length < USAGE_DAY_PAGE) return { usage: collected, complete: true };
  }
  return { usage: collected, complete: false };
}

async function activityWindow(db, today, days = 7) {
  const start = shiftDay(today, -(days - 1));
  const dayList = Array.from({ length: days }, (_, offset) => shiftDay(start, offset));
  const daily = await Promise.all(dayList.map((day) => usageOfDay(db, day)));
  const usage = daily.flatMap((result) => result.usage);

  const byDay = new Map();
  for (let offset = 0; offset < days; offset += 1) {
    const day = shiftDay(start, offset);
    byDay.set(day, { day, users: new Set(), views: 0 });
  }
  const perUser = new Map();
  for (const row of usage) {
    const bucket = byDay.get(row.day);
    if (!bucket) continue;
    const views = Number.isSafeInteger(row.views) ? row.views : 0;
    if (typeof row.user_id === 'string') {
      bucket.users.add(row.user_id);
      const entry = perUser.get(row.user_id) ?? { views: 0, days: new Set(), lastSeenAt: null };
      entry.views += views;
      entry.days.add(row.day);
      if (typeof row.last_seen_at === 'string' && (!entry.lastSeenAt || row.last_seen_at > entry.lastSeenAt)) {
        entry.lastSeenAt = row.last_seen_at;
      }
      perUser.set(row.user_id, entry);
    }
    bucket.views += views;
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
    perUser,
    complete: daily.every((result) => result.complete),
  };
}

export async function adminOverview(db, request) {
  await requireAdmin(db, request);
  const today = shanghaiDay();
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [totalUsers, disabledUsers, newUsers, totalAdmins, activity, recentUsers, recentLoginEvents, recentEventRows] = await Promise.all([
    countRows(db, 'users', (query) => query.eq('role', 'user')),
    countRows(db, 'users', (query) => query.eq('role', 'user').eq('status', 'disabled')),
    countRows(db, 'users', (query) => query.eq('role', 'user').gte('created_at', sevenDaysAgoIso)),
    countRows(db, 'users', (query) => query.eq('role', 'admin')),
    activityWindow(db, today, 14),
    db.from('users').select(USER_LIST_COLUMNS).eq('role', 'user')
      .order('created_at', { ascending: false }).limit(5).then(rows),
    db.from('auth_events').select('id,user_id,kind,at,user_agent').eq('kind', 'login')
      .order('at', { ascending: false }).limit(20).then(rows),
    db.from('auth_events').select('id,user_id,actor_id,kind,at,user_agent')
      .order('at', { ascending: false }).limit(24).then(rows),
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

  const usageTop = [];
  const ranked = [...activity.perUser.entries()].sort((left, right) => right[1].views - left[1].views);
  for (const [userId, entry] of ranked) {
    if (usageTop.length >= 6) break;
    try {
      const user = await fetchSafeUserById(db, userId);
      if (!user || user.role !== 'user') continue;
      usageTop.push({
        userId,
        username: user.username,
        status: user.status === 'disabled' ? 'disabled' : 'active',
        ...usageSummary(entry),
      });
    } catch {
      continue;
    }
  }

  const actors = await actorNames(db, recentEventRows);
  const nameCache = new Map();
  const nameOf = async (id) => {
    if (!id) return null;
    if (!nameCache.has(id)) nameCache.set(id, await fetchSafeUserById(db, id).catch(() => null));
    return nameCache.get(id);
  };
  const recentEvents = [];
  for (const event of recentEventRows) {
    if (recentEvents.length >= 10) break;
    const target = await nameOf(event.user_id);
    if (!target) continue;
    recentEvents.push({
      id: event.id,
      kind: event.kind,
      username: target.username,
      actorName: event.actor_id ? actors.get(event.actor_id) ?? null : null,
      at: event.at,
      userAgent: event.user_agent ?? null,
    });
  }

  const todayBucket = activity.days.find((day) => day.day === today);
  const last7 = activity.days.slice(-7);
  const start7 = shiftDay(today, -6);
  let active7d = 0;
  for (const entry of activity.perUser.values()) {
    for (const day of entry.days) {
      if (day >= start7) {
        active7d += 1;
        break;
      }
    }
  }

  return json({
    generatedAt: new Date().toISOString(),
    stats: {
      totalUsers,
      disabledUsers,
      newUsers7d: newUsers,
      activeToday: todayBucket?.activeUsers ?? 0,
      active7d,
      viewsToday: todayBucket?.views ?? 0,
      views7d: last7.reduce((sum, day) => sum + day.views, 0),
      totalAdmins,
    },
    activity: { days: activity.days, complete: activity.complete },
    usageTop,
    recentUsers: recentUsers.map(adminSummary),
    recentLogins,
    recentEvents,
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
  const today = shanghaiDay();
  const usage = await activityWindow(db, today, 7);
  const decorate = (row) => ({
    ...adminSummary(row),
    usage7d: usageSummary(usage.perUser.get(row.id)),
  });

  if (query) {
    const { list, truncated } = await searchUsers(db, query);
    const from = (page - 1) * PAGE_SIZE;
    return json({
      items: list.slice(from, from + PAGE_SIZE).map(decorate),
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
    items: list.map(decorate),
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
  const [activeSessions, events, rootId] = await Promise.all([
    countActiveSessions(db, user.id),
    db.from('auth_events').select('id,kind,at,user_agent')
      .eq('user_id', user.id).order('at', { ascending: false }).limit(10).then(rows),
    rootAdminId(db),
  ]);
  return json({
    admin: {
      ...toPublicUser(user),
      lastActiveAt: user.last_active_at ?? null,
      loginCount: Number.isSafeInteger(user.login_count) ? user.login_count : 0,
    },
    isRoot: Boolean(rootId && rootId === user.id),
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

export async function adminTeam(db, request) {
  const { user } = await requireAdmin(db, request);
  const rootId = await rootAdminId(db);
  const list = rows(await db.from('users').select(ADMIN_LIST_COLUMNS).eq('role', 'admin')
    .order('created_at', { ascending: true }).limit(50));
  const items = await Promise.all(list.map(async (row) => {
    let activeSessions = 0;
    try {
      activeSessions = await countActiveSessions(db, row.id);
    } catch {
      activeSessions = 0;
    }
    return adminAccountSummary(row, { isRoot: row.id === rootId, activeSessions });
  }));
  return json({
    you: { id: user.id, isRoot: Boolean(rootId && rootId === user.id) },
    items,
  });
}

export async function adminCreateAdmin(db, request) {
  const { user: actor } = await requireRoot(db, request);
  const limit = await consume(db, 'admin_manage', actor.id);
  if (!limit.allowed) {
    return errorJson('rate_limited', 429, {
      'retry-after': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))),
    });
  }

  const body = await readJson(request);
  const { username, usernameLower } = parseUsername(body?.username, { allowReserved: true });
  const password = validateAdminPassword(body?.password);

  const existing = rows(await db.from('users').select('id').eq('username_lower', usernameLower).limit(1));
  if (existing.length > 0) return errorJson('username_taken', 409);

  const derived = await hashPassword(password);
  const nowIso = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    username,
    username_lower: usernameLower,
    phone: null,
    role: 'admin',
    status: 'active',
    must_change_password: true,
    password_salt: derived.salt,
    password_hash: derived.hash,
    password_iterations: derived.iterations,
    recovery_question: null,
    recovery_answer_salt: null,
    recovery_answer_hash: null,
    created_at: nowIso,
    updated_at: nowIso,
    last_login_at: null,
    last_active_at: null,
    login_count: 0,
  };

  let created;
  try {
    created = await db.from('users').insertIfAbsent(row, { onConflict: 'username_lower' }).select(ADMIN_LIST_COLUMNS);
  } catch {
    return errorJson('admin_create_unconfirmed', 503);
  }
  if (created.error) {
    const winner = rows(await db.from('users').select('id').eq('username_lower', usernameLower).limit(1));
    if (winner.length > 0) return errorJson('username_taken', 409);
    return errorJson('admin_create_unconfirmed', 503);
  }
  if (!Array.isArray(created.data) || created.data.length !== 1) {
    const winner = rows(await db.from('users').select('id').eq('username_lower', usernameLower).limit(1));
    if (winner.length > 0) return errorJson('username_taken', 409);
    return errorJson('admin_create_unconfirmed', 503);
  }

  const admin = created.data[0];
  await recordEvent(db, {
    userId: admin.id,
    actorId: actor.id,
    kind: 'admin_created',
    userAgent: userAgentOf(request),
  });
  return json({ admin: adminAccountSummary(admin, { isRoot: false, activeSessions: 0 }) }, 201);
}

export async function adminSetAdminStatus(db, request, id) {
  const { user: actor } = await requireRoot(db, request);
  if (!isUuid(id)) return errorJson('admin_not_found', 404);
  if (id === actor.id) return errorJson('admin_cannot_disable_self', 409);
  const rootId = await rootAdminId(db);
  if (id === rootId) return errorJson('admin_root_protected', 409);

  const body = await readJson(request);
  const status = body?.status;
  if (status !== 'active' && status !== 'disabled') throw new AppError('invalid_input', 400);

  const found = rows(await db.from('users').select(ADMIN_LIST_COLUMNS)
    .eq('id', id).eq('role', 'admin').limit(1));
  if (found.length !== 1) return errorJson('admin_not_found', 404);
  const target = found[0];
  let activeSessions = 0;
  try {
    activeSessions = await countActiveSessions(db, id);
  } catch {
    activeSessions = 0;
  }
  if (target.status === status) {
    return json({
      admin: adminAccountSummary(target, { isRoot: false, activeSessions }),
      sessionsRevoked: 0,
    });
  }

  let updated;
  try {
    updated = await db.from('users').update({
      status,
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('role', 'admin').select(ADMIN_LIST_COLUMNS);
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
    actorId: actor.id,
    kind: status === 'disabled' ? 'admin_disabled' : 'admin_enabled',
    userAgent: userAgentOf(request),
  });
  return json({
    admin: adminAccountSummary(updated.data[0], {
      isRoot: false,
      activeSessions: status === 'disabled' ? 0 : sessionsRevoked > 0 ? sessionsRevoked : activeSessions,
    }),
    sessionsRevoked,
  });
}

export async function adminRevokeAdminSessions(db, request, id) {
  const { user: actor } = await requireRoot(db, request);
  if (!isUuid(id)) return errorJson('admin_not_found', 404);
  if (id === actor.id) return errorJson('admin_cannot_disable_self', 409);
  const found = rows(await db.from('users').select('id').eq('id', id).eq('role', 'admin').limit(1));
  if (found.length !== 1) return errorJson('admin_not_found', 404);

  let sessionsRevoked = 0;
  try {
    sessionsRevoked = await revokeAllSessions(db, id);
  } catch {
    return errorJson('service_unavailable', 503);
  }
  await recordEvent(db, {
    userId: id,
    actorId: actor.id,
    kind: 'admin_sessions_revoked',
    userAgent: userAgentOf(request),
  });
  return json({ ok: true, sessionsRevoked });
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
  if (path === '/api/admin/admins') {
    if (method === 'GET') return adminTeam(db, request);
    if (method === 'POST') return adminCreateAdmin(db, request);
    throw new AppError('method_not_allowed', 405);
  }
  if (path === '/api/admin/credentials') {
    if (method !== 'POST') throw new AppError('method_not_allowed', 405);
    return adminCredentials(db, request);
  }

  const adminStatus = path.match(/^\/api\/admin\/admins\/([^/]+)\/status$/);
  if (adminStatus) {
    if (method !== 'POST') throw new AppError('method_not_allowed', 405);
    return adminSetAdminStatus(db, request, adminStatus[1]);
  }
  const adminRevoke = path.match(/^\/api\/admin\/admins\/([^/]+)\/revoke-sessions$/);
  if (adminRevoke) {
    if (method !== 'POST') throw new AppError('method_not_allowed', 405);
    return adminRevokeAdminSessions(db, request, adminRevoke[1]);
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