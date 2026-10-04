// 支付闭环 HTTP 全链路测试：下单 →（手动）管理员确认 → 积分/VIP 入账 → 对账。
// 锁死的行为：确认幂等（重复确认 422）、VIP 续期叠加、取消后不可确认、对账汇总。
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMigrated, resetIdentityTables, startTestServer, pool } from './helpers.js';
import { app } from '../index.js';

process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let userCookie;
let userCsrf;
let adminCookie;
let adminCsrf;

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

const authHeaders = (cookie, csrf) => ({ 'content-type': 'application/json', cookie, 'x-csrf-token': csrf });

const userPost = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: authHeaders(userCookie, userCsrf), body: JSON.stringify(body || {}) });
const userGet = (path) => fetch(`${baseUrl}${path}`, { headers: authHeaders(userCookie, userCsrf) });
const adminGet = (path) => fetch(`${baseUrl}${path}`, { headers: authHeaders(adminCookie, adminCsrf) });
const adminPost = (path, body) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: authHeaders(adminCookie, adminCsrf), body: JSON.stringify(body || {}) });

const balanceOf = async (userId) => {
  const { rows } = await pool.query(`SELECT balance FROM credit_accounts WHERE user_id=$1`, [userId]);
  return rows[0]?.balance ?? null;
};
const userIdByEmail = async (email) => {
  const { rows } = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
  return rows[0].id;
};

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  process.env.EMAIL_VERIFICATION_DISABLED = 'true';
  ({ server, baseUrl } = await startTestServer());
  const u = await registerAndLogin(`pay-user-${Date.now()}@test.local`);
  userCookie = u.cookie; userCsrf = u.csrfToken;
  const adminEmail = `pay-admin-${Date.now()}@test.local`;
  const a = await registerAndLogin(adminEmail);
  adminCookie = a.cookie; adminCsrf = a.csrfToken;
  await pool.query(`UPDATE users SET role='admin' WHERE email=$1`, [adminEmail]);
});

test.after(async () => {
  delete process.env.EMAIL_VERIFICATION_DISABLED;
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('SKU 目录可读且只暴露 manual 通道', async () => {
  const res = await userGet('/api/payments/skus');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.skus.length >= 4);
  assert.ok(body.skus.every((s) => s.amountCents >= 0 && s.title));
  assert.deepEqual(body.channels.map((c) => c.key), ['manual']);
});

test('下单（积分 SKU）→ pending + 转账说明', async () => {
  const res = await userPost('/api/payments/orders', { skuCode: 'credits_small' });
  assert.equal(res.status, 201);
  const { order, pay } = await res.json();
  assert.match(order.orderNo, /^MS\d{8}/);
  assert.equal(order.status, 'pending');
  assert.equal(order.amountCents, 990);
  assert.match(pay.instructions, /转账/);
  assert.match(pay.instructions, /订单号/);
});

test('管理员确认 → 积分到账（幂等：重复确认 422）', async () => {
  const created = await (await userPost('/api/payments/orders', { skuCode: 'credits_small' })).json();
  const uid = await userIdByEmail((await pool.query(`SELECT email FROM users WHERE id=(SELECT user_id FROM payment_orders WHERE order_no=$1)`, [created.order.orderNo])).rows[0].email);
  const before = await balanceOf(uid);

  const ok1 = await adminPost(`/api/admin/payments/orders/${created.order.orderNo}/confirm`, { providerRef: '转账凭证-001' });
  assert.equal(ok1.status, 200);
  const ok1Body = await ok1.json();
  assert.equal(ok1Body.result.kind, 'credits');
  assert.equal(ok1Body.result.credits, 1000);
  assert.equal(ok1Body.userBalance, (before ?? 0) + 1000);

  const again = await adminPost(`/api/admin/payments/orders/${created.order.orderNo}/confirm`, {});
  assert.equal(again.status, 422);
  assert.equal((await again.json()).code, 'NOT_CONFIRMABLE');
  assert.equal(await balanceOf(uid), (before ?? 0) + 1000); // 没有重复入账
});

test('VIP 订单确认 → 权益到账，续购叠加到期日', async () => {
  const o1 = await (await userPost('/api/payments/orders', { skuCode: 'vip_month' })).json();
  const r1 = await adminPost(`/api/admin/payments/orders/${o1.order.orderNo}/confirm`, {});
  assert.equal(r1.status, 200);
  const exp1 = new Date((await r1.json()).result.expiresAt);
  assert.ok(exp1 - Date.now() > 29 * 86400000, '首次应约 30 天');

  const o2 = await (await userPost('/api/payments/orders', { skuCode: 'vip_month' })).json();
  const r2 = await adminPost(`/api/admin/payments/orders/${o2.order.orderNo}/confirm`, {});
  assert.equal(r2.status, 200);
  const exp2 = new Date((await r2.json()).result.expiresAt);
  assert.ok(exp2 - exp1 > 29 * 86400000, '续购应从上次到期日叠加约 30 天');
});

test('用户取消 pending 订单后，管理员不可再确认', async () => {
  const o = await (await userPost('/api/payments/orders', { skuCode: 'credits_large' })).json();
  const cancel = await userPost(`/api/payments/orders/${o.order.orderNo}/cancel`);
  assert.equal(cancel.status, 200);
  const confirm = await adminPost(`/api/admin/payments/orders/${o.order.orderNo}/confirm`, {});
  assert.equal(confirm.status, 422);
  assert.equal((await confirm.json()).code, 'NOT_CONFIRMABLE');
});

test('未知 SKU / 未知通道 → 422', async () => {
  assert.equal((await userPost('/api/payments/orders', { skuCode: 'nope' })).status, 422);
  assert.equal((await userPost('/api/payments/orders', { skuCode: 'vip_month', channel: 'alipay_qr' })).status, 422);
});

test('对账端点：paid 汇总与逐日分组', async () => {
  const res = await adminGet('/api/admin/payments/reconcile?days=30');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.totals.orders >= 3);
  // 实际 paid：1×credits_small(990) + 2×vip_month(5800) = 6790（重复确认不重复计）
  assert.ok(body.totals.amount_cents >= 990 + 2900 * 2);
  assert.ok(body.byDay.length >= 1);
  assert.ok(body.byDay.every((r) => r.orders > 0 && r.amount_cents > 0));
});

test('普通用户不可访问管理端支付端点', async () => {
  const res = await userGet('/api/admin/payments/orders');
  assert.ok([401, 403].includes(res.status));
});
