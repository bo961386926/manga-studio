// HTTP-level contract tests for the self-hosted SVG captcha used by
// login/register. CAPTCHA_ENABLED is read per-request so tests toggle it
// inside one file without affecting other suites (node --test isolates files).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMigrated, resetIdentityTables, startTestServer, pool } from './helpers.js';
import { _peekAnswer } from '../auth/captcha.js';

process.env.NODE_ENV = 'test';

test.after(async () => {
  try {
    await pool.end();
  } catch {}
});

const getCaptcha = (baseUrl) => fetch(`${baseUrl}/api/auth/captcha`).then((r) => r.json());

const registerWithCaptcha = async (baseUrl, email, password) => {
  const cap = await getCaptcha(baseUrl);
  return fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, captchaId: cap.captchaId, captchaText: _peekAnswer(cap.captchaId) }),
  });
};

const loginWithCaptcha = async (baseUrl, email, password, text) => {
  const cap = await getCaptcha(baseUrl);
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, captchaId: cap.captchaId, captchaText: text ?? _peekAnswer(cap.captchaId) }),
  });
};

test('captcha: endpoint issues SVG challenge when enabled', async () => {
  process.env.CAPTCHA_ENABLED = 'true';
  await ensureMigrated();
  await resetIdentityTables();
  const { baseUrl, server } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/auth/captcha`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.enabled, true);
    assert.ok(body.captchaId, 'captchaId present');
    assert.match(body.svg, /<svg/);
    // --- 新增：验证码真实现断言 ---
    const { _peekAnswer } = await import('../auth/captcha.js');
    const answer = _peekAnswer(body.captchaId);
    assert.ok(!/<text/i.test(body.svg), 'SVG must not contain <text> elements (answer leakage)');
    assert.ok(!body.svg.includes(answer), 'answer must not appear in SVG');
    const pathCount = (body.svg.match(/<path /g) || []).length;
    assert.ok(pathCount >= 4, `expected >= 4 <path> elements, got ${pathCount}`);
  } finally {
    server.close();
  }
});

test('captcha: endpoint reports disabled mode', async () => {
  process.env.CAPTCHA_ENABLED = 'false';
  await ensureMigrated();
  const { baseUrl, server } = await startTestServer();
  try {
    const body = await getCaptcha(baseUrl);
    assert.equal(body.enabled, false);
    assert.equal(body.captchaId, undefined);
  } finally {
    server.close();
  }
});

test('captcha: login without captcha is rejected with CAPTCHA_REQUIRED', async () => {
  process.env.CAPTCHA_ENABLED = 'true';
  await ensureMigrated();
  await resetIdentityTables();
  const { baseUrl, server } = await startTestServer();
  try {
    const email = `cap-${Date.now()}@test.local`;
    await registerWithCaptcha(baseUrl, email, 'super-secret-pass-1');
    await pool.query("UPDATE users SET status='active' WHERE email_normalized=$1", [email]);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'super-secret-pass-1' }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.error, 'CAPTCHA_REQUIRED');
  } finally {
    server.close();
  }
});

test('captcha: login with wrong captcha is CAPTCHA_INVALID and challenge is single-use', async () => {
  process.env.CAPTCHA_ENABLED = 'true';
  await ensureMigrated();
  await resetIdentityTables();
  const { baseUrl, server } = await startTestServer();
  try {
    const email = `cap-${Date.now()}@test.local`;
    await registerWithCaptcha(baseUrl, email, 'super-secret-pass-1');
    await pool.query("UPDATE users SET status='active' WHERE email_normalized=$1", [email]);
    const cap = await getCaptcha(baseUrl);
    const attempt = (text) =>
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'super-secret-pass-1', captchaId: cap.captchaId, captchaText: text }),
      });
    const wrong = await attempt('zzzz');
    assert.equal(wrong.status, 422);
    assert.equal((await wrong.json()).error, 'CAPTCHA_INVALID');
    // 单次有效：同一验证码重放直接判无效
    const reuse = await attempt('zzzz');
    assert.equal(reuse.status, 422);
    assert.equal((await reuse.json()).error, 'CAPTCHA_INVALID');
  } finally {
    server.close();
  }
});

test('captcha: correct captcha lets login proceed to password check', async () => {
  process.env.CAPTCHA_ENABLED = 'true';
  await ensureMigrated();
  await resetIdentityTables();
  const { baseUrl, server } = await startTestServer();
  try {
    const email = `cap-${Date.now()}@test.local`;
    await registerWithCaptcha(baseUrl, email, 'super-secret-pass-1');
    await pool.query("UPDATE users SET status='active' WHERE email_normalized=$1", [email]);
    // 正确验证码 + 错误密码 → 401（说明验证码关隘已通过）
    const wrongPw = await loginWithCaptcha(baseUrl, email, 'nope-not-it');
    assert.equal(wrongPw.status, 401);
    // 新验证码 + 正确密码 → 200
    const ok = await loginWithCaptcha(baseUrl, email, 'super-secret-pass-1');
    assert.equal(ok.status, 200);
  } finally {
    server.close();
  }
});

test('captcha: register requires captcha when enabled', async () => {
  process.env.CAPTCHA_ENABLED = 'true';
  await ensureMigrated();
  await resetIdentityTables();
  const { baseUrl, server } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `cap-reg-${Date.now()}@test.local`, password: 'super-secret-pass-1' }),
    });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error, 'CAPTCHA_REQUIRED');
    // 带正确验证码 → 202
    const ok = await registerWithCaptcha(baseUrl, `cap-reg-${Date.now()}@test.local`, 'super-secret-pass-1');
    assert.equal(ok.status, 202);
  } finally {
    server.close();
  }
});
