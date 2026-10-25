/**
 * 本地开发逃生阀（生产环境绝不启用）：
 *
 *  (A) EMAIL_VERIFICATION_DISABLED=true 时，重复注册同一邮箱不再是无操作，
 *      而是用本次提交的密码覆盖旧密码（等价自助改密码）——否则用户以为注册成功，
 *      实际旧密码才有效，怎么登录都是 401。
 *      未设置该变量时，重复注册必须保持原样：202 且密码不变（不泄漏账号存在性）。
 *
 *  (B) RATE_LIMIT_DISABLED=true 时登录限流整体旁路，避免本地反复调试被
 *      10 分钟窗口锁死；未设置时必须照常限流。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMigrated, resetIdentityTables, startTestServer, pool } from './helpers.js';

process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.NODE_ENV = 'test';

let server;
let baseUrl;

test.before(async () => {
  await ensureMigrated();
  await resetIdentityTables();
  ({ server, baseUrl } = await startTestServer());
});

test.after(async () => {
  delete process.env.EMAIL_VERIFICATION_DISABLED;
  delete process.env.RATE_LIMIT_DISABLED;
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const request = (path, { method = 'GET', json, headers = {} } = {}) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

const register = (email, password) =>
  request('/api/auth/register', { method: 'POST', json: { email, password } });

const login = (email, password) =>
  request('/api/auth/login', { method: 'POST', json: { email, password } });

const activate = async (email) => {
  await pool.query(
    "UPDATE users SET status = 'active', email_verified_at = now() WHERE email_normalized = $1",
    [email]
  );
};

test('重复注册在未开逃生阀时保持静默无操作（生产行为不变）', async () => {
  const email = 'dup-prod@example.com';
  assert.equal((await register(email, 'originalpass1')).status, 202);
  await activate(email);

  // 再次注册：响应仍是 202，但密码绝不能变
  assert.equal((await register(email, 'newpassword22')).status, 202);
  assert.equal((await login(email, 'originalpass1')).status, 200, '旧密码必须仍然有效');
  assert.equal((await login(email, 'newpassword22')).status, 401, '新密码不得生效');
});

test('EMAIL_VERIFICATION_DISABLED=true 时重复注册按新密码生效（本地改密码）', async () => {
  process.env.EMAIL_VERIFICATION_DISABLED = 'true';
  try {
    const email = 'dup-dev@example.com';
    assert.equal((await register(email, 'firstpass123')).status, 202);

    // 重复注册＝自助改密码（本地开发专用）
    assert.equal((await register(email, 'secondpass456')).status, 202);
    assert.equal((await login(email, 'secondpass456')).status, 200, '新密码必须立即生效');
    assert.equal((await login(email, 'firstpass123')).status, 401, '旧密码必须失效');
  } finally {
    delete process.env.EMAIL_VERIFICATION_DISABLED;
  }
});

test('RATE_LIMIT_DISABLED 未设置时限流照常生效（同一邮箱第 6 次登录被拒）', async () => {
  const email = 'limited@example.com';
  await register(email, 'lockedpass123');
  await activate(email);

  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    statuses.push((await login(email, 'wrongpassword')).status);
  }
  assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.equal(statuses[5], 429, '第 6 次必须被限流拦截');
});

test('RATE_LIMIT_DISABLED=true 时限流旁路（连续失败不再出现 429）', async () => {
  process.env.RATE_LIMIT_DISABLED = 'true';
  try {
    const email = 'bypassed-limit@example.com';
    await register(email, 'bypasspass123');
    await activate(email);

    for (let i = 0; i < 12; i += 1) {
      assert.equal((await login(email, 'wrongpassword')).status, 401);
    }
  } finally {
    delete process.env.RATE_LIMIT_DISABLED;
  }
});
