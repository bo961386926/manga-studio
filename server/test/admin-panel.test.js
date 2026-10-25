// Admin panel endpoints: stats overview, registration switch with
// reauthentication gating, and VIP grant via the admin API.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureMigrated,
  resetIdentityTables,
  startTestServer,
  pool,
} from './helpers.js';
import { hashPassword } from '../auth/password.js';

process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

let server;
let baseUrl;

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  ({ server, baseUrl } = await startTestServer());
  // admin + normal verified users
  await pool.query(
    `INSERT INTO users (id, email, email_normalized, password_hash, role, status, email_verified_at)
     VALUES (gen_random_uuid(), 'admin@example.com', 'admin@example.com', $1, 'admin', 'active', NOW())`,
    [await hashPassword('AdminPass123')]
  );
  await pool.query(
    `INSERT INTO users (id, email, email_normalized, password_hash, role, status, email_verified_at)
     VALUES (gen_random_uuid(), 'user@example.com', 'user@example.com', $1, 'user', 'active', NOW())`,
    [await hashPassword('UserPass123')]
  );
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const request = (path, { method = 'GET', json, cookie, headers = {} } = {}) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

const login = async (email, password) => {
  const res = await request('/api/auth/login', { method: 'POST', json: { email, password } });
  assert.equal(res.status, 200);
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const body = await res.json();
  return { cookie, csrf: body.csrfToken };
};

test('non-admin cannot read the ops overview', async () => {
  const { cookie } = await login('user@example.com', 'UserPass123');
  const res = await request('/api/admin/stats/overview', { cookie });
  assert.equal(res.status, 403);
});

test('admin reads the ops overview counters', async () => {
  const { cookie } = await login('admin@example.com', 'AdminPass123');
  const res = await request('/api/admin/stats/overview', { cookie });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.users_total >= 2);
  assert.ok(body.users_verified >= 2);
  assert.equal(typeof body.failure_rate_24h, 'number');
  assert.ok(body.projects_total >= 0);
});

test('admin registration switch requires reauthentication', async () => {
  const { cookie, csrf } = await login('admin@example.com', 'AdminPass123');
  const get1 = await request('/api/admin/registration', { cookie });
  assert.equal((await get1.json()).open, true);

  // Sensitive action without recent reauthentication → 403.
  const put1 = await request('/api/admin/registration', {
    method: 'PUT',
    json: { open: false },
    cookie,
    headers: { 'x-csrf-token': csrf },
  });
  assert.equal(put1.status, 403);
  assert.match((await put1.json()).error, /reauth/i);

  // Wrong password does not unlock it.
  const bad = await request('/api/auth/reauthenticate', {
    method: 'POST',
    json: { password: 'WrongPass123' },
    cookie,
    headers: { 'x-csrf-token': csrf },
  });
  assert.equal(bad.status, 401);

  // Correct reauthentication unlocks it.
  const reauth = await request('/api/auth/reauthenticate', {
    method: 'POST',
    json: { password: 'AdminPass123' },
    cookie,
    headers: { 'x-csrf-token': csrf },
  });
  assert.equal(reauth.status, 200);

  const put2 = await request('/api/admin/registration', {
    method: 'PUT',
    json: { open: false },
    cookie,
    headers: { 'x-csrf-token': csrf },
  });
  assert.equal(put2.status, 200);
  const get2 = await request('/api/admin/registration', { cookie });
  assert.equal((await get2.json()).open, false);

  // Restore for other tests.
  const put3 = await request('/api/admin/registration', {
    method: 'PUT',
    json: { open: true },
    cookie,
    headers: { 'x-csrf-token': csrf },
  });
  assert.equal(put3.status, 200);
});

test('admin grants and revokes VIP through the API', async () => {
  const { cookie, csrf } = await login('admin@example.com', 'AdminPass123');
  const headers = { 'x-csrf-token': csrf };
  // 敏感操作：先重新认证解锁 15 分钟窗口
  const reauth = await request('/api/auth/reauthenticate', {
    method: 'POST',
    json: { password: 'AdminPass123' },
    cookie,
    headers,
  });
  assert.equal(reauth.status, 200);
  const users = await (await request('/api/admin/users?q=user@example', { cookie })).json();
  const target = users.users.find((u) => u.email === 'user@example.com');
  assert.ok(target);

  const grant = await request(`/api/admin/users/${target.id}/vip`, {
    method: 'POST',
    json: { expiresAt: new Date(Date.now() + 864e5).toISOString() },
    cookie,
    headers,
  });
  assert.equal(grant.status, 200);

  const revoked = await request(`/api/admin/users/${target.id}/vip`, {
    method: 'DELETE',
    cookie,
    headers,
  });
  assert.equal(revoked.status, 200);
});
