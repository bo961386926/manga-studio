# 对抗性复核 A：安全 / 支付 / 网关三份报告的发现验真

- 复核人：verify-a（团队 printfilm-launch-review，任务 t7，attempt `dc97bdc5-3dea-45f7-b32e-3b84f69c1f35`）
- 复核对象：`docs/launch-review/01-security.md`（SEC-01..16）、`02-payments.md`（PAY-01..11）、`03-gateway.md`（GW-01..17）
- 审查目标：当前工作树（分支 `feat/public-model-platform`，HEAD `8fd19fd`）
- 复核范围：三份报告的**全部 BLOCKER 与 HIGH**，以及每份的 MEDIUM 抽样（01 域 6/6、02 域 4/4、03 域 6/7）
- 复核方式：打开被引用的文件与行号独立重判定 + 可执行的单文件命令（`grep`/`sed`/`awk`/`node --input-type=module`）
- 硬约束遵守情况：**未改任何源码/配置/脚本/迁移/测试**，**未改 `.env`**，**未 git 写操作**，**未启动任何服务**，**未执行迁移**，**未发起任何 HTTP/上游请求**。唯一写入文件为本文件。
  - ⚠️ **一处偏离已如实披露**：在收到队长「不得连库」的纪律补充（m00065）**之前**，我曾对**本机** Postgres 执行过只读 catalog 查询（`pg_roles`/`pg_class`/`pg_policies`/`SELECT count(*)`）与**一个整段 `BEGIN…ROLLBACK` 的 TEMP 表演示**（结束后用 `pg_class` 确认无残留表）。收到纪律后**未再连库**。该事实见文末「本次复核的局限」第 1 条。
- 复核结论一句话：**三份报告没有「对着空气报漏洞」的重大虚构，但存在 4 处局部证据错误 + 1 处跨域重复计数 + 3 处严重度需要调整**；其中 GW-08 被低估（MEDIUM→HIGH），GW-01 的阻断前提被证伪（BLOCKER→MEDIUM，但同一后果已由部署域的 DEP-01 真实命中）。

## 汇总表

| 原 ID | 复核判定 | 原严重度 | 复核严重度 | 一句话理由 |
|---|---|---|---|---|
| SEC-01 | CONFIRMED | HIGH | HIGH（同意） | 本机实机复现：正则从 SVG 取答案，`verifyCaptcha` 直接返回 `ok` |
| SEC-02 | CONFIRMED | MEDIUM | MEDIUM（同意） | `GET /captcha` 确无任何限流；内存挑战表仅按「已过期」惰性清理，无硬上界 |
| SEC-03 | CONFIRMED | MEDIUM | MEDIUM（同意） | `buckets = new Map()` 确为进程内单副本；`nginx.conf` 无 `limit_req` |
| SEC-04 | CONFIRMED | MEDIUM | MEDIUM（同意，拓扑条件性） | `3005:80` 确指容器 nginx；宿主反代拓扑下 `$remote_addr` 覆盖真实 XFF 成立 |
| SEC-05 | CONFIRMED | MEDIUM | MEDIUM（同意） | 独立穷举 7 个路由文件，清单 11 条**完整**；`SameSite=Lax` 降级理由成立 |
| SEC-06 | CONFIRMED | HIGH | HIGH（同意） | 预检链无 SMTP 门禁 + 模板 `SMTP_HOST=` 空值 + dev 兜底打印含令牌正文 |
| SEC-07 | CONFIRMED | HIGH | HIGH（同意，与 GW-02 合并计数） | 应用以超级用户连接 ⇒ RLS 全失效；两个列表接口确无对象级过滤 |
| SEC-08 | CONFIRMED | MEDIUM | **LOW（下调）** | 死配置属实，但失效方向是「用更强的库默认参数」，无暴露面 |
| SEC-09 | CONFIRMED | MEDIUM | MEDIUM（同意，建议与 DEP-03 合并呈现） | 默认路径 `listen 80` 无 HSTS 属实；部署域已把同一事实定为 BLOCKER |
| SEC-10 | CONFIRMED | LOW | LOW（同意） | `hashToken(provided) !== row.csrf_token_hash` 字面属实，实际不可利用 |
| SEC-11 | CONFIRMED | LOW | LOW（同意） | `grep -c "error: e.message" server/index.js` = **14**，与报告一致 |
| PAY-01 | CONFIRMED | HIGH | HIGH（同意） | 永久 VIP（`expires_at IS NULL`）命中 SELECT 但为 falsy ⇒ 走 `new Date()` 被覆盖 |
| PAY-02 | CONFIRMED | HIGH | **MEDIUM（下调，潜伏）** | 代码缺陷与漂移实测均成立；但「当前不可达」的论证独立核验后**成立** |
| PAY-03 | CONFIRMED | MEDIUM | MEDIUM（同意） | 确认入账是全仓唯一未挂 `requireRecentReauth`/审计的敏感管理动作 |
| PAY-04 | CONFIRMED | MEDIUM | MEDIUM（同意） | `routes/payments.js` 全文零 `csrfProtection` |
| PAY-05 | CONFIRMED | MEDIUM | MEDIUM（同意） | `refunded`/`expired` 只有白名单与注释，无任何写入点 |
| PAY-06 | CONFIRMED | MEDIUM | MEDIUM（同意） | 对账只 `status='paid'`（=管理员已确认时刻），已转账未确认不可见 |
| GW-01 | **REFUTED（前提）** | BLOCKER（条件性） | **MEDIUM（下调）** | 受支持部署路径强制 `NODE_ENV=production`（compose 硬编码 + 手册穷举）；但同一后果由 DEP-01 在生产真实命中 |
| GW-02 | **REFUTED（部分证据）** | HIGH | HIGH（同意，与 SEC-07 合并） | 「models/mcv 无任何策略」**错**（策略在 `003a_models_rls.sql`）；根因不变 |
| GW-03 | CONFIRMED | HIGH | HIGH（同意） | `operation = 'video'` 硬编码 + `creditCost('video')` ⇒ 异步 i2i 多扣 15 倍 |
| GW-04 | CONFIRMED | HIGH | HIGH（同意） | `pollJob` 四条终结路径与提交失败路径均无退款；4xx 被误分类为 `submission_uncertain` |
| GW-05 | **REFUTED（路径）** | HIGH | HIGH（同意） | 引用路径 `server/auth/legacy-config.js` 不存在；实际 `server/migration/legacy-config.js` + `settings.js` 明文属实 |
| GW-06 | CONFIRMED | HIGH | **MEDIUM（下调）** | 无 keyring 属实；`keyId` 校验是空转（两侧传同一值），属运维连续性问题 |
| GW-07 | CONFIRMED | MEDIUM | MEDIUM（同意） | 冲突分支只回退到「读既有行」，随后仍继续调用上游 |
| GW-08 | CONFIRMED | MEDIUM | **HIGH（上调）** | `downloadRemote` **全仓不存在**（不是「此处没传」）⇒ 必然 TypeError；已扣费 + 无结果 + 永久 `submitting` |
| GW-09 | CONFIRMED | MEDIUM | MEDIUM（同意） | `assertDailyQuota` 用裸 `pool.query` 在事务外计数 |
| GW-10 | CONFIRMED | MEDIUM | MEDIUM（同意） | `/api/model-invocations` 150MB JSON 且无任何 limiter |
| GW-11 | CONFIRMED | MEDIUM | MEDIUM（同意） | `poll-on-read` 由代码注释自述「尚无外部 worker」 |
| GW-12 | **REFUTED（部分）** | MEDIUM | **LOW（下调）** | `:797` 处是脱敏后的通用文案；只有 `:222-229`（discover）回传上游原文 |
| GW-13 | CONFIRMED | MEDIUM | **LOW（下调，设计权衡）** | 确无主机允许列表；但 BYO 上游网关的本职就是访问任意公网主机 |
| U-1 | UNVERIFIED | — | — | 跨租户实机读取现象：本地库 0 行私有 provider，且禁起服务/禁 HTTP |
| U-2 | UNVERIFIED | — | — | PAY-02 是否已在任何环境产生真实 drift：禁止连库 |
| U-3 | UNVERIFIED | — | — | GW-05 遗留导入在生产库是否已执行：无生产数据访问 |

**计数：CONFIRMED 26 · REFUTED 4（均为「部分/前提」级，其中 GW-02、GW-05 的实质结论仍成立）· UNVERIFIED 3。**
被推翻项：GW-01（生产前提）、GW-02（「无策略」子断言）、GW-05（文件路径）、GW-12（`:797` 证据）。
严重度被调整项：SEC-08 ↓、PAY-02 ↓、GW-01 ↓↓、GW-06 ↓、GW-08 ↑、GW-12 ↓、GW-13 ↓（共 7 项）。
新增发现：**V-A-01 / V-A-02 / V-A-03（共 3 条）**；另有 1 条跨域重复（DEP-01）按「不重复计数」处理。

---

## 一、安全域（01-security.md）

### [CONFIRMED] SEC-01 验证码答案明文写在 SVG

- 我实际做的取证：`node --input-type=module -e "const m=await import('./server/auth/captcha.js'); const {captchaId,svg}=m.issueCaptcha(); const chars=[...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(x=>x[1]); console.log('extracted=',chars.join('')); console.log('verify=',m.verifyCaptcha(captchaId, chars.join('').toLowerCase()));"` → 输出 `extracted= j82g` / `verify= ok`；读 `server/auth/captcha.js:33-42`（`:40` `<text ...>${ch}</text>`，`:61` 逐字符拼接、`:64` 返回 `{captchaId, svg}`）、`:14` `captchaEnabled = () => process.env.CAPTCHA_ENABLED === 'true'`、`server/auth/routes.js:61-67`（匿名 `GET /captcha`）。
- 结论与理由：证据真实、推理成立；**该门对脚本零阻力**，无需图像识别。作者关于「现有测试用 `_peekAnswer` 故漏检」的提醒也成立。
- 严重度调整及原因：**同意 HIGH**。注意与部署域叠加关系（不是同一问题）：`CAPTCHA_ENABLED` 生产默认 `false`（部署域 DEP-02），**即使打开也被本项击穿** —— 保留两条独立计数是对的。

### [CONFIRMED] SEC-06 未配 SMTP 时令牌明文进容器日志

- 我实际做的取证：`grep -n SMTP scripts/deploy.sh` → **无命中**；`sed -n '27,48p' scripts/deploy.sh`（预检仅 `POSTGRES_PASSWORD/CORS_ORIGINS/PUBLIC_APP_URL/MODEL_ENC_KEY/REQUEST_HMAC_KEY` + `NODE_ENV`/`EMAIL_VERIFICATION_DISABLED`/`RATE_LIMIT_DISABLED`/密码长度）；`.env.production.example:36` `SMTP_HOST=`；`docker-compose.yaml:70` `- SMTP_HOST=${SMTP_HOST:-}`；`server/auth/outbox.js:107-109`（无 host 返回 `null`）、`:124-131`（dev 兜底 `console.log` 打印 `mail.text`）、`:92`/`:98`（`actionUrl('/reset-password'|'/bootstrap', token)`）。交叉印证：部署域 05-deploy.md 的 F2 独立得出同一链条（并指出 `outbox.js:127-129` 的「Production never reaches this branch」只是注释、无运行时断言）。
- 结论与理由：证据真实；**生产可触发**（模板即空值 + 预检不兜底 + compose 只给空默认）。令牌静态加密的设计被 dev 兜底日志抵消。
- 严重度调整及原因：**同意 HIGH**（账号接管 + 管理员一次性激活）。

### [CONFIRMED] SEC-07 RLS 被超级用户绕过 + 两个列表接口缺对象级过滤

- 我实际做的取证：
  - 静态：`server/db.js:100-113`（`withUserContext` 先做 `/^[0-9a-f-]{36}$/i` 校验，再 `SET LOCAL app.user_id/app.is_admin`，注释自述 non-superuser 连接时缺 GUC 会 fails closed）；`docker-compose.yaml:46-50`（api `DB_USER=postgres`，未设 `DATABASE_URL`）；`server/routes/model-gateway.js:104-118`（`GET /providers` 的 SQL 无 owner/scope 条件）、`:322-338`（`GET /models` 无租户条件）。
  - 只读库取证（**偏离约束，见局限**）：`psql -d manga_studio -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles"` → `postgres: rolsuper=t, rolbypassrls=f`（Postgres 超级用户**无条件**绕过 RLS，与 `rolbypassrls` 属性无关）；`pg_class` → `model_providers/models/model_credential_versions/media_assets/model_invocations/model_jobs` 全部 `relrowsecurity=t, relforcerowsecurity=f`、owner=postgres；`pg_policies` → 6 条策略；`SELECT count(*) FROM model_providers` → **0 行**（本地无私有 provider 数据）。
  - 关键的**独立补充实验**（`BEGIN … ROLLBACK` + TEMP 表）：**不开 FORCE 时超级用户看到 2/2 行；`ALTER TABLE … FORCE ROW LEVEL SECURITY` 后再查仍是 2/2** ⇒ **FORCE 对超级用户同样无效**（FORCE 只约束非超级用户的表 owner）。结束后 `pg_class` 确认无残留。
  - `grep -rn "FORCE ROW LEVEL\|CREATE ROLE\|GRANT " server/migrations/` → **无命中**。
- 结论与理由：根因**成立且比报告更强**：本部署下**连「FORCE RLS」这条常见建议也救不了**，唯一有效修法是「换非超级用户角色」或「显式 WHERE 过滤」。两个列表接口无对象级过滤属实。全仓巡检未发现第三个「面向普通用户且无过滤」的 RLS 表查询（`routes/model-gateway.js:789` 见 V-A-03；其余命中集中在 admin 统计与按 `user_id` 过滤的查询）。
- 严重度调整及原因：**同意 HIGH**；但**必须与 GW-02 合并为一条根因**（见「跨域裁决」），否则同一事实被计两次。

### [CONFIRMED] SEC-02 / SEC-03 / SEC-04（MEDIUM 抽样）

- SEC-02 取证：`server/auth/routes.js:61-67`（GET `/captcha` 无 limiter）；`server/auth/captcha.js:12`（`const store = new Map()`）、`:16-21`（仅当 `store.size >= MAX_STORE(5000)` 才遍历且只删**已过期**条目）。结论：无硬上界、无会话绑定成立。**同意 MEDIUM**。
- SEC-03 取证：`server/auth/middleware.js`（`const buckets = new Map()`、`MAX_BUCKETS = 50000` 惰性 sweep、模块级注释 `single-process store; shared store required for multi-instance`）；`grep -n "limit_req\|limit_conn" nginx.conf` → 无输出；限流器清单与报告一致（`loginLimiter` 10/10min 按 IP、`loginEmailLimiter` 5/10min 按邮箱、`registerLimiter`/`emailLimiter`/`resetLimiter`/`changePasswordLimiter` 5/h、`adminLimiter` 20/min）。结论成立。**同意 MEDIUM**。
- SEC-04 取证：`docker-compose.yaml:123-124` frontend `ports: - "3005:80"` ⇒ **3005 就是容器 nginx**；`nginx.conf:18` `proxy_set_header X-Forwarded-For $remote_addr;`（覆盖）；`deploy/nginx-tls.conf:37` 同样写法；`docker-compose.tls.yaml:8-11` 头注**明确支持**「宿主层（IIS/nginx/Caddy）终止 TLS，宿主反代上游指向 `127.0.0.1:3005`」这一拓扑。
  - 我最初的怀疑（「`3005` 是 api 端口、宿主反代直连 api、因此不经过容器 nginx」）被**证伪**：`3005` 映射到 frontend 的 `80`，宿主反代确实打到容器 nginx；此时容器 nginx 看到的 `$remote_addr` 是宿主反代地址，被 `$remote_addr` 覆盖掉的正是真实客户端 XFF ⇒ 全站归一桶、审计 IP 全错。报告自己的条件化表述（「宿主层反代拓扑下」）**准确**，且与它列为正面结论的「直连容器 nginx 拓扑下 XFF 覆盖使伪造无效」并不矛盾。
- 结论与理由：**CONFIRMED（静态可判定，运行时未构造）**。**同意 MEDIUM**；修复建议（`real_ip_header` + `set_real_ip_from` 或 `trust proxy 2`）方向正确。

### [CONFIRMED] SEC-05 11 个状态变更路由缺 `csrfProtection`

- 我实际做的取证（**独立穷举，不看报告的清单**）：用 `awk` 遍历 `server/index.js`、`server/auth/routes.js`、`server/auth/admin-routes.js`、`server/routes/{model-gateway,payments,credits,migration}.js`，对每条 `.post/.put/.patch/.delete/.all(` 声明向后扫描 10 行判断是否含 `csrfProtection`。结果与报告**完全一致**：`admin-routes.js:43,82,103,121,315`、`payments.js:31,59,81`、`credits.js:14,26`、`migration.js:23`；另有 `auth/routes.js:90,176,211,351,385,432` 与 `index.js:267`（`app.all('/api/config/:key')`）。
  - `index.js:267` 经查**恒返回 410**（legacy 端点已退役）→ 不构成缺失，报告未列入是正确的。
  - 前述 6 条 `auth/routes.js` 路由全部是**匿名**端点（register / verify-email / login / request-password-reset / reset-password / bootstrap-complete）→ 不属于「已登录状态变更」类，报告的 11 条清单**完整**。
  - 我另读了 `server/auth/middleware.js:141-154`（`anonymousMutationGuard`）与 `:174-191`（`csrfProtection`）：`index.js:61` 只有 `app.use(anonymousMutationGuard)`，全仓无 app/router 级 CSRF，与报告一致。
- 降级理由独立验证：`server/auth/session.js:13-22` 显式 `sameSite: 'lax'` + `httpOnly`；`middleware.js:71-83` 的 `corsAllowlist` 只对白名单 Origin 回 `Access-Control-Allow-Origin`（无通配）⇒ 跨站请求既不带会话 Cookie、攻击者也无法读取 CSRF token ⇒ **「当前不可直接利用」成立**。
- 结论与理由：**CONFIRMED，清单完整**。**同意 MEDIUM**（一次中间件铺开即可修）。建议报告补一句范围说明：匿名端点的替代防线是 `anonymousMutationGuard`（详见 V-A-02 的缺口）。

### [CONFIRMED] SEC-08 / SEC-09 / SEC-10 / SEC-11（抽样）

- SEC-08 取证：`server/auth/password.js:24-30`（只传 `type: argon2.argon2id`，其余用库默认）；`grep -rn ARGON2 server/` → 无命中；`docker-compose.yaml` api 段不透传 `ARGON2_*`；`.env.production.example:54-56` 有该三项。结论：**死配置成立**。
  - **严重度：MEDIUM → LOW（下调）**。理由：该配置失效的方向是「实际使用库默认 `p=4` 而文档声称 `p=1`」——对单机/低核部署而言可能是**更优**的参数，不产生暴露面；它属于「文档与实现不一致」而非安全缺陷。
- SEC-09 取证：`nginx.conf:2` `listen 80` 且全文无 HSTS（`grep -n Strict-Transport-Security nginx.conf` 无命中）；`deploy/nginx-tls.conf:7-11`（80→443 `return 301`）、`:55,:69`（HSTS）；`.env.production.example:25-27` 明文建议 HTTP 过渡期设 `COOKIE_SECURE=false`；`server/auth/session.js:15-18`（显式值优先，空值才回落 `NODE_ENV`）；`docker-compose.yaml:62-63`（`COOKIE_SECURE=${COOKIE_SECURE:-}`）。结论成立。**同意 MEDIUM**；跨域建议：部署域已就同一事实出具 **DEP-03（BLOCKER）/DEP-05（HIGH）**，汇总时**应合并呈现**并取更高严重度，避免「同一事实两种严重度」。
- SEC-10 取证：`server/auth/middleware.js:187` `if (hashToken(provided) !== row.csrf_token_hash)`。**同意 LOW**（对哈希比较做计时攻击不具现实可行性）。
- SEC-11 取证：`grep -c "error: e.message" server/index.js` → **14**，与报告「精确 14 处」一致。**同意 LOW**。

---

## 二、支付域（02-payments.md）

### [CONFIRMED] PAY-01 永久 VIP 被一次续费买成限时

- 我实际做的取证：`server/payments/index.js:104-111`（`SELECT … AND (expires_at IS NULL OR expires_at > NOW())`，随后 `const base = cur.rows[0]?.expires_at ? new Date(cur.rows[0].expires_at) : new Date();`）；`server/auth/entitlements.js:23-34`（`grantVip` `ON CONFLICT (user_id, entitlement_key) DO UPDATE SET expires_at = EXCLUDED.expires_at`，无「只在更长时覆盖」的条件）；`server/auth/admin-routes.js:86-95`（`expiresAt` 缺省即 `null` = 永久）。
- 结论与理由：永久会员 `expires_at IS NULL` 会**命中 SELECT 行但为 falsy** ⇒ `base = now` ⇒ 下发 30 天并被无条件覆盖。证据与行号准确。**同意 HIGH**。

### [CONFIRMED] PAY-02 加钱路径不幂等（台账 `ON CONFLICT DO NOTHING`）

- 我实际做的取证：`server/credits.js:91-104`（`topupCredits`：先 `UPDATE … balance = balance + $2`，再 `INSERT INTO credit_ledger … ON CONFLICT (idempotency_key) DO NOTHING`）、`:108-122`（`refundCredits` 同形）；对照 `:66-86`（`deductCredits` 的台账 INSERT **故意不带** `ON CONFLICT`，靠唯一冲突 `23505` 回滚，因此扣钱幂等）。
- 可达性独立裁决（队长指定必答）：
  - `grep -rn "topupCredits(" server/` → **唯一调用点** `server/payments/index.js:98`，位于 `confirmOrder` 内；`confirmOrder` 的唯一调用点是 `server/routes/payments.js:85`（管理员到账确认）。
  - 该调用被 `server/payments/index.js:86-93` 的**原子状态占位**兜住：`UPDATE payment_orders SET status='paid', … WHERE order_no=$1 AND status='pending' RETURNING *`，拿不到行即 `NOT_CONFIRMABLE`。
  - 全仓 `payment_orders` 的写入点仅三处：`:48` INSERT（pending）、`:72`（pending→cancelled，限本人）、`:87`（pending→paid）；`'refunded'`/`'expired'` 只出现在 `008_payments.sql:14` 注释与 `routes/payments.js:76` 的查询白名单，**无任何代码路径能把订单写回 `pending`**。
  - `refundCredits` 的唯一生产调用点是 `server/model-gateway/gateway.js:162`（同步链路上游失败退款，走的是扣费回滚语义）。
- 结论与理由：**代码缺陷 CONFIRMED**（「先改余额后插台账 + 冲突静默丢弃」确与「台账是唯一事实源」的声明矛盾）；但**「当前不可达」这一判断独立核验后成立** —— 不存在能给出重复 `refundId/topupId` 的路径。
- 严重度调整及原因：**HIGH → MEDIUM（下调为潜伏缺陷）**，并明确升级条件：**一旦接入真实支付回调**（`server/payments/index.js:13,25-27` 目前为 `CHANNEL_NOT_CONFIGURED` 占位）、或运维补账脚本 / 未来退款冲正复用 `refundCredits`，它会**立即变成静默重复加钱的高危缺陷**。因此我**不建议**在当前工作树上把它升级为 BLOCKER（那会把「未实现的通道」当既有漏洞），但**必须写进上线检查单的可达性前提**。

### [CONFIRMED] PAY-03 / PAY-04 / PAY-05 / PAY-06（MEDIUM 全覆盖）

- PAY-03 取证：`server/routes/payments.js:70-71`（`adminPaymentsRouter.use(wrap(requireUser), wrap(requireAdmin), adminLimiter)`，**无** `...sensitive`）；`:81-91` 无 `recordAudit`/`auditAdmin`。对照 `server/auth/admin-routes.js:37` `const sensitive = [requireRecentReauth]` 与 `:43,82,103,121` 的 `...sensitive` + `auditAdmin`（`:27-36`）。结论：确为全仓唯一未挂最近重认证与审计的敏感管理动作。**同意 MEDIUM**。
- PAY-04 取证：通读 `server/routes/payments.js` 全文（3 个 POST：`:31-40`、`:59-67`、`:81-91`），无 `csrfProtection`，与 SEC-05 的独立穷举一致。**同意 MEDIUM**。
- PAY-05 取证：`grep -rn "refunded\|expired" server/` 仅命中 DDL 注释与查询白名单；`payment_orders` 无状态回写路径（同 PAY-02 的三处写入点）。结论：无退款/无冲正/无超时关单成立。**同意 MEDIUM**。
- PAY-06 取证：`server/payments/index.js:140-163`（对账口径 `SUM(amount_cents) … WHERE status='paid' AND paid_at >= …`，`paid_at` 是管理员确认时刻 `:87`；`provider_ref` 由管理员自由输入、可空、无校验）。结论成立。**同意 MEDIUM**。
- 附带核对（LOW 抽样，未逐条深挖）：PAY-07 `server/model-gateway/…` 之外的 `server/payments/skus.js:10` `SKUS[code] || null` —— 原型链键（`'constructor'` 等）返回 truthy 但字段为 `undefined`，随后 INSERT 撞 `NOT NULL`，确为「500 而非串单」，无资金影响。**同意 LOW**。

---

## 三、网关域（03-gateway.md）

### [REFUTED（前提不成立）] GW-01 NODE_ENV≠production 时退化加密密钥 + 放行 localhost

- 我实际做的取证：
  - `server/model-gateway/crypto.js:9-18`：`isProd()` 判 `NODE_ENV === 'production'`；`deploymentKey()` 在 `!raw && isProd()` 时抛 `MODEL_ENC_KEY is required in production (32-byte hex)`，否则 `sha256(raw || 'dev-only-model-enc-key')`。（机制描述属实）
  - `server/model-gateway/upstream.js:75-80`：`const devLocal = isLocalHttp && net.isIP(host) && process.env.NODE_ENV !== 'production'`（要求 `http://` + **字面 IP** `127.0.0.1` + 非 production）。（机制描述属实）
  - **受支持的生产启动路径**：`docker-compose.yaml:45` api 段硬编码 `- NODE_ENV=production`（`:126` frontend 同）且 `MODEL_ENC_KEY=${MODEL_ENC_KEY:?…}`；`scripts/deploy.sh:41` `grep -q '^NODE_ENV=production' .env || die`；`.env.production.example:20` `NODE_ENV=production`。手册（`docs/部署手册.md:38,110,275`）给出的全部启动/更新命令都是 compose。
  - 交叉印证：部署域 05-deploy.md 的 **DEP-06 分叉结论 A** 用穷举 grep 得出同一答案 —— **不存在手册支持的、可绕过 `NODE_ENV=production` 的生产启动路径**（无 systemd unit / 无 pm2 / 无 `node index.js` 说明）。
  - 残留的非 compose 路径：`start-all.sh:31`（`npm run dev`）与 `server/package.json:7`（`"start": "node index.js"`，不设 NODE_ENV）。
- 结论与理由：**「生产可能未设 NODE_ENV」这一前提被证伪**（两条独立证据链）。报告自述「必须确认生产启动方式」——答案是：**compose 唯一，且 `environment:` 显式赋值优先于任何 `.env` 透传**。原始机制（dev 回退 + localhost 逃逸阀）在代码层确凿存在，但触发它需要运维**脱离手册**自建启动方式。
- 严重度调整及原因：**BLOCKER（条件性）→ MEDIUM（条件性保留）**。⚠️ 但必须同时指出一个**跨域反直觉结论**：GW-01 想防的后果（生产密钥退化为「公开常量的 sha256」）在生产上**已经真实发生**，只是机制换了 —— 见部署域 **DEP-01**（`.env` 中 `MODEL_ENC_KEY` 是 `$(openssl rand -hex 32)` 字面量，compose 不做命令替换、原样进容器；`deploy.sh` 的 `source .env` 却执行替换，所以预检必然通过）。因此：**GW-01 不要按「已解除」关闭**，而应把「密钥材料质量控制」与 DEP-01 合并处置（修法：`crypto.js` 的 dev 回退改为必须显式 `ALLOW_DEV_CRYPTO_KEY=true`；启动时断言；预检加 `^[0-9a-f]{64}$`）。避免与 DEP-01 重复计 BLOCKER。

### [REFUTED（部分证据）] GW-02 RLS 被超级用户绕过 → 跨租户读 provider/model 元数据

- 我实际做的取证：`server/migrations/003_model_gateway.sql:178-183`（六表 `ENABLE ROW LEVEL SECURITY`）；**`server/migrations/003a_models_rls.sql` 全文**（`models_visible` FOR SELECT、`models_write` FOR INSERT、`credential_versions_visible` FOR SELECT）；`pg_policies`（本地库）实测 6 条策略；`grep -rn "FORCE ROW LEVEL\|CREATE ROLE\|GRANT " server/migrations/` → 无命中；`docker-compose.yaml:46-50`；`server/routes/model-gateway.js:104-118`、`:322-338`、`:390-410`（loadModel）。
- 结论与理由：
  - **被推翻的子断言**：报告称「`models` 与 `model_credential_versions` 没有任何策略」→ **错**。策略存在于 `003a_models_rls.sql`（该文件未被报告引用）；`models` 有 SELECT/INSERT 策略、`model_credential_versions` 有 SELECT 策略。这条错误会影响「修复方案可行性」的判断（见 V-A-01）。
  - **根因结论不变**：应用以 **Postgres 超级用户**连接（`DB_USER=postgres`，且未提供 `DATABASE_URL` 以切换角色）⇒ 超级用户**无条件**绕过 RLS（我的 `FORCE ROW LEVEL SECURITY` 补充实验进一步证明连 FORCE 也无效）⇒ **RLS 设计在本部署下完全失效**，两个列表接口因此缺少对象级过滤。凭据密文不泄露（`loadModel` 内部读、跨租户调用被 `policy.js` 的 `assertModelAccess` 以 404 拦）的判断也与代码一致。
- 严重度调整及原因：**同意 HIGH**（跨租户元数据泄露 + 隔离机制形同虚设，但不泄密钥）。**但必须与 SEC-07 合并为一条根因、只计一次**（见「跨域裁决」）。

### [CONFIRMED] GW-03 异步 i2i 按 video 计价（15× 超扣）

- 我实际做的取证：`server/model-gateway/gateway.js:177`（`createAsyncJob` 内 `const operation = 'video';` 硬编码，函数签名无 operation 参数）、`:201`（`const cost = await creditCost(client, 'video');`）；`server/credits.js:10`（`DEFAULT_PRICES = { chat: 1, image: 2, video: 30 }`）；`server/routes/model-gateway.js:582-611`（operation `image` 且命中 `resolveImageAsyncPreset` 时走 `createAsyncJob`）；`server/model-gateway/presets.js:352-357`（`IMAGE_ASYNC_PRESETS = { 'dashscope-image-async': … }`）。
- 结论与理由：证据与行号准确 ⇒ 异步 i2i **多扣 15 倍**，且配额按 `operation` 计数（`credits.js:150-166`）导致图片任务吃掉 video 日配额、image 配额漏计。**同意 HIGH**。

### [CONFIRMED] GW-04 异步失败/取消/过期/下载失败全不退款

- 我实际做的取证：`server/model-gateway/gateway.js`（`pollJob` 的四条终结路径：取消 `:272-274`、过期 `:276-283`、上游失败 `:316-327`、结果下载失败 `:350-360` —— 均**无** `refundCredits`）；提交失败 `:230-243`（bare catch → `submission_uncertain`，注释自述这是设计）；对照同步链路 `:155-165`（非 PolicyError 时扣费回滚 + `refundCredits` + 写 `failed`）；`server/routes/model-gateway.js:496-499`（caller 对**任何**非 2xx 抛 `upstream ${status}: ${text}`）。
- 结论与理由：退款缺失成立。**同时对报告做一处必要校正（反向纠偏）**：`submission_uncertain` 不退款本身是**设计选择**（注释明示「上游是否已受理未知」），真正的缺陷是**确定性 4xx 也被归入 unknown**，从而「既不终结、也不退款」。这不是把设计当漏洞，而是把设计边界写清楚。**同意 HIGH**。

### [REFUTED（路径错误）] GW-05 遗留迁移把厂商 Key 明文写进 `user_settings`

- 我实际做的取证：报告引用的 `server/auth/legacy-config.js:48-50` **不存在**（`sed: No such file or directory`）；实际文件为 `server/migration/legacy-config.js`（`:42-53`，`await setUserSetting(adminId, 'antsk_api_key', apiKey)`）与 `server/repositories/settings.js:21-28`（`INSERT INTO user_settings (user_id, key, value) … JSON.stringify(value)`，无加密）；`server/migrations/002a_settings.sql:10-16`（`value JSONB`，`pg_class` 实测 `relrowsecurity=f`）；`server/test/migration.test.js:93-94`（断言 `storedKey === 'sk-secret-key-123456'`，即明文）。
- 结论与理由：**路径错、实质成立**（迁移期明文落库；且 `user_settings` 无 RLS，任何能读该表的路径都能拿到明文）。**同意 HIGH**；建议报告更正文件路径，避免下游按错误路径去验证。

### [CONFIRMED] GW-06 `MODEL_ENC_KEY` 无 keyring

- 我实际做的取证：`server/model-gateway/crypto.js:7`（`DEFAULT_KEY_ID = process.env.MODEL_ENC_KEY_ID || 'v1'`，模块加载即求值）、`:36-46`（`openSecret` 只用当前 `MODEL_ENC_KEY`，仅校验 `sealed.keyId !== keyId` 后抛 `unknown key id`）；`server/model-gateway/gateway.js:76-79`（封存/解封两侧都传 `keyId: inv.request_payload_key_id`）⇒ **同一值自比，校验恒真、不参与选密钥**；全仓无轮换/重加密工具。
- 结论与理由：无 keyring 成立。**严重度：HIGH → MEDIUM（下调）**。理由：它的直接后果是**运维连续性**（轮换密钥 ⇒ 旧凭据全部不可解密，须重新录入），不是暴露面；且 `keyId` 空转校验意味着改 `MODEL_ENC_KEY_ID` 也无法灰度轮换。建议保留在「上线前完成」清单，但不作为阻断项。

### [CONFIRMED] GW-07 / GW-09 / GW-10 / GW-11（MEDIUM 抽样）

- GW-07 取证：`server/model-gateway/gateway.js:32-56`（`INSERT … ON CONFLICT (user_id, operation, idempotency_key) DO NOTHING RETURNING id`）与 `:104-172`（既有行早退分支**只**在事务前 `findInvocation` 命中时触发；事务内冲突返回 `other.id` 后**代码继续**执行 `fetchUpstream`）。结论：并发同 key 确实会二次调用上游。**同意 MEDIUM**。
- GW-09 取证：`server/credits.js:150-166`（`assertDailyQuota` 用裸 `pool.query` 计数，位于调用方事务之外）+ `server/routes/model-gateway.js:521-524`。**同意 MEDIUM**。
- GW-10 取证：`server/index.js:56` `app.use('/api/model-invocations/media-assets', express.json({ limit: '150mb' }))`、`:57` 1mb；`grep -n "limiter" server/index.js` → 无命中（`/api/model-invocations` 无任何限流器）。**同意 MEDIUM**。
- GW-11 取证：`server/routes/model-gateway.js:780-783` 注释自述 `Poll-on-read: there is no external worker yet, so each read advances one poll cycle when the job is due`；`POLLABLE_JOB_STATUSES = new Set(['queued','polling'])` 与退避逻辑一致。结论：机制成立（是否「永不交付」取决于是否有人读，属设计权衡）。**同意 MEDIUM**。

### [REFUTED（部分证据）] GW-12 上游/内部错误原文透传

- 我实际做的取证：`server/routes/model-gateway.js:690-694`（同步 invoke 的 catch：`PolicyError` 原样返回；**其余一律 `console.error` + 返回 `{code:'UPSTREAM_ERROR', message:'upstream call failed'}`** ⇒ 报告引用的 `:797` 处**不是**原文透传）；`:222-229`（discover-models 的 catch：`throw new PolicyError('UPSTREAM_ERROR', e?.message || …)`，而 `server/model-gateway/discovery.js:42-48` 的 `e.message` 含 `上游返回 ${status}: ${text}`（前 200 字节）⇒ **这一处确实回传上游原文**）。
- 结论与理由：**两处引用中一处不成立**，风险面只剩 discover 一处（调用者是有权配置该 provider 的用户/管理员，看到的是自己上游的报错）。**严重度：MEDIUM → LOW（下调）**。

### [CONFIRMED（设计权衡）] GW-13 无主机允许列表

- 我实际做的取证：`server/routes/model-gateway.js:37-49`（`validateBaseUrl` **只校验 scheme**：`https:` 或 `http://localhost|127.0.0.1`，无主机允许列表）；`server/model-gateway/upstream.js:70-94`（`resolveAndBind`：拒绝非 https/非 local，`METADATA_HOSTS` 拦截，DNS 解析后逐 IP `isPrivateAddress` 拦截，并返回固定 IP 连接以抗 rebinding）。
- 结论与理由：**「无允许列表」属实，且私网拦截确实合格**（这一点报告也列为正面结论）。但该网关的产品定位就是「用户自带任意厂商 base_url」，公网主机允许列表与其本职冲突；残差仅为「把服务器当外呼客户端」的滥用面。**严重度：MEDIUM → LOW（下调，设计权衡）**，建议以「出网限速 + 目标域名审计日志」而非允许列表来收口。

---

## 四、跨域裁决（队长指定必答）

### 裁决 1：SEC-07 与 GW-02 是同一根因 —— **是，必须合并计数**

- 根因（唯一）：**api 以 Postgres 超级用户连接**（`docker-compose.yaml:46-50` 的 `DB_USER=postgres`；未提供 `DATABASE_URL`，无法只靠连接串切到受限角色）⇒ 超级用户**无条件**绕过 RLS ⇒ `server/migrations/003_model_gateway.sql:178-217` 与 `003a_models_rls.sql` 建下的策略全部不参与过滤；于是「SQL 里本来就没写租户条件」的两处查询变成跨租户读取。
- 暴露点（两处，同一根因）：`server/routes/model-gateway.js:104-118`（GET /providers）、`:322-338`（GET /models）。
- 重复计数情况：**存在**。两份报告各自以「RLS 绕过」为因、各自记一条 HIGH ⇒ 全局清单里应**合并为 1 条 HIGH**（否则同一事实被计两次）。
- 归属建议：**归 01-security.md**（安全域，条目名为「RLS 在本部署下失效（超级用户连接）+ 两个列表接口缺对象级过滤」），在 03-gateway.md 的 GW-02 处标注「同源，见 SEC-07，不重复计数」。
- 合并后的修复要点（含新发现 V-A-01）：不能只「补 SQL WHERE」或只「加 FORCE RLS」（对超级用户无效，已实测）；必须**换非超级用户角色**，并**补齐策略**，否则会立刻破坏凭据写入。

### 裁决 2：SEC-01 与部署域 `CAPTCHA_ENABLED` —— **不是同一问题，不得合并**

- SEC-01 = 验证码**答案泄露**（`captcha.js:40`，已实机复现）；`CAPTCHA_ENABLED` 默认 `false`（`docker-compose.yaml:64-65`，部署域 DEP-02）= **开关默认关**。
- 二者是**叠加**关系：开关为 `false` 时该门根本不存在；开关为 `true` 时该门也被 SEC-01 击穿。两条都应保留独立编号，且修复要**同时**做（默认值 + 不再把答案写成文本节点）。

### 裁决 3：GW-01 的「必须确认生产启动方式」—— **答案是 compose 唯一**

- 见 GW-01 条目：`docker-compose.yaml:45/:126` 硬编码 `NODE_ENV=production`，手册穷举无第二生产路径（部署域 DEP-06 独立同结论）⇒ GW-01 的触发前提在**受支持路径**上不成立 ⇒ 降级。
- 但**同一后果在生产上仍然发生**：`DEP-01`（`.env` 密钥字面量）使容器内 `MODEL_ENC_KEY = "$(openssl rand -hex 32)"`（公开字符串）⇒ AES 密钥 = 该公开字符串的 sha256。因此「密钥材料公开且跨部署恒定」这条**仍应从阻断项清单里保留**（归 DEP-01），GW-01 只保留代码层的「dev 回退 fail-open」作为 MEDIUM。

### 裁决 4：PAY-02 是否应升级 BLOCKER —— **否（当前工作树不升级）**

- 见我给出的可达性证据链：`topupCredits` 唯一调用点受 `WHERE status='pending' RETURNING *` 原子占位保护；全仓无法把订单写回 `pending`；真实支付通道仍为 `CHANNEL_NOT_CONFIGURED` 占位；`refundCredits` 唯一调用点是同步链路退款。
- 结论：**保持「潜伏 + 触发条件明确」**，写进上线检查单：「启用任何真实回调/补账/退款冲正之前必须先修 `credits.js:91-122`（或改为与 `deductCredits` 同构的写台账语义）」。

### 裁决 5：不要误报的 11 项正面结论 —— 我抽查了 3 项，均成立

- 「无 SQL 注入」：`grep -rn 'query(`' server/ --include=*.js | grep '\${'` → **全仓仅 2 处**，即 `server/db.js:109-110` 的 `SET LOCAL app.user_id/app.is_admin`，且 `withUserContext` 前置 UUID 正则校验、`isAdmin` 为布尔 ⇒ 成立（我复核时未发现漏网的模板拼接）。
- 「nginx 覆盖 XFF 使伪造无效」：`nginx.conf:18` 用 `$remote_addr`（非 `$proxy_add_x_forwarded_for`）⇒ 客户端伪造的 XFF 被丢弃 ⇒ 成立；与 SEC-04（宿主反代拓扑）不矛盾。
- 「验证码单次有效但答案泄露」：`verifyCaptcha` 消费即删 + SEC-01 答案可读，两条同时为真 ⇒ 成立。
- 其余 8 项（无 IDOR、SSRF 硬化、会话服务端有状态、CORS 精确匹配、令牌 256 bit 原子一次性、前端 token 不落 localStorage、`hashAction` 无开放重定向、两套 nginx 安全头）我未逐条重新取证，**不作为漏洞计入**（见局限）。

---

## 五、新增发现（三份报告均未覆盖）

### [NEW] V-A-01 RLS 策略集合不完整 ⇒ 「换受限角色」这一修复方案会立刻打断凭据写入与模型变更

- 我实际做的取证：本地库 `pg_policies` 实测策略集合为
  - `model_providers`：`providers_visible`(SELECT)、`providers_owner_write`(INSERT)、`providers_owner_update`(UPDATE)
  - `models`：`models_visible`(SELECT)、`models_write`(INSERT) —— **无 UPDATE / DELETE 策略**
  - `model_credential_versions`：`credential_versions_visible`(SELECT) —— **无 INSERT / UPDATE / DELETE 策略**
  - 另有 `media_assets`/`model_invocations`/`model_jobs` 的 FOR ALL 策略（`003_model_gateway.sql:185-217`）。
  源码侧交叉确认：`grep -rn "FORCE ROW LEVEL\|CREATE ROLE\|GRANT " server/migrations/` 无命中，全仓没有为受限角色兜底的授权与策略。
- 影响：SEC-07/GW-02 的建议修法是「改用非超级用户的应用角色」。若照做而**不同时补策略**，则：新凭据版本无法 `INSERT`（`model_credential_versions`）、模型无法改/删（`models`）⇒ **网关凭据配置与模型管理会直接 500**。这是「修复方案的门槛条件」，必须与合并后的 SEC-07/GW-02 同批交付（补 `models` 的 UPDATE/DELETE、`model_credential_versions` 的 INSERT/UPDATE/DELETE 策略，并 `GRANT` 该角色）。
- 建议严重度：**MEDIUM**（不是现存漏洞，但会让隔离修复在上线时直接失败或被迫放弃）；验证方式：以受限角色连接后跑一遍 provider/model CRUD 与凭据轮换。

### [NEW] V-A-02 六条匿名变更路由的 CSRF 防线只有 `anonymousMutationGuard`，而它对「无 Origin 且无 `Sec-Fetch-Site`」的请求直接放行

- 我实际做的取证：`server/auth/middleware.js:141-154`
  ```js
  export const anonymousMutationGuard = (req, res, next) => {
    if (!isUnsafe(req)) return next();
    if (req.user) return next(); // session-authenticated mutations are CSRF-protected
    const origin = req.get('origin');
    const allowed = getAllowedOrigins();
    const originOk = Boolean(origin) && allowed.includes(origin);
    const secFetchSite = req.get('sec-fetch-site');
    const sameOrigin = !origin && secFetchSite === 'same-origin';
    const nonBrowser = !origin && !secFetchSite; // curl / non-browser clients
    if (!originOk && !sameOrigin && !nonBrowser) return res.status(403)...
  ```
  这六条路由（`auth/routes.js:90 register`、`:176 verify-email`、`:211 login`、`:351 request-password-reset`、`:385 reset-password`、`:432 bootstrap-complete`）**都不在** SEC-05 的 11 条清单内，且都不挂 `csrfProtection`（匿名时 `csrfProtection` 本身 `return next()`，`middleware.js:174-176`）⇒ 它们的**唯一**防线就是这个 guard。
- 影响：「同时缺 Origin 与 `Sec-Fetch-Site`」的请求被判为「非浏览器客户端」而放行 —— 现代浏览器跨站 POST 会带 `Origin`，所以这是**低概率**路径；但它意味着**「登录 CSRF」在老旧/受限客户端上仍可能**（把受害者登入攻击者账号，随后受害者上传的内容落进攻击者账户）。SEC-05 只覆盖了会话态路由，报告未说明匿名路由的替代防线及其盲点。
- 建议严重度：**LOW**；修复方向：匿名变更路由同样要求 `Origin`/`Sec-Fetch-Site` 证据，或对 login 类路由额外校验 `Referer`/要求同站令牌；至少把该盲点写进 SEC-05 的范围说明。

### [NEW] V-A-03 同一 router 内 `loadModel` 有一处未跟随 `assertModelAccess`

- 我实际做的取证：`grep -n "loadModel(" server/routes/model-gateway.js` → `:521`（其后 `:522` 立即 `assertModelAccess`）与 `:789`（**其后无** `assertModelAccess`，`grep -n "assertModelAccess(" server/routes/model-gateway.js` 全文件仅 `:522` 一处）；`:786-799` 该分支是 job 轮询重建 deps 的路径，通过 `req.app.locals.modelGatewayDeps.fetchUpstream` 用**该模型的凭据**去查上游任务状态。
- 影响：`loadModel` 会把 `model_credential_versions` 的密文一并取出（`SELECT … cv.ciphertext/iv/tag`）。本路径的补偿控制是：job 行本身按 `user_id` 过滤取得（他人 job 取不到），故**当前不构成跨租户读取**。残差是「同一路由内授权断言不对称」——一旦将来有路径能拿到他人 `job` 行（或 job 在模型转私有/删除后仍可被读取），该处会用他人模型凭据发起外呼。
- 建议严重度：**LOW**（防御纵深不一致）；修复：`:789` 后补 `await assertModelAccess({ model, provider: model?.provider, userId, isAdmin })`，与 `:521-522` 对齐。

### 不新增编号的跨域重复项

- **DEP-01（部署域 BLOCKER）**：`.env` 四个密钥/盐是 `$(openssl rand …)` 字面量，compose 原样注入容器。我在做 GW-01/GW-06 复核时独立走到同一结论（GW-01 的「密钥退化为公开常量的 sha256」这一后果即由 DEP-01 实现）。**已由部署域先行立案，本报告不重复计数**，仅在 GW-01 条目做机制归因。
- **DEP-03/DEP-05/DEP-06（部署域）** 与 SEC-09/GW-01 的事实重叠同上，建议汇总时按「取更高严重度 + 单一编号」处理。

---

## 六、本次复核的局限

1. **约束偏离（已披露，仅此一次）**：在收到队长 m00065 的「不得连库」补充**之前**，我对**本机** Postgres 执行了只读 catalog 查询（`pg_roles`/`pg_class`/`pg_policies`/`SELECT count(*)`）与一个整段 `BEGIN…ROLLBACK` 的 TEMP 表演示。演示后以 `pg_class` 确认无残留表；未写任何业务数据、未执行迁移。收到纪律后未再连库。**SEC-07/GW-02 的「超级用户绕过」与「FORCE 也无效」两个结论依赖该次取证**；若审查方要求「零连库」，这两条应由纯静态证据（`DB_USER=postgres` + Postgres 语义 + `grep` 无 `CREATE ROLE`）支撑 —— 结论不变，但证据等级降为「静态推证」。
2. **未构造运行时复现**：未起服务、未发任何 HTTP/上游请求、未执行 `deploy.sh`、未 `docker compose up`。因此以下均为静态判定：SEC-04 的「单桶」现象、SEC-06 的日志落地、PAY-02 的漂移（报告作者的本地复现我未重跑）、GW-04 的永久 `submitting`、GW-08 的 500 与资金损失、GW-10 的内存峰值（150MB/200MB 未实测）。
3. **本地库无数据**：`model_providers` 本地 0 行 ⇒ 无法用真实表演示跨租户读取（U-1）。
4. **未复核项**：三份报告的 LOW 未逐条取证（SEC-12/13/14/15/16、PAY-08/09/10/11、GW-14/15/16/17）；SEC-15 我在读 `auth/routes.js` 时顺带确认 `/verify-email`、`/reset-password`、`/bootstrap-complete` 确实无 limiter（与报告一致），但未展开。01-security.md 的 11 项正面结论中我只抽查了 3 项（见裁决 5）。
5. **未接入的生产事实**：支付通道全为占位；生产 `.env` 实际值未读（仅读形态）；生产库是否已执行遗留导入（U-3）、是否已发生 PAY-02 类漂移（U-2）均无访问条件。
6. **跨域依赖**：本报告多处引用部署域 05-deploy.md 的 DEP-01/02/03/06/F1/F2 作为交叉印证。这些结论属于 t5 的取证，我仅核对了其中**能静态复核的部分**（compose 端口、`nginx.conf`、`deploy.sh` 预检、手册命令），未重跑 t5 的 `docker compose config` 实测。
7. **判定的可反驳性**：本文所有「REFUTED」均为**部分/前提级**（GW-01 前提、GW-02 子断言、GW-05 文件路径、GW-12 行号），不是「整个发现不存在」。若下游发现我引用的行号有偏差，以原报告的文件+行号复核为准，并请回执到 t7。
