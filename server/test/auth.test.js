import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, validatePassword } from '../auth/password.js';
import { ensureMigrated, listTables, insertUser, resetIdentityTables } from './helpers.js';

test('normalizes email and enforces 10-128 byte password policy', () => {
  assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com');
  assert.equal(validatePassword('123456789'), false);
  assert.equal(validatePassword('1234567890'), true);
  assert.equal(validatePassword('x'.repeat(129)), false);
});

test('identity migration creates required tables and unique normalized email', async () => {
  await ensureMigrated();
  await resetIdentityTables();
  const tables = await listTables();
  for (const t of ['users', 'sessions', 'user_action_tokens', 'email_outbox']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  await insertUser({ email: 'USER@example.com' });
  // Same email with different case/whitespace must collide on the unique key.
  await assert.rejects(insertUser({ email: '  user@example.com ' }), /users_email_normalized_key/);
});
