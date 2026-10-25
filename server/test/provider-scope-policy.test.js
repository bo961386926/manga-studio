// 服务商 scope 策略：私有需 VIP，但对管理员应该是豁免的。
//
// 用户实测踩到的逻辑倒挂：管理员能建「共享」（影响所有用户的更高权限动作），
// 却因为没 VIP 而建不了只属于自己的「私有」——这让管理员无法做任何自用配置，
// 也让人无法理解。策略应为：私有 = 普通用户需 VIP；管理员豁免。
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMigrated, resetIdentityTables, startTestServer, pool } from './helpers.js';
import { grantVip, revokeVip } from '../auth/entitlements.js';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;

const request = (path, { method = 'GET', json, cookie, headers = {} } = {}) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

const registerAndLogin = async (email) => {
  await request('/api/auth/register', { method: 'POST', json: { email, password: '1234567890' } });
  const login = await request('/api/auth/login', { method: 'POST', json: { email, password: '1234567890' } });
  const body = await login.json();
  return { cookie: (login.headers.get('set-cookie') || '').split(';')[0], csrfToken: body.csrfToken };
};

const createProvider = (session, scope) =>
  request('/api/model-invocations/providers', {
    method: 'POST',
    cookie: session.cookie,
    headers: { 'x-csrf-token': session.csrfToken },
    json: { name: `p-${scope}-${Date.now()}`, baseUrl: 'https://api.deepseek.com/v1', authType: 'bearer', scope },
  });

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  process.env.EMAIL_VERIFICATION_DISABLED = 'true';
  ({ server, baseUrl } = await startTestServer());
});

test.after(async () => {
  delete process.env.EMAIL_VERIFICATION_DISABLED;
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('普通用户没有 VIP → 建私有服务商被拒（VIP_REQUIRED）', async () => {
  const session = await registerAndLogin('plain-user@example.com');
  const res = await createProvider(session, 'private');
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, 'VIP_REQUIRED');
});

test('普通用户拿到 VIP 后 → 可以建私有服务商', async () => {
  const session = await registerAndLogin('vip-user@example.com');
  const { rows } = await pool.query("SELECT id FROM users WHERE email_normalized = 'vip-user@example.com'");
  await grantVip({ userId: rows[0].id, reason: 'test' });

  const res = await createProvider(session, 'private');
  assert.equal(res.status, 200, 'VIP 用户应能自配私有服务商');

  // 撤销后重新被拦，证明判定走的是 entitlements 而不是角色
  await revokeVip({ userId: rows[0].id });
  const denied = await createProvider(session, 'private');
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'VIP_REQUIRED');
});

test('管理员没有 VIP → 仍可建私有服务商（豁免，避免逻辑倒挂）', async () => {
  const session = await registerAndLogin('admin-no-vip@example.com');
  await pool.query("UPDATE users SET role = 'admin' WHERE email_normalized = 'admin-no-vip@example.com'");

  const res = await createProvider(session, 'private');
  assert.equal(res.status, 200, '管理员建私有服务商不应被 VIP 拦（他能建更高权限的共享）');
});

test('普通用户仍不能建共享服务商（ADMIN_ONLY）', async () => {
  const session = await registerAndLogin('shared-user@example.com');
  const res = await createProvider(session, 'shared');
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'ADMIN_ONLY');
});

// ---------- 使用侧：与创建侧策略必须一致 ----------

test('使用侧：管理员可用自己的私有服务商模型（不因缺 VIP 被拦）', async () => {
  const { assertModelAccess } = await import('../model-gateway/policy.js');
  const { randomUUID } = await import('node:crypto');
  const adminId = randomUUID(); // userId 在生产里来自会话，必然是 UUID
  const model = { id: randomUUID(), enabled: true, access_level: 'verified' };
  const provider = { id: randomUUID(), enabled: true, scope: 'private', owner_user_id: adminId };
  await assert.doesNotReject(() =>
    assertModelAccess({ model, provider, userId: adminId, isAdmin: true })
  );
});

test('使用侧：普通用户用私有服务商仍要求 VIP，且非本人一律 404', async () => {
  const { assertModelAccess } = await import('../model-gateway/policy.js');
  const { randomUUID } = await import('node:crypto');
  const ownerId = randomUUID();
  const model = { id: randomUUID(), enabled: true, access_level: 'verified' };
  const provider = { id: randomUUID(), enabled: true, scope: 'private', owner_user_id: ownerId };
  await assert.rejects(
    () => assertModelAccess({ model, provider, userId: ownerId, isAdmin: false }),
    /vip entitlement required/
  );
  await assert.rejects(
    () => assertModelAccess({ model, provider, userId: randomUUID(), isAdmin: false }),
    /not your model/
  );
});
