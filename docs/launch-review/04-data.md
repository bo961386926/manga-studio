# 数据层审查报告（T-data）：迁移安全 / 备份恢复可执行性 / PII

- 审查目标：当前工作树，分支 `feat/public-model-platform`，HEAD `8fd19fd`，工作树未提交改动仅 `?? .agent-teams/`（`git status --porcelain`）。
- 审查视角：准备上线的生产部署（docker compose：nginx 前端 + Express api + postgres:16）。
- 方法：全只读静态取证 + 只读探测（`git status`、`docker ps`、`docker compose config`、`wc`/`grep`/`sed`）。**未执行任何迁移、恢复、DROP/DELETE，未启动容器，未修改源码。**
- 结论口径：按「数据一旦丢/坏，上线即事故」的最保守标准。

## 汇总表

| ID | 严重度 | 标题 | 证据位置 | 已复现 |
|---|---|---|---|---|
| DATA-01 | BLOCKER | 媒体文件零持久化：`/app/media-store` 无命名卷，容器重建即永久丢失，且数据库备份不含文件 | `server/model-gateway/media.js:26,51-52`；`docker-compose.yaml:85-86` | 是（静态） |
| DATA-02 | BLOCKER | 备份单机单卷、无异地副本；age 私钥无托管强制——主机/卷损即数据不可恢复 | `docker-compose.yaml:22,86,141-142`；`docs/部署手册.md:352,397,79` | 是（静态） |
| DATA-03 | HIGH | 加密备份删除明文前不校验可解密；`age-keygen` 私钥生成/保管文档错误（裸命令不落盘） | `server/scripts/backup-encrypt.js:15-16`；`scripts/encrypt-existing-backups.sh:9,39-48`；`docs/部署手册.md:77-79` | 是（静态） |
| DATA-04 | HIGH | `pg_dump` 失败残留半截 `.dump`，且被保留策略当成有效备份计数，可能挤掉最后一份完好备份 | `server/scripts/backup-db.js:44,49-57,60-68` | 是（静态） |
| DATA-05 | HIGH | 生产可静默明文落盘全库备份（含全部 PII），仅告警不阻断 | `docker-compose.yaml:84`；`server/scripts/backup-db.js:55-57`；`scripts/deploy.sh:45` | 是（静态） |
| DATA-06 | HIGH | 无 downgrade 路径：003–009 无逆操作 SQL；迁移失败 → api 退出 + `restart: unless-stopped` 重启循环 | `server/db.js:48-83`；`server/index.js:279-291`；`docker-compose.yaml:96`；`docs/database-rollback.md:7-13` | 是（静态） |
| DATA-07 | HIGH | 生产连库用 superuser `postgres`，RLS 与「fail closed」声称全部不成立；`projects/assets` 无 RLS | `docker-compose.yaml:49`；`server/db.js:16,100-101`；`server/migrations/003_model_gateway.sql:178-183` | 是（静态） |
| DATA-08 | HIGH | `topupCredits`/`refundCredits` 幂等承诺不成立：先改余额后写台账，冲突被 `ON CONFLICT DO NOTHING` 吞掉 → 余额与台账背离 | `server/credits.js:91-107,108-124`；`server/migrations/005_credits.sql:2,22` | 是（静态） |
| DATA-09 | HIGH | 迁移非幂等（13 个文件里 7 个无 `IF NOT EXISTS`），而文档教人删 `schema_migrations` 记录「重放」并声称可重复运行 | `server/migrations/001_identity.sql:6`、`001a_entitlements.sql:6,19`、`002_user_ownership.sql:40-41`、`002a_settings.sql:4,10`、`002b_migration_imports.sql:4`、`003_model_gateway.sql:7,29,58,82,97,133`、`003a_models_rls.sql:4,18,31`；`docs/database-rollback.md:28,77` | 是（静态） |
| DATA-10 | MEDIUM | 关键外键列 / RLS 过滤列 / 调度轮询列缺索引（`media_assets.user_id`、`email_outbox(status,next_attempt_at)`、`models.provider_id` 等） | `server/migrations/003_model_gateway.sql`（全文无一条 `CREATE INDEX`）；`server/migrations/001_identity.sql:53-75`；`server/auth/outbox.js:147-150` | 是（静态） |
| DATA-11 | MEDIUM | 无账号注销能力与数据保留策略；外键无 `ON DELETE` 使硬删除同样不可行 | 全仓 grep 无命中；`server/migrations/005_credits.sql:6,14`；`server/migrations/002_user_ownership.sql:6-7` | 是（静态） |
| DATA-12 | MEDIUM | `audit_events.ip_hash` 为全量 HMAC-SHA256（无截断/无轮换、盐同机 `.env`），持有 salt 可穷举还原 IPv4 | `server/auth/middleware.js:31-32`；`server/migrations/001a_entitlements.sql:26`；`server/auth/audit.js:19-22` | 是（静态） |
| DATA-13 | MEDIUM | `schema_migrations` 只记文件名、无 checksum：迁移文件被改动后不会重放，schema 静默漂移 | `server/db.js:51-58,63-79` | 是（静态） |
| DATA-14 | MEDIUM | 无 leader 锁：多副本会重复备份、并发轮转互删、迁移无 advisory lock（§8.1 已自认） | `docs/部署手册.md:394`；`server/backup.js:17-36`；`server/db.js:48-83` | 部分（单副本下未触发） |
| DATA-15 | MEDIUM | `database-rollback.md` 的恢复命令与当前 schema 不符且部分不可用（「19 个表」实际 29 张；宿主侧 `pg_restore` 在 5432 未发布时无法连库） | `docs/database-rollback.md:93,96-101`；`docker-compose.yaml`（postgres 无 `ports`） | 是（静态） |
| DATA-16 | MEDIUM | `.env.production.example` 预填占位域名，能通过 `${VAR:?}` 与 `deploy.sh` 预检但不指向真实站点 | `.env.production.example:16-17,42`；`docker-compose.yaml:53-54`；`scripts/deploy.sh:35,39` | 是（静态） |
| DATA-17 | LOW | `IP_HMAC_SALT` 生成长度两处文档不一致（hex32 vs hex16） | `docs/部署手册.md:42` vs `.env.production.example:32` | 是 |
| DATA-18 | LOW | `deleteMedia` 仅软删不回收文件，`media-store` 只增不减（叠加 DATA-01 无卷） | `server/model-gateway/media.js:81-90` | 是 |
| DATA-19 | LOW | `assertDailyQuota` 在事务外读计数 → 并发可超每日配额（成本失控，非数据丢失） | `server/credits.js:151-169` | 是 |
| DATA-20 | LOW | 本地 `.env` 权限 644（手册要求 600）；保留策略把 `.dump` 与同名 `.dump.age` 分别计数，迁移期实际保留份数减半 | `ls -la .env`；`docs/部署手册.md:23`；`server/scripts/backup-db.js:60-64` | 是 |

计数：**BLOCKER 2 / HIGH 7 / MEDIUM 7 / LOW 4 = 20**。

---

### [BLOCKER] DATA-01 媒体文件零持久化：容器重建即永久丢失，且数据库备份不含文件

- 证据：
  - `server/model-gateway/media.js:26`：`const storageRoot = () => process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), 'media-store');`
  - `server/model-gateway/media.js:51-52`：`await fs.mkdir(path.join(storageRoot(), 'user', userId), { recursive: true });` / `await fs.writeFile(objectPath(userId, objectKey), buffer);` → 落盘到容器可写层。
  - `docker-compose.yaml:85-86`：api 服务 `volumes:` 下**只有** `- backups:/app/backups`；`docker-compose.yaml:141-142` 只声明 `pgdata` / `backups` 两个卷。`docker-compose.tls.yaml:17-19` 只加 nginx 配置与证书挂载。
  - 全仓检索 `MEDIA_STORAGE_DIR`／`media-store`：命中仅 `server/model-gateway/media.js:2,26` 与 3 个测试文件（`server/test/{image-reference,media,invocation}.test.js`）——**生产 compose、`.env.production.example`、`docs/部署手册.md` §2 变量表、`docs/数据库…` 全程未提及该变量**。
- 影响：容器内 cwd = `/app`（`server/Dockerfile.server:6` `WORKDIR /app`），因此生产媒体写入 `/app/media-store`，而该路径**没有任何命名卷**。任何一次 `docker compose up -d --build`（即 `docs/部署手册.md:270-277` §5.1 的标准更新发布流程）都会重建 api 容器 → 用户上传的参考图、关键帧、生成结果**全部永久丢失**。
  更严重的是「静默」：`media_assets` 表行在 `pgdata` 卷里会被 `pg_dump` 备份并恢复，恢复后 `status='ready'` 依旧存在，但 `server/model-gateway/media.js:77` 的 `fs.readFile(...)` 会抛 ENOENT → 接口 500。**数据库恢复成功给了「数据已保住」的假象，实际媒体全部 404。**
- 复现步骤：
  1. `grep -rn "MEDIA_STORAGE_DIR\|media-store" . --include=*.js --include=*.md --include=*.yaml --include=*.example | grep -v node_modules` → 仅代码与测试命中。
  2. `grep -n -A6 "volumes:" docker-compose.yaml` → api 只有 `backups:/app/backups`。
  3. `docker compose --env-file .env.example config | grep -n -A6 "manga-studio-api" `（只读渲染）确认最终卷集合。
- 建议修复（上线前必须）：在 compose 为 api 增加 `media:/app/media-store` 命名卷（并写入 `.env.production.example` / 部署手册变量表与 `MEDIA_STORAGE_DIR=/app/media-store`）；同时把 media-store 纳入备份链路（`tar`/`rclone` 或 pg_dump 之外的独立快照），并在恢复演练里把「媒体抽样可下载」列为验收项。
- 验证方式：改动后 `docker compose config` 应出现第三个命名卷；`docker compose up -d --build` 前后对同一 `media_assets.id` 执行 `GET /api/media/<id>` 均应 200；`docker compose exec api ls /app/media-store` 在重建后仍能看到历史目录。

---

### [BLOCKER] DATA-02 备份单机单卷、无异地副本；age 私钥无托管强制——主机/卷损即不可恢复

- 证据：
  - `docker-compose.yaml:22`：postgres 卷 `- pgdata:/var/lib/postgresql/data`；`:86`：api 卷 `- backups:/app/backups`；`:141-142`：两个卷同为**同一宿主机的本地命名卷**（Docker 默认 local driver）。
  - `docs/部署手册.md:352`：「异地容灾（rclone → 对象存储，保留 30 天）为规划项（审计方案 §6.3），落地前至少把 6.2 拷出的备份放到服务器之外的存储。」
  - `docs/部署手册.md:397`：「**备份异地容灾未落地**：加密备份仍在单机卷内」——文档自认为已知限制。
  - `docs/部署手册.md:79`：「同目录生成的身份文件（私钥）务必离线保管，丢失 = 备份永久无法解密」——只是嘱咐，无任何强制或校验。
- 影响：数据库、备份、以及（按手册做法）加密私钥全部落在同一台主机上。主机磁盘损坏、被勒索、误删卷、快照回滚失败 → **数据与备份同时不可恢复**，没有任何 RPO 可用。这是本条的核心：备份存在不等于可恢复。
- 复现步骤：
  1. `docker compose config | grep -n -A3 "volumes:"` → 仅 `pgdata`、`backups` 两个 local 卷。
  2. `grep -n "异地\|rclone" docs/部署手册.md` → 命中 352、397 行，均为「规划项/未落地」。
- 建议修复：上线前二选一并落到审查报告结论里：(a) 落一条自动化异地/异机同步（`rclone` 或 `docker compose cp` + cron 到对象存储/另一台机器），并写明 RPO；(b) 若本期明确接受风险，需产出**书面的、带签字的**风险接受条目，并在上线检查单里加入「人工定期拷出」的操作责任人与频率。同时把 age 私钥纳入密钥托管（见 DATA-03）。
- 验证方式：能给出至少一份存在于服务器之外的备份对象（时间戳 + 校验和），并用它完整恢复出一个可查询的库；或给出签署的风险接受记录。

---

### [HIGH] DATA-03 加密备份删除明文前不校验可解密；私钥生成/保管文档错误

- 证据：
  - `server/scripts/backup-encrypt.js:15-16`：`run('age', ['-r', String(recipient).trim(), '-o', outFile, plainFile]);` 紧接着 `fs.rmSync(plainFile, { force: true });` —— 只要 `age` 退出码为 0 就删除明文，**从不验证 `outFile` 能用对应私钥解出**（`age -r` 对「任意合法公钥」都会成功，不校验私钥归属）。
  - `scripts/encrypt-existing-backups.sh:39-48`：`age -r "$RECIPIENT" -o "$out" "$f"` 后仅以 `[ -s "$out" ]`（非空）为条件 `rm "$f"`。文件头 `:9` 也承认「确认 .dump.age 可解密…后，再执行删除明文」只是**人工步骤**，脚本不执行该校验。
  - `docs/部署手册.md:77-79`：`age-keygen`（**未带 `-o`**）→ age 的裸调用会把 identity（私钥）打印到 stdout，**默认不生成任何文件**；文档却写「同目录生成的身份文件（私钥）务必离线保管」。对比 `scripts/encrypt-existing-backups.sh:5` 用的是 `age-keygen -o age.key`（正确落盘）——两处口径不一致。
  - 无任何私钥存在性检查：`grep -rn "age.key\|identity" server/ scripts/` 仅命中文档与脚本注释，运行时不校验私钥可获取。
- 影响：三种路径都会导致**全部备份永久不可解密**（= 等同没有备份）：① 操作员按 `:77` 裸跑 `age-keygen` 后误以为私钥已落盘而只复制公钥；② 私钥文件随开发机重装/误删/未纳入托管而丢失；③ `BACKUP_AGE_RECIPIENT` 被填成文档占位符或他人公钥——age 加密照样成功、明文照样删除。此时 `pgdata` 一旦出问题，`backups/` 里只剩一堆打不开的 `.dump.age`。
- 复现步骤：
  1. `sed -n '35,49p' server/scripts/encrypt-existing-backups.sh` → 无解密校验。
  2. `cat -n server/scripts/backup-encrypt.js` → 第 15-16 行，加密后立即 `rmSync`。
  3. `sed -n '74,80p' docs/部署手册.md` → 裸 `age-keygen`。
  4. （可选，只读验证 age 语义）`age-keygen --help` 查看默认输出行为；本机当前**未安装 age**（`command -v age` 为空），故未做本地实测，标注为「部分未验证」。
- 建议修复：① `backup-encrypt.js` 改为「加密 → 用测试口令/或至少 `age -d -i $BACKUP_AGE_IDENTITY` 解密到 `/dev/null` 校验 → 再删明文」，校验失败则保留明文并以非零码退出；② 上线前强制一次性「加密→解密→恢复演练」跑通并记录；③ 修正文档为 `age-keygen -o /secure/path/age.key`，并把私钥托管（离线介质/密码管理器/另一台机器）写成上线前置检查项；④ 在 `.env` 校验里禁止 `BACKUP_AGE_RECIPIENT` 含 `example`。
- 验证方式：`BACKUP_AGE_RECIPIENT=<正确公钥> npm run backup` 生成 `.dump.age`，再用私钥解密并与 `.dump` 的 sha256 一致；把 recipient 改成任意他人公钥，脚本应当**失败并保留明文**（当前行为是成功并删除明文）。

---

### [HIGH] DATA-04 pg_dump 失败残留半截备份，并被保留策略当成有效备份计数

- 证据：
  - `server/scripts/backup-db.js:44`：`execFileSync('pg_dump', args, { env, stdio: 'inherit' });` —— `--file` 直写目标文件（`:39`），失败时**已有字节留在磁盘上，代码没有清理**。
  - `server/scripts/backup-db.js:74-79`：仅 `console.error` + `process.exit(1)`，仍无清理。
  - `server/scripts/backup-db.js:60-68`：`readdirSync(BACKUP_DIR).filter(f => f.endsWith('.dump') || f.endsWith('.dump.age')).sort().reverse()` → `files.slice(KEEP)` 逐个 `unlinkSync`。**半截文件与该备份同名规则（`${dbName}-${stamp()}.dump`），会参与计数、也会被当成「最新备份」保留。**
  - `server/scripts/backup-db.js:56`：未配置加密时告警明文——意味着失败残留的半截文件同样是**明文 PII**。
- 影响：磁盘写满、pg_dump 被 OOM kill、连接中断等任一情况下，`backups/` 会同时出现「半截的新备份」和「完好的旧备份」；保留策略按时间排序只留最近 14 份 → 反复失败会把**唯一完好的那几份挤掉**（`files.slice(KEEP)` 直接删，不校验可恢复性）。运维在事故现场按「取最新一份」恢复时，拿到的是截断 dump。属于「可致数据不可恢复」的静默路径。
- 复现步骤：
  1. `cat -n server/scripts/backup-db.js`（确认 44 行后无 try/cleanup、60-68 行计数逻辑）。
  2. 破坏性验证未执行（任务禁止）；可用只读等价推演：`sqlite3`/`head -c` 无关，直接审 `pg_dump` 语义——官方行为为「失败不 unlink 输出文件」。
- 建议修复：pg_dump 写入 `${file}.partial` 并在成功后 rename 为最终名；失败路径 `unlink` 半成品；轮转只对校验通过（例如存在同名 `.ok` 侧车文件，或 `pg_restore -l` 可读）的文件计数；轮转时保证至少保留一份「校验通过」的最旧备份不被删除。
- 验证方式：手工构造一个截断的 `.dump` 放进 `backups/`（测试机），跑一次 `npm run backup`，断言截断文件被清理或至少不被计入 KEEP 且不会导致完好备份被删。

---

### [HIGH] DATA-05 生产可静默明文落盘全库备份（含全部 PII）

- 证据：
  - `docker-compose.yaml:84`：`- BACKUP_AGE_RECIPIENT=${BACKUP_AGE_RECIPIENT:-}` —— **默认空**，缺失不阻断启动。
  - `server/scripts/backup-db.js:55-57`：未设置时 `console.warn('[backup] WARNING: BACKUP_AGE_RECIPIENT not set — backup stored as PLAINTEXT (contains user PII)')` —— 仅日志告警。
  - `scripts/deploy.sh:45`：`[ -n "${BACKUP_AGE_RECIPIENT:-}" ] || say "警告：…"` —— 同样只 `say`（警告），不 `die`。
  - 对照：同为「生产必须」的 `EMAIL_VERIFICATION_DISABLED` / `RATE_LIMIT_DISABLED` 在 `deploy.sh:42-43` 是硬拒绝（`die`），而加密开关不是 → 门禁口径不一致。
  - `docs/部署手册.md:310`：明文 dump「生产**必须**设置加密」；`.env.production.example:63-64` 也只写「强烈建议」。
- 影响：一次「忘填 `BACKUP_AGE_RECIPIENT`」的生产部署，会让**整个数据库的明文 pg_dump**（users 邮箱与 password_hash、sessions.token_hash、email_outbox.recipient_email、audit_events.ip_hash、payment_orders 支付信息、media 元数据）以 24h×14 份的节奏长期留在宿主机 Docker 卷里。这正是审计方案 R1 要消除的暴露面，目前靠人记性。
- 复现步骤：
  1. `grep -n "BACKUP_AGE_RECIPIENT" docker-compose.yaml scripts/deploy.sh server/scripts/backup-db.js` → 全部为可选/告警。
  2. `bash -n scripts/deploy.sh` 后静态阅读第 42-45 行的门禁差异。
- 建议修复：`deploy.sh` 预检把 `BACKUP_AGE_RECIPIENT` 纳入 `need`（或至少要求 `BACKUP_DISABLED=true` 时显式确认），把「明文备份」变成需要显式 `--allow-plaintext-backup` 才放行的例外；`.env.production.example` 把它标为 ✅ 必须。
- 验证方式：`./scripts/deploy.sh --preflight-only` 在缺该项时应失败退出（当前会「预检通过」）。

---

### [HIGH] DATA-06 无 downgrade 路径：003–009 无逆操作 SQL；迁移失败即重启循环

- 证据：
  - `server/db.js:48-83`：`runMigrations()` 只做「读 `schema_migrations` → 未应用则执行 → 记录」，**没有任何 down/回滚实现**。
  - `docs/database-rollback.md:7-13`：迁移清单表只列到 `002b_migration_imports.sql`，逆操作章节（`:22-69`）也只覆盖 `001`、`001a`、`002`、`002a`、`002b`。**`003_model_gateway.sql`、`003a_models_rls.sql`、`004`–`009`（模型网关/公告通知/积分/活动/埋点/支付/ledger reason）全部没有逆操作 SQL。**
  - `server/index.js:279-291`：`initDB().then(...)` 的 `.catch(err => { console.error('[Server] Failed to initialize database:', err); process.exit(1); })` → 迁移失败 = 进程退出。
  - `docker-compose.yaml:96`：`restart: unless-stopped` → api 容器进入**无限重启循环**，日志被告警刷满。
  - `docs/部署手册.md:370` 自认「迁移不可自动降级」。
- 影响：上线后若任一迁移失败（或语义有误需要撤回），只能「前滚修复」：无逆 SQL、无 down 路径，唯一手段是恢复备份（而备份见 DATA-02/DATA-03/DATA-04 的可用性存疑）。同时崩溃循环会让 `deploy.sh:75-80` 的 300s 健康等待超时并触发 `rollback()` 把镜像退回 `:previous` —— **但数据库 schema 已经前进且无法回退**，形成「旧代码 + 新 schema」的混合状态，这是最典型的升级事故形态。`009_ledger_topup_reason.sql:2-5` 这类 `DROP CONSTRAINT` + 重建的补丁尤其需要逆操作成文。
- 复现步骤：
  1. `grep -n "^|" docs/database-rollback.md | head` → 清单止于 002b。
  2. `ls server/migrations/` → 存在 003–009，无对应 `down` 文件或逆 SQL 文档。
  3. `sed -n '275,295p' server/index.js`；`grep -n "restart:" docker-compose.yaml`。
- 建议修复：为 `003`–`009` 逐一补齐逆操作 SQL 到 `docs/database-rollback.md`，并在迁移前增加「上线前必须验证 down 路径可用」的检查项；给 runner 增加可选的 `--dry-run`/`schema_migrations` 校验输出，使失败时的现场可诊断。
- 验证方式：在临时库（非生产）上「应用 001–009 → 按文档逆序回滚 → 再前滚」，两轮后 schema 与首轮一致。

---

### [HIGH] DATA-07 生产连库用 superuser，RLS 与「fail closed」声称不成立

- 证据：
  - `docker-compose.yaml:49`：api 环境 `- DB_USER=postgres`（`docker-compose.yaml` 第 48-50 行区间，含 `DB_HOST=postgres` / `DB_NAME=manga_studio`）；`server/db.js:16`：`user: process.env.DB_USER || 'postgres'`。
  - `server/db.js:100-101` 注释声称：「Missing GUC fails closed on non-superuser connections (see 003 migration policies)」——**前提是 non-superuser，而生产配的正是 postgres 超级用户**（超级用户 BYPASSRLS）。
  - `server/migrations/003_model_gateway.sql:178-183`：仅对 `model_providers / models / model_credential_versions / media_assets / model_invocations / model_jobs` 执行 `ENABLE ROW LEVEL SECURITY`；`003a_models_rls.sql` 补 `models`/`model_credential_versions` 策略。
  - 全量检索 `ENABLE ROW LEVEL SECURITY`：**只命中 003 与 003a**；`projects`（用户内容主表）、`assets`、`credit_*`、`payment_orders`、`audit_events`、`email_outbox` **均无 RLS**。
  - `server/db.js:105-111`：`SET LOCAL app.user_id = '<uuid>'`（带 `^[0-9a-f-]{36}$` 校验，无注入）。
- 影响：RLS 是「最后一道数据隔离兜底」，当前在生产被双重削弱：① 连接身份是超级用户，策略直接绕过；② 用户内容主表根本没有策略。因此跨用户读写完全依赖每个查询都手写 `WHERE user_id = $n` —— 任何一处遗漏（新接口、报表、导出、维护脚本）即静默越权读写。这是数据完整性/隔离层面的系统性风险，无法用「代码已 review」替代。
- 复现步骤：
  1. `grep -rn "ENABLE ROW LEVEL SECURITY" server/migrations/` → 仅 003、003a。
  2. `grep -rn "CREATE POLICY" server/migrations/ | wc -l` 与表清单对比。
  3. `sed -n '95,115p' server/db.js`；`grep -n "DB_USER" docker-compose.yaml`。
- 建议修复：为应用建专用非超级用户角色（`CREATE ROLE manga_app LOGIN` + 精确 GRANT），compose 用该角色连库；把 RLS 策略覆盖到 `projects/assets/credit_*/payment_orders`；对缺 GUC 的场景做 fail-close 测试。
- 验证方式：以应用角色连库，`SET LOCAL app.user_id` 后查询他人 `projects` 应返回 0 行；不设 GUC 查询应报错或 0 行。

---

### [HIGH] DATA-08 余额与台账可能背离：`topupCredits`/`refundCredits` 的幂等承诺不成立

- 证据：
  - `server/credits.js:91-107`（`topupCredits`）：先 `UPDATE credit_accounts SET balance = balance + $2 ... RETURNING balance`（`:95`），**之后**才 `INSERT INTO credit_ledger (...) ... ON CONFLICT (idempotency_key) DO NOTHING`（`:101-103`）。
  - `server/credits.js:108-124`（`refundCredits`）：同一顺序，`:112` 加钱、`:119-121` 写台账并 `ON CONFLICT DO NOTHING`。
  - `server/credits.js:91` 注释自称：「幂等键 = pay:orderNo（重复确认不会重复加钱）」——与实际实现相反：**幂等只作用于 ledger 行，余额累加是幂等的盲区**。重复调用时 `INSERT` 被 `ON CONFLICT` 静默吞掉，**余额已经多加了一次**，且不留任何台账痕迹（违反 `server/migrations/005_credits.sql:2` 的「ledger 只增不改，是余额争议的唯一事实源」）。
  - 对照 `server/credits.js:66-88`（`deductCredits`）：`SELECT ... FOR UPDATE`（`:70-73`）后 `UPDATE balance = balance - $2`（`:78-81`），且台账 INSERT **无** `ON CONFLICT`（`:82-86`，重复会报错 → fail closed），同时有 DB 级 `CHECK (balance >= 0)`（`005_credits.sql:7`）兜底。扣减侧是正确写法，恰好反证入账侧的顺序错误。
  - 现状护栏：`server/payments/index.js:88-93` 的 `UPDATE payment_orders SET status='paid' WHERE order_no=$1 AND status='pending' RETURNING *` 是原子占位，`if (!order) throw ... NOT_CONFIRMABLE`，把「重复确认」挡在函数之外——所以**当前支付确认路径是安全的**，缺陷是函数级契约不成立（埋雷），且 `refundCredits` 的调用点护栏强度未逐一核实。
- 影响：任何未来新增的调用点（补单、对账脚本、批量退款、事务重试）只要在未校验前置状态的情况下二次调用，就会**无声虚增余额**且台账对不上——而台账被定义为唯一事实源，出事后无法自证。资金类数据完整性风险。
- 复现步骤（只读推演 + 现有测试可覆盖）：
  1. `sed -n '88,124p' server/credits.js` → 观察先 UPDATE 后 INSERT 的顺序。
  2. `grep -rn "topupCredits\|refundCredits" server/ --include=*.js | grep -v node_modules` → 确认仅 `payments/index.js` 与网关失败路径调用，据此评估当前暴露面。
- 建议修复：把幂等判定前移——先 `INSERT INTO credit_ledger` 并检查 `rowCount`/`RETURNING`，仅当本次真正插入成功时才执行余额 UPDATE；或先 `INSERT ... ON CONFLICT DO NOTHING RETURNING id`，无返回即直接返回原余额；并补一条「ledger.balance_after 与 credit_accounts.balance 一致」的对账测试。
- 验证方式：单测中连续两次以同一 `refId` 调用 `topupCredits`，断言余额只加一次、ledger 只有一行。

---

### [HIGH] DATA-09 迁移非幂等，而文档教人删记录「重放」并声称可重复运行

- 证据（无 `IF NOT EXISTS` 的迁移）：
  - `server/migrations/001_identity.sql:6` `CREATE TABLE users (`（22 行 sessions、41 行 user_action_tokens、53 行 email_outbox 同）
  - `server/migrations/001a_entitlements.sql:6,19`（`user_entitlements`、`audit_events`）
  - `server/migrations/002_user_ownership.sql:40-41` `ALTER TABLE projects DROP CONSTRAINT projects_pkey;` / `ALTER TABLE assets DROP CONSTRAINT assets_pkey;`（无 `IF EXISTS`）
  - `server/migrations/002a_settings.sql:4,10`；`server/migrations/002b_migration_imports.sql:4`
  - `server/migrations/003_model_gateway.sql:7,29,58,82,97,133`（6 张表全部无 `IF NOT EXISTS`）
  - `server/migrations/003a_models_rls.sql:4,18,31`（`CREATE POLICY` 无 `IF NOT EXISTS`）
  - 对比：`004_announcements_notifications.sql:5,19`、`005_credits.sql:5,12`、`006_activities.sql:3,13,25,39`、`007_analytics.sql:3`、`008_payments.sql:3` 都用了 `CREATE TABLE IF NOT EXISTS` —— 说明作者知道幂等要求，但前 7 个文件未回填。
  - 文档承诺与操作指引：`docs/database-rollback.md:77`「迁移文件**可重复运行**（`schema_migrations` 防重复）」；`:28`「删除 `schema_migrations` 中对应 filename 记录（如需重放）」；`docs/部署手册.md:350`「恢复后迁移 runner 幂等」。
- 影响：`schema_migrations` 只要出现记录丢失/漂移（人员按 `:28` 手工删记录、部分表恢复、从旧备份恢复后 schema 更新），runner 会从 `001_identity.sql:6` 开始重放并立刻抛 `relation "users" already exists` → `server/index.js:290` `process.exit(1)` → `restart: unless-stopped` 无限重启，服务起不来。文档同时给了错误的「可重复运行」保证，会诱导运维走这条路。
- 复现步骤（未在生产执行）：
  1. `for f in server/migrations/*.sql; do printf "%s: " "$f"; grep -c "IF NOT EXISTS" "$f"; done` → 前 7 个为 0 或部分 0。
  2. `grep -n "重放\|可重复运行" docs/database-rollback.md` → 命中 28、77 行。
- 建议修复：给 `001/001a/002a/002b/003/003a` 的建表与 `CREATE POLICY` 补 `IF NOT EXISTS`，`002` 的 `DROP CONSTRAINT` 补 `IF EXISTS`；或更稳妥地在 runner 里为「迁移失败 + 该文件已存在对象」提供显式诊断；同步修正 `database-rollback.md:77` 的措辞，把「重放」限制在真正幂等的文件上（逐文件标注）。
- 验证方式：在临时库上先应用全部迁移，再清空 `schema_migrations` 重跑一次；应当全部跳过式通过而不是抛错。

---

### [MEDIUM] DATA-10 关键外键列 / RLS 过滤列 / 调度轮询列缺索引

- 证据：
  - `server/migrations/003_model_gateway.sql`：`grep -n "CREATE INDEX"` **无任何输出** —— 该文件建的 6 张表除主键与少量 UNIQUE 约束外没有任何二级索引。
  - 高频路径缺索引（附查询位置）：
    - `media_assets`：查询条件为 `user_id`（`server/model-gateway/media.js:53-58` 写入、`:63-68` 读取，RLS 策略 `003_model_gateway.sql:204-207` 也按 `user_id` 过滤）——**只有 PK(id) 与 UNIQUE(object_key)**，媒体列表/配额统计将全表扫描；该表随每次生成线性增长（含视频），是最先出问题的一张。
    - `email_outbox`：`server/auth/outbox.js:147-150` `WHERE status = 'pending' AND next_attempt_at <= NOW() ORDER BY created_at LIMIT $3 FOR UPDATE SKIP LOCKED`，而 `server/migrations/001_identity.sql:53-75` 的 `email_outbox` 仅 PK + 少量约束、**无任何索引**；worker 每 5s 跑一次（`server/auth/outbox.js:214`）。
    - `models.provider_id`（`003_model_gateway.sql:31` FK，无索引）→ 删/改 provider 时对 models 全表扫；`model_credential_versions.provider_id/model_id`（`:60-61`）同样无索引。
    - `model_invocations` 仅 `UNIQUE(user_id, operation, idempotency_key)`（`:128`）：可服务幂等查询，但 `server/credits.js:158-162` 的「今日配额计数」（`user_id + operation + created_at >= date_trunc('day', NOW())`）与按 `user_id` 列历史都需额外排序/过滤。
    - `audit_events` 只有 `(created_at DESC)`（`001a_entitlements.sql:30`）：后台按 `actor_user_id` 审计过滤无索引。
    - `referrals.referrer_id`（`006_activities.sql:41`）、`redeem_codes.redeemed_by`、`user_action_tokens.user_id`、`email_outbox.user_id/action_token_id` 均无索引。
- 影响：上线初期数据量小无感，随 `media_assets`/`email_outbox`/`model_jobs` 增长会出现「只有某些接口变慢」的雪崩式劣化；RLS（若按 DATA-07 修复后生效）会把这些全表扫描变成**每次请求**的固定成本。
- 复现步骤：`for t in media_assets email_outbox models model_credential_versions; do echo "== $t"; grep -n "$t" server/migrations/*.sql | grep -i "index\|unique"; done`
- 建议修复：至少补 `media_assets(user_id, created_at DESC)`、`email_outbox(status, next_attempt_at)`、`models(provider_id)`、`model_credential_versions(provider_id)`/`(model_id)`、`model_invocations(user_id, created_at DESC)`；上线后用 `pg_stat_user_tables` / `pg_stat_statements` 复检顺序扫描。
- 验证方式：临时库灌入 10 万行 media_assets/email_outbox，`EXPLAIN (ANALYZE, BUFFERS)` 确认走 Index Scan 而非 Seq Scan。

---

### [MEDIUM] DATA-11 无账号注销能力与数据保留策略；外键无 `ON DELETE` 使硬删除同样不可行

- 证据：
  - `grep -rn -iE "delete from users|deleteAccount|注销|account deletion|retention|数据保留" server/ docs/` → **server/ 与 docs/ 下零命中**（唯一命中在 `server/node_modules/safe-buffer/README.md`，无关）。
  - 外键定义：`server/migrations/005_credits.sql:6` `user_id UUID PRIMARY KEY REFERENCES users(id)`、`:14` `user_id UUID NOT NULL REFERENCES users(id)`、`server/migrations/002_user_ownership.sql:6-7` `ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)` —— *均无 `ON DELETE CASCADE`/`SET NULL`*。
  - 另有 `model_providers.owner_user_id ... ON DELETE CASCADE`（`003_model_gateway.sql:9`）等部分级联，形成「删用户一半级联、一半被拒」的半可用状态。
- 影响：① 合规上无「删除权」实现路径；② 即便运维手工 `DELETE FROM users`，也会被 `credit_ledger`/`credit_accounts`/`projects`/`assets` 的外键直接拒绝（`credit_ledger` 是资金台账，本就**不该**随用户删除而消失——所以这里需要的是一套显式的匿名化/保留策略，而非级联）。
- 复现步骤：`grep -rn "deleteAccount\|注销\|retention" server/ docs/ --include=*.js --include=*.md` → 无命中。
- 建议修复：定义并文档化数据保留策略（邮箱/密码哈希/IP 哈希/行为埋点/支付订单各自的保留期与删除方式），实现注销流程：业务数据删除或匿名化 + 资金台账按法规保留（`user_id` 置匿名占位或保留但脱敏）+ 审计事件保留期。
- 验证方式：走一遍注销流程后，`users` 中的邮箱不再可检索，且 `credit_ledger` 仍可对账。

---

### [MEDIUM] DATA-12 `ip_hash` 为全量 HMAC，持有同机 salt 即可穷举还原 IPv4

- 证据：
  - `server/auth/middleware.js:31-32`：`export const hashIp = (ip) => crypto.createHmac('sha256', ipHmacSalt()).update(String(ip || '')).digest('hex');` —— 无截断、无轮换、无按时间加盐。
  - `server/migrations/001a_entitlements.sql:26`：`ip_hash CHAR(64)`；写入见 `server/auth/audit.js:19-22`。
  - 调用点密集：`server/auth/routes.js:166,201,236,241,281,312,319,459,490`、`server/auth/admin-routes.js:34`、`server/routes/migration.js:42,65,83`、`server/routes/model-gateway.js:373` —— 基本每个认证/管理/网关动作都留一条带 IP 哈希的审计。
  - `IP_HMAC_SALT` 与数据库/备份同在服务器 `.env`（`docker-compose.yaml:59`；`docs/部署手册.md:23` 只要求 `.env` 600）。
- 影响：IPv4 空间仅 2^32，持有 salt 时**全量枚举只需数分钟**（甚至可预建彩虹表）。因此 `audit_events.ip_hash` 实质是「可逆 IP」，加上数据保留永久（见 DATA-11），形成完整的用户 IP 行为档案。再叠加 DATA-05 的明文备份，等于整套 PII 以近乎明文形态存在于宿主机磁盘。此条不影响可用性，但直接影响「个人信息处理」的合规表述（若对外声称为匿名化，属不实陈述）。
- 复现步骤：`sed -n '20,33p' server/auth/middleware.js`；`grep -rn "ip_hash" server/`。**未验证项**：未实测枚举耗时（需真实 salt，不采集）。
- 建议修复：改用「HMAC + 定期轮换盐 + 仅保留必要精度」（例如 IPv4 掩掉末 8 位）或改为不可关联的随机化 ID；为 `audit_events` 设定保留期（如 90 天）并定期清理；在隐私政策中避免使用「不可逆匿名化」表述。
- 验证方式：确认新写入的 `ip_hash` 无法通过 `/16` 以外的精度还原；确认存在审计清理任务。

---

### [MEDIUM] DATA-13 `schema_migrations` 无 checksum，schema 静默漂移

- 证据：
  - `server/db.js:51-56`：`CREATE TABLE IF NOT EXISTS schema_migrations (filename VARCHAR(255) PRIMARY KEY, applied_at BIGINT NOT NULL)` —— **只有 filename + 时间戳**。
  - `server/db.js:57-64`：`const applied = new Set(rows.map(r => r.filename)); ... if (applied.has(file)) continue;` —— 只看文件名，不看内容。
- 影响：开发过程中修改一个**已应用**的迁移文件（本仓库迁移文件在 feature 分支上仍在演进，例如 `009_ledger_topup_reason.sql` 这类补丁），在已有库上不会重新执行 → 「文件描述 = 实际 schema」的假设失效且**无任何提示**。生产新库不受影响，但「把 staging/自测库备份恢复到生产」或「在生产上按旧备份重建后继续前滚」这两条常见路径会静默带入不一致 schema，排障时极易误判。
- 复现步骤：`sed -n '48,80p' server/db.js`。
- 建议修复：给 `schema_migrations` 增加 `checksum CHAR(64)`，启动时对已应用文件做校验，不一致则拒绝启动并明确报错（fail-fast 而非静默）。
- 验证方式：改动一个已应用迁移文件的注释后重启，应当报 checksum 不一致（当前是无提示）。

---

### [MEDIUM] DATA-14 无 leader 锁：多副本导致重复备份、轮转互删、迁移无互斥

- 证据：
  - `server/backup.js:17-36`：`startBackupScheduler()` 仅检查 `BACKUP_DISABLED`，随后 `setInterval` + 首次 `setTimeout`，**无 `pg_try_advisory_lock`、无单例标记**；`server/backup.js:22-29` 每个副本独立 spawn `pg_dump`。
  - `server/db.js:48-83`：`runMigrations()` 无 advisory lock —— 两个副本同时启动会并发执行同一迁移文件（`CREATE TABLE users` 一方必然失败）。
  - `docs/部署手册.md:394` 已知限制 1 自认：「限流为进程内存实现、备份/邮件 outbox 调度无 leader 锁——多副本会重复跑定时任务且限流失真；扩容前需加 `pg_try_advisory_lock`」。
  - 当前 `docker-compose.yaml` 未设置 `deploy.replicas`，实际操作中 `docker compose up -d` 为单副本；但 `--scale api=2` 或迁移到 k8s 即触发。
- 影响：多副本下同一时刻两份 `pg_dump`（DB 与磁盘双倍压力），并**并发执行保留策略 `unlinkSync`** —— 两个进程各自读到「要删的旧文件」集合，可能把对方刚写好的新备份删掉，甚至在 `readdirSync` 与 `unlinkSync` 之间因竞态导致备份份数低于预期。属「静默丢失备份」类风险，与 §8.1 的轻描淡写（「重复跑定时任务」）严重程度不匹配。
- 复现步骤：静态阅读 `server/backup.js` 与 `docs/部署手册.md:394`；未在多副本环境实测（标注「部分未验证」）。
- 建议修复：备份/outbox/通知三个调度器统一用 `SELECT pg_try_advisory_lock($1)` 抢主；保留策略改为「先写临时清单、加锁、再删」；迁移 runner 加 `pg_advisory_lock` 并在扩容文档中明确单副本前提。
- 验证方式：`docker compose up -d --scale api=2` 观察日志中备份任务只出现一次（当前会出现两次）。

---

### [MEDIUM] DATA-15 `database-rollback.md` 的恢复命令与当前 schema 不符且部分不可用

- 证据：
  - `docs/database-rollback.md:93`：「查看备份内容（**19 个表**数据段等）」——实际表数量为 **29**：`001`(users, sessions, user_action_tokens, email_outbox) + `001a`(user_entitlements, audit_events) + `db.js:26-43`(projects, assets, config) + `002a`(system_settings, user_settings) + `002b`(migration_imports) + `003`(model_providers, models, model_credential_versions, media_assets, model_invocations, model_jobs) + `004`(announcements, notifications) + `005`(credit_accounts, credit_ledger) + `006`(check_ins, redeem_batches, redeem_codes, referrals) + `007`(analytics_events) + `008`(payment_orders) + 运行时新建的 `schema_migrations`。
  - `docs/database-rollback.md:96-101`：`pg_restore --host localhost --username postgres --dbname manga_studio ...` / `createdb manga_studio_restore` —— 这些命令若在**宿主机**执行，需要 postgres 端口可达；而 `docker-compose.yaml` 的 postgres 服务**没有 `ports:` 映射**（`grep -n "ports:" docker-compose.yaml` 仅命中 frontend 的 3005），且无口令注入 → 宿主机无法连接，命令不可用。若在容器内执行则需写 `docker compose exec postgres …`，文档未说明执行位置。
  - 对照：`docs/部署手册.md:321-348` §6.3 的容器内写法（`docker compose exec postgres …`）是正确的 —— 两份文档对同一动作给出不同且一份不可用的命令集。
- 影响：事故现场按 `database-rollback.md` 操作会先撞上「连不上数据库」，再对表数量产生错误预期（据此判断「恢复不完整」）。恢复流程的可执行性是上线前的核心验收项，不应留歧义。
- 复现步骤：`grep -n "ports:" docker-compose.yaml`；`grep -rn "CREATE TABLE" server/migrations/*.sql server/db.js | wc -l`。
- 建议修复：把 `database-rollback.md` 的恢复段整体改为与 §6.3 一致的容器内写法并注明执行位置；把「19 个表」改为实际数字或改为「表数量以 `pg_restore -l` 输出为准」。
- 验证方式：按修正后的文档完整跑一遍恢复演练（临时库）。

---

### [MEDIUM] DATA-16 `.env.production.example` 预填占位域名，能通过所有预检但不指向真实站点

- 证据：
  - `.env.production.example:16-17`：`CORS_ORIGINS=https://manga.example.com` / `PUBLIC_APP_URL=https://manga.example.com`（**非空**）；`:42` `SMTP_FROM=no-reply@manga.example.com`。
  - 门禁只校验「非空 + https:// 前缀」：`docker-compose.yaml:53-54` 用 `${CORS_ORIGINS:?...}`（非空即通过）；`scripts/deploy.sh:35` `need CORS_ORIGINS`、`:39` `case "$CORS_ORIGINS" in https://*) ok ...`（占位值满足）。
  - 对比 `POSTGRES_PASSWORD=`、`IP_HMAC_SALT=`、`MODEL_ENC_KEY=` 等留空项**会**被门禁拦下（`deploy.sh:34-37,44`）——只有域名类预填值漏网。
- 影响：操作员若漏改域名而直接 `./scripts/deploy.sh`，预检全绿、容器全起、健康检查通过（§3.4 用 `127.0.0.1:3005` 冒烟，与域名无关），但：邮件里的验证/重置链接指向 `manga.example.com`（用户注册即卡死），且 CORS 白名单是一个**不受操作方控制的域名**——若该域名被第三方注册，浏览器同源策略会允许其对 api 发起带 Cookie 的跨源请求（配合 `credentials` 语义构成越权面）。数据层角度：这是「注册链路不可用 + 邮箱验证 Token 外泄到第三方域名」的合规/可用性事故。
- 复现步骤：`sed -n '14,18p' .env.production.example`；`bash scripts/deploy.sh --preflight-only`（在预检文件上运行，不构建）观察是否放行。
- 建议修复：`.env.production.example` 把域名类字段留空（`CORS_ORIGINS=`、`PUBLIC_APP_URL=`、`SMTP_FROM=`），或让 `deploy.sh` 显式拒绝含 `example.com` 的取值。
- 验证方式：带占位域名执行 `--preflight-only` 应当失败。

---

### [LOW] DATA-17 `IP_HMAC_SALT` 生成长度文档不一致

- 证据：`docs/部署手册.md:42`「`IP_HMAC_SALT` ✅ 必须 … `openssl rand -hex 32`」 vs `.env.production.example:32-33`「IP 审计哈希盐：`openssl rand -hex 16`」。
- 影响：无功能故障；但盐长度口径不一致会让操作员怀疑配置正确性，且 hex16（8 字节）在枚举场景下更弱（与 DATA-12 叠加）。
- 复现步骤：`grep -n "IP_HMAC_SALT" -A2 docs/部署手册.md .env.production.example`。
- 建议修复：统一为 `openssl rand -hex 32`。
- 验证方式：两处文本一致。

### [LOW] DATA-18 `deleteMedia` 仅软删不回收文件

- 证据：`server/model-gateway/media.js:81-90`：注释称「Soft delete; physical cleanup happens when ref_count reaches 0.」，但实现只有 `UPDATE media_assets SET status='deleted', deleted_at=NOW()`，**没有任何 `fs.unlink`**，`media_assets.ref_count`（`003_model_gateway.sql:90`）也未见递减逻辑。
- 影响：`media-store`（无卷，见 DATA-01）只增不减 → 磁盘单调增长；删除用户内容后文件仍留在容器内，与「用户删除」承诺不符。
- 复现步骤：`sed -n '81,90p' server/model-gateway/media.js`；`grep -rn "ref_count" server/ --include=*.js | grep -v node_modules`。
- 建议修复：ref_count 归零时物理删除对象；增加孤儿文件清理任务。
- 验证方式：删除媒体后 `ls` 目标目录不再存在该对象。

### [LOW] DATA-19 `assertDailyQuota` 在事务外读计数，可被并发绕过

- 证据：`server/credits.js:151-169`：用 `pool.query` 直接 `SELECT COUNT(*)::int AS c FROM model_invocations WHERE user_id = $1 AND operation = $2 AND created_at >= date_trunc('day', NOW())`，随后 `if (rows[0].c >= limit) throw`。COUNT 与实际写入不在同一事务、无锁。
- 影响：并发发起 N 个请求可同时通过配额检查 → 超出每日配额（成本失控），不影响数据一致性。
- 复现步骤：`sed -n '151,169p' server/credits.js`。
- 建议修复：把配额检查与 invocation 写入放在同一事务并用行锁/计数表原子递增。
- 验证方式：并发打满配额，统计 `model_invocations` 当日行数不应超过 limit。

### [LOW] DATA-20 本地 `.env` 权限 644；保留策略把同名 `.dump` 与 `.dump.age` 分别计数

- 证据：`ls -la .env` → `-rw-r--r--@ 1 wuxb staff 487 Oct 3 23:52 .env`，而 `docs/部署手册.md:23` 要求「`.env` 权限 600」。另 `server/scripts/backup-db.js:60-64` 的过滤同时收 `.dump` 与 `.dump.age`，`scripts/encrypt-existing-backups.sh:33-37` 在迁移期会**同时存在** `X.dump` 与 `X.dump.age` → 同一份备份占用 2 个 `BACKUP_KEEP` 额度，实际保留时间减半。
- 影响：本地开发机上的密钥文件对同机其他用户可读（生产由手册要求 600，但无自动校验）；备份轮转在加密迁移窗口期实际只保留 7 天份量。
- 复现步骤：`ls -la .env .env.production.example`；`sed -n '59,68p' server/scripts/backup-db.js`。
- 建议修复：`deploy.sh`/`health-check.sh` 增加 `.env` 权限断言；轮转按「时间戳」而非「文件」计数（同一时间戳的 `.dump`/`.dump.age` 视为一份）。
- 验证方式：迁移期执行一次备份后，`ls backups/ | wc -l` 与预期保留份数一致。

---

## 已核实的「正向」结论（供汇总时平衡判断）

以下项经取证确认**无问题**，不构成发现（列出以免与「未覆盖」混淆）：

1. **迁移的事务化与记账原子性是正确的**：`server/db.js:66-78` 每个文件 `BEGIN` → 执行 → `INSERT INTO schema_migrations` → `COMMIT`，失败 `ROLLBACK` 并抛错。因此**不会出现「schema 改了但没记账」或「记了账但 schema 没改」的半截状态**；单条迁移内部也不会留半截 schema（`002_user_ownership.sql:3` 的注释「Runs inside the migration runner's transaction」与实际一致）。
2. **补丁式编号的排序是可靠的**：`server/db.js:61` `fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()` —— 字典序下 `001 < 001a < 002 < 002a < 002b < 003 < 003a < 004 … 009` 全部落在正确位置（`a`/`b` 后缀排在下一个数字之前）。`003a_models_rls.sql` 依赖的 `models` 表由 `003` 创建，顺序正确。
3. **首次生产空库的前置顺序正确**：`server/index.js:279-291` 先 `await initDB()`（内部 `ensureBaseTables` → `runMigrations`）**再** `app.listen`，迁移未完成不对外服务；`server/db.js:119-128` 的 `initDB` 顺序为 `ensureBaseTables()`（`projects/assets/config`）→ `runMigrations()`，因此 `002` 的 `ALTER TABLE projects` 与 `001a`/`002a` 建表都不会因缺表失败。空库上 `002:27-37` 的 `RAISE EXCEPTION`（要求 ownership 完整）因 `projects`/`assets` 为空而不会触发。
4. **扣减侧的资金安全是有 DB 级保障的**：`server/migrations/005_credits.sql:7` `balance INT NOT NULL DEFAULT 0 CHECK (balance >= 0)`（余额不可为负）+ `server/credits.js:70-73` `SELECT … FOR UPDATE` 行锁 + `:78-81` `balance = balance - $2` 原子更新 + 台账唯一键（`:22` `idempotency_key … UNIQUE`）→ 无丢失更新、无负余额、无重复扣减台账。
5. **订单状态机是原子的**：`server/payments/index.js:88-93` `UPDATE … WHERE order_no=$1 AND status='pending' RETURNING *` + `NOT_CONFIRMABLE` 抛出，天然收敛并发/重复确认。
6. **入账密钥与敏感载荷是加密落库的**：模型凭据 `003_model_gateway.sql:62-65`（ciphertext/iv/tag/key_id + `MODEL_ENC_KEY` fail-close）、请求载荷 `:105-108`、邮件动作令牌 `server/auth/outbox.js:147-154` 读取 `action_token_ciphertext/iv/tag/key_id`、券码只存哈希 `006_activities.sql:24-28`（`code_hash BYTEA UNIQUE`）——明文不落库。
7. **备份调度器的容器内路径是对的**：`server/backup.js:15` `path.join(__dirname, 'scripts', 'backup-db.js')` 在容器内解析为 `/app/scripts/backup-db.js`（`server/Dockerfile.server:6,17` `WORKDIR /app` + `COPY . .`），`server/backup.js:24` `cwd: __dirname` 使 `BACKUP_DIR` 默认解析到已挂卷的 `/app/backups`（`server/scripts/backup-db.js:16`）；`scripts/backup-now.sh:8,11` 硬编码的 `manga-studio-api` 与 `docker-compose.yaml:39` `container_name: manga-studio-api` 一致 → 该手动备份命令**可用**。`server/Dockerfile.server:11` 已装 `postgresql16-client`（`pg_dump` 与服务端 postgres:16 大版本对齐）与 `age`。
8. **备份目录不含 age 私钥**：`grep -rn "age.key" scripts/ server/` 仅命中脚本注释；`.gitignore:94-95` 忽略 `*.key` / `age.key`，`.dockerignore:25-26` 排除 `.env` 与 `.env.*`（因此私钥即便放在仓库根也不会被提交或打进镜像）——**前提是操作员不在仓库根生成 `age.key` 后再构建**（本条列为「未覆盖项 3」的残留风险）。

---

## 未验证 / 未覆盖项

| # | 项 | 原因 |
|---|---|---|
| 1 | 未在真实 Postgres 上执行任何迁移、回滚或恢复演练；所有 SQL 级结论均为静态阅读 + 语义推演 | 任务硬约束：禁止执行破坏性数据库命令与恢复演练。本机**没有运行中的 Postgres 服务**（`docker ps` 无 manga-studio 相关容器；仅存在悬空卷 `gcc-printfilm_pgdata`、`gcc-printfilm_backups`），无法做等价验证 |
| 2 | `docs/部署手册.md` §6.3 恢复演练**未实跑**：`age --decrypt`（宿主无 age，`command -v age` 为空）、`docker compose cp`、`pg_restore`、`dropdb` 全部未执行 | 同上（禁止恢复演练 + 无运行环境）。**结论：§6.3 的「命令是否真实可用」只完成了静态核对**——容器内写法（`docker compose exec postgres …` + `127.0.0.1` trust 连接）语法与官方镜像一致，判定「语法可用但未实测」 |
| 3 | age 私钥是否实际存在/是否已离线保管、`BACKUP_AGE_RECIPIENT` 生产取值 | 属运行时密钥，未读取 `.env`（避免采集真实密钥）。**因此 DATA-03 的实际触发概率未知**；但其「删除明文前不校验」的代码缺陷已确证 |
| 4 | 承诺的 RPO/RTO 有无证据支撑 | `docs/部署手册.md` 与 `docs/database-rollback.md` **通篇未给出 RPO/RTO 数值**（grep「RPO」「RTO」零命中）→ 属「承诺缺失」而非「证据不足」，故未单列发现；建议汇总时并入 DATA-02 |
| 5 | 多副本（`--scale api=2`）下的备份/迁移竞态 | 需实际运行多副本，本机未启动容器 |
| 6 | 备份文件实际大小、`backups/` 卷内是否存在历史明文 `.dump`、卷占用 | 卷为悬空卷且需启动容器才能读取；`docker volume ls` 仅能确认 `gcc-printfilm_pgdata`、`gcc-printfilm_backups` 两个卷存在 |
| 7 | `pg_restore` 恢复后的**行数与业务一致性抽样** | 需真实备份产物 + 运行库，不可离线完成 |
| 8 | PII 在应用日志中的完整暴露面 | 已做定向 grep（`console.*email|password|token|ip`）仅命中无敏感值的用法；未做全量日志采集（需运行时） |
| 9 | `002_user_ownership.sql:31` 与 `003_model_gateway.sql:226` 的 `BEGIN` 是否属于 PL/pgSQL 块内 | 已核对 `003` 的 `226` 行确位于 `CREATE OR REPLACE FUNCTION … AS $$ DECLARE … BEGIN … END $$ LANGUAGE plpgsql` 之内（非顶层事务控制语句），无嵌套事务冲突；`002` 的 `31` 行同理位于 `DO $$ … $$` 内。此项**已消除**（列在此处以说明已排查） |

## 上线阻断意见（本域）

- **必须在部署前解决**：DATA-01（媒体无卷 = 更新发布即丢文件）、DATA-02（无异地备份 = 主机故障即全损）。
- **必须在部署前解决或书面接受**：DATA-03 / DATA-04 / DATA-05（三者共同决定「备份能不能用来恢复」）、DATA-06（回滚能力）、DATA-07（数据隔离兜底）。
- **建议在同批修复**：DATA-08、DATA-09（资金台账与重放安全性）。
- 其余 MEDIUM/LOW 可排期，但应在报告里带上责任人与期限。
