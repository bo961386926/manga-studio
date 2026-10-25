import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  ensureMigrated,
  resetIdentityTables,
  startTestServer,
  insertUser,
  pool,
} from './helpers.js';
import { hashToken, randomToken } from '../auth/tokens.js';
import { canUseCapability, grantVip, revokeVip, countActiveAdmins } from '../auth/entitlements.js';
import { SESSION_COOKIE } from '../auth/session.js';

process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

let server;
let baseUrl;

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  ({ server, baseUrl } = await startTestServer());
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// Activate a user and create a session row; returns { userId, cookie, csrf }.
async function makeSession({ email, role = 'user', reauth = false }) {
  const userId = await insertUser({ email });
  await pool.query(
    `UPDATE users SET status = 'active', email_verified_at = NOW(), role = $2 WHERE id = $1`,
    [userId, role]
  );
  const token = randomToken(32);
  const csrf = randomToken(32);
  await pool.query(
    `INSERT INTO sessions
       (id, user_id, token_hash, session_version, csrf_token_hash, csrf_expires_at,
        expires_at, reauthenticated_at)
     VALUES (gen_random_uuid(), $1, $2, 1, $3, NOW() + interval '10 minutes',
             NOW() + interval '7 days', $4)`,
    [
      userId,
      hashToken(token),
      hashToken(csrf),
      reauth ? new Date() : null,
    ]
  );
  return { userId, cookie: `${SESSION_COOKIE}=${token}`, csrf };
}

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

test('verified user can use free capability but not VIP capability', async () => {
  const { userId } = await makeSession({ email: 'cap@example.com' });
  assert.equal(await canUseCapability({ userId, accessLevel: 'free' }), true);
  assert.equal(await canUseCapability({ userId, accessLevel: 'vip' }), false);

  await grantVip({ userId, expiresAt: null });
  assert.equal(await canUseCapability({ userId, accessLevel: 'vip' }), true);

  // Expired VIP must be denied.
  await grantVip({ userId, expiresAt: new Date(Date.now() - 1000) });
  assert.equal(await canUseCapability({ userId, accessLevel: 'vip' }), false);

  await revokeVip({ userId });
  assert.equal(await canUseCapability({ userId, accessLevel: 'vip' }), false);
});

test('admin routes require admin session and recent reauthentication', async () => {
  // Non-admin session gets 403 on admin routes.
  const user = await makeSession({ email: 'plain@example.com' });
  const forbidden = await request('/api/admin/users', { cookie: user.cookie });
  assert.equal(forbidden.status, 403);

  // Admin without reauth gets 403 on sensitive actions.
  const admin = await makeSession({ email: 'admin@example.com', role: 'admin', reauth: false });
  const noReauth = await request(`/api/admin/users/${user.userId}/disable`, {
    method: 'POST',
    cookie: admin.cookie,
    headers: { 'x-csrf-token': admin.csrf },
  });
  assert.equal(noReauth.status, 403);

  // Anonymity is rejected outright.
  const anon = await request('/api/admin/users');
  assert.equal(anon.status, 401);
});

test('admin can pause registration and grant/revoke VIP via API', async () => {
  const admin = await makeSession({ email: 'admin2@example.com', role: 'admin', reauth: true });
  const target = await makeSession({ email: 'target@example.com' });
  const headers = { 'x-csrf-token': admin.csrf };

  const pause = await request('/api/admin/registration', {
    method: 'PUT',
    cookie: admin.cookie,
    json: { open: false },
    headers,
  });
  assert.equal(pause.status, 200);
  const blocked = await request('/api/auth/register', {
    method: 'POST',
    json: { email: 'closed@example.com', password: '1234567890' },
  });
  assert.equal(blocked.status, 403);
  await request('/api/admin/registration', {
    method: 'PUT',
    cookie: admin.cookie,
    json: { open: true },
    headers,
  });

  const grant = await request(`/api/admin/users/${target.userId}/vip`, {
    method: 'POST',
    cookie: admin.cookie,
    json: { expiresAt: null },
    headers,
  });
  assert.equal(grant.status, 200);
  assert.equal(await canUseCapability({ userId: target.userId, accessLevel: 'vip' }), true);

  const revoke = await request(`/api/admin/users/${target.userId}/vip`, {
    method: 'DELETE',
    cookie: admin.cookie,
    headers,
  });
  assert.equal(revoke.status, 200);
  assert.equal(await canUseCapability({ userId: target.userId, accessLevel: 'vip' }), false);
});

test('cannot disable the last active admin', async () => {
  const admins = await countActiveAdmins();
  assert.equal(admins, 2); // admin@example.com + admin2@example.com
  const admin = await makeSession({ email: 'admin3@example.com', role: 'admin', reauth: true });

  // Disable the two pre-existing admins, leaving only admin3.
  for (const email of ['admin@example.com', 'admin2@example.com']) {
    const { rows } = await pool.query('SELECT id FROM users WHERE email_normalized = $1', [email]);
    const res = await request(`/api/admin/users/${rows[0].id}/disable`, {
      method: 'POST',
      cookie: admin.cookie,
      headers: { 'x-csrf-token': admin.csrf },
    });
    assert.equal(res.status, 200);
  }
  const { rows } = await pool.query('SELECT id FROM users WHERE email_normalized = $1', [
    'admin3@example.com',
  ]);
  const last = await request(`/api/admin/users/${rows[0].id}/disable`, {
    method: 'POST',
    cookie: admin.cookie,
    headers: { 'x-csrf-token': admin.csrf },
  });
  assert.equal(last.status, 409);
});
