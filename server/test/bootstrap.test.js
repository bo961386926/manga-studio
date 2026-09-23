import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureMigrated,
  resetIdentityTables,
  startTestServer,
  insertUser,
  findUser,
  pool,
} from './helpers.js';
import { runBootstrap, createBootstrapToken } from '../bootstrap-admin.js';
import { hashToken, consumeToken } from '../auth/tokens.js';
import { setConfig, removeConfig } from '../db.js';

process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

let server;
let baseUrl;

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  await setConfig('maintenance_mode', true);
  ({ server, baseUrl } = await startTestServer());
});

test.after(async () => {
  await removeConfig('maintenance_mode').catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('bootstrap requires maintenance mode', async () => {
  await removeConfig('maintenance_mode');
  await assert.rejects(runBootstrap({ email: 'nomaint@example.com' }), /maintenance mode/);
  await setConfig('maintenance_mode', true);
});

test('bootstrap refuses when an active admin already exists', async () => {
  const adminId = await insertUser({ email: 'existing-admin@example.com' });
  await pool.query(
    `UPDATE users SET role = 'admin', status = 'active', email_verified_at = NOW() WHERE id = $1`,
    [adminId]
  );
  await assert.rejects(runBootstrap({ email: 'another@example.com' }), /active admin exists/);
});

test('bootstrap token is purpose-bound and single-use', async () => {
  const { token } = await createBootstrapToken({ email: 'bootstrap@example.com' });

  const firstClient = await pool.connect();
  try {
    const first = await consumeToken(firstClient, hashToken(token), 'bootstrap_admin');
    assert.ok(first, 'token must be consumable once');
  } finally {
    firstClient.release();
  }

  const secondClient = await pool.connect();
  try {
    // Second consumption must be a no-op (conditional update returns nothing).
    assert.equal(await consumeToken(secondClient, hashToken(token), 'bootstrap_admin'), null);
    // Wrong purpose must never consume it either.
    assert.equal(await consumeToken(secondClient, hashToken(token), 'verify_email'), null);
  } finally {
    secondClient.release();
  }
});

test('bootstrap-complete activates the admin and the password works', async () => {
  const { token } = await createBootstrapToken({ email: 'final@example.com' });
  const complete = await fetch(`${baseUrl}/api/auth/bootstrap-complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password: 'admin-password-123' }),
  });
  assert.equal(complete.status, 200);

  const user = await findUser('final@example.com');
  assert.equal(user.status, 'active');
  assert.equal(user.role, 'admin');
  assert.ok(user.email_verified_at);

  // Token is single-use.
  const reuse = await fetch(`${baseUrl}/api/auth/bootstrap-complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password: 'admin-password-123' }),
  });
  assert.equal(reuse.status, 400);

  // The admin can log in with the chosen password.
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'final@example.com', password: 'admin-password-123' }),
  });
  assert.equal(login.status, 200);
});
