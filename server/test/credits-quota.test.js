// Stage-6a/6b: signup grant, per-invocation deduction with idempotency,
// refund on upstream failure, insufficient balance (402) and daily quotas.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  ensureMigrated,
  resetIdentityTables,
  startTestServer,
  pool,
} from './helpers.js';
import { hashPassword } from '../auth/password.js';
import { invokeSync, createAsyncJob, findJob } from '../model-gateway/gateway.js';

process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let userId;
let providerId;
let chatModelId;
let videoModelId;

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  ({ server, baseUrl } = await startTestServer());
  await pool.query(
    `INSERT INTO users (id, email, email_normalized, password_hash, role, status, email_verified_at)
     VALUES (gen_random_uuid(), 'c@example.com', 'c@example.com', $1, 'user', 'active', NOW())`,
    [await hashPassword('Credits123')]
  );
  userId = (await pool.query("SELECT id FROM users WHERE email='c@example.com'")).rows[0].id;
  providerId = crypto.randomUUID();
  chatModelId = crypto.randomUUID();
  videoModelId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO model_providers (id, owner_user_id, scope, name, base_url, auth_type)
     VALUES ($1, NULL, 'shared', 'Cr', 'https://mock.example', 'none')`,
    [providerId]
  );
  await pool.query(
    `INSERT INTO models (id, provider_id, name, api_model, capability, adapter_kind, protocol_preset, endpoint_path, access_level)
     VALUES ($1, $2, 'Chat', 'm-chat', 'chat', 'legacy', 'openai-chat', '/v1/chat/completions', 'verified'),
            ($3, $2, 'Vid', 'm-video', 'video', 'legacy', 'openai-video-async', '/videos', 'verified')`,
    [chatModelId, providerId, videoModelId]
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

const chatModel = (id = chatModelId) => ({
  id, api_model: 'm-chat', capability: 'chat', adapter_kind: 'legacy',
  protocol_preset: 'openai-chat', endpoint_path: '/v1/chat/completions',
  access_level: 'verified', enabled: true, deleted_at: null, protocol_config: {}, timeout_ms: 0,
});
const videoModel = () => ({
  id: videoModelId, api_model: 'm-video', capability: 'video', adapter_kind: 'legacy',
  protocol_preset: 'openai-video-async', endpoint_path: '/videos',
  access_level: 'verified', enabled: true, deleted_at: null, protocol_config: {}, timeout_ms: 0,
  provider: { id: providerId, base_url: 'https://mock.example', auth_type: 'none', timeout_ms: 0 },
});

const balance = async () =>
  (await pool.query('SELECT balance FROM credit_accounts WHERE user_id = $1', [userId])).rows[0].balance;

test('registration grants 200 signup credits', async () => {
  // 直接插入的用户在首次使用时懒创建并获得同等赠送
  assert.ok(!(await pool.query('SELECT 1 FROM credit_accounts WHERE user_id = $1', [userId])).rows.length);
  const res = await request('/api/auth/register', {
    method: 'POST',
    json: { email: 'fresh@example.com', password: 'FreshPass123' },
  });
  assert.equal(res.status, 202);
  const freshId = (await pool.query("SELECT id FROM users WHERE email='fresh@example.com'")).rows[0].id;
  const granted = (await pool.query('SELECT balance FROM credit_accounts WHERE user_id = $1', [freshId])).rows[0];
  assert.equal(granted.balance, 200);
  // 原测试用户：懒创建也补 200（后续测试依赖）
  const { ensureCreditAccount } = await import('../credits.js');
  const { withUserContext } = await import('../db.js');
  await withUserContext({ userId, isAdmin: true }, (client) => ensureCreditAccount(client, userId));
  assert.equal(await balance(), 200);
});

test('chat invocation deducts 1 credit; idempotent replay does not double-charge', async () => {
  const key = `chat-${crypto.randomUUID()}`;
  const result = await invokeSync({
    userId, isAdmin: false,
    model: chatModel(), provider: { id: providerId, base_url: 'https://mock.example', auth_type: 'none', timeout_ms: 0 },
    operation: 'chat', idempotencyKey: key,
    payload: { prompt: 'hi' },
    buildRequest: () => ({}),
    parseResponse: () => 'ok',
    uploadResult: async ({ client, invocationId, upstreamResult }) => {
      const { storeTextResult } = await import('../model-gateway/gateway.js');
      await storeTextResult(client, { invocationId, text: upstreamResult.content });
      return { kind: 'chat', content: upstreamResult.content };
    },
    deps: { fetchUpstream: async () => ({ content: 'ok' }) },
  });
  assert.equal(result.content, 'ok');
  assert.equal(await balance(), 199);
  // 重放：同 key 同 payload → 返回缓存结果，不再扣费
  const replay = await invokeSync({
    userId, isAdmin: false,
    model: chatModel(), provider: { id: providerId, base_url: 'https://mock.example', auth_type: 'none', timeout_ms: 0 },
    operation: 'chat', idempotencyKey: key,
    payload: { prompt: 'hi' },
    buildRequest: () => ({}),
    parseResponse: () => 'ok',
    uploadResult: async () => { throw new Error('should not re-upload'); },
    deps: { fetchUpstream: async () => { throw new Error('should not re-call upstream'); } },
  });
  assert.equal(replay.content, 'ok');
  assert.equal(await balance(), 199);
});

test('upstream submit failure refunds the charge', async () => {
  const before = await balance();
  await assert.rejects(() =>
    invokeSync({
      userId, isAdmin: false,
      model: chatModel(), provider: { id: providerId, base_url: 'https://mock.example', auth_type: 'none', timeout_ms: 0 },
      operation: 'chat', idempotencyKey: `fail-${crypto.randomUUID()}`,
      payload: { prompt: 'boom' },
      buildRequest: () => ({}),
      parseResponse: () => 'never',
      uploadResult: async () => ({}),
      deps: { fetchUpstream: async () => { throw new Error('upstream down'); } },
    })
  );
  assert.equal(await balance(), before);
});

test('insufficient balance → 402 CREDIT_REQUIRED', async () => {
  await pool.query('UPDATE credit_accounts SET balance = 0 WHERE user_id = $1', [userId]);
  await assert.rejects(
    () =>
      invokeSync({
        userId, isAdmin: false,
        model: chatModel(), provider: { id: providerId, base_url: 'https://mock.example', auth_type: 'none', timeout_ms: 0 },
        operation: 'chat', idempotencyKey: `poor-${crypto.randomUUID()}`,
        payload: { prompt: 'hi' },
        buildRequest: () => ({}),
        parseResponse: () => 'x',
        uploadResult: async () => ({}),
        deps: { fetchUpstream: async () => ({ content: 'x' }) },
      }),
    (e) => e.code === 'CREDIT_REQUIRED' && e.status === 402
  );
  // 恢复余额供后续测试
  await pool.query('UPDATE credit_accounts SET balance = 500 WHERE user_id = $1', [userId]);
});

test('video job deducts 30 credits; submission_uncertain keeps the charge', async () => {
  const before = await balance();
  const accepted = await createAsyncJob({
    userId, isAdmin: false, model: videoModel(),
    provider: videoModel().provider,
    idempotencyKey: `video-${crypto.randomUUID()}`,
    payload: { prompt: 'p', aspectRatio: '16:9', duration: 8 },
    deps: {
      fetchUpstream: async () => { throw new Error('submit lost'); },
    },
  });
  assert.equal(accepted.status, 'submission_uncertain');
  assert.equal(await balance(), before - 30);
});

test('daily quota: free video limit reached → 429 QUOTA_EXCEEDED', async () => {
  // 直接插入 3 条今天的 video 调用记录（免费档上限）
  for (let i = 0; i < 3; i++) {
    await pool.query(
      `INSERT INTO model_invocations (id, user_id, model_id, model_id_snapshot, operation, idempotency_key, request_hash, status,
         request_payload_ciphertext, request_payload_iv, request_payload_tag, request_payload_key_id)
       VALUES (gen_random_uuid(), $1, $2, $2, 'video', $3, 'h', 'succeeded', '\\x78', '\\x78', '\\x78', 'v1')`,
      [userId, videoModelId, `q-${i}-${crypto.randomUUID()}`]
    );
  }
  const { assertDailyQuota } = await import('../credits.js');
  await assert.rejects(
    () => assertDailyQuota({ userId, capability: 'video', isAdmin: false }),
    (e) => e.code === 'QUOTA_EXCEEDED' && e.status === 429
  );
  // VIP 提升配额：授予 VIP 后通过
  await pool.query(
    `INSERT INTO user_entitlements (id, user_id, entitlement_key, enabled)
     VALUES (gen_random_uuid(), $1, 'vip', TRUE) ON CONFLICT (user_id, entitlement_key) DO UPDATE SET enabled = TRUE`,
    [userId]
  );
  await assert.doesNotReject(() => assertDailyQuota({ userId, capability: 'video', isAdmin: false }));
  // 管理员不受限
  await assert.doesNotReject(() => assertDailyQuota({ userId, capability: 'video', isAdmin: true }));
});
