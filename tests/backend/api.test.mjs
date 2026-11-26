import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeDb } from './fake-db.mjs';
import { createApplication } from '../../functions/router.mjs';
import { hashPassword } from '../../functions/passwords.mjs';
import { consume } from '../../functions/limiter.mjs';
import { shanghaiDay } from '../../functions/validate.mjs';

const ORIGIN = 'https://moneyflow.test';
const ADMIN_PASSWORD = '123456';
const ADMIN_NEW_PASSWORD = 'LedgerRoot2026';

function cookieOf(response) {
  const header = response.headers.get('set-cookie');
  assert.ok(header, 'expected a set-cookie header');
  return header.split(';')[0];
}

async function jsonOf(response) {
  return response.json();
}

async function call(app, path, { method = 'GET', origin = ORIGIN, body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  const request = new Request(`${ORIGIN}/functions/v1/app${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return app({ request });
}

test('云端账户与管理员契约', async (t) => {
  const today = shanghaiDay();
  const nowIso = new Date().toISOString();
  const adminId = crypto.randomUUID();
  const adminSecret = await hashPassword(ADMIN_PASSWORD, 1000);
  const db = new FakeDb({
    users: [{
      id: adminId,
      username: 'root',
      username_lower: 'root',
      phone: null,
      role: 'admin',
      status: 'active',
      must_change_password: true,
      password_salt: adminSecret.salt,
      password_hash: adminSecret.hash,
      password_iterations: adminSecret.iterations,
      recovery_question: null,
      recovery_answer_salt: null,
      recovery_answer_hash: null,
      created_at: nowIso,
      updated_at: nowIso,
      last_login_at: null,
      last_active_at: null,
      login_count: 0,
    }],
  });
  const app = createApplication({ db, origin: ORIGIN, dayForNow: () => today });
  let adminCookie = '';
  let adminUser = null;
  let userCookie = '';
  let userId = '';
  let username = 'alice';
  let password = 'alice123';

  await t.test('来源校验拒绝伪造 Origin', async () => {
    const response = await call(app, '/api/login', {
      method: 'POST',
      origin: 'https://evil.example',
      body: { identifier: 'root', password: ADMIN_PASSWORD },
    });
    assert.equal(response.status, 403);
    assert.equal((await jsonOf(response)).error, 'origin_forbidden');
  });

  await t.test('初始管理员登录后必须修改密码才能进入控制台', async () => {
    const login = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: 'root', password: ADMIN_PASSWORD },
    });
    assert.equal(login.status, 200);
    const cookie = cookieOf(login);
    assert.match(cookie, /^__Host-app_auth\.session=/);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    assert.match(login.headers.get('set-cookie'), /Secure/);
    assert.match(login.headers.get('set-cookie'), /SameSite=Lax/);
    assert.match(login.headers.get('set-cookie'), /Max-Age=14400/);
    const payload = await jsonOf(login);
    assert.equal(payload.user.role, 'admin');
    assert.equal(payload.user.username, 'root');
    assert.equal(payload.user.mustChangePassword, true);
    assert.equal(payload.user.passwordHash, undefined);
    adminCookie = cookie;
    adminUser = payload.user;

    const me = await call(app, '/api/me', { cookie: adminCookie });
    assert.equal(me.status, 200);
    assert.equal((await jsonOf(me)).user.mustChangePassword, true);

    const overview = await call(app, '/api/admin/overview', { cookie: adminCookie });
    assert.equal(overview.status, 403);
    assert.equal((await jsonOf(overview)).error, 'admin_password_change_required');
  });

  await t.test('管理员可同时修改自己的用户名和密码', async () => {
    const wrong = await call(app, '/api/admin/credentials', {
      method: 'POST',
      cookie: adminCookie,
      body: { currentPassword: 'not-the-password', newPassword: ADMIN_NEW_PASSWORD },
    });
    assert.equal(wrong.status, 400);
    assert.equal((await jsonOf(wrong)).error, 'current_password_incorrect');

    const weak = await call(app, '/api/admin/credentials', {
      method: 'POST',
      cookie: adminCookie,
      body: { currentPassword: ADMIN_PASSWORD, newPassword: 'short1' },
    });
    assert.equal(weak.status, 400);
    assert.equal((await jsonOf(weak)).error, 'weak_admin_password');

    const changed = await call(app, '/api/admin/credentials', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        currentPassword: ADMIN_PASSWORD,
        username: 'ledger-root',
        newPassword: ADMIN_NEW_PASSWORD,
      },
    });
    assert.equal(changed.status, 200);
    const payload = await jsonOf(changed);
    assert.equal(payload.user.username, 'ledger-root');
    assert.equal(payload.user.mustChangePassword, false);
    assert.equal(payload.otherSessionsRevoked, 0);

    const me = await call(app, '/api/me', { cookie: adminCookie });
    assert.equal(me.status, 200);
    assert.equal((await jsonOf(me)).user.username, 'ledger-root');

    const overview = await call(app, '/api/admin/overview', { cookie: adminCookie });
    assert.equal(overview.status, 200);
    const overviewPayload = await jsonOf(overview);
    assert.equal(overviewPayload.stats.totalUsers, 0);
    assert.equal(overviewPayload.stats.newUsers7d, 0);

    const oldLogin = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: 'root', password: ADMIN_PASSWORD },
    });
    assert.equal(oldLogin.status, 401);

    const oldPassword = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: 'ledger-root', password: ADMIN_PASSWORD },
    });
    assert.equal(oldPassword.status, 401);

    const newLogin = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: 'ledger-root', password: ADMIN_NEW_PASSWORD },
    });
    assert.equal(newLogin.status, 200);
    const newPayload = await jsonOf(newLogin);
    assert.equal(newPayload.user.role, 'admin');
    assert.equal(newPayload.user.mustChangePassword, false);
    adminCookie = cookieOf(newLogin);

    const security = await call(app, '/api/admin/security', { cookie: adminCookie });
    assert.equal(security.status, 200);
    const securityPayload = await jsonOf(security);
    assert.equal(securityPayload.admin.username, 'ledger-root');
    assert.ok(securityPayload.activeSessions >= 1);
    assert.ok(Array.isArray(securityPayload.events));
    assert.equal(JSON.stringify(securityPayload).includes('password_hash'), false);
  });

  await t.test('普通用户注册、登录与管理员边界', async () => {
    const reserved = await call(app, '/api/register', {
      method: 'POST',
      body: {
        username: 'root',
        password: 'alice123',
        recovery: { question: '我的第一只宠物叫什么名字？', answer: 'blue' },
      },
    });
    assert.equal(reserved.status, 409);

    const registered = await call(app, '/api/register', {
      method: 'POST',
      body: {
        username,
        password,
        phone: '13800001234',
        recovery: { question: '我的第一只宠物叫什么名字？', answer: 'blue' },
      },
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.headers.get('set-cookie'), null);
    const registeredPayload = await jsonOf(registered);
    userId = registeredPayload.user.id;
    assert.equal(registeredPayload.user.role, 'user');
    assert.equal(registeredPayload.user.mustChangePassword, false);
    assert.equal(registeredPayload.user.recoveryQuestion, '我的第一只宠物叫什么名字？');

    const duplicate = await call(app, '/api/register', {
      method: 'POST',
      body: { username: 'ALICE', password: 'another123' },
    });
    assert.equal(duplicate.status, 409);

    const login = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: '13800001234', password },
    });
    assert.equal(login.status, 200);
    const loginPayload = await jsonOf(login);
    assert.equal(loginPayload.user.role, 'user');
    assert.match(login.headers.get('set-cookie'), /Max-Age=43200/);
    userCookie = cookieOf(login);

    const forbidden = await call(app, '/api/admin/overview', { cookie: userCookie });
    assert.equal(forbidden.status, 403);
    assert.equal((await jsonOf(forbidden)).error, 'forbidden');

    const adminDetail = await call(app, `/api/admin/users/${adminId}`, { cookie: adminCookie });
    assert.equal(adminDetail.status, 404);

    const selfStatus = await call(app, `/api/admin/users/${adminId}/status`, {
      method: 'POST',
      cookie: adminCookie,
      body: { status: 'disabled' },
    });
    assert.equal(selfStatus.status, 409);
    assert.equal((await jsonOf(selfStatus)).error, 'admin_cannot_disable_self');
  });

  await t.test('管理员列表、搜索、详情与使用统计', async () => {
    const list = await call(app, '/api/admin/users', { cookie: adminCookie });
    assert.equal(list.status, 200);
    const listPayload = await jsonOf(list);
    assert.equal(listPayload.total, 1);
    assert.equal(listPayload.items[0].username, username);
    assert.equal(listPayload.items[0].phoneMasked, '138****1234');

    const byName = await call(app, '/api/admin/users?q=ali', { cookie: adminCookie });
    assert.equal((await jsonOf(byName)).items.length, 1);

    const byPhone = await call(app, '/api/admin/users?q=1380000', { cookie: adminCookie });
    assert.equal((await jsonOf(byPhone)).items.length, 1);

    const first = await call(app, '/api/usage/ping', { method: 'POST', cookie: userCookie });
    assert.equal((await jsonOf(first)).tracked, true);
    const second = await call(app, '/api/usage/ping', { method: 'POST', cookie: userCookie });
    assert.equal((await jsonOf(second)).tracked, true);

    const overview = await call(app, '/api/admin/overview', { cookie: adminCookie });
    const stats = (await jsonOf(overview)).stats;
    assert.equal(stats.totalUsers, 1);
    assert.equal(stats.newUsers7d, 1);
    assert.equal(stats.activeToday, 1);
    assert.equal(stats.active7d, 1);

    const detail = await call(app, `/api/admin/users/${userId}`, { cookie: adminCookie });
    assert.equal(detail.status, 200);
    const detailPayload = await jsonOf(detail);
    assert.equal(detailPayload.user.username, username);
    assert.equal(detailPayload.user.phone, '13800001234');
    assert.equal(detailPayload.activeSessions, 1);
    assert.equal(detailPayload.usage.activeDays30d, 1);
    assert.equal(detailPayload.usage.totalViews30d, 2);
    assert.equal(detailPayload.usage.daily.at(-1).views, 2);
    assert.ok(detailPayload.events.some((event) => event.kind === 'register'));
    assert.ok(detailPayload.events.some((event) => event.kind === 'login'));
    assert.equal(JSON.stringify(detailPayload).includes('password'), false);
    assert.equal(JSON.stringify(detailPayload).includes('recovery_answer'), false);
  });

  await t.test('管理员停用、启用与强制下线普通用户', async () => {
    const disabled = await call(app, `/api/admin/users/${userId}/status`, {
      method: 'POST',
      cookie: adminCookie,
      body: { status: 'disabled' },
    });
    assert.equal(disabled.status, 200);
    const disabledPayload = await jsonOf(disabled);
    assert.equal(disabledPayload.user.status, 'disabled');
    assert.equal(disabledPayload.sessionsRevoked, 1);

    const blocked = await call(app, '/api/me', { cookie: userCookie });
    assert.equal(blocked.status, 401);
    assert.match(blocked.headers.get('set-cookie'), /Max-Age=0/);

    const loginBlocked = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: username, password },
    });
    assert.equal(loginBlocked.status, 403);
    assert.equal((await jsonOf(loginBlocked)).error, 'account_disabled');

    const enabled = await call(app, `/api/admin/users/${userId}/status`, {
      method: 'POST',
      cookie: adminCookie,
      body: { status: 'active' },
    });
    assert.equal(enabled.status, 200);
    assert.equal((await jsonOf(enabled)).user.status, 'active');

    const login = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: username, password },
    });
    assert.equal(login.status, 200);
    userCookie = cookieOf(login);

    const revoked = await call(app, `/api/admin/users/${userId}/revoke-sessions`, {
      method: 'POST',
      cookie: adminCookie,
    });
    assert.equal(revoked.status, 200);
    assert.equal((await jsonOf(revoked)).sessionsRevoked, 1);

    const afterRevoke = await call(app, '/api/me', { cookie: userCookie });
    assert.equal(afterRevoke.status, 401);

    const relogin = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: username, password },
    });
    userCookie = cookieOf(relogin);
  });

  await t.test('用户修改密码后撤销全部会话', async () => {
    const changed = await call(app, '/api/account/password', {
      method: 'POST',
      cookie: userCookie,
      body: { currentPassword: password, newPassword: 'alice456' },
    });
    assert.equal(changed.status, 200);
    const changedPayload = await jsonOf(changed);
    assert.equal(changedPayload.ok, true);
    assert.equal(changedPayload.sessionsRevoked, 1);
    password = 'alice456';

    const stale = await call(app, '/api/me', { cookie: userCookie });
    assert.equal(stale.status, 401);
    const oldLogin = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: username, password: 'alice123' },
    });
    assert.equal(oldLogin.status, 401);
    const newLogin = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: username, password },
    });
    assert.equal(newLogin.status, 200);
    userCookie = cookieOf(newLogin);
  });

  await t.test('找回入口不会暴露管理员账户', async () => {
    const adminLookup = await call(app, '/api/recovery/lookup', {
      method: 'POST',
      body: { identifier: 'ledger-root' },
    });
    assert.equal(adminLookup.status, 200);
    assert.equal((await jsonOf(adminLookup)).found, false);

    const oldAdminLookup = await call(app, '/api/recovery/lookup', {
      method: 'POST',
      body: { identifier: 'root' },
    });
    assert.equal((await jsonOf(oldAdminLookup)).found, false);

    const adminReset = await call(app, '/api/recovery/reset', {
      method: 'POST',
      body: { identifier: 'ledger-root', answer: 'blue', newPassword: 'SomeoneElse2026' },
    });
    assert.equal(adminReset.status, 404);

    const found = await call(app, '/api/recovery/lookup', {
      method: 'POST',
      body: { identifier: username },
    });
    assert.equal(found.status, 200);
    const foundPayload = await jsonOf(found);
    assert.equal(foundPayload.found, true);
    assert.equal(foundPayload.account.maskedPhone, '138****1234');

    const wrongAnswer = await call(app, '/api/recovery/reset', {
      method: 'POST',
      body: { identifier: username, answer: 'red', newPassword: 'alice789' },
    });
    assert.equal(wrongAnswer.status, 400);
    assert.equal((await jsonOf(wrongAnswer)).error, 'invalid_recovery_answer');

    const reset = await call(app, '/api/recovery/reset', {
      method: 'POST',
      body: { identifier: username, answer: 'BLUE', newPassword: 'alice789' },
    });
    assert.equal(reset.status, 200);
    assert.equal((await jsonOf(reset)).username, username);

    const oldSession = await call(app, '/api/me', { cookie: userCookie });
    assert.equal(oldSession.status, 401);
    const login = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: username, password: 'alice789' },
    });
    assert.equal(login.status, 200);
  });

  await t.test('自定义找回问题可注册、找回并校验长度', async () => {
    const question = '我小时候养的金鱼叫什么名字？';
    const registered = await call(app, '/api/register', {
      method: 'POST',
      body: {
        username: 'bob',
        password: 'bob12345',
        recovery: { question: `  ${question}  `, answer: '泡泡' },
      },
    });
    assert.equal(registered.status, 201);
    assert.equal((await jsonOf(registered)).user.recoveryQuestion, question);

    const found = await call(app, '/api/recovery/lookup', {
      method: 'POST',
      body: { identifier: 'bob' },
    });
    assert.equal(found.status, 200);
    const foundPayload = await jsonOf(found);
    assert.equal(foundPayload.found, true);
    assert.equal(foundPayload.account.recoveryQuestion, question);

    const reset = await call(app, '/api/recovery/reset', {
      method: 'POST',
      body: { identifier: 'bob', answer: '泡泡', newPassword: 'bob45678' },
    });
    assert.equal(reset.status, 200);

    const login = await call(app, '/api/login', {
      method: 'POST',
      body: { identifier: 'bob', password: 'bob45678' },
    });
    assert.equal(login.status, 200);
    const bobCookie = cookieOf(login);

    const tooShort = await call(app, '/api/account/recovery', {
      method: 'POST',
      cookie: bobCookie,
      body: {
        currentPassword: 'bob45678',
        recovery: { question: '问', answer: '泡泡' },
      },
    });
    assert.equal(tooShort.status, 400);
    assert.equal((await jsonOf(tooShort)).error, 'invalid_recovery');
  });

  await t.test('固定窗口限流按窗口放行与拦截', async () => {
    const now = Date.now();
    for (let index = 0; index < 10; index += 1) {
      const result = await consume(db, 'login', 'direct-limit', now);
      assert.equal(result.allowed, true);
    }
    const limited = await consume(db, 'login', 'direct-limit', now);
    assert.equal(limited.allowed, false);
    assert.ok(limited.retryAfterMs > 0);
    const reset = await consume(db, 'login', 'direct-limit', now + 15 * 60 * 1000 + 1);
    assert.equal(reset.allowed, true);
  });
});