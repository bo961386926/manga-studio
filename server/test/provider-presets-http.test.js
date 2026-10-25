// 服务商预设 + 拉取模型的 HTTP 层测试。
// 覆盖：鉴权、下发字段安全性、凭据解密后注入上游、以及上游失败的报错路径。
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMigrated, resetIdentityTables, startTestServer, pool } from './helpers.js';
import { app } from '../index.js';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let cookie = '';
let csrfToken = '';

const request = (path, { method = 'GET', json, headers = {} } = {}) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  process.env.EMAIL_VERIFICATION_DISABLED = 'true';
  ({ server, baseUrl } = await startTestServer());

  const reg = await request('/api/auth/register', {
    method: 'POST',
    json: { email: 'presets@example.com', password: '1234567890' },
  });
  assert.equal(reg.status, 202);
  const login = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'presets@example.com', password: '1234567890' },
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  csrfToken = (await login.json()).csrfToken;
  assert.ok(csrfToken, 'login must return a csrf token');
  // 共享 provider / 其下模型需要管理员；角色实时读库，同一 cookie 立即生效
  await pool.query("UPDATE users SET role = 'admin' WHERE email_normalized = 'presets@example.com'");
});

test.after(async () => {
  delete process.env.EMAIL_VERIFICATION_DISABLED;
  delete app.locals.modelGatewayDeps;
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('未登录不能读服务商预设', async () => {
  const saved = cookie;
  cookie = '';
  try {
    const res = await request('/api/model-invocations/provider-presets');
    assert.equal(res.status, 401);
  } finally {
    cookie = saved;
  }
});

test('登录后下发国内主流服务商预设，且不含任何凭据字段', async () => {
  const res = await request('/api/model-invocations/provider-presets');
  assert.equal(res.status, 200);
  const { presets } = await res.json();
  assert.ok(Array.isArray(presets) && presets.length >= 6, '至少 6 家国内主流服务商');

  const keys = presets.map((p) => p.key);
  for (const expected of ['dashscope', 'ark', 'deepseek', 'zhipu', 'moonshot', 'minimax']) {
    assert.ok(keys.includes(expected), `缺少预设: ${expected}`);
  }

  for (const preset of presets) {
    assert.ok(preset.key && preset.name, 'key/name required');
    assert.match(preset.baseUrl, /^https:\/\//);
    assert.ok(Object.keys(preset.capabilities).length > 0, `${preset.key} 需要至少一个能力`);
    for (const spec of Object.values(preset.capabilities)) {
      assert.ok(spec.protocolPreset && spec.endpointPath, '能力规格需要协议与端点');
    }
  }

  // keyUrl 合法包含 "apiKey" 字样，这里只校验凭据字段与密钥值
  const raw = JSON.stringify(presets);
  assert.ok(!raw.includes('"secret"'), '预设响应不得出现 secret 字段');
  assert.ok(!raw.includes('"credential"'), '预设响应不得出现 credential 字段');
  assert.ok(!raw.includes('sk-'), '预设响应不得出现密钥值');
  assert.ok(!raw.includes('Authorization'), '预设响应不得出现 Authorization');
});

test('对不存在的 provider 拉取模型 → 404', async () => {
  const res = await request('/api/model-invocations/providers/00000000-0000-0000-0000-000000000000/discover-models', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    json: {},
  });
  assert.equal(res.status, 404);
});

test('完整链路：建服务商 → 存 Key → 拉取模型（凭据解密后注入上游）', async () => {
  const created = await request('/api/model-invocations/providers', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    json: { name: '测试服务商', baseUrl: 'https://api.deepseek.com/v1', authType: 'bearer', scope: 'shared' },
  });
  assert.equal(created.status, 200);
  const { id: providerId } = await created.json();
  assert.ok(providerId);

  const cred = await request(`/api/model-invocations/providers/${providerId}/credential`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    json: { secret: 'sk-unit-test-secret' },
  });
  assert.equal(cred.status, 200);

  const calls = [];
  app.locals.modelGatewayDeps = {
    fetchUpstream: async (params) => {
      calls.push(params);
      return { status: 200, body: Buffer.from(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })) };
    },
  };

  const discovered = await request(`/api/model-invocations/providers/${providerId}/discover-models`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    json: {},
  });
  assert.equal(discovered.status, 200);
  const { models } = await discovered.json();
  assert.deepEqual(models.map((m) => m.apiModel), ['deepseek-chat', 'deepseek-reasoner']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/models');
  assert.deepEqual(calls[0].upstreamAuth, { type: 'bearer', secret: 'sk-unit-test-secret' }, '凭据必须由服务端解密后经注入通道下发');
  assert.equal(calls[0].headers.Authorization, undefined, '客户端 headers 袋子不得携带 authorization');

  // 上游报错 → 502，且错误信息透传（便于用户看懂 Key 不对/额度不足）
  app.locals.modelGatewayDeps = {
    fetchUpstream: async () => ({ status: 401, body: Buffer.from('{"error":{"message":"invalid api key"}}') }),
  };
  const failed = await request(`/api/model-invocations/providers/${providerId}/discover-models`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    json: {},
  });
  assert.equal(failed.status, 502);
  const failure = await failed.json();
  assert.equal(failure.error.code, 'UPSTREAM_ERROR');
  assert.match(failure.error.message, /401/);
});
