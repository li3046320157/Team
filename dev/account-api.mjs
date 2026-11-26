// 本地开发专用账户服务：复用真实路由与内存数据库，仅在回环地址生效。
import { createApplication } from '../functions/router.mjs';
import { hashPassword } from '../functions/passwords.mjs';
import { FakeDb } from '../tests/backend/fake-db.mjs';

const DEV_ORIGIN = 'https://moneyflow-eia97wm6wyg.qoder.zone';
const PREFIX = '/functions/v1/app';
const DEV_COOKIE = 'app_auth.session';
const SECURE_COOKIE = '__Host-app_auth.session';
const MAX_BODY_BYTES = 64 * 1024;

async function seedDatabase() {
  const db = new FakeDb();
  const now = new Date().toISOString();
  const secret = await hashPassword('123456', 1000);
  await db.from('users').insert({
    id: crypto.randomUUID(),
    username: 'root',
    username_lower: 'root',
    phone: null,
    role: 'admin',
    status: 'active',
    must_change_password: true,
    password_salt: secret.salt,
    password_hash: secret.hash,
    password_iterations: secret.iterations,
    recovery_question: null,
    recovery_answer_salt: null,
    recovery_answer_hash: null,
    created_at: now,
    updated_at: now,
    last_login_at: null,
    last_active_at: null,
    login_count: 0,
  });
  return db;
}

function toServerCookie(header) {
  return header.replace(/(^|;\s*)app_auth\.session=/g, (_match, lead) => `${lead}${SECURE_COOKIE}=`);
}

function toBrowserCookie(header) {
  return header.replace(SECURE_COOKIE, DEV_COOKIE).replace(/;\s*Secure/gi, '');
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export function createDevAccountApi() {
  let ready = null;

  async function app() {
    if (!ready) {
      ready = (async () => {
        const db = await seedDatabase();
        return { db, handle: createApplication({ db, origin: DEV_ORIGIN }) };
      })();
    }
    return ready;
  }

  async function reset() {
    const fresh = await seedDatabase();
    ready = Promise.resolve({ db: fresh, handle: createApplication({ db: fresh, origin: DEV_ORIGIN }) });
  }

  async function handle(request, response) {
    if (request.method === 'POST' && request.url === `${PREFIX}/__dev/reset`) {
      await reset();
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || name === 'host' || name === 'connection') continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    if (headers.has('cookie')) headers.set('cookie', toServerCookie(headers.get('cookie')));
    // 后端只信任固定 HTTPS 来源；本地开发在回环地址上代理请求并统一来源。
    headers.set('origin', DEV_ORIGIN);

    const body = await readBody(request);
    const upstream = new Request(`${DEV_ORIGIN}${request.url}`, {
      method: request.method,
      headers,
      body,
    });

    const { handle: route } = await app();
    const result = await route({ request: upstream });
    response.statusCode = result.status;
    for (const [name, value] of result.headers) {
      if (name.toLowerCase() === 'set-cookie') continue;
      response.setHeader(name, value);
    }
    const cookies = result.headers.getSetCookie().map(toBrowserCookie);
    if (cookies.length > 0) response.setHeader('set-cookie', cookies);
    const payload = Buffer.from(await result.arrayBuffer());
    response.setHeader('content-length', String(payload.length));
    response.end(payload);
  }

  return { handle };
}