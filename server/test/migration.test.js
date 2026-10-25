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
import { classifyLegacyModel, classifyRegistry, maskSecret, importModelConfig } from '../migration/legacy-config.js';
import { sealEnvelope, openEnvelope } from '../migration/envelope.js';
import { getUserSetting } from '../repositories/settings.js';

process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

let adminId;
let server;
let baseUrl;

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  adminId = await insertUser({ email: 'admin@example.com' });
  await pool.query(
    `UPDATE users SET role = 'admin', status = 'active', email_verified_at = NOW() WHERE id = $1`,
    [adminId]
  );
  ({ server, baseUrl } = await startTestServer());
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('built-in becomes shared and old custom becomes admin private', () => {
  const result = classifyLegacyModel(
    { id: 'custom-1', provider: 'self-hosted' },
    { isBuiltIn: false, adminId }
  );
  assert.deepEqual(result, { scope: 'private', ownerId: adminId });

  const builtin = classifyLegacyModel(
    { id: 'builtin-1', provider: 'default' },
    { isBuiltIn: true, adminId }
  );
  assert.deepEqual(builtin, { scope: 'shared', ownerId: null });
});

test('classifyRegistry produces deterministic ownership report', () => {
  const report = classifyRegistry(
    {
      models: [
        { id: 'm-builtin', isBuiltIn: true },
        { id: 'm-custom', isBuiltIn: false },
      ],
    },
    { adminId }
  );
  assert.deepEqual(report, [
    { id: 'm-builtin', scope: 'shared', ownerId: null },
    { id: 'm-custom', scope: 'private', ownerId: adminId },
  ]);
});

test('maskSecret never reveals the full credential', () => {
  assert.equal(maskSecret('abcdefghijkl'), 'abcd****ijkl');
  assert.equal(maskSecret('short'), '****');
  assert.equal(maskSecret(undefined), null);
});

test('importModelConfig stores under admin settings and reports masked', async () => {
  const report = await importModelConfig({
    adminId,
    registry: {
      providers: [{ id: 'p1', name: 'Custom' }],
      models: [{ id: 'builtin-1', isBuiltIn: true }, { id: 'custom-1', isBuiltIn: false }],
    },
    apiKey: 'sk-secret-key-123456',
    modelConfig: { chatModel: { modelName: 'x' } },
  });
  assert.equal(report.modelCount, 2);
  assert.equal(report.apiKeyConfigured, true);
  assert.equal(report.apiKeyMasked, 'sk-s****3456');
  assert.equal(report.apiKeyMasked.includes('secret'), false);

  const stored = await getUserSetting(adminId, 'model_registry');
  assert.equal(stored.models.length, 2);
  assert.equal(stored.migrationOwnership[1].scope, 'private');
  const storedKey = await getUserSetting(adminId, 'antsk_api_key');
  assert.equal(storedKey, 'sk-secret-key-123456');
});

test('admin import endpoint requires reauth and stores config', async () => {
  const token = randomToken(32);
  const csrf = randomToken(32);
  await pool.query(
    `INSERT INTO sessions
       (id, user_id, token_hash, session_version, csrf_token_hash, csrf_expires_at, expires_at, reauthenticated_at)
     VALUES (gen_random_uuid(), $1, $2, 1, $3, NOW() + interval '10 minutes', NOW() + interval '7 days', NOW())`,
    [adminId, hashToken(token), hashToken(csrf)]
  );
  const cookie = `${SESSION_COOKIE}=${token}`;

  const response = await fetch(`${baseUrl}/api/admin/migration/model-config`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-csrf-token': csrf,
    },
    body: JSON.stringify({
      registry: { models: [{ id: 'custom-2', isBuiltIn: false }] },
      apiKey: 'sk-another-123456',
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.modelCount, 1);
  assert.equal(body.apiKeyMasked, 'sk-a****3456');
});

test('v1 envelope decrypts only with the export password and AAD', async () => {
  const envelope = await sealEnvelope(
    { exportId: 'e1', config: { key: 'masked' } },
    'one-time-password'
  );
  assert.equal(envelope.v, 1);
  assert.equal(envelope.data.includes('masked'), false, 'plaintext must never appear in file');

  const opened = await openEnvelope(envelope, 'one-time-password');
  assert.deepEqual(opened, { exportId: 'e1', config: { key: 'masked' } });

  await assert.rejects(openEnvelope(envelope, 'wrong'), /authentication failed/);
});

test('envelope import endpoint binds export id once and rejects replay', async () => {
  const token = randomToken(32);
  const csrf = randomToken(32);
  await pool.query(
    `INSERT INTO sessions
       (id, user_id, token_hash, session_version, csrf_token_hash, csrf_expires_at, expires_at, reauthenticated_at)
     VALUES (gen_random_uuid(), $1, $2, 1, $3, NOW() + interval '10 minutes', NOW() + interval '7 days', NOW())`,
    [adminId, hashToken(token), hashToken(csrf)]
  );
  const cookie = `${SESSION_COOKIE}=${token}`;
  const headers = { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf };

  const envelope = await sealEnvelope(
    {
      exportId: 'export-abc-123',
      config: {
        registry: { models: [{ id: 'custom-3', isBuiltIn: false }] },
        apiKey: 'sk-envelope-123456',
      },
    },
    'export-password'
  );
  const body = { envelope, password: 'export-password', deploymentId: 'deploy-1' };

  const first = await fetch(`${baseUrl}/api/migration/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(first.status, 200);
  const report = await first.json();
  assert.equal(report.exportId, 'export-abc-123');
  assert.equal(report.apiKeyMasked, 'sk-e****3456');

  // Replay with the same envelope is rejected.
  const replay = await fetch(`${baseUrl}/api/migration/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(replay.status, 409);

  // Wrong password is rejected without binding.
  const wrong = await fetch(`${baseUrl}/api/migration/import`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ envelope, password: 'nope', deploymentId: 'deploy-1' }),
  });
  assert.equal(wrong.status, 400);

  // Imported config landed in admin settings.
  const stored = await getUserSetting(adminId, 'model_registry');
  assert.equal(stored.models[0].id, 'custom-3');
});
