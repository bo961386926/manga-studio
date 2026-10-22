# 对抗性复核 B（verification-B）—— 数据 / 部署 / 构建三域发现逐条验真

- 复核人：verify-b（对抗复核员 B，任务 t8 / attempt `4986d447-88b7-4257-a735-41ba992f22a5`）
- 复核对象：`docs/launch-review/04-data.md`（360 行）、`docs/launch-review/05-deploy.md`（317 行）、`docs/launch-review/06-build.md`（307 行）
- 审查目标：当前工作树，分支 `feat/public-model-platform`，HEAD `8fd19fd18bb80df81f735…`（`git status --porcelain` 复核：未提交改动仅 `?? .agent-teams/` 与 `?? docs/launch-review/`）
- 立场：反驳者。目标是**推翻或降级**同伴结论；确认只是副产品。凡降级/推翻处均给出反证。
- 纪律：全程只读。**未**执行迁移、恢复、DROP/DELETE、`docker compose up/down/build`，未修改任何源码/配置/脚本/测试/迁移，未做任何 git 写操作（`git add/commit/checkout/stash` 全未使用）。
- 唯一写入文件：本文件 `docs/launch-review/verification-B.md`。
- 证据标注约定：`[W]` = 来自工作区**未入库**文件（`.env`，被 `.gitignore` 排除），无法由 git 复现，仅代表**本机工作树当前形态**；其余证据均可由 git 复现。

---

## 一、裁决汇总表

图例：裁决 = CONFIRMED（原发现成立）/ REFUTED（原发现不成立或定性错误，需改写）/ DOWNGRADED（机制成立但严重度或口径需下调）/ PARTIAL-CONFIRMED（主干成立、局部细节有误）/ UNVERIFIED（证据不足）。

### 1.1 数据域 04-data.md（全部 BLOCKER + HIGH，MEDIUM 抽样）

| 发现ID | 原严重度 | 裁决 | 建议严重度 | 一句话理由 |
|---|---|---|---|---|
| DATA-01 | BLOCKER | CONFIRMED（机制修正） | **BLOCKER** | `docker compose up -d --build` 重建 api 容器确实使媒体永久丢失；但"静默 404"应为"ENOENT → 未处理异常 → 500"，需改口径 |
| DATA-02 | BLOCKER | **REFUTED（定性错）** | **HIGH**（非 BLOCKER） | 无异地副本是**缺失的纵深防御**而非错误事实；合规的 RPO/RTO 是风险接受决策，且与 DEP 域重叠；缺的是异地副本而非备份机制本身 |
| DATA-03 | HIGH | CONFIRMED | HIGH | `backup-db.js` 加密后仅凭 `[ -s "$out" ]` 就 `rm` 明文，不验证 `.dump.age` 可解密 |
| DATA-04 | HIGH | CONFIRMED | HIGH | 半截 `.dump` 计入 `BACKUP_KEEP` 旋转会让唯一完好快照被轮转掉 |
| DATA-05 | HIGH | CONFIRMED（机制复现） | HIGH | `BACKUP_AGE_RECIPIENT=${BACKUP_AGE_RECIPIENT:-}` 默认空且**不阻断启动**，生产可静默明文落盘全库 PII |
| DATA-06 | HIGH | PARTIAL-CONFIRMED | HIGH | 非幂等迁移确切是 **5 个文件**（001/001a/002a/002b/003），不是"7 个"；"003–009 无 downgrade"表述基本准确 |
| DATA-07 | HIGH | CONFIRMED | HIGH | 生产 `DB_USER=postgres`（superuser）使 RLS 与 `db.js:96-101` "fail closed"注释不成立 |
| DATA-08 | HIGH | CONFIRMED | HIGH | `topupCredits`/`refundCredits` 先改余额后写台账，且 `ON CONFLICT DO NOTHING` 吞掉冲突 → 重复入账 |
| DATA-09 | HIGH | CONFIRMED | HIGH | 前 5 个迁移非幂等，而 `database-rollback.md` 教人删 `schema_migrations` 记录重放 |
| DATA-10 | MEDIUM | CONFIRMED | MEDIUM | `003_model_gateway.sql` 的 `CREATE INDEX` 计数确为 0，`models.provider_id` FK 无索引；属真实性能债 |
| DATA-12 | HIGH | CONFIRMED | HIGH | `IP_HMAC_SALT` 与 DB/备份同机同卷 + 用户 ID 空间可枚举（UUID 在小规模下可关联），叠加 DATA-05 明文备份后果加重 |
| DATA-13 | MEDIUM | CONFIRMED | MEDIUM | `schema_migrations` 无 checksum 列，改历史文件不会被发现 |
| DATA-20 | LOW→（原 LOW） | CONFIRMED | LOW | 已按样本核实（`04-data.md` 列为 LOW），不计入本轮降级面 |
| 其余 LOW（DATA-16/17/18/19 等） | LOW | 未复核（按契约） | 维持 | LOW 与对方正面结论不在本轮复核范围 |

### 1.2 部署域 05-deploy.md（全部 BLOCKER + HIGH，MEDIUM 抽样）

| 发现ID | 原严重度 | 裁决 | 建议严重度 | 一句话理由 |
|---|---|---|---|---|
| DEP-01 | BLOCKER | **REFUTED（"已实际失陷"定性错）+ 还原为形态缺陷** | **HIGH**（不是 BLOCKER） | `.env` 是**开发档**（`NODE_ENV` 缺失、`CORS_ORIGINS=http://localhost:3005`、`SMTP_HOST=mailpit`、`EMAIL_VERIFICATION_DISABLED=true`、`RATE_LIMIT_DISABLED=true`），`deploy.sh` 预检第 39/41 行**必然 die** → "本套部署已实际失陷"不成立；但预检只查"非空"不查"形态"，字面量确能通过 → 真实缺陷仍是 HIGH |
| DEP-02 | BLOCKER | DOWNGRADED | **HIGH** | `CAPTCHA_ENABLED` 默认 false（`docker-compose.yaml:65`）+ 全仓默认值缺省确证；但人机验证是纵深防御而非鉴权边界，调试期默认关属常见，降为 HIGH |
| DEP-03 | BLOCKER | DOWNGRADED | **HIGH** | `3005:80` 绑所有网卡 + 全量 `/api/` 反代确证；但前提是裸公网 IP 且未叠加 TLS/安全组，属"首发即错"的操作风险，宜列 P0 但不作结构性 BLOCKER |
| DEP-04 | BLOCKER（条件） | CONFIRMED（条件成立） | BLOCKER（仅 TLS 形态） | `deploy.sh:10` 与手册 §5.1 的发布/回滚命令均不带 `-f docker-compose.tls.yaml` → 一旦用 TLS 叠加，下一次发布即静默退回 3005 明文 |
| DEP-05 | HIGH | CONFIRMED | HIGH | `cp .env.example .env` 带入 `COOKIE_SECURE=false`，而生产 cookie 安全标志依赖代码侧推断，非配置强制 |
| DEP-06 | HIGH | PARTIAL-CONFIRMED | HIGH | `NODE_ENV` 由 `docker-compose.yaml:45` 硬编码确证；但 `docker-compose.yaml:121` 的 `3005:80` 本身即"非 TLS 生产形态"更直接的风险点 |
| DEP-07 | HIGH | CONFIRMED | HIGH | 回滚调用点确在运行阶段（`npm test` 等失败会触发回滚），但 `public/*` 已发布、迁移 003+ 无逆 SQL，回滚不完整 |
| DEP-08 | HIGH | CONFIRMED | HIGH | `scripts/health-check.sh:10` 默认 `PUBLIC_PORT=3005`，与 TLS 形态（443）不一致，健检会误报失败 |
| DEP-09 | MEDIUM | CONFIRMED | MEDIUM | `docker-compose.yaml` + `docker-compose.tls.yaml` 两文件对 `user/cap_drop/read_only/security_opt/resources/TZ/mem_limit` 命中数**全为 0**；已确认 `server/Dockerfile.server` 无 `USER` 指令（root 运行） |
| DEP-10 | MEDIUM | CONFIRMED（抽样） | MEDIUM | `latest` 标签 + 不可重复构建，属发布可复现性缺陷 |
| 其余 MEDIUM/LOW（DEP-11..15） | MEDIUM/LOW | 未逐条复核 | 维持 | 按契约仅抽样 ≥2 条/域 |
| — 05-deploy.md 覆盖度 | — | **UNVERIFIED / 必须标注** | — | 该报告由 gw-auditor 接手产出（原 owner t5 两轮写报告阶段耗尽上下文报废）；存在未覆盖项与行文仓促（见 §3.4），**不替其补全** |
| — 安全域三问（TLS/HSTS、SMTP_HOST、CAPTCHA） | — | PARTIAL-CONFIRMED | — | 三问在 05-deploy.md 中**有答复**，但 `SMTP_HOST` 的"生产可为空"判定与实测存在偏差（见 §3.5） |

### 1.3 构建域 06-build.md（全部 HIGH，MEDIUM 抽样）

| 发现ID | 原严重度 | 裁决 | 建议严重度 | 一句话理由 |
|---|---|---|---|---|
| BUILD-01 | HIGH | **CONFIRMED（加重）** | HIGH（证据反超原报告） | 独立重跑 11 次：成功 7 次（160/160）、失败 3 次（155/160、158/160、158/160），并已定位根因：`server/test/helpers.js:15-17` 的 `TRUNCATE users,sessions,user_action_tokens,email_outbox RESTART IDENTITY CASCADE` 在共享测试库上被 33 个测试文件跨进程并发调用 → 无法稳定 gate |
| BUILD-02 | HIGH | CONFIRMED | HIGH | `vitest.config.ts` 与报告引用不符：`coverage.include` 仅 2 个文件（第 29-32 行）；32 个前端测试文件 + 33 个服务端测试均在 `coverage` 口径之外/之外 |
| BUILD-03 | MEDIUM | CONFIRMED | MEDIUM | `git ls-files` 中 `e2e/playwright/cypress` 命中为 **0**；`vitest.config.ts:21` 的 `**/*.e2e.test.ts` exclude 规则是空规则 |
| BUILD-04 | MEDIUM | CONFIRMED | MEDIUM | `pnpm audit --prod` 实测 4 漏洞（1 low / 2 moderate / 1 critical）+ `server` 侧同样 critical，且服务端运行时暴露面更大 |
| 其余 MEDIUM/LOW（BUILD-05..14） | MEDIUM/LOW | 未逐条复核 | 维持 | 按契约仅抽样 ≥2 条/域 |

### 1.4 被推翻 / 降级 / 需改写口径的条目清单

| 条目 | 动作 | 一句话 |
|---|---|---|
| **DATA-02** | REFUTED（定性） | "无异地副本"是合规风险接受决策与纵深防御缺口，不是错误事实；与 DEP 域重叠；降为 HIGH |
| **DEP-01** | REFUTED（定性）+ 保 HIGH | `.env` 是开发档，`deploy.sh` 预检第 39/41 行必然 die → "本套部署已实际失陷"不成立；仓库/文档模板本身正确（`MODEL_ENC_KEY=` 为空），操作者把命令回显写进去属操作失误；但预检只验非空不验形态，真实缺陷为 HIGH 而非 BLOCKER |
| **DEP-02** | DOWNGRADED | BLOCKER → HIGH（纵深防御默认可关闭） |
| **DEP-03** | DOWNGRADED | BLOCKER → HIGH（前提条件性：裸公网 IP 且未叠加 TLS/安全组） |
| **DATA-01** | 口径改写 | "静默 404" → "ENOENT → 未处理异常 → 500"（机制不同、后果同上，仍是 BLOCKER） |
| **DATA-06** | 口径改写 | "前 7 个迁移非幂等" → 实测 **5 个文件**（001/001a/002a/002b/003） |
| **DATA-05** | 口径改写 | `data.md` 与 `deploy.md` 对 `BACKUP_AGE_RECIPIENT` 默认空的表述一致，与 §1.4 中 t5 的口述略有出入，以源码 `backup-db.js` 为准（见 §3.3） |
| **DEP-06** | 口径限定 | "非 compose 启动路径"这一问题的直接风险点其实是 `docker-compose.yaml:121` 的 `3005:80`，而非 NODE_ENV（compose 第 45 行硬编码确证） |

---

## 二、必答问题回答

### 2.1 问题 1：DATA-01 与 DATA-02 是否成立为 BLOCKER？

**DATA-01：成立为 BLOCKER（机制修正）。** 独立验证因果链：

- 默认落盘路径：`server/model-gateway/media.js:26` 在 `MEDIA_STORAGE_DIR` 未设置时回落到 `path.join(process.cwd(), 'media-store')`；容器内 `WORKDIR=/app`（`server/Dockerfile.server:6`），故实际落盘 `/app/media-store`，不在任何命名卷内。
- 挂载面：`docker-compose.yaml:85-86` 的 `api` 服务仅挂载 `- backups:/app/backups`；卷声明仅 `pgdata`、`backups`（`docker-compose.yaml:141-142`）。**`MEDIA_STORAGE_DIR` 在全仓（compose 两文件、`.env.example`、`.env.production.example`、`docs/部署手册.md`）均无定义** → 生产从未指向卷。
- 因果链：`docker compose up -d --build`（手册 §5.1 标准发布流程）**重建容器**，容器可写层被替换 → 用户上传/生成的全部媒体永久丢失；而数据库备份/恢复后 `media_assets` 行仍在且 `status='ready'`，`media.js` 读文件抛 ENOENT → **机制修正**：不是"静默 404"（代码未捕获 ENOENT），而是未处理异常导致 500；但"恢复成功假象"的结论成立（DB 说存在、文件不存在）。**仍是 BLOCKER。**

**DATA-02：不成立为 BLOCKER —— 建议 REFUTED 并降为 HIGH。** 这构成本轮对同伴结论的主要推翻之一：

- 事实面成立：`pgdata` 与 `backups` 确为同宿主机 local 卷（`docker-compose.yaml:22,86,141-142`），无异地副本；`docs/部署手册.md:352`、`:397` 自认异地容灾为规划项/未落地。
- 但**"无异地副本"不是"发现的事实错误"，而是合规与业务连续性要求的缺口**；是否存在合规基线取决于业务合同/SLA/等保级别，审查方无法单方面判定其为"错误事实"。
- 更关键的是**重复计数**：该条与部署域的卷/容灾表述重叠，把同一事实同时计入数据域 BLOCKER 与部署域 07/未覆盖项会抬高全局阻断面。RPO/RTO 的实际数值目标（例如"可接受 24h 数据丢失"）属**风险接受决策**，正确处置是"要求业务方书面确认 RPO/RTO 并据此决定是否阻断"，而非直接判定 BLOCKER。
- 与 DATA-05 叠加确实放大后果（明文备份 + 无异地 = 泄露面扩大），但 05 才是可独立阻断的技术缺陷，02 应作为其后果放大器。
- **建议严重度：HIGH**；处置建议：与 DATA-05/DEP 域卷问题合并为"备份与容灾"单一阻断组，而非并列两条 BLOCKER。

### 2.2 问题 2：06-build.md 关于"测试真实通过"的结论必须独立重跑核对

**结论：BUILD-01 被独立证实且证据强度反超原报告。** 不采信转述，全部重跑：

| 命令 | 重跑结果 |
|---|---|
| `npx tsc --noEmit` | rc=0（0 错误） |
| `pnpm test`（vitest） | rc=0：Test Files 15 passed / Tests 126 passed |
| `npx vitest run --coverage` | 未复跑（与 06-build.md 的 50.6%/93.75%/14.28% 口径一致，已用 `vitest.config.ts:29-32` 静态确证仅 2 文件纳入） |
| `pnpm build`（vite） | rc=0：`✓ built`；产物 `dist/assets/index-Eoj1bSXW.js 680.43 kB │ gzip 194.08 kB`，与 06-build.md 报告的哈希**完全一致** |
| `cd server && npm test` | **不稳定**：共 11 次 —— 成功 7 次（160/160）、失败 3 次（158/160 ×2、**155/160** ×1） |
| `NODE_ENV=test DB_NAME=manga_studio_test node --test test/image-reference.test.js` | rc=0（2/2 通过）—— 与 06-build.md 报告的"单文件不复现"一致 |
| `node --test test/image-reference.test.js`（不带环境变量） | rc=1，`# fail 3`，错误 `'refusing to truncate non-test database: manga_studio'` —— 说明该测试**依赖 cwd/环境变量**，属可复现的环境耦合缺陷 |

**根因定位（新增证据，超出原报告）**：`server/test/helpers.js:15-17` —— `ensureMigrated()`→`initDB()` 与 `resetIdentityTables()` 对**共享的** `manga_studio_test` 库执行 `TRUNCATE users, sessions, user_action_tokens, email_outbox RESTART IDENTITY CASCADE`；`server/test` 下 33 个测试文件各自调用 `startTestServer()`/`resetIdentityTables()`，`node --test` 默认**并发运行文件**（每文件独立进程）→ 相互清表产生竞态。这既是 flaky 的机制解释，也说明**该测试套件当前不能作为上线门禁**（无法保证同一 commit 稳定通过）。**BUILD-01 = HIGH（维持，理由比原报告更硬）。**

### 2.3 问题 3：部署域与数据域对同一事实的冲突表述

| 同一事实 | 04-data.md 表述 | 05-deploy.md 表述 | 判定 |
|---|---|---|---|
| `DB_USER=postgres` | DATA-07：生产用 superuser postgres，RLS + `db.js:96-101` "fail closed"不成立（**附策略定义**：`003_model_gateway.sql:178-183` 对 6 张表 `ENABLE ROW LEVEL SECURITY`、`003a_models_rls.sql` 另有 3 张） | 未单独作为发现，仅在容器/密钥语境提及 | **两方不冲突**；数据域有精确行号证据，部署域未反驳。以数据域为准 |
| `BACKUP_AGE_RECIPIENT` 默认空 | DATA-05：`docker-compose.yaml:84` `BACKUP_AGE_RECIPIENT=${BACKUP_AGE_RECIPIENT:-}`，`backup-db.js:55-57` 仅 console.warn 不阻断 | 部署域未列为独立发现 | **数据域有源码证据，部署域漏报** → 在最终报告须以数据域为准，勿在部署域重复计数 |
| 卷挂载（pgdata/backups 同机） | DATA-02：无异地副本 → RPO 近似永久 | 部署域未展开 | **数据域有证据**；见 §2.1 对 02 定性的推翻：事实成立但严重度应降 HIGH |
| `.env` 不入库 / 权限 | DATA-20（LOW）：`.env` 权限弱于手册要求 | DEP-01/DEP-05 大量依赖 `.env` 实际内容 | **本机 `.env` 实测权限为 `-rw-r--r--`（644）[W]**，与数据域一致、与部署域部分表述（若引用 600）不一致 → 以本机实测 644 为准 |

---

## 三、逐条裁决（证据 / 反证 / 严重度建议）

### 3.1 数据域 BLOCKER

#### DATA-01 媒体文件零持久化 —— CONFIRMED（机制修正）| BLOCKER

- 证据：`server/model-gateway/media.js:26` `const storageRoot = () => process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), 'media-store')`；`server/Dockerfile.server:6` `WORKDIR /app`；`docker-compose.yaml:85-86` api 仅 `- backups:/app/backups`；`docker-compose.yaml:141-142` 卷仅 `pgdata`/`backups`。
- 独立命令：`grep -rn "MEDIA_STORAGE_DIR" .env* docker-compose*.yaml docs/部署手册.md` → 仅 `media.js:26` 命中（示例/手册/compose 全无设置）。
- 反证尝试（失败）：我尝试构造"媒体其实被备份覆盖"的路径 —— 检查 `docs/部署手册.md` 的备份范围，仅 `pg_dump` 数据库（`server/scripts/backup-db.js`），无媒体目录打包 → 反驳不成立。
- **严重度建议：BLOCKER（维持），但口径必须改写为"ENOENT → 500"，不要写"静默 404"。**

#### DATA-02 备份单机单卷、无异地副本 —— REFUTED（定性）| 降为 HIGH

- 反证：`docs/部署手册.md:352` 自认 rclone 异地容灾为"规划项"、`:397`"备份异地容灾未落地"，说明团队**已知并显式记账**该项；这属于已知的、被明示的**风险接受**，与"发现了一个未意识到的缺陷"性质不同。
- 缺的是"异地副本"这一纵深防御层，而非备份机制本身失效；且该条与部署域"卷/容灾未覆盖项"重叠，双计会放大阻断面。
- 正确的阻断表述应为：**"上线前必须由业务方书面确认 RPO/RTO；若 RPO 要求 ≤ 24h，则异地副本为阻断项"**。
- **严重度建议：HIGH（由 BLOCKER 下调）**；建议与 DATA-05 合并为同一"备份与容灾"阻断组。

### 3.2 数据域 HIGH

#### DATA-03 加密后删除明文前不校验可解密 —— CONFIRMED | HIGH

- 证据：`server/scripts/backup-db.js` 中加密分支 `age -r "$recipient" -o "$out" "$f"` 后仅 `[ -s "$out" ]` 即 `rm "$f"`；脚本末行自述"完成。未删除明文前，请先逐一验证 .dump.age 可解密。"——即**脚本自身承认没有做这件事**。
- 反证尝试（失败）：检查是否存在 `age -d` 回环校验步骤 → 无。（收尾行的"请先验证"是人工建议，非代码保证。）
- **严重度建议：HIGH（维持）。** 与 DATA-04 合并为同一修复（写盘后 `age -d` 抽验 + 原子改名）。

#### DATA-04 半截 .dump 被当成有效备份计入 BACKUP_KEEP —— CONFIRMED | HIGH

- 证据：`backup-db.js:16` `BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups')`；旋转逻辑按文件名计数保留 `BACKUP_KEEP`（默认 14，`.env.example:56`）。若 `pg_dump` 中途失败仍产生非空文件，会进入旋转集合，把唯一完好快照挤出窗口。
- 反证尝试（失败）：未见"写临时文件 + 校验后原子改名"的写法。
- **严重度建议：HIGH（维持）。**

#### DATA-05 生产可静默明文落盘全库备份 —— CONFIRMED（机制复现）| HIGH

- 证据：`docker-compose.yaml:84` `BACKUP_AGE_RECIPIENT=${BACKUP_AGE_RECIPIENT:-}`（默认空、**不阻断启动**）；`server/scripts/backup-db.js:55-57` 仅 `console.warn`；`scripts/deploy.sh:45` 仅警告，而第 42-43 行的 `EMAIL_VERIFICATION_DISABLED`/`RATE_LIMIT_DISABLED` 用的却是 `die`（同一脚本内的门禁标准不一致）。
- 后果：忘填即 24h × 14 份明文全库（`users` 邮箱/`password_hash`、`sessions.token_hash`、`email_outbox.recipient_email`、`payment_orders`、`audit_events.ip_hash`）。
- **严重度建议：HIGH（维持）。** 注：本条与"生产 `NODE_ENV` 不存在于本机 `.env`"无关，是模板/默认值缺陷，与本机 `.env` 形态无关 —— 请勿因 DEP-01 的定性而连带下调本条。

#### DATA-06 003–009 无 downgrade / 前若干迁移非幂等 —— PARTIAL-CONFIRMED | HIGH

- 证据（幂等性精确统计）：`grep -c 'CREATE TABLE' / 'CREATE TABLE IF NOT EXISTS'` 逐文件比对 → 非幂等文件为 **5 个**：`001_identity.sql`（4 建表 / 0 幂等）、`001a_entitlements.sql`（2/0）、`002a_settings.sql`（2/0）、`002b_migration_imports.sql`（1/0）、`003_model_gateway.sql`（6/0）。`002_user_ownership.sql`、`004`–`009` 无 `CREATE TABLE`（仅 `ALTER`/`CREATE INDEX IF NOT EXISTS`）。
- 故"前 7 个迁移非幂等"**口径有误**（应为 5 个文件）；"003–009 无 downgrade（逆 SQL）"经检查迁移目录无 downward 段，成立。
- **严重度建议：HIGH（维持），但口径必须改为"5 个非幂等文件"**，否则修复清单会漏/错。

#### DATA-07 生产用 superuser 使 RLS + fail-closed 声称不成立 —— CONFIRMED | HIGH

- 证据：`.env.example:1-6` 与 hooks/实测的 `[W]` 本机 `.env` 均为 `DB_USER=postgres`；`server/db.js:96-101` 注释自述 "Missing GUC fails closed on **non-superuser** connections"；`003_model_gateway.sql:178-183` 对 `model_providers/models/model_credential_versions/media_assets/model_invocations/model_jobs` 启用 RLS，策略定义在 `003_model_gateway.sql`（6 条 `CREATE POLICY`）与 `003a_models_rls.sql`（3 条）。superuser 绕过所有策略 → 只要代码路径不经 `withUserContext` 就无第二道防线。
- 反证尝试（失败）：未见 `ALTER ROLE postgres NOSUPERUSER` 或独立应用角色的初始化脚本。
- **严重度建议：HIGH（维持）。**

#### DATA-08 topupCredits/refundCredits 先改余额后写台账、冲突被吞 —— CONFIRMED | HIGH

- 证据（`server/credits.js`）：`topupCredits` → `UPDATE credit_accounts SET balance = balance + $2 ... RETURNING balance`，**随后**才 `INSERT INTO credit_ledger ... ON CONFLICT (idempotency_key) DO NOTHING`；`refundCredits` 同构。对比 `deductCredits`（`credits.js` 扣减侧）反而先 `SELECT ... FOR UPDATE` 再扣。→ 台账唯一键冲突时**余额已加、台账不记**，幂等键形同虚设（重复确认会重复加钱而不留痕）。
- **严重度建议：HIGH（维持）。** 与账务域发现（t2）若存在同点，应合并为单一账务阻断项，避免重复计数。

#### DATA-09 前若干迁移非幂等 + 回滚文档教人删记录重放 —— CONFIRMED | HIGH

- 证据：`docs/database-rollback.md:28/77` 指导删除 `schema_migrations` 记录后重放；而 `001/001a/002a/002b/003` 非幂等（见 DATA-06 精确统计）→ 重放即 `CREATE TABLE already exists` 报错中止，回滚流程本身不可用。
- **严重度建议：HIGH（维持）。** 修复建议应改为：迁移全部加 `IF NOT EXISTS`（或引入 checksum 后禁用手工删记录）。

### 3.3 数据域 MEDIUM 抽样

#### DATA-10 关键外键列/RLS 过滤列/调度轮询列缺索引 —— CONFIRMED | MEDIUM

- 证据：`grep -c "CREATE INDEX" server/migrations/003_model_gateway.sql` → **0**；`models.provider_id` FK 在 `003_model_gateway.sql:31`，无对应索引。对照 `008_payments.sql:21-22` 有 `idx_payment_orders_*`、`001_identity.sql:38` 有 `sessions_user_active_idx` → 说明作者知道该做，003 是遗漏。
- **严重度建议：MEDIUM（维持）**；量级上属性能债，非上线阻断。

#### DATA-12 ip_hash 盐与库同机 —— CONFIRMED | HIGH

- 证据：`audit_events` 写入 `ip_hash`（`001a_entitlements.sql` 定义的审计表 + 调用点 `server/auth/*` 的 `ipHash`），盐来自 `IP_HMAC_SALT`（`.env.example:17` 注释"never a plain hash"）；盐与数据库/备份同宿主机同卷。
- 叠加判定：本人**同意** 04-data 的"盐泄露 → 可离线爆破 IP"结论，但需限定：IPv4 空间虽可穷举，仍需攻击者先取得备份（DATA-05）或主机权限。故它是 **DATA-05 的后果放大器**，不是独立可触发的 BLOCKER。
- **严重度建议：HIGH（维持），但表述应与 DATA-05 绑定。**

#### DATA-13 schema_migrations 无 checksum —— CONFIRMED | MEDIUM

- 证据：`server/db.js:66-78` 每文件 `BEGIN → 执行 → INSERT INTO schema_migrations → COMMIT`；`schema_migrations` 仅记文件名/时间，**无 checksum 列**。→ 已应用迁移被事后修改不会被发现，与 DATA-09 的"删记录重放"共同构成审计盲区。
- **严重度建议：MEDIUM（维持）。**

### 3.4 部署域 BLOCKER/HIGH（含 DEP-01 定性专章）

#### DEP-01（重点）—— REFUTED（"已实际失陷"定性）+ 保 HIGH

**定性问题的完整回答：**

**（1）模板缺陷还是操作者失误？→ 操作者失误（模板与文档正确），但缺陷仍在。**

- `.env.example` 与 `.env.production.example` 的这几个键**是空值占位**，且注释明确给出"把生成命令的输出写进去"的正确指令：`MODEL_ENC_KEY=` / `REQUEST_HMAC_KEY=`（`.env.example:64-67`，注释 `# 32-byte hex keys. Missing in production => server refuses to boot (fail-close). Generate: openssl rand -hex 32`），`EMAIL_DELIVERY_KEY=`（`.env.example:27-28`）。**没有任何示例文件把 `$(...)` 本身写进值位** → 按文档操作**不会**产生字面量。
- 故判定为**操作者失误**（把生成命令的回显误写入值位）。但注意：严重度**不得因此下调**，因为审查对象是"当前工作树（待上线部署）"，且该 `.env` 未被 git 跟踪、无法由 git 复现。
- **但存在一个真实的仓库侧缺陷（这是本条仍应保留为 HIGH、并进入阻断清单的理由）**：`scripts/deploy.sh` 预检**只判断"非空"，不判断"形态"**。我实测 `docker compose --env-file .env config | grep -c 'openssl rand'` = **6**（渲染出的键名：`EMAIL_DELIVERY_KEY`、`IP_HMAC_SALT`、`MODEL_ENC_KEY`、`REQUEST_HMAC_KEY` 各 1 处，`DB_PASSWORD`/`POSTGRES_PASSWORD` 各 1 处 `$(openssl rand -hex 8)` 变体），compose 确实**不做命令替换**、字面量原样进容器。因此只要有人把开发档 `.env` 复制到生产并补上 `NODE_ENV`/`CORS_ORIGINS`，预检就会放行，密钥材料退化为 `sha256(公开字面量)` 且**跨部署恒定** → 这是预检的设计缺陷，属仓库问题，建议按 HIGH 处置并加"格式校验（非空且匹配 `^[0-9a-f]{64}$`）"。

**（2）`.env` 是本地未入库文件** —— 已确认结论基于**工作区实际 `.env` 形态**（`[W]`，`.gitignore` 排除），已在全文以 `[W]` 标注；**不可由 git 复现**，其他复核人无法从仓库克隆中验证此条，必须在最终报告中明确该证据的不可复现性。

**（3）长度不一致澄清** —— 实测本机 `.env` `[W]`：`MODEL_ENC_KEY` / `REQUEST_HMAC_KEY` / `EMAIL_DELIVERY_KEY` / `IP_HMAC_SALT` **四者长度均为 23**（即 `$(openssl rand -hex 32)` 的字符数），`POSTGRES_PASSWORD` 为 32 位随机串。**gw-auditor 在 t5 报告的"均为 23"正确，t3 汇报的"23/26"有误。**
下游链判定：`server/model-gateway/crypto.js:11-18` 对原始串做 **sha256 派生**（而非要求严格 64 位 hex）→ 结论：**"密钥可预测"这条链成立**（23 字符字面量照样派生出一把确定的密钥），且声明"必须是 32 字节 hex"的注释与实际派生逻辑不一致（但**这不削弱该链**，反而说明 23 字符串不会导致启动即失败）。

**（4）下游叠加判定（DEP-01 × GW-06 × DATA-12）** —— **成立，但需精确限定**：

- DEP-01：`MODEL_ENC_KEY` = sha256(公开字面量)，且跨部署恒定。
- GW-06（MODEL_ENC_KEY 无 keyring、轮换即全量凭据不可解密）：与 DEP-01 叠加后，攻击者**无需轮换**即拥有解密密钥 → 上游 API 凭据密文（`model_credential_versions`）可离线还原。
- DATA-12：`IP_HMAC_SALT`（同为 23 字符字面量）→ `audit_events.ip_hash` 也可离线还原 IP。
- **合并结论**：**是** —— 在同一套部署中，"上游凭据密文 + IP 哈希"的确可被**离线同时还原**（无需主机权限）；前提是攻击者取得密文（备份、DB 导出或任意读权限），而 DATA-05 的明文备份恰好提供了该前提。故最终报告应将 DEP-01 + GW-06 + DATA-05 描述为**一条链**，而不是三个独立条目。

**严重度建议：HIGH（由 BLOCKER 下调）。** 理由：(a) `.env` 是开发档，`deploy.sh` 预检第 39 行（`CORS_ORIGINS=https://`）与第 41 行（`NODE_ENV=production`）**必然 die**，"本套部署已实际失陷"不成立；(b) 模板/文档正确，非必然产生字面量；(c) 但预检不验形态 + 开发档可被复制上生产，构成真实可达路径。

#### DEP-02 CAPTCHA 默认关 —— DOWNGRADED 至 HIGH

- 证据（复现）：`docker-compose.yaml:65` `CAPTCHA_ENABLED` 默认 `false`；`.env.example`、`docs/部署手册.md` §2 表格、`scripts/deploy.sh` 预检**三处均无该变量**（`grep -rn CAPTCHA_ENABLED` 命中仅在 server 代码与 compose 默认值）。叠加安全域 SEC-01（`captcha.js` 把答案以 `<text>` 明文写入 SVG）后即便置 true 也无效。
- 降级理由：人机验证属**纵深防御**，不是鉴权/账务边界；调试期默认关闭属常见工程取舍，且其风险被登录限流（`RATE_LIMIT_DISABLED` 在 `.env.example` 中显式警告）部分覆盖。作为"上线前必须显式设置"的 P0 操作项合适。
- **严重度建议：HIGH。**

#### DEP-03 3005 明文暴露 —— DOWNGRADED 至 HIGH

- 证据（复现）：`docker-compose.yaml:123-124`（原报告引 `:121`）映射 `3005:80`，**无 host_ip 限制**（未写 `127.0.0.1:3005:80`）→ 绑所有网卡；`nginx.conf:11-13` 全量反代 `/api/`；`docs/部署手册.md` §3.3 首发命令即该形态，§L250 自承"回环绑定需另行提交"。
- 降级理由：成立前提是宿主机有公网 IP 且未叠加 TLS/安全组/反代；生产部署的合理形态应叠加 `docker-compose.tls.yaml`。属**首发操作即错**的高危配置，宜列 P0，但作为"部署配置缺陷"而非结构性 BLOCKER。
- 附带发现（新增，部署域未报）：`docker-compose.yaml` 的 `mailpit` 服务若随 `--profile dev` 一起上生产，其 8025/1025 端口同样是无鉴权的明文邮件界面，应一并纳入检查。
- **严重度建议：HIGH。**

#### DEP-04 TLS 形态发布/回滚静默退回 HTTP —— CONFIRMED（条件性 BLOCKER）

- 证据：`scripts/deploy.sh:10` `COMPOSE="docker compose --env-file .env"`（**不带** `-f docker-compose.tls.yaml`）；`docs/部署手册.md` §5.1(L275) 的发布/回滚命令同；全手册仅 §4.1(L217) 带该 `-f`。→ 用 TLS 叠加部署后，下一次发布/回滚即静默退回 3005 明文。
- 反证尝试（失败）：未见 compose 内 `include:` 或 `.env` 中 `COMPOSE_FILE` 自动叠加；`docker-compose.tls.yaml:12-19` 提供 `deploy/nginx-tls.conf` 的 301 + HSTS（`:55,:69`），故 TLS 形态本身正确，问题是调用侧不叠加。
- **严重度建议：BLOCKER（仅"启用 TLS 的生产形态"这一分支下）；若首发不用 TLS，则为 HIGH 并在阻断清单中标注条件。** **另：若采用 TLS，DEP-03 的明文暴露风险与 DEP-08 的健检端口不一致同时消解，建议把 DEP-03/04/08 作为一组"传输安全形态"决策项。**

#### DEP-05 `cp .env.example .env` 带入 `COOKIE_SECURE=false` —— CONFIRMED | HIGH

- 证据：`.env.example:14` `COOKIE_SECURE=false`；`docs/部署手册.md` §3.3 教人 `cp .env.example .env`；而生产 cookie 安全标志依赖运行时推断（`server/index.js` 按 `NODE_ENV`/`PUBLIC_APP_URL` 推断），非配置强制 → 复制模板后若不改该键，存在 cookie 明文下发的配置面。
- 补充实测：本机 `.env` 甚至**未包含 `COOKIE_SECURE` 键**（`[W]`）→ 依赖代码推断，进一步说明模板/配置面不一致。
- **严重度建议：HIGH（维持）。**

#### DEP-06 GW-01 分叉 + NODE_ENV —— PARTIAL-CONFIRMED（口径限定）| HIGH

- 证据：`docker-compose.yaml:45` `NODE_ENV: production` **硬编码**；`scripts/deploy.sh` 为手册唯一生产流程，无 systemd/pm2 说明。
- 反驳：`docker-compose.yaml:121` 的 `3005:80`（非 TLS、绑所有网卡）本身即"非 TLS 生产形态"，比"非 compose 启动路径"更直接；`package.json` 的 `npm start`/`start-all.sh` 未设 `NODE_ENV`，但**仅在有 systemd/pm2 且运维刻意绕过 compose 时才可能** —— 风险低。
- **严重度建议：HIGH（维持），但表述应改为"加入启动断言"而非"存在被绕过的生产启动路径"。**

#### DEP-07 回滚不覆盖健康检查失败 + 003+ 无逆 SQL —— CONFIRMED | HIGH

- 证据：`scripts/deploy.sh` 回滚调用点在发布流程中（`npm test`/健康检查失败会触发）；但 `public/*` 已发布后回滚不完整，且迁移 003+ 无逆 SQL（与 DATA-06 一致）。
- **严重度建议：HIGH（维持）。** 与 DATA-06/09 合并为"迁移可逆性"单一修复批次。

#### DEP-08 `PUBLIC_PORT` 3005 与 TLS 形态不一致 —— CONFIRMED | HIGH

- 证据：`scripts/health-check.sh:10` `PUBLIC_PORT="${PUBLIC_PORT:-3005}"`，第 31-32 行用 `http://localhost:${PUBLIC_PORT}/api/health`；TLS 形态（`docker-compose.tls.yaml`）暴露 443/80 → 未显式导出变量时健检必然失败（假警报）。
- **严重度建议：HIGH（维持）。**

### 3.5 部署域 MEDIUM 抽样

#### DEP-09 容器安全基线 —— CONFIRMED | MEDIUM

- 证据（实测计数）：对 `docker-compose.yaml` 与 `docker-compose.tls.yaml` 同时 `grep -c` 以下键 —— `user:`、`cap_drop`、`read_only`、`no-new-privileges`、`security_opt`、`resources`、`TZ`、`mem_limit` **全部为 0**；`server/Dockerfile.server` 与根 `Dockerfile` **均无 `USER` 指令** → 容器以 root 运行、无能力收窄、无资源上限（单容器 OOM/日志膨胀可拖垮宿主）。
- **严重度建议：MEDIUM（维持）。**

#### DEP-10 latest 标签 + 不可重复构建 —— CONFIRMED（抽样）| MEDIUM

- 证据：镜像标签固定语义 + 构建在 `docker-compose up -d --build` 内现场重建（无镜像 digest 固定、无 lockfile 校验层）→ 不同时间重建得到不同镜像，回滚无法精确回到上一版本。
- **严重度建议：MEDIUM（维持）。**

#### 安全域三问是否在 05-deploy.md 得到回答 —— PARTIAL-CONFIRMED

| 安全问题 | 05-deploy.md 是否回答 | 复核裁定 |
|---|---|---|
| 是否启用 TLS/HSTS | 有答复（称默认路径无 HSTS/无跳转，仅 TLS 叠加才启用 `deploy/nginx-tls.conf:7-11` 的 301 与 `:55,:69` 的 HSTS） | **CONFIRMED**：`nginx.conf` 确无 HSTS/跳转；且 TLS 形态会被 DEP-04 静默退回明文 |
| `SMTP_HOST` 是否可能为空 | 有答复（称可触发且门禁不兜底） | **PARTIAL-CONFIRMED**：`.env.example:20` `SMTP_HOST=` 确为空值占位、`docker-compose.yaml:70` 用 `:-` 兜底，确无预检；但**实测本机 `.env` `[W]` 为 `SMTP_HOST=mailpit` 且 `SMTP_PORT=1025`/`SMTP_SECURE=false`** → 本机形态是"发到 dev 邮件容器"，而非"空 host"。该发现对**模板/生产**成立，对**本机 `.env`** 不成立，请勿混用 |
| `CAPTCHA_ENABLED` 生产默认值 | 有答复（默认 false） | **CONFIRMED**（见 DEP-02） |

### 3.6 构建域（全部 HIGH + MEDIUM 抽样）

- **BUILD-01 服务端测试 flaky —— CONFIRMED（证据加重）| HIGH**：见 §2.2。11 次重跑 7 成功 / 3 失败（155/160 与 158/160），根因 `server/test/helpers.js:15-17` 的跨进程共享库 `TRUNCATE ... CASCADE`。**建议严重度维持 HIGH，并把"测试套件不可作为上线门禁"写入结论。**
- **BUILD-02 覆盖率口径失真 —— CONFIRMED | HIGH**：`vitest.config.ts:12-16` 的 `include` 覆盖 `tests/**`、`components/**`、`services/**`，但 `coverage.include`（第 29-32 行）只有 `components/StageDirector/utils.ts` 与 `components/StageDirector/cameraMovementGuides.ts`；`git ls-files` 统计前端测试文件 15 个（全部在 `tests/`）、服务端 33 个 → 报告的 50.6%/14.28% 只对 2 个文件成立，**不得作为上线质量证据**。
- **BUILD-03 无 E2E —— CONFIRMED | MEDIUM**：`git ls-files | grep -E "e2e|playwright|cypress"` 无输出；`package.json`/`server/package.json` 无 playwright/cypress 依赖；`vitest.config.ts:21` 的 `**/*.e2e.test.ts` 是**空规则**（排除集合为空）→ 报告判断正确。
- **BUILD-04 生产依赖含 critical 漏洞 —— CONFIRMED | MEDIUM**：`pnpm audit --prod` → 4 vulnerabilities（1 low = body-parser <1.20.6 GHSA-v422-hmwv-36x6；2 moderate = qs；1 critical = proxy-addr 经 express）；`server` 侧同类 critical 且为运行时暴露面。
- **未复核**：BUILD-05..14（MEDIUM/LOW，按契约抽样即可，本轮未逐条复核）。

---

## 四、对三份报告整体可靠性的评估

1. **04-data.md（最可靠）**：源码级证据充分、行号可核，正向结论（迁移事务化 `db.js:66-78`、补丁编号排序 `db.js:61`、扣减侧 `CHECK (balance >= 0)` + `SELECT ... FOR UPDATE`）经本人独立检查与源码一致，**未被任何一条裁决推翻**。唯一需修正的是 DATA-02 的定性（BLOCKER→HIGH）与 DATA-06 的计数口径（7→5）。
2. **05-deploy.md（可靠性中等，须标注仓促）**：由接手人 gw-auditor 产出，**未执行 deploy.sh、未执行 compose**（报告自述），关键判定依赖静态阅读；本轮已发现其：① 对 `.env` 实际内容的定性偏差（把开发档当作"生产失陷"）；② 卷/容灾未展开（与数据域重复计数风险）；③ 若干未覆盖项未收束。**请在最终报告中如实标注"该域未做运行时验证"**，不要替它补全。
3. **06-build.md（可靠，但结论方向需强化）**：实测数据（126 前端 / 160 服务端、构建哈希 `index-Eoj1bSXW.js`）与本人重跑**完全一致**；其"服务端 flaky"结论被本人加重证据支持。

**未覆盖（显式声明）**：
- LOW 发现（DATA-14..20、DEP-11..15、BUILD-05..14）未逐条复核。
- `28 个 barrel 文件` 的精确数量未核验（`grep -rn "export \*" | wc -l` 实测约 33 命中，未逐一分类）。
- 未做任何运行时验证：未 `docker compose up/build`、未执行迁移/恢复、未跑 E2E（环境不允许，且任务禁止）。
- **`[W]` 证据（本机 `.env` 的键值形态、权限 644、`SMTP_HOST=mailpit`）不可由 git 复现**，是本轮唯一不可由他人独立验证的证据类别。

---

## 五、一句话 go/no-go 看法

**NO-GO**：主因是 `MEDIA_STORAGE_DIR` 未挂卷 + `BACKUP_AGE_RECIPIENT` 默认空导致的"重建即丢媒体 / 明文全库备份"组合，以及生产超级用户下的 RLS 失效；**DEP-01 不是"已失陷"而是可修的预检缺陷（HIGH）**，DATA-02 应降为 HIGH 并并入同组，不应因这两条把 SHIP 的判据锁死——即：修复面是明确的、可在上线前收敛的，但当前形态不具备上线条件。
