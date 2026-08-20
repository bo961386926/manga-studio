# 用户数据隔离与迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 projects、assets、settings、模型配置和旧 Electron/localStorage 迁移到明确的用户归属，消除跨用户读取和旧全局 config 路径。

**Architecture:** 保留现有 JSONB 数据格式和服务函数，增加 `user_id` 作为数据库主键组成部分；所有 repository 查询显式带 `user_id`。内置模型迁移为 shared，旧自定义模型迁移为 bootstrap admin private。迁移采用可回滚 SQL 和一次性加密导入。

**Tech Stack:** Express/pg、PostgreSQL composite keys、React localStorage bridge、AES-GCM envelope、Node/Vitest tests。

---

## 文件责任地图

**Create**

- `server/migrations/002_user_ownership.sql`：projects/assets/config 拆分、user_id、复合主键、RLS/索引。
- `server/repositories/projects.js`、`server/repositories/assets.js`、`server/repositories/settings.js`：带 owner 参数的数据访问。
- `server/migration/legacy-config.js`：旧 config/model registry 导入与报告。
- `server/migration/envelope.js`：v1 Argon2id + AES-GCM 迁移包。
- `server/routes/migration.js`：一次性管理员导入事务。
- `server/test/isolation.test.js`、`server/test/migration.test.js`。
- `services/remoteMigration.ts`：Electron 导出包与远端导入 UI API。

**Modify**

- `server/db.js`、`server/index.js`：迁移、repository 和 authenticated route wiring。
- `services/storageService.ts`、`services/modelRegistry.ts`：迁移向导与停止按关键词删除。
- `App.tsx`、`components/ModelConfig/*`：只展示掩码配置，迁移/登录状态提示。
- `electron/main.cjs`、`package.json`：桥接版本导出能力和远端 HTTPS 加载安全策略。

## Task 1: Add schema migration with dual-read safety

**Files:** create `server/migrations/002_user_ownership.sql`, `server/test/isolation.test.js`; modify `server/db.js`.

- [ ] **Step 1: Write failing cross-user tests**

```js
test('project query always scopes by user id', async () => {
  await saveProject('u1', 'p1', { title: 'one' });
  await saveProject('u2', 'p1', { title: 'two' });
  assert.equal((await getProject('u1', 'p1')).title, 'one');
  assert.equal(await getProject('u2', 'missing'), null);
  assert.equal(await getProject('u2', 'p1').then((p) => p.title), 'two');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npm test -- --test-name-pattern="project query"`. Expected: FAIL because old functions accept only id.

- [ ] **Step 3: Implement migration**

Within a transaction: add nullable `user_id`, backfill existing rows to bootstrap admin, drop old single-column PK, create composite `(user_id,id)` PK and `ON CONFLICT (user_id,id)` upserts, add owner indexes, and keep a migration report. Do not drop old config rows until new settings import succeeds.

- [ ] **Step 4: Implement repositories**

Every function signature must carry `userId` first:

```js
export async function getProject(userId, id) {
  const { rows } = await pool.query('SELECT data FROM projects WHERE user_id = $1 AND id = $2', [userId, id]);
  return rows[0]?.data ?? null;
}
```

- [ ] **Step 5: Verify and commit**

Run: `cd server && npm test -- --test-name-pattern="project query"`. Commit:

```bash
git add server/migrations/002_user_ownership.sql server/repositories server/db.js server/test/isolation.test.js
git commit -m "feat(isolation): scope projects and assets by user"
```

## Task 2: Protect routes and split settings namespaces

**Files:** create `server/repositories/settings.js`; modify `server/index.js`, `server/test/isolation.test.js`.

- [ ] **Step 1: Write IDOR tests**

```js
test('user B cannot read, update, or delete user A project', async () => {
  const a = await requestAs('u1', '/api/projects/p1');
  const b = await requestAs('u2', '/api/projects/p1');
  assert.equal(a.status, 200);
  assert.equal(b.status, 404);
  assert.equal((await requestAs('u2', '/api/projects/p1', { method: 'DELETE' })).status, 404);
});

test('legacy config route is unavailable after migration', async () => {
  assert.equal((await requestAs('u1', '/api/config/model')).status, 410);
});
```

- [ ] **Step 2: Implement**

Change routes to `/api/user/settings/:key` and `/api/admin/system-settings/:key`; use `requireUser`/`requireAdmin`, never infer owner from request body. Return 404 for another user’s resource to avoid existence leaks. Mark `/api/config/:key` migration-only and return 410 after one-time import/skip.

- [ ] **Step 3: Verify and commit**

Run: `cd server && npm test -- --test-name-pattern="IDOR|legacy config"`. Commit:

```bash
git add server/index.js server/repositories/settings.js server/test/isolation.test.js
git commit -m "feat(isolation): enforce owner routes and retire global config"
```

## Task 3: Migrate model configuration ownership

**Files:** create `server/migration/legacy-config.js`, `server/test/migration.test.js`; modify `services/modelRegistry.ts`, `services/storageService.ts`.

- [ ] **Step 1: Write migration mapping tests**

```js
test('built-in becomes shared and old custom becomes admin private', () => {
  const result = classifyLegacyModel({ id: 'custom-1', provider: 'self-hosted' }, { isBuiltIn: false, adminId: 'admin' });
  assert.deepEqual(result.scope, 'private');
  assert.equal(result.ownerId, 'admin');
});
```

- [ ] **Step 2: Implement deterministic mapping**

Built-ins become shared only after admin confirmation; old custom entries become private Provider/Model owned by bootstrap admin. Preserve old ID/API name mapping; ambiguous names stop migration and produce a report. Remove keyword-based deletion of IDs containing `gpt`, `claude`, `gemini`, `sora`, `veo`.

- [ ] **Step 3: Implement browser migration wizard**

Scan only `manga_studio_model_registry`, `antsk_api_key`, `manga_studio_model_config`; parse string/object JSON; display masked summary; upload only after explicit admin confirmation; delete local keys only after server success and second confirmation.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test -- --run` and `cd server && npm test -- --test-name-pattern="migration mapping"`. Commit:

```bash
git add server/migration services/modelRegistry.ts services/storageService.ts server/test/migration.test.js
git commit -m "feat(isolation): migrate legacy model config with ownership"
```

## Task 4: Implement Electron bridge export and remote import envelope

**Files:** create `server/migration/envelope.js`, `server/routes/migration.js`, `services/remoteMigration.ts`, `server/test/migration.test.js`; modify `electron/main.cjs`, `package.json`.

- [ ] **Step 1: Write envelope tests**

```js
test('v1 envelope decrypts only with the export password and AAD', async () => {
  const envelope = await sealEnvelope({ exportId: 'e1', config: { key: 'masked' } }, 'one-time-password');
  assert.deepEqual(await openEnvelope(envelope, 'one-time-password'), { exportId: 'e1', config: { key: 'masked' } });
  await assert.rejects(openEnvelope(envelope, 'wrong'), /authentication failed/);
});
```

- [ ] **Step 2: Implement envelope**

Use Argon2id parameters in the envelope, random nonce, AES-GCM tag, `export_id/version/purpose` AAD, no key in the file, and wipe plaintext/password buffers. Import requires authenticated admin, one-time transaction binding deployment/user/export_id/expiry, and rejects replay/cross-transaction use.

- [ ] **Step 3: Implement bridge**

The old Electron release scans only known localStorage keys, creates the envelope, lets admin set a one-time migration password, and writes no server credentials. The new remote Web release imports via authenticated same-origin API. Do not add a local Express gateway.

- [ ] **Step 4: Verify and commit**

Run: `pnpm build`, `cd server && npm test -- --test-name-pattern="envelope|replay"`; manually verify remote HTTPS loading and no `nodeIntegration`/remote preload. Commit:

```bash
git add server/migration server/routes/migration.js services/remoteMigration.ts electron/main.cjs package.json server/test/migration.test.js
git commit -m "feat(isolation): add encrypted legacy migration bridge"
```

## Task 5: Stage-2 acceptance

- [ ] Run `cd server && npm test` and `pnpm test`.
- [ ] Confirm two users with same project/asset ID remain isolated.
- [ ] Confirm old `/api/config/:key` is 410 after import/skip.
- [ ] Confirm migration report masks credentials and is audit logged.
- [ ] Confirm old Electron exports before new remote Web import; no cross-origin localStorage assumption.
- [ ] Confirm database rollback procedure is documented before beginning the model gateway plan.
