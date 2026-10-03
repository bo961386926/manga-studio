// 图生图（参考图）HTTP 全链路测试。
// 客户端把参考图作为 media asset 上传后传 referenceAssetIds；网关必须把它们
// 变成上游 multipart edit 请求的 image 部分。此前路由校验完就丢弃了参考图，
// 图生图被静默降级成文生图（角色一致性工作流被破坏）——本文件锁死该行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ensureMigrated, resetIdentityTables, startTestServer, pool } from './helpers.js';
import { app } from '../index.js';
import { uploadMedia } from '../model-gateway/media.js';
import { withUserContext } from '../db.js';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let tmpDir;
let cookie;
let csrfToken;
let modelId;
let refAssetId;
const capture = {};

const registerAndLogin = async (email) => {
  await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: '1234567890' }),
  });
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: '1234567890' }),
  });
  const body = await login.json();
  return { cookie: (login.headers.get('set-cookie') || '').split(';')[0], csrfToken: body.csrfToken };
};

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imgref-test-'));
  process.env.MEDIA_STORAGE_DIR = tmpDir;
  await ensureMigrated();
  await resetIdentityTables();
  process.env.EMAIL_VERIFICATION_DISABLED = 'true';
  ({ server, baseUrl } = await startTestServer());

  // DI：捕获网关发出的上游请求
  app.locals.modelGatewayDeps = {
    fetchUpstream: async (opts) => {
      capture.opts = opts;
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ data: [{ b64_json: Buffer.from('fake-png').toString('base64') }] })),
      };
    },
  };

  const session = await registerAndLogin('imgref@example.com');
  cookie = session.cookie;
  csrfToken = session.csrfToken;
  const { rows } = await pool.query("SELECT id FROM users WHERE email_normalized = 'imgref@example.com'");
  const userId = rows[0].id;
  await pool.query(`UPDATE users SET status = 'active', email_verified_at = NOW() WHERE id = $1`, [userId]);

  await withUserContext({ userId, isAdmin: true }, async (client) => {
    const p = await client.query(
      `INSERT INTO model_providers (id, owner_user_id, scope, name, base_url, auth_type)
       VALUES ($1, NULL, 'shared', 'Mock', 'https://mock.example', 'none') RETURNING id`,
      [crypto.randomUUID()]
    );
    const m = await client.query(
      `INSERT INTO models (id, provider_id, name, api_model, capability, adapter_kind, protocol_preset, endpoint_path, access_level)
       VALUES ($1, $2, 'IMG', 'img-1', 'image', 'legacy', 'openai-image', '/images/generations', 'verified') RETURNING id`,
      [crypto.randomUUID(), p.rows[0].id]
    );
    modelId = m.rows[0].id;
  });

  const record = await uploadMedia({
    userId,
    buffer: Buffer.from('fake-image-bytes'),
    contentType: 'image/png',
    checksumSha256: '',
  });
  refAssetId = record.id;
});

test.after(async () => {
  delete process.env.EMAIL_VERIFICATION_DISABLED;
  delete process.env.MEDIA_STORAGE_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const headerOf = (opts, name) =>
  Object.entries(opts?.headers || {}).find(([k]) => k.toLowerCase() === name)?.[1] || '';

const invoke = (payload, key) =>
  fetch(`${baseUrl}/api/model-invocations/invocations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-csrf-token': csrfToken,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(payload),
  });

test('带参考图的 image 调用 → 上游收到 multipart edit 请求并包含图片字节', async () => {
  const res = await invoke(
    {
      modelId,
      operation: 'image',
      prompt: '保持角色形象，同一角色换个动作',
      aspectRatio: '16:9',
      referenceAssetIds: [refAssetId],
    },
    'img-ref-1'
  );
  const text = await res.text();
  assert.equal(res.status, 200, text);

  assert.ok(capture.opts, '上游应被调用');
  const contentType = headerOf(capture.opts, 'content-type');
  assert.ok(contentType.startsWith('multipart/form-data'), `应为 multipart，实际 ${contentType}`);
  const bodyText = capture.opts.body.toString('latin1');
  assert.ok(bodyText.includes('fake-image-bytes'), 'multipart 必须包含参考图字节');
  assert.ok(bodyText.includes('name="model"'), 'multipart 需带 model 字段');
  assert.ok(bodyText.includes('name="image"'), 'multipart 需带 image 文件部分');
});

test('不带参考图的 image 调用 → 维持 JSON 快速路径', async () => {
  capture.opts = null;
  const res = await invoke(
    { modelId, operation: 'image', prompt: '一张风景图', aspectRatio: '16:9' },
    'img-no-ref-1'
  );
  assert.equal(res.status, 200);
  assert.ok(capture.opts, '上游应被调用');
  assert.match(headerOf(capture.opts, 'content-type'), /application\/json/);
  const json = JSON.parse(capture.opts.body.toString('utf8'));
  assert.equal(json.model, 'img-1');
  assert.equal(json.prompt, '一张风景图');
});
