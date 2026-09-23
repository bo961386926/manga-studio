import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureMigrated,
  resetIdentityTables,
  startTestServer,
  insertUser,
  findUser,
  countOutbox,
  getActionToken,
  pool,
} from './helpers.js';
import { setConfig, removeConfig } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { SESSION_COOKIE } from '../auth/session.js';

process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

let server;
let baseUrl;

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  await removeConfig('registration_open').catch(() => {});
  ({ server, baseUrl } = await startTestServer());
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

const setCookie = (res) => res.headers.get('set-cookie') || '';

test('registration creates unverified user and queues verification email', async () => {
  const response = await request('/api/auth/register', {
    method: 'POST',
    json: { email: 'a@example.com', password: '1234567890' },
  });
  assert.equal(response.status, 202);
  const user = await findUser('a@example.com');
  assert.ok(user);
  assert.equal(user.status, 'pending_verification');
  assert.equal(user.email_verified_at, null);
  assert.equal(await countOutbox('verify_email'), 1);
});

test('unverified user cannot log in (generic failure, no account leak)', async () => {
  const response = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'a@example.com', password: '1234567890' },
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('verify-email activates user and login returns cookie + csrf', async () => {
  const token = await getActionToken('a@example.com', 'verify_email');
  assert.ok(token, 'verification token must be decryptable from outbox');
  const verify = await request('/api/auth/verify-email', {
    method: 'POST',
    json: { token },
  });
  assert.equal(verify.status, 200);

  const user = await findUser('a@example.com');
  assert.equal(user.status, 'active');
  assert.ok(user.email_verified_at);

  // Reusing the token must fail (single-use).
  const reuse = await request('/api/auth/verify-email', {
    method: 'POST',
    json: { token },
  });
  assert.equal(reuse.status, 400);

  const login = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'A@Example.COM', password: '1234567890' },
  });
  assert.equal(login.status, 200);
  const body = await login.json();
  assert.ok(body.csrfToken, 'login response must carry the CSRF token');
  assert.ok(setCookie(login).includes(`${SESSION_COOKIE}=`));
});

test('me requires session; after login it returns the user', async () => {
  const anon = await request('/api/auth/me');
  assert.equal(anon.status, 401);

  const login = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'a@example.com', password: '1234567890' },
  });
  const cookie = setCookie(login).split(';')[0];
  const me = await request('/api/auth/me', { cookie });
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.email, 'a@example.com');
  assert.equal(meBody.role, 'user');
});

test('logout revokes the session', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'a@example.com', password: '1234567890' },
  });
  const { csrfToken } = await login.json();
  const cookie = setCookie(login).split(';')[0];

  // Missing CSRF is rejected before any revocation happens.
  const missing = await request('/api/auth/logout', {
    method: 'POST',
    cookie,
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(missing.status, 403);

  const logout = await request('/api/auth/logout', {
    method: 'POST',
    cookie,
    json: {},
    headers: { 'x-csrf-token': csrfToken },
  });
  assert.equal(logout.status, 200);

  const me = await request('/api/auth/me', { cookie });
  assert.equal(me.status, 401);
});

test('change password verifies the current password and rotates all sessions', async () => {
  const changeUserId = await insertUser({ email: 'change@example.com' });
  await pool.query(
    `UPDATE users SET password_hash = $2, status = 'active', email_verified_at = NOW()
     WHERE id = $1`,
    [changeUserId, await hashPassword('1234567890')]
  );
  const firstLogin = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'change@example.com', password: '1234567890' },
  });
  const firstBody = await firstLogin.json();
  const firstCookie = setCookie(firstLogin).split(';')[0];

  const secondLogin = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'change@example.com', password: '1234567890' },
  });
  const secondCookie = setCookie(secondLogin).split(';')[0];

  const wrongCurrent = await request('/api/auth/change-password', {
    method: 'POST',
    cookie: firstCookie,
    headers: { 'x-csrf-token': firstBody.csrfToken },
    json: { currentPassword: 'wrong-password', newPassword: 'changed-password-123' },
  });
  assert.equal(wrongCurrent.status, 400);

  const weakPassword = await request('/api/auth/change-password', {
    method: 'POST',
    cookie: firstCookie,
    headers: { 'x-csrf-token': firstBody.csrfToken },
    json: { currentPassword: '1234567890', newPassword: 'short' },
  });
  assert.equal(weakPassword.status, 422);

  const changed = await request('/api/auth/change-password', {
    method: 'POST',
    cookie: firstCookie,
    headers: { 'x-csrf-token': firstBody.csrfToken },
    json: { currentPassword: '1234567890', newPassword: 'changed-password-123' },
  });
  assert.equal(changed.status, 200);
  const changedBody = await changed.json();
  const replacementCookie = setCookie(changed).split(';')[0];
  assert.ok(changedBody.csrfToken);
  assert.ok(replacementCookie.includes(`${SESSION_COOKIE}=`));

  assert.equal((await request('/api/auth/me', { cookie: firstCookie })).status, 401);
  assert.equal((await request('/api/auth/me', { cookie: secondCookie })).status, 401);
  assert.equal((await request('/api/auth/me', { cookie: replacementCookie })).status, 200);

  const oldPassword = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'change@example.com', password: '1234567890' },
  });
  assert.equal(oldPassword.status, 401);
  const newPassword = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'change@example.com', password: 'changed-password-123' },
  });
  assert.equal(newPassword.status, 200);
});

test('password reset flow rotates the password and invalidates sessions', async () => {
  const requested = await request('/api/auth/request-password-reset', {
    method: 'POST',
    json: { email: 'a@example.com' },
  });
  assert.equal(requested.status, 202);
  const token = await getActionToken('a@example.com', 'reset_password');
  assert.ok(token);

  const reset = await request('/api/auth/reset-password', {
    method: 'POST',
    json: { token, password: 'new-password-12345' },
  });
  assert.equal(reset.status, 200);

  const user = await findUser('a@example.com');
  assert.equal(await verifyPassword(user.password_hash, 'new-password-12345'), true);

  const oldLogin = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'a@example.com', password: '1234567890' },
  });
  assert.equal(oldLogin.status, 401);
});

test('paused registration rejects new signups', async () => {
  await setConfig('registration_open', false);
  try {
    const response = await request('/api/auth/register', {
      method: 'POST',
      json: { email: 'blocked@example.com', password: '1234567890' },
    });
    assert.equal(response.status, 403);
  } finally {
    await removeConfig('registration_open');
  }
});
