# 数据库迁移回滚流程（阶段 2 要求）

本文档在开始自建模型网关（阶段 3）之前生效，描述阶段 1–2 引入的迁移如何安全回滚。所有迁移由 `server/db.js` 的迁移 runner 在事务中执行，并记录在 `schema_migrations` 表中。

## 迁移清单

| 文件 | 内容 | 阶段 |
|---|---|---|
| `001_identity.sql` | users / sessions / user_action_tokens / email_outbox | 1 |
| `001a_entitlements.sql` | user_entitlements / audit_events | 1 |
| `002_user_ownership.sql` | projects/assets 加 user_id、复合主键、backfill | 2 |
| `002a_settings.sql` | system_settings / user_settings | 2 |
| `002b_migration_imports.sql` | migration_imports（一次性导入绑定） | 2 |

## 回滚原则

- 每个迁移是**事务性**的：失败自动回滚，不产生部分状态。
- 回滚顺序与迁移顺序**相反**（先回滚最新的）。
- **先备份**：`pg_dump` 完整备份数据库后再执行任何回滚或重放。
- 绝不使用 `ON DELETE CASCADE` 删除用户内容；数据迁移必须保留备份副本。

## 单个迁移回滚

runner 通过 `schema_migrations.filename` 判断是否已应用。回滚单个迁移的通用步骤：

1. 停掉 API 服务（防止并发写入）。
2. 手动执行逆操作 SQL（见下）。
3. 删除 `schema_migrations` 中对应 filename 记录（如需重放）。
4. 重启服务并验证。

### 002_user_ownership.sql 逆操作（如需恢复单列主键）

```sql
ALTER TABLE projects DROP CONSTRAINT projects_pkey;
ALTER TABLE projects ADD PRIMARY KEY (id);
ALTER TABLE assets DROP CONSTRAINT assets_pkey;
ALTER TABLE assets ADD PRIMARY KEY (id);
-- 如需移除归属：
ALTER TABLE projects DROP COLUMN user_id;
ALTER TABLE assets DROP COLUMN user_id;
-- 删除迁移报告
DELETE FROM config WHERE key = 'ownership_migration_report';
```

> 注意：002 在应用时会拒绝无 admin 归属的库（RAISE EXCEPTION），因此回滚后重新应用 002 前，必须先通过 `npm run admin:bootstrap -- --email=<admin>` 创建首个管理员。

### 002a_settings.sql / 002b_migration_imports.sql 逆操作

```sql
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS migration_imports;
```

### 001a_entitlements.sql 逆操作

```sql
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS user_entitlements;
```

### 001_identity.sql 逆操作

```sql
DROP TABLE IF EXISTS email_outbox;
DROP TABLE IF EXISTS user_action_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
```

## 阶段失败时的整体策略（总计划 §发布闸门）

任一阶段失败：**保留旧可用路径，回滚当前阶段数据库迁移和路由，不通过临时开关绕过认证**。回滚路由 = 还原该阶段提交（由统一把关人负责合并/还原），再按上述 SQL 逆操作回滚数据层。旧 `/api/ai-forward` 等旧路径在阶段 3 完成前保留可用，作为失败回退目标。

## 重放（replay）说明

- 迁移文件可重复运行（`schema_migrations` 防重复）；删除对应记录后重放等价于"重新应用"，必须满足逆操作的先决条件（如 002 要求存在 admin）。
- 数据迁移（002 backfill、legacy-config 导入）**幂等**：已归属行不会被改写；envelope 导入带 `export_id` 一次性绑定，重放会被 409 拒绝。

## 自动备份与恢复（新增）

### 自动备份机制

- **一键手动备份**：`npm run backup` → 立即 `pg_dump` 全库（custom 格式）到 `backups/`
- **自动定时备份**：服务启动后自动启用调度器（默认每 24 小时一次，首次 10 分钟后；环境变量 `BACKUP_INTERVAL_HOURS` / `BACKUP_INITIAL_DELAY_MS` 可调，`BACKUP_DISABLED=true` 关闭）
- **轮转保留**：默认保留最近 14 份（`BACKUP_KEEP` 可调），自动清理更旧的
- 备份文件命名：`backups/manga_studio-YYYYMMDD-HHMMSS.dump`（目录已在 .gitignore）

### 恢复备份

```bash
# 查看备份内容（19 个表数据段等）
pg_restore -l backups/manga_studio-<时间戳>.dump

# 恢复到指定数据库（会覆盖目标库）
pg_restore --host localhost --username postgres --dbname manga_studio \
  --clean --if-exists backups/manga_studio-<时间戳>.dump

# 恢复到新库（保留原库）
createdb manga_studio_restore
pg_restore --dbname manga_studio_restore backups/manga_studio-<时间戳>.dump
```

### 恢复策略

- 遇到数据损坏/误删：优先用最近的备份恢复
- 恢复前先另存当前库（`pg_dump` 一份当前状态），避免恢复过程覆盖新数据
- 恢复后重启服务（迁移 runner 幂等，`schema_migrations` 保证不重复应用）
