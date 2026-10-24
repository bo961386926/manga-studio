# RLS 非超级用户部署指南

## 背景

当前生产环境使用 `postgres` 超级用户连接数据库，导致 **RLS (Row Level Security) 完全失效**（`BYPASSRLS`）。这是 `SEC-07` / `GW-02` / `DATA-07` 标记的高危问题。

解决方案：创建最小权限角色 `manga_studio_app`，启用 RLS，所有应用连接使用该角色。

---

## 前置条件

- [ ] 拥有目标 PostgreSQL 实例的超级用户（`postgres`）访问权限
- [ ] 已备份数据库（`pg_dump` 或快照）
- [ ] 维护窗口：需重启 API 容器（约 30 秒停机）
- [ ] 确认 `server/migrations/010_rls_app_role.sql` 存在且未被篡改

---

## 迁移步骤

### 1. 预检（只读，可重复执行）

```bash
# 在项目根目录
cd /path/to/manga-studio

# 检查当前状态
./scripts/apply-rls-role.sh --check
```

预期输出：
- `manga_studio_app` role 不存在
- 无 grants
- GUC 默认值为空

### 2. 执行迁移

```bash
# 必须以超级用户执行（默认读取 .env 中的 postgres 凭据）
./scripts/apply-rls-role.sh --execute
```

脚本将：
1. 运行 `010_rls_app_role.sql`（创建 role、授权、设置 GUC 默认值）
2. 验证 role、grants、GUC、RLS policies
3. 输出需更新的 `.env` 变量

### 3. 更新环境变量

迁移成功后，编辑 `.env`：

```diff
- DB_USER=postgres
- DB_PASSWORD=old_superuser_password
+ DB_USER=manga_studio_app
+ DB_PASSWORD=<迁移脚本中设置的密码，默认 CHANGE_ME_IN_ENV>
```

> ⚠️ 生产环境请将 `DB_PASSWORD` 改为强密码（`openssl rand -base64 18`），并同步更新 `.env` 与 Docker secrets/SealedSecrets。

### 4. 重启 API 容器

```bash
# 仅重启 api 服务（无需重建镜像）
docker compose --env-file .env up -d --no-deps api

# 等待健康检查通过
docker compose --env-file .env ps api
# 状态应为 healthy
```

### 5. 验证 RLS 生效

```bash
# 以新用户连接，验证跨租户隔离
psql "postgres://manga_studio_app:<password>@host:5432/manga_studio" <<'SQL'
-- 1. 确认当前用户
SELECT current_user, session_user;

-- 2. 设置租户上下文（模拟应用行为）
SET LOCAL app.user_id = '00000000-0000-0000-0000-000000000001';
SET LOCAL app.is_admin = 'false';

-- 3. 尝试查询 models（应只返回该租户可见的）
SELECT count(*) FROM models;

-- 4. 尝试查询其他租户数据（应为 0 行）
-- 假设存在另一个租户的 provider
-- SELECT * FROM model_providers WHERE scope = 'private' AND owner_user_id != current_setting('app.user_id');
SQL
```

预期：查询受 RLS 限制，仅返回当前 `app.user_id` 可见的数据。

---

## 回滚方案

若迁移后出现异常（API 连接失败、权限不足）：

```bash
# 1. 恢复 .env
DB_USER=postgres
DB_PASSWORD=original_password

# 2. 重启 API
docker compose --env-file .env up -d --no-deps api

# 3. （可选）删除 role
psql "postgres://postgres:...@host:5432/manga_studio" -c "DROP ROLE IF EXISTS manga_studio_app;"

# 4. 如已执行 GRANT，需收回（迁移脚本内含 REVOKE 不会自动执行）
# 建议：迁移前做全库快照，回滚用 pg_restore
```

> ⚠️ 回滚会使 RLS 再次失效，仅作为应急方案。

---

## 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| `permission denied for table models` | 未执行 GRANT 或 role 缺失 | 重跑 `--execute`，检查 grants 输出 |
| `RLS policy violation` | 应用未设置 `app.user_id` GUC | 检查 `withUserContext` 中间件是否调用 |
| `connection refused` | 密码错误或 pg_hba.conf 拦截 | 核对 `.env` 密码，检查 `pg_hba.conf` 允许密码认证 |
| `could not connect to server` | 容器网络/防火墙 | 确认 `docker compose ps` 显示 postgres healthy |

---

## 验收清单

- [ ] `apply-rls-role.sh --check` 显示 role 存在且 grants 完整
- [ ] `.env` 已更新 `DB_USER=manga_studio_app` + 强密码
- [ ] API 容器 healthy，日志无权限报错
- [ ] 手工验证 RLS 隔离：不同 `app.user_id` 查询结果互斥
- [ ] 备份脚本（`backup-db.js`）仍能以 postgres 用户运行（不受影响）

---

## 参考文件

| 文件 | 说明 |
|------|------|
| `server/migrations/010_rls_app_role.sql` | 迁移 SQL（创建 role、GRANT、GUC 默认值、REVOKE PUBLIC） |
| `scripts/apply-rls-role.sh` | 幂等执行/检查脚本 |
| `server/db.js:102-113` | `withUserContext` 设置 `app.user_id` / `app.is_admin` GUC |
| `server/migrations/003a_models_rls.sql` | 核心表 RLS policies |

---

## 时间窗口建议

| 阶段 | 预估耗时 | 建议时机 |
|------|----------|----------|
| 预检 | 1 分钟 | 随时 |
| 执行迁移 | 30 秒 | 低峰期 |
| 更新 .env + 重启 | 1 分钟 | 紧接迁移后 |
| 验收 | 5 分钟 | 重启后立即 |

**总停机时间**：< 2 分钟（仅 API 重启）

---

## 联系人

- 数据库变更负责人：@db-admin
- 应用发布负责人：@release-engineer
- 紧急回滚决策：@tech-lead