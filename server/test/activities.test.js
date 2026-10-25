// Stage-6c: check-in (streak/award/dedupe), redeem codes (hash-only,
// per-user batch limits), referral (bind at register, referee reward on
// verify, referrer reward on first successful invocation).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  ensureMigrated,
  resetIdentityTables,
  startTestServer,
  getActionToken,
  pool,
} from './helpers.js';
import { invokeSync } from '../model-gateway/gateway.js';

process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

let server;
let baseUrl;

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  await pool.query('TRUNCATE announcements');
  ({ server, baseUrl } = await startTestServer());
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

const register = async (email, referralCode) => {
  const res = await request('/api/auth/register', {
    method: 'POST',
    json: { email, password: 'Activities123', referralCode },
  });
  assert.equal(res.status, 202);
  return (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
};

const loginAs = async (email, password) => {
  const res = await request('/api/auth/login', { method: 'POST', json: { email, password } });
  assert.equal(res.status, 200);
  return {
    cookie: (res.headers.get('set-cookie') || '').split(';')[0],
    csrf: (await res.json()).csrfToken,
  };
};

const balanceOf = async (userId) =>
  (await pool.query('SELECT balance FROM credit_accounts WHERE user_id = $1', [userId])).rows[0].balance;

test('check-in: base award, same-day 409, streak raises award', async () => {
  const uid = await register('ck1@example.com');
  const dbg = await pool.query('SELECT * FROM check_ins WHERE user_id = $1', [uid]);
  const { checkIn } = await import('../activities.js');
  const first = await checkIn(uid);
  assert.equal(first.streak, 1);
  assert.equal(first.creditsAwarded, 2);
  assert.equal(first.balance, 202);
  await assert.rejects(() => checkIn(uid), (e) => e.code === 'ALREADY_CHECKED_IN' && e.status === 409);
  // 首签回退到昨天 → 今天再签：streak 2、奖励 3
  await pool.query(
    "UPDATE check_ins SET checkin_date = CURRENT_DATE - 1, idempotency_key = 'ck:' || user_id || ':' || to_char(CURRENT_DATE - 1, 'YYYY-MM-DD') WHERE user_id = $1",
    [uid]
  );
  const second = await checkIn(uid);
  assert.equal(second.streak, 2);
  assert.equal(second.creditsAwarded, 3);
});

test('redeem codes: hash-only storage, per-user batch limit, reuse rejected', async () => {
  // admin：注册 + 提权 + 登录（真实密码哈希）
  const res = await request('/api/auth/register', {
    method: 'POST',
    json: { email: 'ad@example.com', password: 'AdminPass123' },
  });
  if (res.status !== 202) console.error('[dbg] register:', res.status, await res.clone().text());
  assert.equal(res.status, 202);
  await pool.query("UPDATE users SET role='admin', status='active', email_verified_at=NOW() WHERE email='ad@example.com'");
  const la = await request('/api/auth/login', { method: 'POST', json: { email: 'ad@example.com', password: 'AdminPass123' } });
  const la2 = await request('/api/auth/login', { method: 'POST', json: { email: 'ad@example.com', password: 'AdminPass123' } });
  const { cookie, csrf } = await loginAs('ad@example.com', 'AdminPass123');
  const headers = { 'x-csrf-token': csrf };
  const ra = await request('/api/auth/reauthenticate', {
    method: 'POST',
    json: { password: 'AdminPass123' },
    cookie,
    headers,
  });

  const created = await request('/api/admin/credits/redeem-batches', {
    method: 'POST',
    json: { name: '公测礼包', credits: 50, count: 3, maxPerUser: 1 },
    cookie,
    headers,
  });
  if (created.status !== 200) console.error('[dbg] batch create:', created.status, await created.text());
  assert.equal(created.status, 200);
  const { codes } = await created.json();
  assert.equal(codes.length, 3);

  // 数据库中不存在明文
  const { rows: leak } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM redeem_codes WHERE encode(code_hash, 'hex') LIKE '%' || $1 || '%'",
    [codes[0]]
  );
  assert.equal(leak[0].n, 0);

  const uid = await register('rc1@example.com');
  await pool.query("UPDATE users SET status='active', email_verified_at=NOW() WHERE id=$1", [uid]);
  const before = await balanceOf(uid);

  const ok = await request('/api/credits/redeem', {
    method: 'POST',
    json: { code: codes[0].toLowerCase() }, // 大小写不敏感
    cookie: '',
  });
  // 未登录 → 401（先验证鉴权）
  assert.equal(ok.status, 401);

  // 用真实用户会话兑换
  const resB = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'rc1@example.com', password: 'Activities123' },
  });
  const uCookie = (resB.headers.get('set-cookie') || '').split(';')[0];
  const redeemed = await request('/api/credits/redeem', {
    method: 'POST',
    json: { code: codes[0].toLowerCase() },
    cookie: uCookie,
  });
  assert.equal(redeemed.status, 200);
  assert.equal((await redeemed.json()).credits, 50);
  assert.equal(await balanceOf(uid), before + 50);

  // 同码重用 → 409；同批第二个码（每人限 1）→ 409；未知码 → 404
  const reuse = await request('/api/credits/redeem', { method: 'POST', json: { code: codes[0] }, cookie: uCookie });
  assert.equal(reuse.status, 409);
  const limit = await request('/api/credits/redeem', { method: 'POST', json: { code: codes[1] }, cookie: uCookie });
  assert.equal(limit.status, 409);
  const unknown = await request('/api/credits/redeem', { method: 'POST', json: { code: 'MSXXXXXXXXXX' }, cookie: uCookie });
  assert.equal(unknown.status, 404);
});

test('referral: bind at register, referee reward on verify, referrer reward on first success', async () => {
  // A：注册并取邀请码
  const aId = await register('refa@example.com');
  const aCookieRes = await request('/api/auth/login', {
    method: 'POST',
    json: { email: 'refa@example.com', password: 'Activities123' },
  });
  // A 未验证邮箱不可登录 → 直接 SQL 激活后登录
  await pool.query("UPDATE users SET status='active', email_verified_at=NOW() WHERE id=$1", [aId]);
  const aLogin = await loginAs('refa@example.com', 'Activities123');
  const referral = await (await request('/api/credits/referral', { cookie: aLogin.cookie })).json();
  assert.ok(referral.code);

  // B：带邀请码注册
  const bId = await register('refb@example.com', referral.code);
  // 无效的邀请关系不存在
  const { rows: [ref] } = await pool.query('SELECT * FROM referrals WHERE referee_id = $1', [bId]);
  assert.ok(ref);
  assert.equal(ref.referrer_id, aId);

  // B 邮箱验证 → 被邀人 +100
  const token = await getActionToken('refb@example.com', 'verify_email');
  const verified = await request('/api/auth/verify-email', {
    method: 'POST',
    json: { token },
  });
  assert.equal(verified.status, 200);
  assert.equal(await balanceOf(bId), 300);
  const { rows: [refAfter] } = await pool.query('SELECT referee_rewarded_at FROM referrals WHERE id = $1', [ref.id]);
  assert.ok(refAfter.referee_rewarded_at);

  // B 首次成功调用 → 邀请人 +200
  const aBefore = await balanceOf(aId);
  const providerId = crypto.randomUUID();
  const modelId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO model_providers (id, owner_user_id, scope, name, base_url, auth_type)
     VALUES ($1, NULL, 'shared', 'Ref', 'https://mock.example', 'none')`,
    [providerId]
  );
  await pool.query(
    `INSERT INTO models (id, provider_id, name, api_model, capability, adapter_kind, protocol_preset, endpoint_path, access_level)
     VALUES ($1, $2, 'C', 'm1', 'chat', 'legacy', 'openai-chat', '/v1/chat/completions', 'verified')`,
    [modelId, providerId]
  );
  const model = {
    id: modelId, api_model: 'm1', capability: 'chat', adapter_kind: 'legacy',
    protocol_preset: 'openai-chat', endpoint_path: '/v1/chat/completions',
    access_level: 'verified', enabled: true, deleted_at: null, protocol_config: {}, timeout_ms: 0,
    provider: { id: providerId, base_url: 'https://mock.example', auth_type: 'none', timeout_ms: 0 },
  };
  await invokeSync({
    userId: bId, isAdmin: false, model,
    provider: model.provider,
    operation: 'chat', idempotencyKey: `ref-succ-${crypto.randomUUID()}`,
    payload: { prompt: 'hi' },
    buildRequest: () => ({}),
    parseResponse: () => 'ok',
    uploadResult: async ({ client, invocationId }) => {
      const { storeTextResult } = await import('../model-gateway/gateway.js');
      await storeTextResult(client, { invocationId, text: 'ok' });
      return { kind: 'chat', content: 'ok' };
    },
    deps: { fetchUpstream: async () => ({ content: 'ok' }) },
  });
  assert.equal(await balanceOf(aId), aBefore + 200);

  // B 再次成功调用不重复发奖
  await invokeSync({
    userId: bId, isAdmin: false, model,
    provider: model.provider,
    operation: 'chat', idempotencyKey: `ref-succ2-${crypto.randomUUID()}`,
    payload: { prompt: 'hi2' },
    buildRequest: () => ({}),
    parseResponse: () => 'ok',
    uploadResult: async ({ client, invocationId }) => {
      const { storeTextResult } = await import('../model-gateway/gateway.js');
      await storeTextResult(client, { invocationId, text: 'ok' });
      return { kind: 'chat', content: 'ok' };
    },
    deps: { fetchUpstream: async () => ({ content: 'ok' }) },
  });
  assert.equal(await balanceOf(aId), aBefore + 200);
});
