import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, validatePassword } from '../auth/password.js';

test('normalizes email and enforces 10-128 byte password policy', () => {
  assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com');
  assert.equal(validatePassword('123456789'), false);
  assert.equal(validatePassword('1234567890'), true);
  assert.equal(validatePassword('x'.repeat(129)), false);
});
