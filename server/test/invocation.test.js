import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ensureMigrated, resetIdentityTables, insertUser, pool } from './helpers.js';
import { withUserContext } from '../db.js';
import { grantVip } from '../auth/entitlements.js';
import { invokeSync, createAsyncJob, findJob, pollJob, cancelJob, storeTextResult, IdempotencyConflictError } from '../model-gateway/gateway.js';
import { uploadMedia } from '../model-gateway/media.js';

let tmpDir;
let userId;
let model;
let provider;

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'invocation-test-'));
  process.env.MEDIA_STORAGE_DIR = tmpDir;
  await ensureMigrated();
  await resetIdentityTables();
  userId = await insertUser({ email: 'inv@example.com' });
  await pool.query(
    `UPDATE users SET status = 'active', email_verified_at = NOW() WHERE id = $1`,
    [userId]
  );
  await grantVip({ userId });

  provider = { id: crypto.randomUUID(), scope: 'shared', owner_user_id: null, base_url: 'https://mock.example', auth_type: 'none' };
  model = {
    id: crypto.randomUUID(),
    api_model: 'm1',
    capability: 'chat',
    adapter_kind: 'legacy',
    protocol_preset: 'openai-chat',
    endpoint_path: '/v1/chat/completions',
    access_level: 'verified',
    enabled: true,
    deleted_at: null,
    protocol_config: {},
    timeout_ms: 5000,
  };
  await withUserContext({ userId, isAdmin: true }, async (client) => {
    await client.query(
      `INSERT INTO model_providers (id, owner_user_id, scope, name, base_url, auth_type)
       VALUES ($1, NULL, 'shared', 'Mock', 'https://mock.example', 'none')`,
      [provider.id]
    );
    await client.query(
      `INSERT INTO models (id, provider_id, name, api_model, capability, adapter_kind, protocol_preset, endpoint_path, access_level)
       VALUES ($1, $2, 'M', 'm1', 'chat', 'legacy', 'openai-chat', '/v1/chat/completions', 'verified')`,
      [model.id, provider.id]
    );
  });
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await pool.end();
});

const chatUploadResult = async ({ client, invocationId, upstreamResult }) => {
  await storeTextResult(client, { invocationId, text: upstreamResult.content });
  return { schemaVersion: 1, kind: 'chat', content: upstreamResult.content, responseFormat: 'text' };
};

test('same user/key/hash returns prior sync result without a second upstream call', async () => {
  let upstreamCalls = 0;
  const deps = {
    fetchUpstream: async () => {
      upstreamCalls += 1;
      return { content: 'hello-world' };
    },
  };
  const base = {
    userId, isAdmin: false, model, provider,
    operation: 'chat', idempotencyKey: 'k-same-1',
    payload: { prompt: 'hi' },
    buildRequest: () => ({}),
    parseResponse: () => 'hello-world',
    uploadResult: chatUploadResult,
    deps,
  };
  const first = await invokeSync(base);
  assert.equal(first.content, 'hello-world');
  const second = await invokeSync(base);
  assert.deepEqual(second, first);
  assert.equal(upstreamCalls, 1, 'second call must reuse the stored result');
});

test('same key with different request hash is rejected', async () => {
  const deps = { fetchUpstream: async () => ({ content: 'x' }) };
  const base = {
    userId, isAdmin: false, model, provider,
    operation: 'chat', idempotencyKey: 'k-conflict-1',
    payload: { prompt: 'one' },
    buildRequest: () => ({}),
    parseResponse: () => 'x',
    uploadResult: chatUploadResult,
    deps,
  };
  await invokeSync(base);
  await assert.rejects(
    invokeSync({ ...base, payload: { prompt: 'two' } }),
    (e) => e instanceof IdempotencyConflictError
  );
});

test('async job lifecycle: submit, poll to success, and cancel is idempotent', async () => {
  let createCalls = 0;
  let statusCalls = 0;
  const deps = {
    fetchUpstream: async () => {
      createCalls += 1;
      return { taskId: 'task-1' };
    },
    parseCreateResponse: ({ body }) => ({ taskId: body.id }),
    fetchJobStatus: async () => {
      statusCalls += 1;
      return { state: 'success', resourceId: 'res-1' };
    },
    downloadJobResult: async () => ({
      buffer: Buffer.from('video-bytes'),
      contentType: 'video/mp4',
    }),
  };

  const created = await createAsyncJob({
    userId, isAdmin: false, model: { ...model, capability: 'video', protocol_preset: 'openai-video-async' },
    provider, idempotencyKey: 'k-job-1',
    payload: { prompt: 'make a video', aspectRatio: '16:9', duration: 8 },
    buildRequest: () => ({}),
    deps,
  });
  assert.equal(created.kind, 'job');
  assert.equal(created.status, 'queued');
  assert.equal(createCalls, 1);

  // Reuse of the same key returns the same job without a new upstream create.
  const again = await createAsyncJob({
    userId, isAdmin: false, model: { ...model, capability: 'video', protocol_preset: 'openai-video-async' },
    provider, idempotencyKey: 'k-job-1',
    payload: { prompt: 'make a video', aspectRatio: '16:9', duration: 8 },
    buildRequest: () => ({}),
    deps,
  });
  assert.equal(again.jobId, created.jobId);
  assert.equal(createCalls, 1);

  const job = await findJob({ userId, isAdmin: false, jobId: created.jobId });
  const done = await pollJob({ userId, isAdmin: false, job, deps });
  assert.equal(done.status, 'succeeded');
  assert.equal(statusCalls, 1);

  // Cancelling a succeeded job is a no-op (idempotent).
  const cancel = await cancelJob({ userId, isAdmin: false, jobId: created.jobId });
  assert.equal(cancel.status, 'succeeded');
});

test('unknown job id returns null (404 semantics, no IDOR leak)', async () => {
  const missing = await findJob({ userId, isAdmin: false, jobId: crypto.randomUUID() });
  assert.equal(missing, null);
});

test('media result is stored as an asset for sync image calls', async () => {
  const deps = { fetchUpstream: async () => ({ base64: Buffer.from('img').toString('base64') }) };
  const result = await invokeSync({
    userId, isAdmin: false, model: { ...model, capability: 'image' },
    provider, operation: 'image', idempotencyKey: 'k-img-1',
    payload: { prompt: 'p', aspectRatio: '16:9' },
    buildRequest: () => ({}),
    parseResponse: ({ body }) => body,
    uploadResult: async ({ client, userId: u, invocationId, upstreamResult }) => {
      const buffer = Buffer.from(upstreamResult.base64, 'base64');
      const record = await uploadMedia({ userId: u, buffer, contentType: 'image/png', checksumSha256: 'a'.repeat(64) });
      await client.query(
        `UPDATE model_invocations SET result_media_asset_id = $2, status = 'succeeded', updated_at = NOW() WHERE id = $1`,
        [invocationId, record.id]
      );
      return { schemaVersion: 1, kind: 'asset', assetId: record.id, contentType: record.content_type, sizeBytes: Number(record.size_bytes) };
    },
    deps,
  });
  assert.equal(result.kind, 'asset');
  assert.ok(result.assetId);
});
