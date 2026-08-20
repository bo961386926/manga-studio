# 身份与公网安全基础实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立邮箱注册、验证、登录、退出、找回密码、管理员 bootstrap、Cookie session、CSRF、CORS 和限流，使服务具备安全的认证基础。

**Architecture:** 在现有 Express `server/index.js` 外增加认证模块和数据库迁移，不重写现有业务查询；session 由服务端保存，浏览器只持有 HttpOnly cookie。邮件使用数据库 outbox，发送失败不阻塞注册事务。

**Tech Stack:** Node.js ESM、Express、PostgreSQL、Argon2id、Node `crypto` AES-GCM/HMAC、`node:test`。

---

## 文件责任地图

**Create**

- `server/migrations/001_identity.sql`：users、sessions、one-time tokens、email outbox、audit 基础表及约束。
- `server/auth/password.js`：Argon2id 哈希/验证与密码策略。
- `server/auth/tokens.js`：随机 token、哈希、单次原子消费。
- `server/auth/session.js`：session 创建、读取、撤销、版本失效、cookie 选项。
- `server/auth/middleware.js`：requireUser、requireAdmin、Origin/Fetch Metadata、CSRF、近期再认证。
- `server/auth/routes.js`：注册、验证、登录、退出、重置、当前用户、CSRF endpoint。
- `server/auth/outbox.js`：SKIP LOCKED/lease 邮件 worker 和 SMTP TLS 发送接口。
- `server/bootstrap-admin.js`：离线 bootstrap CLI 与 maintenance/advisory lock。
- `server/test/auth.test.js`、`server/test/security.test.js`：纯函数与路由安全测试。

**Modify**

- `server/db.js`：统一迁移入口、事务辅助函数、连接池关闭。
- `server/index.js`：注册安全 middleware、挂载 auth routes、启动/停止 outbox worker；旧业务路由暂时保留但在阶段 2 关闭。
- `server/package.json`：增加 `argon2`、`nodemailer`（或兼容 SMTP 客户端）和 `"test": "node --test"`。
- `.env.example`：COOKIE、CORS、SMTP、Argon2、bootstrap 参数示例，禁止 plaintext admin password。
- `nginx.conf`：仅允许配置的 HTTPS origin，转发 `X-Forwarded-*` 仅信任明确代理。

## Task 1: 建立服务端测试与迁移骨架

**Files:** create `server/test/helpers.js`, `server/test/auth.test.js`; modify `server/db.js`, `server/package.json`。

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, validatePassword } from '../auth/password.js';

test('normalizes email and enforces 10-128 byte password policy', () => {
  assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com');
  assert.equal(validatePassword('123456789'), false);
  assert.equal(validatePassword('1234567890'), true);
  assert.equal(validatePassword('x'.repeat(129)), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- --test-name-pattern="normalizes email"`

Expected: FAIL because `server/auth/password.js` does not exist.

- [ ] **Step 3: Implement the migration runner and password module**

`server/auth/password.js` must export `normalizeEmail`, `validatePassword`, `hashPassword`, `verifyPassword`; use byte length (`Buffer.byteLength`) and Argon2id, never plain SHA-256.

- [ ] **Step 4: Run test to verify it passes**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth/password.js server/test/auth.test.js server/package.json server/db.js
git commit -m "feat(auth): add identity migration and password primitives"
```

## Task 2: Add users, sessions, tokens, and outbox tables

**Files:** create `server/migrations/001_identity.sql`; modify `server/db.js`.

- [ ] **Step 1: Write migration assertions**

```js
test('identity migration creates required tables and unique normalized email', async () => {
  const tables = await listTables();
  assert.deepEqual(tables.sort(), ['email_outbox', 'one_time_tokens', 'sessions', 'users']);
  await assert.rejects(insertUser('u2', 'USER@example.com'), /users_email_normalized_key/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd server && npm test -- --test-name-pattern="identity migration"`. Expected: FAIL until a test database is configured.

- [ ] **Step 3: Implement SQL and runner**

The migration must include `users`, `sessions` with `csrf_token_hash/csrf_expires_at/csrf_version`, `one_time_tokens` with purposes `verify_email/reset_password/bootstrap_admin`, and `email_outbox` with lease/status checks. Run migrations in a transaction and record applied filenames in `schema_migrations`.

- [ ] **Step 4: Verify**

Run: `docker compose up -d db && cd server && DATABASE_URL=... npm test -- --test-name-pattern="identity migration"`. Expected: PASS and duplicate normalized email rejected.

- [ ] **Step 5: Commit**

```bash
git add server/migrations/001_identity.sql server/db.js server/test
git commit -m "feat(auth): create identity and email outbox schema"
```

## Task 3: Implement sessions, CSRF, CORS, and rate limits

**Files:** create `server/auth/tokens.js`, `server/auth/session.js`, `server/auth/middleware.js`, `server/test/security.test.js`; modify `server/index.js`, `.env.example`.

- [ ] **Step 1: Write security tests**

```js
test('unsafe mutation rejects missing or mismatched CSRF', async () => {
  const response = await request('/api/auth/logout', { method: 'POST', cookie, headers: { Origin: allowedOrigin } });
  assert.equal(response.status, 403);
});

test('CORS never emits wildcard origin', async () => {
  const response = await request('/api/auth/me', { headers: { Origin: 'https://evil.example' } });
  assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npm test -- --test-name-pattern="CSRF|wildcard"`. Expected: FAIL.

- [ ] **Step 3: Implement**

Use 256-bit random session IDs stored only as SHA-256 hashes; cookie flags are `HttpOnly; Secure; SameSite=Lax; Path=/`, max age 7 days. Bind CSRF hash to session and rotate after login/password change. Require `Origin` or Fetch Metadata for anonymous unsafe requests, exact CORS allowlist, and trusted proxy CIDR before reading forwarded IPs. Add per-IP/email/login/reset limits with generic responses.

- [ ] **Step 4: Verify and commit**

Run the targeted test, then `cd server && npm test`. Commit:

```bash
git add server/auth server/index.js server/test/security.test.js .env.example
git commit -m "feat(auth): protect sessions csrf cors and rate limits"
```

## Task 4: Implement auth routes and email outbox

**Files:** create `server/auth/routes.js`, `server/auth/outbox.js`; modify `server/index.js`.

- [ ] **Step 1: Write route tests**

```js
test('registration creates unverified user and queues verification email', async () => {
  const response = await request('/api/auth/register', { method: 'POST', json: { email: 'a@example.com', password: '1234567890' } });
  assert.equal(response.status, 202);
  assert.equal((await findUser('a@example.com')).email_verified_at, null);
  assert.equal(await countOutbox('verify_email'), 1);
});

test('unverified user cannot call protected API', async () => {
  assert.equal((await request('/api/projects')).status, 403);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npm test -- --test-name-pattern="registration|unverified"`. Expected: FAIL.

- [ ] **Step 3: Implement routes**

Implement `POST /api/auth/register`, `GET /api/auth/verify-email`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/request-password-reset`, `POST /api/auth/reset-password`, `GET /api/auth/me`, and `GET /api/auth/csrf`. Tokens are stored hashed, email token expires 24h, reset token 30m, and consumption is one SQL conditional update. Login returns generic failure for unknown/unverified/disabled users.

- [ ] **Step 4: Implement outbox worker**

Claim pending rows with `FOR UPDATE SKIP LOCKED`, set a lease, send via TLS/STARTTLS, mark sent or dead with bounded retries; templates receive action URLs only, never raw token persistence or logging.

- [ ] **Step 5: Verify and commit**

Run: `cd server && npm test`. Expected: all auth tests pass. Commit:

```bash
git add server/auth server/index.js server/test
git commit -m "feat(auth): add email registration login and recovery"
```

## Task 5: Add VIP entitlements and administrator controls

**Files:** create `server/auth/entitlements.js`, `server/auth/admin-routes.js`, `server/auth/audit.js`, `server/test/entitlements.test.js`; modify `server/auth/routes.js`, `server/index.js`.

- [ ] **Step 1: Write entitlement and registration-pause tests**

```js
test('verified user can use free capability but not VIP capability', async () => {
  assert.equal(await canUseCapability({ userId: 'u1', accessLevel: 'free' }), true);
  assert.equal(await canUseCapability({ userId: 'u1', accessLevel: 'vip' }), false);
  await grantVip({ userId: 'u1', expiresAt: null });
  assert.equal(await canUseCapability({ userId: 'u1', accessLevel: 'vip' }), true);
});

test('admin can pause registration and cannot remove the last admin', async () => {
  await setRegistrationOpen(false);
  assert.equal((await request('/api/auth/register', { method: 'POST', json: validUser })).status, 403);
  await assert.rejects(removeAdmin('last-admin'), /last admin/);
});
```

- [ ] **Step 2: Implement**

Create entitlement rows with permanent or expiring VIP, admin grant/extend/revoke, and server-side access evaluation (`verified user + active entitlement + model access level`). Add admin endpoints to pause/resume registration and manage users/entitlements; add last-admin guard and 15-minute reauthentication for high-risk actions. Record structured audit events containing actor/action/target/result/request metadata, never passwords, tokens, prompts, outputs or keys. Do not add points, payment or SMS.

- [ ] **Step 3: Verify and commit**

Run: `cd server && npm test -- --test-name-pattern="VIP|registration|last admin"`. Commit:

```bash
git add server/auth server/test/entitlements.test.js server/index.js
git commit -m "feat(auth): add vip entitlements and admin controls"
```

## Task 6: Add bootstrap admin and stage-1 release gate

**Files:** create `server/bootstrap-admin.js`; modify `server/index.js`, `.env.example`, `server/test/auth.test.js`.

- [ ] **Step 1: Write bootstrap tests**

```js
test('bootstrap refuses when an active admin already exists', async () => {
  await assert.rejects(runBootstrap({ email: 'admin@example.com' }), /active admin exists/);
});

test('bootstrap token is purpose-bound and single-use', async () => {
  const token = await createBootstrapToken();
  await consumeToken(token, 'bootstrap_admin');
  await assert.rejects(consumeToken(token, 'bootstrap_admin'));
});
```

- [ ] **Step 2: Implement**

Use maintenance mode plus PostgreSQL advisory lock; accept admin email interactively or from a protected terminal prompt, never a plaintext password environment variable. Create a pending admin and one-time `bootstrap_admin` token, display the setup URL once, require email verification, and add last-admin guard for disable/delete operations.

- [ ] **Step 3: Verify and commit**

Run: `cd server && npm test`, then `node bootstrap-admin.js --help`. Commit:

```bash
git add server/bootstrap-admin.js server/index.js server/test .env.example
git commit -m "feat(auth): add safe bootstrap admin flow"
```

## Task 7: Stage-1 acceptance

- [ ] Run `cd server && npm test`.
- [ ] Run `pnpm build`.
- [ ] Verify with curl that unauthenticated `GET /api/auth/me` is 401, unverified `/api/projects` is 403, and CSRF mismatch is 403.
- [ ] Verify logs contain no password, raw token, cookie, or authorization header.
- [ ] Record the commit SHA and do not begin the data-isolation plan until all checks pass.
