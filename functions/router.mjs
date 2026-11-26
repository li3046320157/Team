import { AppError, applicationPath, errorJson, json, requireTrustedOrigin } from './http.mjs';
import {
  SessionRequired,
  bindPhone,
  changePassword,
  currentUser,
  loginAccount,
  logoutAccount,
  lookupRecovery,
  pingUsage,
  registerAccount,
  resetPassword,
  unauthorized,
  updateProfile,
  updateRecovery,
} from './accounts.mjs';
import { handleAdminRoute } from './admin.mjs';
import { shanghaiDay } from './validate.mjs';

const PUBLIC_ROUTES = new Set([
  'POST /api/register',
  'POST /api/login',
  'POST /api/logout',
  'POST /api/recovery/lookup',
  'POST /api/recovery/reset',
]);

async function route(db, request, origin, dayForNow) {
  requireTrustedOrigin(request, origin);
  const path = applicationPath(request);
  const method = request.method;
  const key = `${method} ${path}`;

  if (method === 'GET' && path === '/api/health') return json({ ok: true });
  if (PUBLIC_ROUTES.has(key)) {
    if (path === '/api/register') return registerAccount(db, request);
    if (path === '/api/login') return loginAccount(db, request);
    if (path === '/api/logout') return logoutAccount(db, request);
    if (path === '/api/recovery/lookup') return lookupRecovery(db, request);
    if (path === '/api/recovery/reset') return resetPassword(db, request);
  }

  if (method === 'GET' && path === '/api/me') return currentUser(db, request);
  if (method === 'POST' && path === '/api/account/profile') return updateProfile(db, request);
  if (method === 'POST' && path === '/api/account/phone') return bindPhone(db, request);
  if (method === 'POST' && path === '/api/account/password') return changePassword(db, request);
  if (method === 'POST' && path === '/api/account/recovery') return updateRecovery(db, request);
  if (method === 'POST' && path === '/api/usage/ping') return pingUsage(db, request, dayForNow);

  if (path.startsWith('/api/admin')) {
    const response = await handleAdminRoute(db, request, { path, method });
    if (response) return response;
  }

  if (path === '/api/health' || path === '/api/me' || path === '/api/register'
    || path === '/api/login' || path === '/api/logout' || path === '/api/recovery/lookup'
    || path === '/api/recovery/reset' || path === '/api/account/profile'
    || path === '/api/account/phone' || path === '/api/account/password'
    || path === '/api/account/recovery' || path === '/api/usage/ping') {
    throw new AppError('method_not_allowed', 405);
  }
  throw new AppError('not_found', 404);
}

export function createApplication({ db, origin, dayForNow = shanghaiDay }) {
  return async function handle(ctx) {
    try {
      return await route(db, ctx.request, typeof origin === 'function' ? origin() : origin, dayForNow);
    } catch (error) {
      if (error instanceof SessionRequired) return unauthorized(error.state);
      if (error instanceof AppError) return errorJson(error.code, error.status);
      return errorJson('service_unavailable', 503);
    }
  };
}