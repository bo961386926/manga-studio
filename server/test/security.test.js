import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureMigrated,
  resetIdentityTables,
  insertUser,
  startTestServer,
  pool,
} from './helpers.js';
import { hashToken, randomToken } from '../auth/tokens.js';
import { SESSION_COOKIE } from '../auth/session.js';
import { getAllowedOrigins } from '../auth/middleware.js';

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

// Insert an active user and a session row; returns the browser cookie value.
async function sessionCookieFor(email) {
  const userId = await insertUser({ email });
  await pool.query(
    `UPDATE users SET status = 'active', email_verified_at = NOW() WHERE id = $1`,
    [userId]
  );
  const token = randomToken(32);
  await pool.query(
    `INSERT INTO sessions
       (id, user_id, token_hash, session_version, csrf_token_hash, csrf_expires_at, expires_at)
     VALUES (gen_random_uuid(), $1, $2, 1, $3, NOW() + interval '10 minutes', NOW() + interval '7 days')`,
    [userId, hashToken(token), hashToken('csrf-secret')]
  );
  return `${SESSION_COOKIE}=${token}`;
}

test('unsafe mutation rejects missing or mismatched CSRF', async () => {
  const cookie = await sessionCookieFor('csrf@example.com');
  const headers = { cookie, origin: 'http://localhost:5173' };

  const missing = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers });
  assert.equal(missing.status, 403);

  const mismatched = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { ...headers, 'x-csrf-token': 'wrong-token' },
  });
  assert.equal(mismatched.status, 403);
});

test('CORS never emits wildcard origin', async () => {
  const response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Origin: 'https://evil.example' },
  });
  assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
  // Non-allowlisted origin must not receive any ACAO header.
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('development defaults allow the actual Vite ports when CORS is unset', () => {
  const previousOrigins = process.env.CORS_ORIGINS;
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.CORS_ORIGINS;
  process.env.NODE_ENV = 'development';
  try {
    assert.deepEqual(getAllowedOrigins(), [
      'http://localhost:3000',
      'http://localhost:5173',
    ]);
  } finally {
    process.env.CORS_ORIGINS = previousOrigins;
    process.env.NODE_ENV = previousNodeEnv;
  }
});
