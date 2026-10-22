# 01 安全审查报告（认证 / 会话 / 授权 / 注入 / 限流 / 人机验证）

- **审查目标**：漫剧工场（manga-studio）当前工作树，分支 `feat/public-model-platform`，HEAD `8fd19fd`（含最近落地的「自托管 SVG 验证码 + 登录/注册门」与 `1e55cf6` CAPTCHA_ENABLED 透传）。
- **视角**：即将上线的生产部署（docker-compose 单机 nginx 反代 + api + postgres）。
- **审查者**：sec-auditor（团队 printfilm-launch-review，任务 t1 / attempt 2）。
- **只读声明**：本次审查仅创建本文件 `docs/launch-review/01-security.md`，未修改任何源码、配置、迁移、密钥，未执行任何 git 写操作，未启动任何服务。
- **复现环境**：工作区根目录 `node --input-type=module` 直接调用模块（无需起服务）；或用 curl 打已部署实例并注明。`git status --porcelain` 当时仅 `?? .agent-teams/`，`docs/launch-review/`。

> 严重度定义：BLOCKER = 资金/数据损失、未授权访问、上线即不可用；HIGH = 上线前必修；MEDIUM = 可上线但需排期；LOW = 改进项。

## 汇总表

| ID | 严重度 | 标题 | 证据位置 | 已复现 |
|----|--------|------|----------|--------|
| SEC-01 | HIGH | 验证码答案以明文写在返回的 SVG 里，人机验证可被 3 行脚本完全绕过 | `server/auth/captcha.js:40`（渲染）、`server/auth/routes.js:61-67`（签发） | 是（node 直调，`verifyCaptcha` 返回 `ok`） |
| SEC-02 | MEDIUM | `GET /api/auth/captcha` 无限流且无会话绑定；内存存储无上界 | `server/auth/routes.js:61-67`、`server/auth/captcha.js:10-21,57-65` | 代码级已验（未压测） |
| SEC-03 | MEDIUM | 限流是单进程内存 Map：重启清零、多副本不共享；nginx 无第三层限速 | `server/auth/middleware.js:85-123`、`nginx.conf`（无 `limit_req`） | 代码级已验 |
| SEC-04 | MEDIUM | 宿主层反代拓扑下，容器 nginx 覆盖 `X-Forwarded-For`，全站退化为单一限流桶 | `nginx.conf:18`、`server/auth/middleware.js:100-102`、`server/index.js:48`、`docker-compose.tls.yaml` 头注 | 代码级已验（拓扑相关） |
| SEC-05 | MEDIUM | 11 个状态变更路由缺 `csrfProtection`（admin 5 + 支付 3 + 积分 2 + 迁移 1，明细见节） | `server/auth/admin-routes.js:43,82,103,121,315`；`server/routes/payments.js:31,59,81`；`server/routes/credits.js:14,26`；`server/routes/migration.js:23` | 代码级已验 |
| SEC-06 | HIGH | 生产未配 `SMTP_HOST` 时，邮箱验证/重置/管理员激活令牌明文写入容器日志 | `server/auth/outbox.js:124-131`（打印）+ `:160-178`（解密并渲染）+ `:76-101`（拼 token）、`scripts/deploy.sh:27-48`（不校验 SMTP_HOST） | 代码级已验（调用链全读） |
| SEC-07 | HIGH | RLS 策略在本部署（应用以 Postgres 超级用户连接）下被 BYPASSRLS 绕过，而两个列表接口未做显式 owner 过滤 | `server/db.js:100-113`、`server/migrations/003a_models_rls.sql:4-43`、`server/routes/model-gateway.js:104-118,322-338`、`docker-compose.yaml`（api `DB_USER`） | 否（静态推证，无法起服务验证） |
| SEC-08 | MEDIUM | `ARGON2_*` 是死配置：生产文档声称的 `parallelism=1` 从未生效，实际库默认 p=4 | `server/auth/password.js:24-30`、`.env.production.example:54-56`、`server/node_modules/argon2/argon2.cjs:32-34,50-52` | 是（读库默认值） |
| SEC-09 | MEDIUM | 默认部署路径（仅 80 端口，无 TLS/HSTS）配合 `COOKIE_SECURE=false` 过渡开关，会话 Cookie 明文过网 | `nginx.conf:2`、`deploy/nginx-tls.conf:14,55,69`、`.env.production.example:25-27`、`docker-compose.yaml:62-63`、`server/auth/session.js:13-22` | 代码级已验 |
| SEC-10 | LOW | CSRF token 比较用 `!==`（非恒定时间） | `server/auth/middleware.js:187` | 代码级已验 |
| SEC-11 | LOW | 错误响应把 `e.message` 回传客户端（DB/内部错误可能外泄） | `server/index.js`（14 处 `res.status(500).json({ error: e.message })`：`:83,95,106,128,140,152,164,176,194,205,216,228,244,261`） | 代码级已验 |
| SEC-12 | LOW | 支付订单号仅 32 bit 随机（`MS`+日期+8 hex；有 UNIQUE 约束兜底，实际风险是 500 而非串单） | `server/payments/index.js:34-38`、`server/migrations/008_payments.sql:5` | 代码级已验 |
| SEC-13 | LOW | SSRF 私网黑名单未覆盖 100.64/10、192.0.0/24、198.18/15 | `server/model-gateway/upstream.js:49-67` | 代码级已验 |
| SEC-14 | LOW | 服务端 SVG 经 `dangerouslySetInnerHTML` 注入；bootstrap/reset 模式的 token 不从地址栏清除 | `components/AuthPage.tsx:46-73,214` | 代码级已验 |
| SEC-15 | LOW | `/verify-email`、`/reset-password`、`/bootstrap-complete` 无限流（靠 256 bit 一次性令牌兜底） | `server/auth/routes.js:176-207,385-408,432-465` | 代码级已验 |
| SEC-16 | LOW | 登录/注册不吊销同一账号的既有会话（改密/禁用才全量吊销） | `server/auth/routes.js:211-263`（登录成功仅 `createSession`） | 代码级已验 |

**计数：BLOCKER 0 · HIGH 3（SEC-01/06/07）· MEDIUM 6（SEC-02/03/04/05/08/09）· LOW 7（SEC-10～16）· 合计 16。**

---

### [HIGH] SEC-01 验证码答案以明文写在返回的 SVG 里，人机验证可被脚本完全绕过

- **证据**：`server/auth/captcha.js:28-54` 的 `renderSvg(code)` 把每个字符按顺序逐个渲染：
  ```js
  // server/auth/captcha.js:33-42（原文，仅省略中间几行）
  const glyphs = code                                                  // 33
    .split('')                                                        // 34
    .map((ch, i) => {                                                 // 35
      const x = step * (i + 0.6) + randomBetween(-2, 2);              // 36
      ...
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${rotate} ${x.toFixed(1)} ${y.toFixed(1)})" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" font-weight="700" fill="${pick(palette)}" text-anchor="middle">${ch}</text>`;  // 40：明文写入
    })                                                                // 41
    .join('');                                                        // 42
  ```
  `server/auth/routes.js:61-67` 把这个 SVG 原样返回给任何匿名调用者：
  ```js
  authRouter.get('/captcha', (req, res) => {
    if (!captchaEnabled()) return res.json({ enabled: false });
    const { captchaId, svg } = issueCaptcha();
    return res.json({ enabled: true, captchaId, svg });   // 第 66 行
  });
  ```
  **已复现**（工作区根，无需起服务）：
  ```bash
  node --input-type=module -e "const m=await import('./server/auth/captcha.js'); const {captchaId,svg}=m.issueCaptcha(); const chars=[...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(x=>x[1]); console.log('extracted=',chars.join('')); console.log('verify=',m.verifyCaptcha(captchaId, chars.join('').toLowerCase()));"
  # 输出：extracted= qsgc   （每次随机，4 位顺序即答案）
  #      verify= ok
  ```
  在 HTTPS 部署下等价的一行 curl + 提权脚本：`GET /api/auth/captcha` → `svg` 字段 → `matchAll(/<text[^>]*>([^<]*)<\/text>/)` → 提交 `captchaId`+该字符串即通过。
- **影响**：`CAPTCHA_ENABLED=true`（生产必开，见 `scripts/deploy.sh` 不校验但 `1e55cf6` 专门透传）时，登录/注册的人机验证**不提供任何机器人阻力**：攻击者用一个 HTTP 客户端即可自动完成「取题→读答案→作答→重取」。它唯一的真实价值（对抗分布式撞库：`loginLimiter` 只按 IP 10 次/10 分钟，换 IP 即绕过；`loginEmailLimiter` 5 次/10 分钟按邮箱）被完全抵消，等价于仅剩「5 次/邮箱/10 分钟」的在线口令猜测配额，且注册同样无阻力（可批量灌账号、触发 SEC-06 的邮件/日志放大）。注意：`server/auth/captcha.js:1` 自述为「'防君子' tier」，若产品定位只是「劝退手点脚本」，可降为 MEDIUM；但只要它被 `enforceCaptcha`（`routes.js:46-58`）当作**强制关隘**（缺/错即 422），就应按安全控制对待 → 定 HIGH。
- **复现步骤**：
  1. `curl -s http://<host>/api/auth/captcha` → 记下 `captchaId` 与 `svg`；
  2. `svg` 中 `<text ...>X</text>` 依次拼接（上例 `qsgc`）；
  3. `curl -s -XPOST http://<host>/api/auth/login -H 'Content-Type: application/json' -d '{"email":"victim@x.com","password":"guess","captchaId":"<id>","captchaText":"qsgc"}'` → 返回 401 `invalid credentials`（**说明验证码已通过、进入口令校验**，而不是 422 CAPTCHA_INVALID）。
- **建议修复**：不要下发可反推答案的素材。任选其一：(a) 服务端把字符渲染成**路径 `<path>`**（把字形轮廓转成 path，或对每个字符做随机仿射后再输出 path 数据），SVG 里不出现任何字符文本；(b) 用 `crypto.randomInt` 生成答案并把答案改为**服务端签名 cookie 或 DB 记录**；(c) 保留 SVG 但把答案写进 `<image>`（PNG 光栅化）/ 用 `text` 的 `d` 干扰层掩盖顺序——仍需保证文本节点不含真字符。同时把 `pick()`（`captcha.js:23-25` 的 `Math.random`）换成 `crypto.randomInt`（`Math.random` 可预测，且此处正是安全语义）。回归测试必须**断言 `svg` 不含答案**（现有 `server/test/captcha.test.js:7,24,33` 用 `_peekAnswer` 拿答案，永远不会发现此问题——这正是漏检原因）。
- **验证方式**：`node --input-type=module -e "..."`（同上方复现命令）应输出 `extracted=` 与 `verify= invalid`；或对部署实例重复「取 SVG → 提交提取串」应得 422 `CAPTCHA_INVALID`。

---

### [MEDIUM] SEC-02 `GET /api/auth/captcha` 无限流、无会话绑定，内存挑战表无硬上界

- **证据**：
  - `server/auth/routes.js:61-67`：该路由**不带任何中间件**（无 `registerLimiter`/`loginLimiter`、无 `requireUser`、无 `anonymousMutationGuard`——它是 GET，本来也不在守卫范围）；每调用一次即 `issueCaptcha()`。
  - `server/auth/captcha.js:12` `const store = new Map()`；`:57-65` 每次签发 `store.set(captchaId, {answer, expiresAt: now + TTL_MS})`（TTL 10 分钟，`CODE_LENGTH=4`）。
  - `server/auth/captcha.js:16-21` 的 `prune` **只在 `store.size >= MAX_STORE(5000)` 时**才遍历，且**只删除 `expiresAt <= now` 的条目**：
    ```js
    const prune = (now) => {
      if (store.size < MAX_STORE) return;
      for (const [id, entry] of store) if (entry.expiresAt <= now) store.delete(id);
    };
    ```
    当攻击者在 10 分钟内持续请求，Map 中几乎全部条目都未过期 → `prune` 一个也删不掉 → **条目数没有上界**，唯一硬边界是 10 分钟窗口内的请求数。
- **影响**：未认证、零成本的接口（响应还是 ~1–2 KB 的 SVG，额外消耗出口带宽）。粗算：单机 1k req/s × 600 s = 60 万条 ≈ 60 MB 量级；若有多机 10k req/s，则 600 万条量级 → 容器内存耗尽（`node` OOM / 被 cgroup kill）。同时它天然是验证码刷取接口：配合 SEC-01，攻击者可在本地预取大量 `captchaId`+答案对缓存起来，之后几乎无限速地发起登录尝试（预取的挑战在 10 分钟 TTL 内可用，因为每个挑战只在**验证时**才被消费）。**未实机压测**，量级为按代码与内存估算。
- **复现步骤**：`for i in $(seq 1 2000); do curl -s -o /dev/null http://<host>/api/auth/captcha; done` 观察进程 RSS 单调增长（需部署实例，未在本机执行）；或本地 `node -e` 循环调用 `issueCaptcha()` 100 万次观察 `store.size`（无 prune 生效）。
- **建议修复**：给 `GET /captcha` 加独立限流（如 `rateLimit({windowMs: 60_000, max: 30})`，键用 `req.ip`）；把 `prune` 改为「先删过期 + 若仍 >= MAX_STORE 则按插入顺序淘汰最旧条目」（LRU/队列）；把 TTL 缩短到 2–3 分钟；长期方案是把挑战存 Redis/DB 并加 TTL 索引。
- **验证方式**：对部署实例跑上述 for 循环，`docker stats` 观察内存；或单测断言 `store.size` 在插入 10 倍 MAX_STORE 后仍 ≤ 某上界。

---

### [MEDIUM] SEC-03 限流是单进程内存 Map：重启清零、多副本不共享、无第三层限速

- **证据**：`server/auth/middleware.js:87` `const buckets = new Map();`（模块级，进程内）；文件第 85 行自带注释：「rate limiting (single-process store; shared store required for multi-instance)」。`rateLimit`（102-123）以 `${id}:${keyFn(req)}` 为键、计数在内存；`RATE_LIMIT_DISABLED === 'true'` 时**整条旁路**（第 108 行，生产部署脚本会强制该值为 false，见 `scripts/deploy.sh:27-48`）。
  当前实例：`loginLimiter` 10/10min（按 IP）、`loginEmailLimiter` 5/10min（按邮箱）、`registerLimiter` 5/h、`emailLimiter` 5/h、`resetLimiter` 5/h、`changePasswordLimiter` 5/h、`adminLimiter` 20/min（125-135）。`nginx.conf` 全文**无 `limit_req`/`limit_conn`**（已 grep 确认），所以没有边缘限速兜底。
- **影响**：容器 `restart`/重新部署（`scripts/deploy.sh` 每次滚动换镜像并 `trap rollback`）即把全部计数清零 → 攻击者可在部署后立刻重置预算；一旦横向扩副本（多 api 容器），每个副本各有独立配额，实际允许次数乘以副本数；DB 侧无任何限流记录可供审计。属「可被持续化绕过的防线」，不构成单独可利用漏洞，但与 SEC-01/SEC-04 叠加后撞库门几乎只剩 5 次/邮箱/10 分钟。
- **复现步骤**：`grep -n "limit_req\|limit_conn" nginx.conf`（无输出）；`grep -n "single-process" server/auth/middleware.js`（第 85 行）；重启 api 容器后重复登录失败，计数从 0 重新开始（需部署实例，未执行）。
- **建议修复**：把限流键值放到共享存储（Postgres 表 `rate_limits(key, count, reset_at)` + `INSERT ... ON CONFLICT DO UPDATE` 或 Redis），至少在 nginx 加 `limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m; limit_req zone=login burst=5 nodelay;`（作用于 `/api/auth/login|register|reset-password`）；把「重启清零」在运行手册里显式承认。
- **验证方式**：`grep -n "limit_req" nginx.conf` 期望命中；重启 api 后 `POST /api/auth/login` 连续 6 次仍应 429。

---

### [MEDIUM] SEC-04 宿主层反代拓扑下容器 nginx 覆盖 `X-Forwarded-For`，全站限流退化为单桶

- **证据**：`nginx.conf:18` `proxy_set_header X-Forwarded-For $remote_addr;`（**覆盖**客户端传入值——对「客户端直接打 nginx」的拓扑这是正确且更安全的写法，值得肯定）；`server/index.js:48` `app.set('trust proxy', 1)`；`server/auth/middleware.js:100-102` 注释「Default key is req.ip, which honours app.set('trust proxy', ...) so all clients behind the single nginx hop do not collapse into one bucket」。
  但 `docker-compose.tls.yaml` 头注明确给出另一种受支持拓扑：「若由宿主层（IIS/nginx/Caddy）终止 TLS，则用主 compose，并把宿主反代上游指向 `127.0.0.1:3005`」。此时容器 nginx 看到的 `$remote_addr` 是**宿主反代的地址（通常 172.x/127.0.0.1）**，`$remote_addr` 覆盖掉的正是宿主反代传来的真实客户端 XFF → 所有公网用户归一成同一个 `req.ip`。
- **影响**：在宿主层反代拓扑下：(a) `loginLimiter` 10 次/10 分钟变成**全站共享** → 任意单个攻击者可在 1 分钟内用 11 次错误登录把**所有用户**的登录打成 429（拒绝服务，含管理员）；(b) 更深的问题是指纹全错（`hashIp`、审计日志 `ip` 字段全部记成反代 IP），事后无法溯源。本机无法构造该拓扑验证，属**静态推证**。
- **复现步骤**：按 `docker-compose.tls.yaml` 头注在宿主 nginx 上加 `proxy_pass http://127.0.0.1:3005;` 并配 TLS，然后从两个不同公网 IP 各登录失败几次，观察总计数是否合并（未执行，需部署环境）。
- **建议修复**：二选一——(a) 若坚持宿主反代终止 TLS，把 `nginx.conf:18` 改为 `proxy_set_header X-Forwarded-For $http_x_forwarded_for;`（信任宿主注入的值）并把 `app.set('trust proxy', 2)`；或 (b) 更稳妥：让容器 nginx 用 `real_ip_header X-Forwarded-For; set_real_ip_from <宿主网段>; real_ip_recursive on;` 重写 `$remote_addr`，继续用 `$remote_addr` 做限流键；并在运行手册中把这条拓扑约束写进上线检查单。
- **验证方式**：拓扑二部署后 `curl -H 'X-Forwarded-For: 1.2.3.4'` 应不影响分桶；两个不同来源 IP 的限流计数应互相独立（不互相 429）。

---

### [MEDIUM] SEC-05 11 个状态变更路由缺 `csrfProtection`

- **证据**：`csrfProtection`（`server/auth/middleware.js:174-191`）只对不安全方法生效，但对**已登录**请求强制校验 `X-CSRF-Token`；而 `anonymousMutationGuard`（141-154）对 `if (req.user) return next()` 直接放行（注释：session-authenticated mutations are CSRF-protected）——**这条注释只对挂了 `csrfProtection` 的路由成立**。
  **先排除「全局已兜底」的可能**：`server/index.js:61` 只有 `app.use(anonymousMutationGuard)`，全文 `csrfProtection` 仅出现在 8 条内联路由上（`server/index.js:110,132,156,168,198,209,236,253`）与各 router 内部，**没有 app 级/router 级 CSRF**。全部命中（`grep -rn "csrfProtection" server/`）：`auth/middleware.js:174`（定义）、`auth/routes.js:270,295,472`、`auth/admin-routes.js:160,185,218`、`routes/model-gateway.js` 共 10 处、`index.js` 8 处内联——**`routes/{payments,credits,migration}.js` 一次都没有出现**。
  逐路由核对（`adminRouter.use(wrap(requireUser))` 见 `server/auth/admin-routes.js:25`；`paymentsRouter.use(wrap(requireUser))` 见 `routes/payments.js:22`；`adminPaymentsRouter.use(wrap(requireUser), wrap(requireAdmin), adminLimiter)` 见 `:71`；`creditsRouter.use(wrap(requireUser))` 见 `routes/credits.js:12`；`migrationRouter.use(wrap(requireUser))` 见 `routes/migration.js:19`）：
  | 路由 | 证据 | 缺失 |
  |---|---|---|
  | `POST /api/admin/migration/model-config` | `admin-routes.js:43-54` | csrfProtection（可写 apiKey/modelConfig） |
  | `POST /api/admin/users/:id/vip` | `admin-routes.js:82-101` | csrfProtection |
  | `DELETE /api/admin/users/:id/vip` | `admin-routes.js:103-117` | csrfProtection |
  | `PUT /api/admin/registration` | `admin-routes.js:121-136` | csrfProtection |
  | `POST /api/admin/users/:id/disable` | `admin-routes.js:315-348` | csrfProtection（禁号 + 吊销会话） |
  | `POST /api/admin/payments/orders/:orderNo/confirm` | `routes/payments.js:81-91` | csrfProtection（人工到账确认→入账/发 VIP，**最敏感**） |
  | `POST /api/payments/orders` | `routes/payments.js:31-40` | csrfProtection |
  | `POST /api/payments/orders/:orderNo/cancel` | `routes/payments.js:59-67` | csrfProtection |
  | `POST /api/credits/checkin` | `routes/credits.js:14-24` | csrfProtection |
  | `POST /api/credits/redeem` | `routes/credits.js:26-38` | csrfProtection（兑换码→发积分） |
  | `POST /api/migration/import` | `routes/migration.js:23-27` | csrfProtection（导入 v1 数据包，管理员级） |
  **共 11 条不安全方法**：5 条 admin（`admin-routes.js:43,82,103,121,315`）+ 3 条支付（`payments.js:31,59,81`）+ 2 条积分（`credits.js:14,26`）+ 1 条迁移（`migration.js:23`）。
  对照组（已挂 csrf，说明团队知道该模式、只是没铺开）：`admin-routes.js:160`（发公告）、`:185`（删公告）、`:218`（生成兑换码）；`auth/routes.js:270`（logout）、`:295`（改密）、`:472`（reauthenticate）；`routes/model-gateway.js` 的全部 10 条写路由。
- **影响**：纵深防御不一致。**当前不是可直接利用的 CSRF**：会话 cookie `sameSite: 'lax'`（`server/auth/session.js:13-22`）使跨站 POST 不携带 cookie，且 `Access-Control-Allow-Headers` 虽含 `X-CSRF-Token` 但 `corsAllowlist`（middleware.js:71-83）只对白名单 Origin 回 ACAO，攻击者无法读取 token。风险来自「single point of failure」：一旦首页 CSP（`nginx.conf` 有 `script-src 'self'`，正面）或某个 XSS 被突破、或未来把 `sameSite` 调整为 `none`/引入子域（`deploy/nginx-tls.conf` 用了 `includeSubDomains` 的 HSTS，子域已在信任边界内），这 11 个路由会**第一个倒下**，其中包括给任意用户发/收 VIP、积分兑换码核销与管理员的到账确认。故定 MEDIUM（修一条中间件即可）。
- **复现步骤**：`grep -rn "csrfProtection" server/` 应看到 `routes/{payments,credits,migration}.js` 零命中；或起服务后对 `POST /api/admin/registration`、`POST /api/credits/redeem` 只带会话 cookie、不带 `X-CSRF-Token`，观察是否 200（未执行，需部署实例）。
- **建议修复**：在这 5 个 router 的 `use(wrap(requireUser))` 之后统一补 `use(wrap(csrfProtection))`（非不安全方法自动 no-op，`middleware.js:174-191` 已实现该语义），一次性覆盖全部 11 条；不要只补列表里的几条。补一条测试：遍历每个 router 的 stack，断言所有 POST/PUT/DELETE 都包含 csrf 中间件。
- **验证方式**：新增/执行 `server/test/security.test.js` 风格用例，遍历 `adminRouter.stack` 断言每个不安全方法都包含 csrf 中间件。

---

### [HIGH] SEC-06 生产未配 `SMTP_HOST` 时，验证/重置/管理员激活令牌明文写入容器日志

- **证据**：`SMTP_HOST` 为空时 `sendMail` 走「开发兜底」分支，把**含明文令牌的邮件正文**打进进程日志 —— `server/auth/outbox.js:124-131`（原文）：
  ```js
  const sendMail = async (mail) => {                                  // 124
    const t = getTransporter();                                       // 125
    if (!t) {                                                         // 126
      // Development fallback: print the full message so local signup/reset
      // flows can be completed (spec §8 allows console output in dev).
      // Production never reaches this branch without SMTP configured.  // 129 ← 只是假设，没有任何代码强制
      console.log(`[mail:dev] to=${mail.to} subject=${mail.subject}\n${mail.text}`);   // 130
      return;
    }
    await t.sendMail(mail);                                           // 133
  };
  ```
  调用链上 `mail.text` **确实是明文令牌**：`processOne`（`outbox.js:160-178`）先用 `openActionToken`（`:36`，用 `EMAIL_DELIVERY_KEY` 解开密文）取出明文 token，再 `renderEmail(row.purpose, { recipientEmail, token })`（`:171`）；`renderEmail`（`:82-101`）把 token 拼进 URL：
  ```js
  const actionUrl = (path, token) => {                                          // 76
    const base = (process.env.PUBLIC_APP_URL || 'http://localhost:3001').replace(/\/$/, '');
    // Token travels in the URL fragment so it never reaches the server via logs.   // 78 ← 该假设被 130 行的日志兜底推翻
    return `${base}/#${path}?token=${encodeURIComponent(token)}`;                 // 79
  };
  ```
  → `verify_email`（86 行，24h 有效）、`reset_password`（92 行，30min）、**`bootstrap_admin`（98 行，一次性管理员激活）** 三种链接都会被打印。注意：令牌在库里是密文（`sealActionToken`/`action_token_ciphertext`，`outbox.js:58-70`，发信成功后还被清空 `:186-192`）——**静态存储做对了，日志兜底把它抵消了**。
  触发条件在部署侧具备：`scripts/deploy.sh:27-48` 的预检 `need` 清单只有 `POSTGRES_PASSWORD/CORS_ORIGINS/PUBLIC_APP_URL/MODEL_ENC_KEY/REQUEST_HMAC_KEY` + 三行布尔校验，**不含 `SMTP_HOST`**；`.env.production.example:36` 就是 `SMTP_HOST=`（**生产模板默认留空**）；`docker-compose.yaml:70` 为 `- SMTP_HOST=${SMTP_HOST:-}`（可空缺省）——因此 SMTP 没接通时容器照常启动、健康检查照样通过。`docker compose logs api` 对运维、日志聚合平台、以及任何能读日志的人可读。
- **影响**：若上线时 SMTP 尚未接通（上线第一步很常见），则：(a) 注册验证邮件根本发不出 → 新用户无法激活（**上线即功能不可用**，即便 `EMAIL_VERIFICATION_DISABLED=false`）；(b) 更严重的是**管理员激活链接（`bootstrap_admin`，`routes.js:432-465` 消费）与任意用户的重置链接被写进日志**——凡是能看容器日志的人（含日志聚合的第三方、共享宿主上的其他租户），在令牌有效期内可直接完成管理员激活或账号接管 = 未授权访问 + 权限提升。同时日志里出现用户邮箱属 PII 外泄。
- **复现步骤**：无需起服务即可静态确认（读 `outbox.js:124-131` + `:160-178` + `:76-101`）。动态复现（**未执行**，约束禁止起服务）：`SMTP_HOST= node --input-type=module -e "...processOne({...})..."` 或部署后 `docker compose logs api | grep -i 'mail:dev'`。**若生产已用此配置跑过，日志中的令牌应视为已泄漏**：`docker compose logs api | grep -oE 'token=[A-Za-z0-9]+'` 自查后作废对应令牌。
- **建议修复**：兜底分支只记录元数据（`purpose`、收件邮箱的哈希、`requestId`），**绝不落 `mail.text`**；确需本地调试时用显式 `OUTBOX_DEBUG_LOG_BODY=true` 开关并在启动时打印醒目警告；`scripts/deploy.sh` 把 `SMTP_HOST` 加入 `need`（或未配置时打 BLOCKER 级警告并要求显式 `--accept-no-email`）；同时把 `outbox.js:78` 那条「token never reaches the server via logs」的注释改正，避免下一个人继续误信。
- **验证方式**：`grep -n "mail.text" server/auth/outbox.js` 应只在 `sendMail` 的 `t.sendMail(mail)` 路径（第 176 行传参）出现，第 130 行不得出现；`grep -n "SMTP_HOST" scripts/deploy.sh` 应命中预检；单测：`SMTP_HOST` 未设时捕获 `console.log` 断言不含 `token=`。

---

### [HIGH] SEC-07 RLS 在生产连接（超级用户）下被 BYPASSRLS 绕过，两个列表接口因此缺少对象级过滤

- **证据（证据链）**：
  1. `server/db.js:100-101` 注释自述：「Transaction bound to the authenticated user context for RLS (GUC). **Missing GUC fails closed on non-superuser connections**」；`withUserContext`（102-113）在事务内执行 `SET LOCAL app.user_id = '${userId}'` / `SET LOCAL app.is_admin = '...'`（userId 先过 `/^[0-9a-f-]{36}$/i`）。
  2. `server/migrations/003a_models_rls.sql:4-16` 的 `models_visible` 策略完全依赖该 GUC：
     ```sql
     CREATE POLICY models_visible ON models FOR SELECT USING (EXISTS (
       SELECT 1 FROM model_providers p WHERE p.id = models.provider_id AND p.deleted_at IS NULL
         AND (p.scope = 'shared' OR (p.scope = 'private'
              AND p.owner_user_id::text = current_setting('app.user_id', true))))))
     ```
     `models_write`（18-29）、`credential_versions_visible`（31-43）同理。
  3. **但生产部署里应用用的就是 Postgres 超级用户**：`docker-compose.yaml` 的 postgres 服务 `POSTGRES_USER: postgres`，api 服务 `environment` 里 `DB_USER=postgres` / `DB_PASSWORD=${POSTGRES_PASSWORD:?...}`（同一份凭据）。PostgreSQL 中**超级用户默认 `BYPASSRLS`**，且 RLS 对表 owner 默认也不生效（除非 `FORCE ROW LEVEL SECURITY`，本迁移文件中没有）。
  4. 因此「fail closed」的前提（non-superuser）在本部署中不成立 → `app.user_id` GUC 尽管被正确设置，**策略不参与过滤**。
  5. 受影响的只有**两个列表 GET**（写入/密钥路径都有显式检查，见下）：`server/routes/model-gateway.js:104-118` `GET /providers`：
     ```sql
     SELECT id, scope, name, base_url, auth_type, auth_header_name, enabled, deleted_at,
            (active_credential_version_id IS NOT NULL) AS credential_configured
     FROM model_providers WHERE deleted_at IS NULL ORDER BY created_at
     ```
     与 `:322-338` `GET /models`：`SELECT m.id, ..., p.scope AS provider_scope, p.name AS provider_name FROM models m JOIN model_providers p ON p.id = m.provider_id WHERE m.deleted_at IS NULL ORDER BY m.created_at`。二者都**没有 `owner_user_id` 过滤**，整体包在 `withUserContext({userId, isAdmin})` 内，把可见性完全托付给 RLS。
     对照：`POST /providers/:id/credential`（137-139 显式 `isOwner/isAdminShared`）、`discover-models`（198-202）、`POST/DELETE /models`、`DELETE /providers` 均有显式检查 → 写路径与密钥读取**不依赖** RLS，不受此条影响。
- **影响**：任一登录用户调用 `GET /api/model-gateway/providers`（或 `/models`）可看到**其他用户 private provider 的元数据**：`name`、`base_url`、`auth_type`、`auth_header_name`、`enabled`、`credential_configured` 以及私有模型的 `api_model`、`access_level`、`endpoint_path`。**不含密钥明文**（凭据另存 `credential_versions` 且只在 owner 检查后的 `openSecret` 路径解密），所以不是密钥泄漏，但是明确的跨租户信息泄漏（暴露其他用户接入的第三方服务域名/账号结构，可用于定向钓鱼与后续攻击面测绘）。**未实机验证**（无法在只读约束下起服务，也无法连生产库）；这是依据「超级用户 ⇒ BYPASSRLS」的静态推证，请队长在汇总时标为「推证/待实机确认」。
- **复现步骤**（需授权环境，二选一）：
  1. 直连库：`psql ... -c "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user;"` → 若 `rolsuper=true`，再 `SET LOCAL app.user_id='<A的uuid>'` 后 `SELECT count(*) FROM model_providers WHERE scope='private';` 与不带 GUC 时对比，若结果相同且包含 B 的记录，则策略未生效；
  2. 应用侧：用户 A 创建 private provider，用户 B 调 `GET /api/model-gateway/providers`（带 B 自己的 csrf/cookie），若响应含 A 的 `name/base_url` 即确认。
- **建议修复**：(a) 立即给这两个查询补显式过滤（最小改动、最稳）：`WHERE p.deleted_at IS NULL AND (p.scope='shared' OR p.owner_user_id = $1)`，`isAdmin` 时放开；(b) 让应用用**非超级用户**连接（新建 `manga_app` 角色，`GRANT` 必要权限，不授 `BYPASSRLS`/表 owner），并给策略加 `ALTER TABLE ... FORCE ROW LEVEL SECURITY`；(c) 增加一个 `isolation.test.js` 风格的用例，断言 B 看不到 A 的 private provider（`server/test/` 已有 `isolation.test.js`，在此追加最自然）。
- **验证方式**：上述复现步骤 2 在修复后应返回空/仅 shared；`psql -c "SELECT rolbypassrls FROM pg_roles WHERE rolname='postgres'"` 若为 true，则必须完成 (a) 或 (b)。

---

### [MEDIUM] SEC-08 `ARGON2_*` 是死配置：生产文档声称的 `parallelism=1` 从未生效

- **证据**：`grep -rn "ARGON2" .`（排除 node_modules）只命中 `.env.example:42-44` 与 `.env.production.example:54-56`（`ARGON2_MEMORY=65536`、`ARGON2_ITERATIONS=3`、`ARGON2_PARALLELISM=1`），**`server/` 下的代码与 `docker-compose.yaml` 均不读取、不透传这三个变量**。实际哈希参数来自 `server/auth/password.js:24-30`：
  ```js
  return argon2.hash(password, { type: argon2.argon2id });   // 第 28 行注释自认：argon2 package defaults: m=65536, t=3, p=4
  ```
  `server/node_modules/argon2/argon2.cjs:32-34`（`timeCost = 3`）与 `:50-52`（`memoryCost = 1 << 16`、`parallelism = 4`）确认库默认 p=4。
- **影响**：m=64 MiB / t=3 本身是合理基线（OWASP 对 argon2id 建议 ≥19 MiB），**安全性尚可**；问题在于 (a) 文档与实现不一致，运维按文档调参（尤其想降低生产并发内存占用时设 `ARGON2_PARALLELISM=1`）不会有任何效果，「已按文档加固」是假象；(b) 4 条 lane 在高并发登录时对 2C/4G 级别容器会成倍放大瞬时内存（每次哈希 ~64 MiB × 并发数）。属配置正确性/资源风险。
- **复现步骤**：`grep -rn "ARGON2" server/ docker-compose.yaml`（无输出）；`grep -n "argon2.hash" server/auth/password.js`（只有 `type`）。
- **建议修复**：把参数显式化并接入 env：`argon2.hash(pwd, { type: argon2.argon2id, memoryCost: Number(process.env.ARGON2_MEMORY||65536), timeCost: Number(process.env.ARGON2_ITERATIONS||3), parallelism: Number(process.env.ARGON2_PARALLELISM||1) })`，在 `docker-compose.yaml` 透传；或删除 `.env.*.example` 中的三个变量以免误导。
- **验证方式**：新增单测断言 `hashPassword` 产出的 hash 字符串中参数段（`$argon2id$v=19$m=...,t=...,p=...`）与 env 一致。

---

### [MEDIUM] SEC-09 默认部署路径无 TLS/HSTS，配合 `COOKIE_SECURE=false` 过渡开关会让会话明文过网

- **证据**：
  - `server/auth/session.js:13-22`：`secure: process.env.COOKIE_SECURE !== undefined && COOKIE_SECURE !== '' ? COOKIE_SECURE === 'true' : NODE_ENV === 'production'` —— 默认（不设）在生产为 `true`（**这个默认是对的**）；但显式 `COOKIE_SECURE=false` 会关掉。
  - `docker-compose.yaml:62-63` 把 `COOKIE_SECURE=${COOKIE_SECURE:-}` 透传（默认空 → 走 NODE_ENV 分支）；`scripts/deploy.sh:27-48` **不校验** `COOKIE_SECURE`；`.env.production.example:25-27` 明文给出过渡指导：「可临时设 COOKIE_SECURE=false（否则浏览器不回传会话 Cookie，无法登录）」紧跟 `COOKIE_SECURE=true`（`.env.example:16` 亦为 `false`）→ 运维最可能这样上线第一阶段。
  - 默认 compose 的入口是 `nginx.conf:2` `listen 80;`（**无 `listen 443`**），全文件**无 `Strict-Transport-Security`**；TLS 需要额外叠加 `docker-compose.tls.yaml` + `deploy/nginx-tls.conf`（该文件 `:14` 有 `listen 443 ssl`、`:55`/`:69` 有 `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`）。CSP 在 `nginx.conf:35-40`/`deploy/nginx-tls.conf:56,63,70` 两套里都有（`default-src 'self'; script-src 'self'; ...; frame-ancestors 'none'`），**这一点是好的**；`index.html:7` 无 CSP meta（依赖 nginx 头，可接受）。
- **影响**：若按默认 compose 上 80 端口并设 `COOKIE_SECURE=false`，`ms_session`（HttpOnly、SameSite=Lax、7 天有效，`session.js`）会在**明文 HTTP 上传输**：同一链路上的任何中间人（公共 WiFi、云内网旁路、被劫持的上游反代）可抓到会话 cookie 直接冒充用户（含管理员）；同时无法抵抗 SSL-strip。属「按文档即可踏错」的部署级风险，定 MEDIUM（部署域队友可能同时记录 TLS 缺失，本条只从**会话安全**视角记）。
- **复现步骤**：`grep -n "Strict-Transport-Security\|listen" nginx.conf`（无 HSTS、仅 80）；`grep -n "COOKIE_SECURE" .env.production.example docker-compose.yaml server/auth/session.js`；用 `curl -v http://<host>/api/auth/login -d ...` 观察 `Set-Cookie` 缺 `Secure`（需部署实例，未执行）。既有单测 `server/test/session-cookie.test.js:29-53` 已覆盖三种 COOKIE_SECURE 组合，说明这是被刻意支持的开关。
- **建议修复**：把 TLS 覆盖文件变成默认上线路径（compose 默认监听 443 + 80 跳转），或在 `deploy.sh` 里把 `COOKIE_SECURE=false` 视为需显式 `--insecure-http` 确认的高危项并打 BLOCKER 警告；`deploy.sh` 增加 `COOKIE_SECURE` 与 HSTS 存在性校验。
- **验证方式**：`curl -sI https://<host>/ | grep -i strict-transport` 应命中；HTTP 请求应 301 到 HTTPS；`docker compose config | grep COOKIE_SECURE` 应为空或 `true`。

---

### [LOW] SEC-10 CSRF token 比较非恒定时间

- **证据**：`server/auth/middleware.js:187` `if (hashToken(provided) !== row.csrf_token_hash) { ... }`（会话 cookie 那条路径用的是 SHA-256 十六进制字符串比较）。相比之下 `server/auth/tokens.js` 的 `consumeToken` 与 `password.js` 的 `argon2.verify` 都是恒定时间/原子语义。
- **影响**：理论上存在基于响应时间差的 token 猜测（需要高精度计时 + 大量并发，且 `csrf_expires_at` 只有 10 分钟）。实际可利用性极低（SameSite=Lax 是主防线）；属代码规范不一致。
- **复现步骤**：读 `middleware.js:187`；`grep -n "timingSafeEqual" server/ -r`（在 csrf 路径无命中）。
- **建议修复**：改用 `crypto.timingSafeEqual(Buffer.from(hashToken(provided),'hex'), Buffer.from(row.csrf_token_hash,'hex'))`（长度不等时先短路返回失败）。
- **验证方式**：新增单测断言长度不等时不抛异常且返回 403。

---

### [LOW] SEC-11 错误响应把 `e.message` 回传客户端

- **证据**：`server/index.js` 内联路由的 catch 分支普遍是 `res.status(500).json({ error: e.message })`——**实测 14 处**，精确行号：`:83, :95, :106, :128, :140, :152, :164, :176, :194, :205, :216, :228, :244, :261`（`grep -rn "error: e.message" server/index.js | wc -l` → 14）。`server/routes/payments.js:15` 的 `sendErr` 与 `server/routes/credits.js:20,34` 也回传 `e.message`，但那三处**只对 `PolicyError`（自带面向用户的安全文案 + code）放行**，属预期设计，不计入本条。`server/index.js:118` 还把 `POST /api/projects` 的 title/payload 大小写进 `console.log`（属 SEC-11 同类信息泄漏，见下方影响）。正面：`model-gateway.js` 与 `auth/routes.js` 的对外错误做了收敛（统一 `UPSTREAM_ERROR` / `invalid credentials`），未发现 SQL 堆栈或 `pg` 原始错误外泄的固定路径。
- **影响**：依赖驱动/库的错误文本可能包含 SQL 片段、表名、约束名、文件路径 → 给攻击者提供指纹（信息泄漏，非直接越权）。需触发未预期的异常分支才能看到，故 LOW。**已复现的那部分**：`grep -rn "error: e.message" server/index.js` 确认 14 处，且这些 catch 覆盖 `projects`/`assets`/`user-settings`/`admin system-settings` 等全部内联路由——即**任何**这些接口的 DB 异常都会把原始 message 回给调用者。未在本机触发实际 500（需起服务，见「未覆盖」）。
- **复现步骤**：`grep -n "error: e.message" server/index.js server/routes/*.js`（15+ 处）；构造 `POST /api/projects` 带超长 payload 观察响应体（未执行）。
- **建议修复**：对外统一 `{ error: 'internal error', requestId }`，细节记 `console.error(e)` + `requestId`（`server/index.js:50` 已有 `requestId` 中间件，正好可作为关联键）。
- **验证方式**：`grep -c "error: e.message" server/index.js` 期望为 0；或单测注入抛错 handler 断言响应体不含 `e.message`。

---

### [LOW] SEC-12 支付订单号仅 32 bit 随机

- **证据**：`server/payments/index.js:34-38`：
  ```js
  const genOrderNo = () => {                                              // 34
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `MS${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;  // 37
  };
  ```
  同一天内空间 2^32，生日界约 77k 单即 50% 碰撞概率。**唯一性有 DB 兜底**：`server/migrations/008_payments.sql:5` `order_no VARCHAR(32) UNIQUE NOT NULL` → 碰撞会抛唯一约束冲突（表现为 500，不应串单）。`createOrder` 在 `index.js:46` 调用它，**未看到对唯一冲突的重试**（碰撞即用户看到下单失败）。
- **影响**：现实订单量下碰撞概率低；`GET /orders/:orderNo` 有 owner 校验（`server/routes/payments.js:50-57` 显式 `order.user_id !== req.user.user_id → 404`），枚举只能得到 404，**不宜写成「可枚举他人订单」**。属健壮性/可用性改进项（极小概率下单失败 + 订单号可被猜中后仍需 owner 校验）。
- **复现步骤**：`grep -n "randomBytes(4)" server/payments/index.js` → 第 37 行；`grep -n "order_no" server/migrations/008_payments.sql` → 第 5 行确认 UNIQUE。
- **建议修复**：改用 `crypto.randomBytes(10)`（80 bit）或 `crypto.randomUUID()`，并对唯一冲突做一次重试。
- **验证方式**：`grep -n "randomBytes(10)" server/payments/index.js` 应命中；压测创建订单断言无 500 唯一冲突。

---

### [LOW] SEC-13 SSRF 私网黑名单未覆盖 100.64/10、192.0.0/24、198.18/15

- **证据**：`server/model-gateway/upstream.js:49-67` 的 `isPrivateAddress` 覆盖 10/8、127/8、0/8、169.254/16、172.16-31、192.168/16、≥224、`::1`、`::`、`fe80::/10`、`fc00::/7`、IPv4-mapped；**未含 CGNAT 100.64/10、192.0.0/24、基准测试网段 198.18/15**（后者恰是本机 TUN/Fake-IP 代理常用网段，见团队经验）。
- **影响**：`validateBaseUrl`（`model-gateway.js:37-49`）允许任意 https 主机，防护全靠这层黑名单 + `resolveAndBind`（71-94，解析即绑定 IP、拒绝任一私网结果、跨源重定向拒绝、无 DNS 重绑定 TOCTOU）——整体设计是合格甚至偏好的。留下的缺口仅当目标位于上述少见网段时才可被当作「公网」放行（如需读 198.18/15 上的服务）。可利用性低。
- **复现步骤**（**已执行**）：
  ```bash
  node --input-type=module -e "const u=await import('./server/model-gateway/upstream.js'); for (const ip of ['100.64.0.1','198.18.0.1','192.0.0.1','10.0.0.1','169.254.169.254']) console.log(ip, u.isPrivateAddress(ip));"
  # 输出：
  # 100.64.0.1 false        ← CGNAT 未被识别为私网
  # 198.18.0.1 false        ← 基准测试网段未被识别
  # 192.0.0.1  false        ← 192.0.0.0/24 未被识别
  # 10.0.0.1   true
  # 169.254.169.254 true
  ```
  `grep -n "100\.64\|198\.18\|192\.0\.0" server/model-gateway/upstream.js` 无命中，与输出一致。
- **建议修复**：采用白名单思路（只允许「解析结果非保留网段」）或补齐 `100.64.0.0/10`、`192.0.0.0/24`、`198.18.0.0/15`、`192.0.2.0/24`、`198.51.100.0/24`、`203.0.113.0/24`。
- **验证方式**：单测对上述网段断言 `isPrivateAddress(...) === true`。

---

### [LOW] SEC-14 服务端 SVG 经 `dangerouslySetInnerHTML` 注入；bootstrap/reset 模式的 token 不从地址栏清除

- **证据**：`components/AuthPage.tsx:214` `dangerouslySetInnerHTML={{ __html: captcha.svg }}`（把 `/api/auth/captcha` 返回的字符串直接注入 DOM；`<script>` 经 innerHTML 不执行，且当前 SVG 由 `captcha.js:28-54` 的固定模板 + `CHARSET` 生成，未发现可利用 XSS）。`components/AuthPage.tsx:46-73`：`verify` 分支在提交后 `window.history.replaceState(null,'',pathname+search)`（第 58 行）**会**清除 hash 中的 token，但 **`bootstrap`（64-68）与 `reset`（69-72）分支把 token 存进 React state 后不清 hash** → 管理员激活/重置链接的 token 长期留在地址栏与浏览器历史（共享电脑、截图、Referer 全部可能外带）。`components/AuthPage/hashAction.ts` 是纯解析函数、无跳转拼接 → **未发现开放重定向**（正面结论）；`tests/auth-page-hash.test.ts` 5 个用例只覆盖解析，无安全断言。
- **影响**：SVG 注入当前无实际攻击者可控输入（回答来自本服务的固定模板），定 LOW 是因为它把「未来任何 SVG 渲染改动」变成 XSS 直通车（`nginx.conf` 的 `script-src 'self'` 也拦不住 `onload=`/`<animate>` 类内联向量——`CSP` 未含 `script-src` 的 inline 阻断对属性事件是否生效取决于浏览器，需谨慎）；token 残留在地址栏是可被人看到的一次性凭据暴露（激活令牌 24h 有效、重置 30 分钟）。
- **复现步骤**：读 `components/AuthPage.tsx:214,64-72`；浏览器打开 `https://<host>/#/bootstrap?token=...`，提交前后观察地址栏 hash 是否仍在（需前端实例，未执行）。
- **建议修复**：`bootstrap`/`reset` 分支同样 `history.replaceState`；对 SVG 做白名单净化或改成 `<img src="data:image/svg+xml;base64,...">`（避免 innerHTML 路径）；给 `tests/` 增加「bootstrap/reset 提交后 location.hash 不含 token」的断言。
- **验证方式**：新增前端单测断言 `window.location.hash === ''`；`grep -n "dangerouslySetInnerHTML" components/` 只剩受控用法。

---

### [LOW] SEC-15 `/verify-email`、`/reset-password`、`/bootstrap-complete` 无限流

- **证据**：`server/auth/routes.js:176-207`（verify-email）、`385-408`（reset-password）、`432-465`（bootstrap-complete）**都不带任何 limiter**（对比 `register` 90-93 带 `registerLimiter`、`login` 211+ 带两个、`request-password-reset` 351-383 带 `resetLimiter`）。
- **影响**：令牌是 `randomToken(32)` = 256 bit 且 `consumeToken` 用单条 `UPDATE ... WHERE consumed_at IS NULL AND expires_at > NOW() RETURNING` 原子一次性消费（`server/auth/tokens.js`），在线爆破不可行；无限流的实际风险是**未认证的 CPU 消耗**（`bootstrap-complete` 在验证 token 前先跑一次 `hashPassword`：`routes.js:439`，即任何匿名请求都能让服务端做一次 argon2，配合无边缘限速可放大为 CPU DoS——**这一点比 token 爆破更值得修**）。
- **复现步骤**：`grep -n "authRouter.post" server/auth/routes.js` 逐个对照 limiter 列表（静态）；并发压 `POST /api/auth/bootstrap-complete` 观察 CPU（未执行）。
- **建议修复**：给三条路由加 limiter（可共用 `resetLimiter` 量级）；`bootstrap-complete` 把 `hashPassword` 移到 token 消费成功之后再算（或用低成本的哈希占位）以避免匿名 CPU 放大。
- **验证方式**：`grep -A3 "authRouter.post(\s*'/bootstrap-complete'" server/auth/routes.js` 应出现 limiter。

---

### [LOW] SEC-16 登录/注册不吊销同一账号的既有会话

- **证据**：`server/auth/routes.js:211-263` 的 `login` 在凭证通过后只做 `createSession(...)` + `res.cookie(SESSION_COOKIE, token, ...)`，**没有** `revokeAllSessions`（或 `revokeAllSessions(..., { exceptSessionId })` 之外的清理）。全量吊销只出现在 `change-password`（291-347，`session_version + 1` + `revokeAllSessions`）与 admin `disable`（`admin-routes.js:315-348`）。
- **影响**：别人在共用设备上登录过的 `ms_session`（HttpOnly、7 天）在我重新登录后依然有效，直到改密或被管理员禁用；用户更换密码才会失效（这是可接受的常见取舍）。会话固定方面**未发现**可利用路径：登录会覆盖 cookie、`ms_session` 是 HttpOnly（无法从 JS 种）且 `readSession`（`session.js:51-69`）会校验 `user_session_version` 快照与会话 `status`，服务端有状态、可真正失效。
- **复现步骤**：`grep -n "revokeAllSessions\|createSession" server/auth/routes.js`；登录前后对同一账号用旧 cookie 调 `GET /api/auth/me` 应仍 200（需部署实例，未执行）。
- **建议修复**：在 `login` 成功后调用 `revokeAllSessions(client, userId, { exceptSessionId: newSessionId })`（或提供「退出所有设备」入口），并在前端提示。
- **验证方式**：登录后在另一「设备」用旧 cookie 调 `/api/auth/me` 应 401。

---

## 已验证为**未发现**问题的项（正面结论，供对抗复核直接引用）

1. **SQL 注入**：`grep -rnE "query\(\s*\`[^\`]*\\\$\{" server --include=*.js` 仅命中 `server/db.js:109`、`server/db.js:110` 两处 `SET LOCAL`（值被 `/^[0-9a-f-]{36}$/i` 与布尔字面量严格约束），其余全部参数化。
2. **对象级授权（IDOR）**：`server/repositories/projects.js`、`assets.js`、`settings.js` 的每个函数都带 `user_id = $1`（`saveProject`/`saveAsset` 用 `ON CONFLICT (user_id, id)`）；`server/model-gateway/media.js` 的 `getMediaRecord/getMediaContent/deleteMedia` 全部带 `user_id = $2` 且 `objectPath` 会剥离 `[^a-zA-Z0-9/_-]` 后强制 `startsWith('user/${userId}/')`（**未发现路径穿越**）；`server/model-gateway/gateway.js` 的 `findJob/cancelJob` 带 `j.user_id = $2`；`server/routes/payments.js:50-57` 订单读有显式 owner 校验、`server/payments/index.js` 的 `cancelOrder` 用 `WHERE order_no=$1 AND user_id=$2 AND status='pending'`。**未发现跨用户读取/修改**。
3. **SSRF**：`server/model-gateway/upstream.js` 解析即绑定 IP（无 DNS 重绑定 TOCTOU）、私网拒绝、`METADATA_HOSTS`、危险请求头黑名单、跨源重定向拒绝、`maxRedirects=2`、POST 默认禁重定向、响应体上限——设计合格（仅 SEC-13 的网段缺口）。
4. **会话服务端有状态**：`session.js:51-69` `readSession` 校验 `revoked_at IS NULL`、`expires_at > NOW()`、`user_session_version === session_version`、`users.status='active'` → 注销/改密/禁号**真的失效**（非无状态 JWT）。
5. **cookie 默认属性**：`httpOnly: true`、`sameSite: 'lax'`、`path: '/'`，生产默认 `secure: true`（`session.js:13-22`），且有 5 个单测覆盖（`server/test/session-cookie.test.js`）。
6. **CORS**：`getAllowedOrigins`（`middleware.js:61-69`）为逗号分割的**精确匹配**（`includes`），非前缀；`corsAllowlist`（71-83）永不输出 `*`，只对白名单回 `ACAO` + `Vary: Origin` + `Allow-Credentials`；`null`/伪造 Host/`https://evil-<域名>` 都不能命中（域名列表来自 env，`deploy.sh` 强制 `https://` 前缀）。
7. **一键 XFF 伪造**：`nginx.conf:18` 用 `$remote_addr` **覆盖**（而非 `$proxy_add_x_forwarded_for`）→ 客户端自带 `X-Forwarded-For` 被丢弃，配合 `app.set('trust proxy', 1)` 得到的是真实对端 IP（**仅在「客户端直连容器 nginx」拓扑下成立**，见 SEC-04）。
8. **账号枚举**：注册用 `INSERT ... ON CONFLICT (email_normalized) DO NOTHING` 且恒 202；`request-password-reset` 恒 202；登录失败统一 401 `invalid credentials` 并用 `getDummyHash()`（`routes.js:70-75`）对未知邮箱做等耗时 argon2 比对。
9. **令牌熵与一次性**：`randomToken(32)` = 256 bit 十六进制；`consumeToken` 单条原子 `UPDATE ... RETURNING`（`tokens.js`）；`verify_email` 24h、`reset_password` 30min、`bootstrap_admin` 一次性。
10. **响应头（nginx 层）**：两套 nginx 配置都带 CSP（`default-src 'self'`、`frame-ancestors 'none'`）、`X-Frame-Options`、`nosniff`、`Referrer-Policy: no-referrer`；TLS 覆盖文件带 HSTS（`deploy/nginx-tls.conf:55,69`）。Express 侧 `securityHeaders`（`middleware.js` 顶部）另设 nosniff/XFO DENY/Referrer-Policy（API 响应无需 CSP）。
11. **前端不含长期凭据**：`services/storageService.ts:35-76` 的 CSRF token 只存在**模块级内存变量**（刷新即失），localStorage/sessionStorage 未发现 token/password（只有主题、Onboarding 标记、模型注册表配置）；`AuthPage/hashAction.ts` 无开放重定向拼接。

## 未覆盖 / 无法确定（请队长在汇总中如实保留）

1. **SEC-07 未经实机验证**：只读约束下没有起服务、没有连生产库，结论建立在「DB_USER=postgres 是超级用户 ⇒ 默认 BYPASSRLS + 表 owner 不受策略约束」这一 PostgreSQL 语义上。**建议上线前用一条 SQL 确认**（见该节复现步骤 1）。另外**未检查**是否对所有相关表都 `FORCE ROW LEVEL SECURITY`（`grep -rn "FORCE ROW LEVEL" server/migrations/` 未做）。
2. **未读文件**：`server/auth/users.js` 相关逻辑未单独通读（用户状态/角色变更分散在 `admin-routes.js` 与 `routes.js`）；`server/notifications.js`、`server/activities.js`、`server/view_configs.js`、`server/model-gateway/{crypto,discovery,multipart,presets,provider-presets}.js`、`server/routes/notifications.js` 只做了关键词级扫描，**未逐行审阅**。`server/routes/{credits,migration}.js` 已读到路由定义（其缺 CSRF 已计入 SEC-05），但 `server/activities.js` 里 `checkIn`/`redeemCode` 的业务逻辑（兑换码熵、重复核销、积分账务）未审——**属账务/积分域，建议由支付账务队友复核**。
3. **未验证的部署事实**：主部署是否实际启用 TLS/HSTS（取决于运维选哪套 compose）；`SMTP_HOST` 在生产 .env 中是否为空（决定 SEC-06 是否成立）；生产是否曾以 `CAPTCHA_ENABLED=true` 上线（决定 SEC-01 是否已被利用）。这三项都无法从工作树确定。
4. **未做动态测试**：没有发起任何 HTTP 请求（约束禁止起服务），因此**没有**验证：限流 429 阈值、验证码 422 行为、CORS 实际响应头、`/api/auth/captcha` 的内存增长曲线、订单确认并发。全部结论为静态代码级 + 一次本地模块级复现（SEC-01）。
5. **未审计的域**（属其他队友 scope，此处不重复）：支付账务一致性、backup/恢复、构建与测试门禁、网关密钥生命周期（我只从鉴权/CSRF 角度触及 `model-gateway` 与 `payments` 的写入路径）。
6. **`server/test/` 与 `tests/` 未运行**（约束：不改不跑服务；跑 jest 需依赖与数据库）。因此「现有测试是否通过」不在本报告结论内，仅引用测试**内容**作为证据（例如 captcha 测试用 `_peekAnswer` 绕过 SVG 这一事实）。

## 附：本次复现命令清单（可原样重跑）

```bash
# SEC-01 验证码答案泄漏（无需起服务）
node --input-type=module -e "const m=await import('./server/auth/captcha.js'); const {captchaId,svg}=m.issueCaptcha(); const chars=[...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(x=>x[1]); console.log('extracted=',chars.join('')); console.log('verify=',m.verifyCaptcha(captchaId, chars.join('').toLowerCase()));"

# SQL 拼接扫描（应只命中 db.js:109-110）
grep -rnE "query\(\s*\`[^\`]*\\\$\{" server --include=*.js

# CSRF 中间件覆盖核对
grep -n "csrfProtection\|requireRecentReauth\|adminLimiter" server/auth/admin-routes.js
grep -n "csrfProtection\|requireUser" server/routes/payments.js

# 限流 / HSTS / XFF 现状
grep -n "limit_req\|limit_conn" nginx.conf
grep -rn "Strict-Transport-Security" nginx.conf deploy/ docker-compose*.yaml
grep -n "X-Forwarded-For\|X-Real-IP" nginx.conf

# RLS 失效证据
grep -n "DB_USER\|POSTGRES_USER" docker-compose.yaml
grep -n "current_setting" server/migrations/003a_models_rls.sql
grep -n "app.user_id\|app.is_admin" server/db.js
```
