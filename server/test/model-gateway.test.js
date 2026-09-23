import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMigrated, pool } from './helpers.js';
import { sealSecret, openSecret, requestHash } from '../model-gateway/crypto.js';

test.before(async () => {
  await ensureMigrated();
});

test.after(async () => {
  await pool.end();
});

test('credential ciphertext is bound to owner, record, field and key id', async () => {
  const sealed = sealSecret('secret', { ownerId: 'u1', recordId: 'p1', field: 'api_key', keyId: 'v1' });
  assert.equal(
    openSecret(sealed, { ownerId: 'u1', recordId: 'p1', field: 'api_key', keyId: 'v1' }),
    'secret'
  );
  // Wrong owner fails.
  assert.throws(() =>
    openSecret(sealed, { ownerId: 'u2', recordId: 'p1', field: 'api_key', keyId: 'v1' })
  );
  // Wrong record fails.
  assert.throws(() =>
    openSecret(sealed, { ownerId: 'u1', recordId: 'p2', field: 'api_key', keyId: 'v1' })
  );
  // Wrong field fails.
  assert.throws(() =>
    openSecret(sealed, { ownerId: 'u1', recordId: 'p1', field: 'secret_key', keyId: 'v1' })
  );
});

test('unknown key id fails closed', async () => {
  const sealed = sealSecret('secret', { ownerId: 'u1', recordId: 'p1', field: 'api_key', keyId: 'v1' });
  assert.throws(
    () => openSecret(sealed, { ownerId: 'u1', recordId: 'p1', field: 'api_key', keyId: 'v9' }),
    /unknown key id/
  );
});

test('tampered ciphertext fails authentication', async () => {
  const sealed = sealSecret('secret', { ownerId: 'u1', recordId: 'p1', field: 'api_key', keyId: 'v1' });
  const tampered = { ...sealed, ciphertext: Buffer.from('deadbeef', 'hex') };
  assert.throws(() =>
    openSecret(tampered, { ownerId: 'u1', recordId: 'p1', field: 'api_key', keyId: 'v1' })
  );
});

test('request hash is deterministic and differs across payloads', () => {
  const h1 = requestHash(JSON.stringify({ prompt: 'a' }));
  const h2 = requestHash(JSON.stringify({ prompt: 'a' }));
  const h3 = requestHash(JSON.stringify({ prompt: 'b' }));
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('003 gateway schema creates required tables', async () => {
  const { rows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN (" +
      "'model_providers','models','model_credential_versions','media_assets','model_invocations','model_jobs')"
  );
  const names = rows.map((r) => r.tablename).sort();
  assert.deepEqual(names, [
    'media_assets',
    'model_credential_versions',
    'model_invocations',
    'model_jobs',
    'model_providers',
    'models',
  ]);
});
