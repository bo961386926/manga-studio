# 支付与账务一致性审查（T-pay / t2）

- 审查对象：当前工作树，分支 `feat/public-model-platform`，HEAD = `8fd19fd`（工作树除 `.agent-teams/` 外无未提交改动；`git status --short` 仅 `?? .agent-teams/`）。支付闭环 MVP 来自 `b31d90d`。
- 审查视角：上线即真金白银。金额单位、幂等、并发、台账、状态机全部按「一分钱都不能错」标准核对。
- 方法：静态取证（`路径:行号` + 摘录）＋ 进程内针对性复现（`node --input-type=module` 直调服务层函数 + 直连 `manga_studio_test` 数据库）。全部复现用数据已删除（脚本末尾 DELETE，复核 `throwaway users remaining = 0`）。
- 未修改任何源码/配置/迁移；未启动服务；未发起任何真实支付请求。

## 汇总表

| ID | 严重度 | 标题 | 证据位置 | 已复现 |
|----|--------|------|----------|--------|
| PAY-01 | HIGH | 永久 VIP 会被一次续费购买「降级」为限时会员（到期时间被覆盖） | `server/payments/index.js:104-116`、`server/auth/entitlements.js:23-34` | 是 |
| PAY-02 | HIGH | `topupCredits`/`refundCredits` 余额加钱不幂等：先改余额、后插台账且 `ON CONFLICT DO NOTHING` → 重复入账无痕 + 台账与余额漂移 | `server/credits.js:94-104`、`server/credits.js:111-122` | 是（当前无调用方能触发；已用直调复现） |
| PAY-03 | MEDIUM | 管理端「确认入账」缺少二次认证（`requireRecentReauth`）与 `audit_events` 审计留痕 | `server/routes/payments.js:71,81-91`；对照 `server/auth/admin-routes.js:39,47,86,107` | 否（读码确证，缺中间件） |
| PAY-04 | MEDIUM | 支付域全部写接口未挂 `csrfProtection`，仅靠 `SameSite=Lax` 兜底 | `server/routes/payments.js`（无 `csrfProtection`）；`server/auth/session.js:19` | 否（读码确证，缺中间件） |
| PAY-05 | MEDIUM | 无退款/冲正路径、无超时关单：误确认不可回滚，pending 订单无限期挂起 | `server/payments/index.js:48,72,87,147-163`、`server/routes/payments.js:76` | 是（grep 全仓无 `refunded`/`expired` 写入点） |
| PAY-06 | MEDIUM | 对账口径 = 「管理员点过确认的订单」，无法与真实到账比对；已转账未确认的资金无任何报表 | `server/payments/index.js:147-163`、`server/routes/payments.js:86` | 是（读码 + 端点行为确证） |
| PAY-07 | LOW | `resolveSku` 原型链键绕过「未知商品」守卫（`__proto__`/`constructor`/`toString`） | `server/payments/skus.js:10`、`server/payments/index.js:41-42` | 是 |
| PAY-08 | LOW | 下单无幂等键、无频率限制，重复点击可产生多张 pending 订单 | `server/routes/payments.js:31-40`、`components/BillingModal.tsx:84` | 否（读码确证） |
| PAY-09 | LOW | `payment_orders.status` 无 DB 级 CHECK，状态机仅靠应用层约定 | `server/migrations/008_payments.sql:14` | 是（读 DDL 确证） |
| PAY-10 | LOW | `providerRef` 无类型/长度校验 → 超长或非字符串导致 502 而非 422 | `server/routes/payments.js:86`、`server/migrations/008_payments.sql:15` | 否 |
| PAY-11 | LOW | 前端把未知订单状态一律渲染为「已取消」 | `components/BillingModal.tsx:10-15` | 否 |

严重度计数：**BLOCKER 0 / HIGH 2 / MEDIUM 4 / LOW 5**（共 11 条）。

---

## 关键结论（先给判定）

1. **今天的唯一入账入口是安全的**：`confirmOrder` 用「事务 + 条件 UPDATE `WHERE status='pending' RETURNING *`」做原子占位，重复确认/并发确认都在此收敛。已复现：并发两次确认同一订单 → `["OK","ERR:NOT_CONFIRMABLE"]`，积分只在台账留下 1 行，余额只加 1 次。**订单状态机是当前唯一挡住 PAY-02 的东西**。
2. **但账务原语本身是坏的**（PAY-02）：`topupCredits`/`refundCredits` 的余额自增完全没有幂等保护，台账的 `ON CONFLICT DO NOTHING` 会把重复记账「静默吞掉」。一旦出现第二个复用 `refId` 的调用点（真实支付回调、运维重试、退款工具），钱会重复到账且台账无痕——`server/migrations/005_credits.sql:2` 声称的「ledger 是余额争议的唯一事实源」在当前实现下不成立。
3. **永久 VIP 会被购买行为破坏**（PAY-01，已复现）。
4. 金额可信度、整数分单位、余额不为负、扣减幂等这四项是**好的**，见文末「已核对通过」。
5. 没有任何一条属于「上线即坏账」的必然损失（无 BLOCKER）：资金不会因为当前代码路径而自动重复入账。但 PAY-01/PAY-02 必须在**接入真实支付通道之前**修掉，因为通道回调正是 `refId` 复用的高发场景。

---

### [HIGH] PAY-01 永久 VIP 会被一次续费购买「降级」为限时会员

- **证据**：
  - `server/payments/index.js:104-111`
    ```js
    const cur = await client.query(
      `SELECT expires_at FROM user_entitlements
       WHERE user_id=$1 AND entitlement_key='vip' AND enabled=TRUE
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [order.user_id]
    );
    const base = cur.rows[0]?.expires_at ? new Date(cur.rows[0].expires_at) : new Date();
    const expiresAt = new Date(base.getTime() + order.payload.days * 86400000);
    ```
    永久 VIP 的 `expires_at` 是 `NULL`：它**命中**了上面这条 SELECT（`expires_at IS NULL`），但 `cur.rows[0]?.expires_at` 为 `null` → 三元表达式走 `false` 分支 → `base = new Date()`（此刻）。永久身份被当成「没有会员」处理。
  - `server/auth/entitlements.js:26-31`：`grantVip` 用 `ON CONFLICT (user_id, entitlement_key) DO UPDATE SET expires_at = EXCLUDED.expires_at` —— 无条件覆盖成上面算出的有限日期。
  - 永久 VIP 是管理端的**默认**授予方式：`server/auth/admin-routes.js:88` `const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;`（不传 `expiresAt` 即永久）；`server/test/entitlements.test.js:73` 也把 `grantVip({ userId, expiresAt: null })` 当作永久会员用例。
- **影响（多少钱、怎么损失）**：客户拿到的是「终身/长期 VIP」资产（管理员手动授予，常见于补偿、大客户、内部账号）。该客户花 ¥29 买一个月会员后，永久权益被**覆盖销毁**，账户变成 30 天后到期。损伤不是平台多付钱而是**平台销毁了已承诺的权益**：用户投诉/退款压力、需要人工 SQL 修复（而无任何补偿接口，见 PAY-05）。反向同理：任何已经永久 VIP 的账号，一旦购买即等于被强制降级。
- **复现步骤（已实测）**：在 `manga_studio_test` 上创建临时用户 → `grantVip({userId, expiresAt: null, ...})` → 确认 `expires_at = null` → `createOrder({skuCode:'vip_month'})` → `confirmOrder(...)` → 再查 `expires_at`：
  ```
  [A] before purchase, expires_at = null (NULL means permanent)
  [A] after vip_month confirm, expires_at = 2026-11-12T01:33:04.873Z
  [A] VERDICT permanent-preserved = false
  ```
- **建议修复**：把「永久」显式分流，不要用真值判断三元：
  ```js
  const row = cur.rows[0];
  if (row && row.expires_at === null) {
    // 已是永久会员：本次购买不缩短权益，仅记录订单已支付（可选：累加一个「赠送天数」备注）
  } else {
    const base = row?.expires_at ? new Date(row.expires_at) : new Date();
    ...
  }
  ```
  或者更稳妥：把永久表示为远期哨兵值并在 `grantVip` 里保留 `max(旧, 新)` 语义（`expires_at = GREATEST(COALESCE(expires_at, 'infinity'), EXCLUDED.expires_at)`，永久用 `'infinity'`）。
- **验证方式**：`server/test/payments.test.js` 增补用例——先 `grantVip({expiresAt:null})`，再走 `vip_month` 确认，断言 `expires_at` 仍为 `NULL`；同时保留现有「续购叠加」用例（`server/test/payments.test.js:105-117`）不回归。

---

### [HIGH] PAY-02 余额加钱不幂等：先改余额、后插台账且 `ON CONFLICT DO NOTHING` → 重复入账无痕 + 台账漂移

> 这条回应队长转来的网关域线索（`server/credits.js:94-104` 与 `:108-122`）。判定：**线索成立**，但当前**没有可达调用路径**；它与订单状态机的关系是「状态机替账务层兜了底」。

- **证据**：
  - `server/credits.js:91-106`（`topupCredits`）
    ```js
    const { rows: updated } = await client.query(
      `UPDATE credit_accounts SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1 RETURNING balance`,
      [userId, amount]                                  // ← 无条件自增，没有任何幂等条件
    );
    const balanceAfter = updated[0].balance;
    await client.query(
      `INSERT INTO credit_ledger (...) VALUES (...)
       ON CONFLICT (idempotency_key) DO NOTHING`,        // ← 冲突时静默丢弃，但余额已经加过了
      [userId, amount, balanceAfter, reason, refId, `pay:${refId}`]
    );
    ```
  - `server/credits.js:111-122`（`refundCredits`）形状完全相同：先 `balance = balance + $2`，再 `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`。
  - **反证「这是实现疏漏而非设计」**：`server/credits.js:82-86`（`deductCredits`）的台账 INSERT **故意没有** `ON CONFLICT` —— 重复键会抛 23505，整个事务回滚，扣减因此真正幂等。加钱的三条路径里只有扣减做对了，方向恰好相反（重复扣钱有保护，重复加钱没有）。
  - 注释与实现矛盾：`server/credits.js:90` 声称「幂等键 = pay:orderNo（重复确认不会重复加钱）」，而 `server/credits.js:103` 的键实际由调用方传入的 `refId` 拼成（`server/payments/index.js:99` 传的是订单主键 `order.id`）；`server/migrations/005_credits.sql:2` 声称「balance 永不为负；ledger 只增不改，是余额争议的唯一事实源」，而 PAY-02 恰恰使 ledger 与 balance 可以静默分叉且**没有任何一行记录这次分叉**。
- **复现步骤（已实测，两条独立复现）**：
  1. **同一 `refId` 连调两次 `topupCredits`**（两次独立事务）：
     ```
     C after 1st topup(1000):      balance=1200  ledgerSum=1200 ledgerRows=2  drift=0
     C after 2nd topup(1000, SAME refId): balance=2200  ledgerSum=1200 ledgerRows=2  drift=1000
     ```
     → 余额多了 1000，台账毫无痕迹，drift = 1000。
  2. **同一 `refId` 连调两次 `refundCredits`**：
     ```
     D after 1st refund(30):            balance=2230 ledgerSum=1230 ledgerRows=3 drift=1000
     D after 2nd refund(30, SAME refId): balance=2260 ledgerSum=1230 ledgerRows=3 drift=1030
     ```
  3. **对照 `deductCredits` 同一 `refId` 连调两次**（证明差异是加钱/扣钱不对称）：
     ```
     E 1st deduct: OK
     E 2nd deduct threw: 23505
     ```
     第二次抛唯一键冲突、事务回滚，余额不变（`balance=2255` 两次相同）。
- **可达性判定（必须如实说明）**：**当前不可达**。`topupCredits` 的唯一调用点是 `server/payments/index.js:98`，它被 `server/payments/index.js:86-93` 的原子占位保护：
  ```js
  `UPDATE payment_orders SET status='paid', paid_at=NOW(), paid_by_admin=$2,
          provider_ref=COALESCE($3, provider_ref), updated_at=NOW()
   WHERE order_no=$1 AND status='pending' RETURNING *`
  ```
  只有 `pending → paid` 的那一次更新能拿到行，拿不到行就抛 `NOT_CONFIRMABLE`（`server/payments/index.js:93`），入账代码根本不会执行。已复现并发确认：
  ```
  [B] concurrent confirm outcomes = ["OK","ERR:NOT_CONFIRMABLE"]
  [B] balance before/after = 0 / 1200 (credited 1200 expected 1000)   ← 1200 = 200 注册赠送 + 1000 入账
  [B] topup ledger rows = {"c":1,"s":1000}
  ```
  余额确实只加了一次入账金额（额外的 200 是 `ensureCreditAccount` 的注册赠送，`server/credits.js:34-63`），台账 1 行。**订单状态机是安全的，我据此不把它评为 BLOCKER。**
- **触发条件（为什么会变成真事故）**：
  1. `server/payments/index.js:13,25-27` 明确预留了 `alipay_qr / wechat_native / stripe`，注释写着「实现 createPayment 后即可上线」。**真实支付通道的重复回调/重放是支付领域最常见的输入**，而回调处理几乎必然会复用「标记已付 + 入账」这段共享逻辑。若届时以 `providerRef`/交易号作为 `refId` 复用，或状态机被改成多步提交，PAY-02 立刻变成静默重复加钱。
  2. 任何运维手动补账/重试脚本（`server/payments/index.js` 没有提供，但一次性 SQL 或临时脚本很容易写出来）。
  3. 未来的退款/冲正实现（PAY-05 要求补的功能）如果复用 `refundCredits`，天然踩中。
- **建议修复**：让**台账成为幂等的判定者**，把余额自增放在「台账插入成功」之后：
  ```js
  const { rows: ins } = await client.query(
    `INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, idempotency_key)
     VALUES ($1,$2,0,$3,'payment_order',$4,$5)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`, [...]);
  if (!ins[0]) return currentBalance;          // 重复键：什么都不做（余额不动）
  const { rows: updated } = await client.query(
    `UPDATE credit_accounts SET balance = balance + $2, updated_at = NOW()
     WHERE user_id=$1 RETURNING balance`, ...);
  await client.query(`UPDATE credit_ledger SET balance_after=$2 WHERE id=$1`, [ins[0].id, updated[0].balance]);
  ```
  等价的最小改法：给 `UPDATE credit_accounts` 加上
  `AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE idempotency_key = $3)` 并断言 `rowCount = 1`。同一处要同步修 `refundCredits`。
- **验证方式**：单元测试——同一 `refId` 连调两次 `topupCredits`，断言 `balance` 只加一次且 `SELECT SUM(delta) FROM credit_ledger` 与 `credit_accounts.balance` 相等（drift = 0）；补一条对的账函数：`SELECT count(*) FROM (SELECT user_id FROM credit_accounts ca WHERE ca.balance <> COALESCE((SELECT SUM(delta) FROM credit_ledger l WHERE l.user_id=ca.user_id),0)) t` 应为 0。

---

### [MEDIUM] PAY-03 管理端「确认入账」缺少二次认证与审计留痕

- **证据**：
  - `server/routes/payments.js:71`：`adminPaymentsRouter.use(wrap(requireUser), wrap(requireAdmin), adminLimiter);` —— 只有登录 + 角色 + 限流（20 次/分钟，`server/auth/middleware.js:135`）。
  - `server/routes/payments.js:81-91`：确认处理函数体内没有任何 `recordAudit` 调用；唯一的留痕是订单行上的 `paid_by_admin`（`server/payments/index.js:87`）。
  - 项目自身标准（对照）：`server/auth/admin-routes.js:39` `const sensitive = [requireRecentReauth];` 挂在 9 个敏感动作上（`:47,86,107,125,159,184,217,319`），例如授予 VIP `:86`、注册开关 `:125`；`server/routes/migration.js:27` 同样要求二次认证。`auditAdmin`（`server/auth/admin-routes.js:27-36`）为每个管理动作写 `audit_events`。
- **影响**：被窃取的会话 Cookie、或管理员离开时未锁屏的浏览器，可以在 15 分钟窗口之外（实际上 `adminLimiter` 允许 20 次/分钟）连续调用确认接口，凭空铸造任意数量的积分与 VIP——这是全系统「一次请求创造最多资产」的动作，却比「改注册开关」的保护更弱。事后无 `audit_events`，只能靠 `payment_orders.paid_by_admin` 反查，无法回答「谁在什么时候用什么 IP 确认了哪些订单」。
- **复现步骤**：`grep -n "requireRecentReauth\|recordAudit" server/routes/payments.js` → 无输出；`grep -n "sensitive" server/routes/payments.js` → 无输出。（缺中间件类问题无法用请求复现「失败」，故标注读码确证。）
- **建议修复**：`adminPaymentsRouter.use(wrap(requireUser), wrap(requireAdmin), adminLimiter)` 之后，在 `confirm` 路由上加 `...sensitive`（即 `wrap(requireRecentReauth)`），并在确认成功后写审计：
  `recordAudit({ actorUserId: req.user.user_id, targetUserId: order.user_id, eventType: 'admin.payment.confirm', result: 'success', requestId: req.id, ipHash: hashIp(req.ip), metadata: { orderNo, amountCents, kind, providerRef } })`。失败路径同样落 `result: 'failure'`。
- **验证方式**：未在 15 分钟内重新认证的管理员调用确认 → 期望 403 `{error:'reauthentication required'}`；重新认证后确认成功 → 期望 `audit_events` 多出一行 `event_type='admin.payment.confirm'`。前端已有统一的重认证重试入口（`components/admin/AdminPanel.tsx` 的 `runSensitive` / `isReauthError`，确认函数已接），服务端补上即可生效。

---

### [MEDIUM] PAY-04 支付域全部写接口未挂 CSRF 中间件

- **证据**：
  - `server/routes/payments.js` 全文没有 `csrfProtection`；`grep -rn "csrfProtection" server` 的命中只有 `server/index.js:110,132,156,168,198,209,236,253`、`server/routes/model-gateway.js`（11 处）、`server/auth/admin-routes.js:160,185,218`、`server/auth/routes.js:270,295,472`——**支付域 0 处**。
  - 受影响端点：`POST /api/payments/orders`（`server/routes/payments.js:31-40`）、`POST /api/payments/orders/:orderNo/cancel`（`:59-67`）、`POST /api/admin/payments/orders/:orderNo/confirm`（`:81-91`）。
  - 兜底来自 Cookie：`server/auth/session.js:19` `sameSite: 'lax'`。跨站表单 POST 不会带上 Cookie，所以当前不可直接利用。
  - 客户端本来就发 CSRF 头：`services/storageService.ts:50-52`（非 GET 请求附加 `X-CSRF-Token`），所以补上服务端校验不会破坏前端。
- **影响**：不是当下可利用的漏洞（SameSite=Lax 挡住了经典 CSRF），但这是**纵深防御缺口**，且缺口正好开在钱上。项目对 projects/assets/settings/模型网关/管理端全部写接口都做了 CSRF，唯独支付没有——一旦后续为了 iframe 嵌入、跨站跳转回跳或 `SameSite=None`（移动端 WebView 常见）而放宽 Cookie 策略，`POST /api/payments/orders` 与 `/confirm` 会立刻变成可被第三方页面触发的动作。另注：`server/auth/middleware.js:78` 已经把 `Idempotency-Key` 加进 CORS 白名单，说明作者考虑过支付请求的加固，但 CSRF 这一层漏了。
- **复现步骤**：`grep -n "csrfProtection" server/routes/payments.js` → 无输出。请求级复现需构造跨站表单，受 SameSite=Lax 保护不会成功，故不宣称已利用。
- **建议修复**：给上述三个 POST 加 `wrap(csrfProtection)`。
- **验证方式**：带 Session Cookie 但不带 `X-CSRF-Token` 调用 `POST /api/payments/orders` → 期望 403 `{error:'csrf token required'}`；现有 `server/test/payments.test.js` 的 `authHeaders`（`:32`）已经带 `x-csrf-token`，不会回归。

---

### [MEDIUM] PAY-05 无退款/冲正路径、无超时关单：误确认不可回滚，pending 订单无限期挂起

- **证据**：
  - 全仓 `payment_orders` 的写入点只有三处：`server/payments/index.js:48`（INSERT，默认 `status='pending'`）、`:72`（`pending → cancelled`，仅本人）、`:87`（`pending → paid`）。`grep -rn "UPDATE payment_orders" server` 与 `grep -rn "refunded" server components services` 的结果里，`'refunded'` 只出现在 DDL 注释 `server/migrations/008_payments.sql:14` 和查询白名单 `server/routes/payments.js:76`，**没有任何代码写入它**。
  - 同理 `'expired'` 只出现在 `server/routes/payments.js:76` 的白名单里；对比模型网关确实会写 `expired`（`server/model-gateway/gateway.js:282`），说明订单侧是「列了状态但没实现」。
  - 对账只统计 `status='paid'`（`server/payments/index.js:152,160`）。
- **影响**：
  1. **误确认不可回滚**：管理员点错订单（用户其实没转账）→ 积分/VIP 已发放，订单变 `paid`，且 `cancelOrder` 只接受 `pending`、`confirmOrder` 只接受 `pending`，**没有任何接口能把 paid 改回去**。只能人工进数据库改状态——而没有配套的冲正流水（要冲正就得用 `refundCredits`，正好踩 PAY-02 的不幂等）。这与「上线即真金白银」的要求直接冲突。
  2. **已转账未确认 = 资金悬挂且无报表**：manual 渠道下用户先转账、管理员漏确认，订单永久 `pending`。用户侧只能看到「待支付」（`components/BillingModal.tsx:11`），平台侧没有任何报表提示「有一笔 30 天前的 pending 订单」，这笔钱在系统里不存在。金额取决于人工疏漏率。
  3. **pending 表无限增长**：`server/migrations/008_payments.sql:22` 为 `status='pending'` 建了部分索引，无过期清理，索引与表会随挂单单调增长。
- **复现步骤（已实测的部分）**：`grep -rn "refunded\|expired" server --include=*.js` → 除白名单与 DDL 注释外无写入点；尝试「已 paid 订单再确认/再取消」的语义路径读码即知必然 422（`server/payments/index.js:73,89` 的 `status='pending'` 条件），现有测试 `server/test/payments.test.js:119-126` 也锁死了「取消后不可确认」。「退款」这一侧不存在代码，无法构造请求。
- **建议修复**：
  1. 增加管理员「冲正/退款」动作：`paid → refunded`（要求 `requireRecentReauth` + 必填原因 + `audit_events`），并在同一事务里写补偿流水（新增 ledger reason，如 `revoke_order`，用 `refundCredits` 前必须先修 PAY-02），VIP 类订单同时 `revokeVip`（`server/auth/entitlements.js:36-42`）。
  2. 增加定时任务把超过 N 天（建议 7 天）的 `pending` 翻成 `expired`，并在用户侧提示重新下单。
  3. 对账页增加「pending 挂账」金额与最老挂单天数（见 PAY-06）。
- **验证方式**：新增测试——确认订单 → 冲正 → 断言 `status='refunded'`、余额回到冲正前、ledger 出现负向补偿行；以及 `created_at < NOW() - 7 days` 的 pending 订单被定时任务翻为 `expired`。

---

### [MEDIUM] PAY-06 对账口径只覆盖「被点过确认的订单」，无法与真实到账比对

- **证据**：
  - `server/payments/index.js:147-163`：`SELECT ... SUM(amount_cents) FROM payment_orders WHERE status='paid' AND paid_at >= NOW() - ($1 || ' days')::interval GROUP BY 1,2,3`，totals 同口径。
  - `paid_at` 是**确认时刻**而非真实到账时刻：`server/payments/index.js:87` `paid_at=NOW()`（写在这一步的就是「管理员点确认」这个动作）。所以「按日对账」实际是「按管理员操作日对账」，跨日转账会被记到确认日。
  - `provider_ref`（转账凭证号）完全由管理员自由输入、可为空、无校验：`server/routes/payments.js:86` `providerRef: req.body?.providerRef || null`；前端也是「可留空」（`components/admin/AdminPanel.tsx` 的 `window.prompt(..., '')`）。它不参与任何汇总。
  - 管理端 UI 只显示三段直方口径 `reconcile.totals`（`components/admin/AdminPanel.tsx:258-264`：已支付订单/总金额/会员单/积分单）。
- **影响**：manual 渠道下，系统的「营收」定义 = 管理员点击次数 × 订单金额。真实银行/微信/支付宝流水永远不在系统内，因此：① 管理员漏点 → 平台低估营收且用户权益未发放（悬挂，见 PAY-05）；② 管理员误点（用户没转账）→ 报表高估营收，且无退款手段；③ 无法发现「同一用户多张订单只收到一笔钱」这类差错（PAY-08 正是制造这种订单的途径）。上线后第一批客诉大概率来自这里。
- **复现步骤**：调用 `GET /api/admin/payments/reconcile?days=30` 与逐日分组的行为由 `server/payments/index.js:147-163` 唯一决定；已用现有测试 `server/test/payments.test.js:133-142` 确认其口径就是 `status='paid'` 求和（该测试的注释「实际 paid：1×credits_small(990) + 2×vip_month(5800) = 6790」即证明「重复确认不重复计」靠的是状态机而非对账逻辑）。
- **建议修复**：对账页增加三块：① 「已转账未确认」候选列表（pending 且超 24h，按金额/时间排序，便于对银行流水）；② 对账同时输出 pending 挂账金额；③ 把 `providerRef` 改为强提示填写并纳入展示/导出。真正的自动对账须等真实通道回调（届时以通道对账文件为准）。
- **验证方式**：造 1 笔 pending 超 24h 的订单，断言对账端点返回的挂账金额把它算进去、且不计入 `amount_cents` 营收。

---

### [LOW] PAY-07 `resolveSku` 原型链键绕过「未知商品」守卫

- **证据**：`server/payments/skus.js:10` `export const resolveSku = (code) => SKUS[code] || null;`（`SKUS` 是普通对象字面量，`:3-8`）。`server/payments/index.js:41-42` 依赖它做白名单：
  ```js
  const sku = resolveSku(skuCode);
  if (!sku) throw Object.assign(new Error('未知商品'), { code: 'UNKNOWN_SKU' });
  ```
- **复现步骤（已实测）**：
  ```
  {"code":"__proto__","truthy":true}
  {"code":"constructor","truthy":true}
  {"code":"toString","truthy":true}
  {"code":"nope","truthy":false,...}
  {"code":"credits_small","truthy":true,"title":"积分包 · 1000","kind":"credits","amountCents":990,"payload":{"credits":1000}}
  ```
  即 `skuCode='__proto__'` 时守卫不触发，`sku.title/kind/amountCents` 均为 `undefined`，`JSON.stringify(sku.payload)` 为 `undefined`，INSERT 会撞上 `payment_orders` 的 `NOT NULL`（`server/migrations/008_payments.sql:7-12`）与 `CHECK (amount_cents >= 0)` → 抛错 → `server/routes/payments.js:11` 的 `errStatus` 默认 502，并被 `:14` 当成服务端错误 `console.error`。
- **影响**：无资金影响（异常值不会被持久化，订单不会创建）。影响是输入校验契约被破坏 + 错误码语义错误（422 变 502）+ 让外部输入在日志里制造「server error」噪声。
- **建议修复**：`export const resolveSku = (code) => (Object.hasOwn(SKUS, code) ? SKUS[code] : null);`，或改用 `new Map(Object.entries(SKUS))`。
- **验证方式**：`node -e` 断言 `resolveSku('__proto__') === null`；补测试断言 `POST /api/payments/orders {skuCode:'__proto__'}` 返回 422 `UNKNOWN_SKU`。

---

### [LOW] PAY-08 下单无幂等键、无频率限制

- **证据**：
  - `server/routes/payments.js:22` `paymentsRouter.use(wrap(requireUser));` —— `paymentsRouter` 上没有任何 `rateLimit(...)`（对照：`server/auth/middleware.js:125-135` 定义了 login/register/admin 等限流器，支付域一个都没挂）。
  - `server/routes/payments.js:33-37` 直接 `createOrder`，没有读取 `Idempotency-Key`（而 `server/auth/middleware.js:78` 已把该请求头加入 CORS 白名单，说明是预留但未实现）。
  - 前端只按 SKU 维度防重：`components/BillingModal.tsx:84` `disabled={busy === s.code}`、`:48` `setBusy(sku.code)`；`busy` 是单个字符串，因此「先点积分包、再点月度会员」会在两张网络请求各自在途时各建一张订单。
- **影响**：用户误操作或网络重试会得到多张 `pending` 订单（例如两张 ¥29 的 `vip_month`）。系统不会自动重复入账（状态机保护），但用户按订单号转账、管理员按订单号确认时，容易只转一笔却确认两笔（或转两笔），直接放大 PAY-06 的对账难度与客诉。属可上线但需排期。
- **建议修复**：`POST /api/payments/orders` 支持 `Idempotency-Key`（同 key 返回原订单）；或加「同一用户同一 SKU 在 60 秒内复用未支付订单」的收敛逻辑；并给 `paymentsRouter` 挂一条用户级 `rateLimit`（如 10 次/分钟）。
- **验证方式**：带同一 `Idempotency-Key` 连发两次下单 → 断言返回同一个 `orderNo`；无 key 时连发 11 次 → 断言第 11 次 429。

---

### [LOW] PAY-09 `payment_orders.status` 无 DB 级 CHECK 约束

- **证据**：`server/migrations/008_payments.sql:14` `status VARCHAR(16) NOT NULL DEFAULT 'pending',-- pending|paid|cancelled|expired|refunded` —— 合法值是**注释**，不是约束。对比 `server/migrations/005_credits.sql:17-18` 给 `credit_ledger.reason` 就建了真正的 `CHECK (reason IN (...))`。
- **影响**：状态机完全靠应用层三个 UPDATE 语句的 `WHERE status=...` 维持。任何未来的写路径（例如 PAY-05 要新增的冲正）写错字符串（`'refund'`/`'PAID'`）都会被静默接受，导致订单既不在对账口径（`status='paid'`）里、也不再可被确认，钱和权益就此悬空。
- **建议修复**：`ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_status_check CHECK (status IN ('pending','paid','cancelled','expired','refunded'));`（注意与 `server/routes/payments.js:76` 的白名单保持同源）。
- **验证方式**：`UPDATE payment_orders SET status='bogus'` 期望被数据库拒绝。

---

### [LOW] PAY-10 `providerRef` 无类型/长度校验

- **证据**：`server/routes/payments.js:86` `providerRef: req.body?.providerRef || null` → `server/payments/index.js:88` `provider_ref=COALESCE($3, provider_ref)` → 列定义 `server/migrations/008_payments.sql:15` `provider_ref VARCHAR(128)`。
- **影响**：传入对象/数组/超过 128 字符的字符串会触发 PostgreSQL 类型或长度错误（22001/22P02），经 `server/routes/payments.js:11` 的 `errStatus` 默认值返回 **502**（并被 `:14` 记成 server error），而不是 422 参数错误。确认动作此时已回滚（同一事务），无资金影响。
- **建议修复**：`const providerRef = typeof req.body?.providerRef === 'string' ? req.body.providerRef.slice(0,128) : null;`，并把长度/类型错误映射为 422。
- **验证方式**：`POST /confirm {providerRef: {a:1}}` → 期望 422 且订单保持 `pending`。

---

### [LOW] PAY-11 前端把未知订单状态一律显示为「已取消」

- **证据**：`components/BillingModal.tsx:10-15`
  ```js
  const map: Record<string, {...}> = { pending: {...}, paid: {...}, cancelled: {...} };
  const s = map[status] || map.cancelled;
  ```
- **影响**：`expired` / `refunded`（PAY-05 建议补上的两个状态）会被渲染成「已取消」文案与灰色徽章，误导用户以为是自己取消的。当前无写入方，故仅为隐患；一旦补上冲正/过期就会真实发生。
- **建议修复**：未知状态显式渲染为该状态原文的灰色徽章，或在 `map` 中补齐 `expired: '已过期'`、`refunded: '已退款'`。
- **验证方式**：给 `StatusBadge` 传 `'expired'` 断言渲染「已过期」。

---

## 已核对通过（确认「不是问题」的项，避免下游重复劳动）

| 项 | 结论 | 证据 |
|----|------|------|
| 金额是否服务端权威取值 | **是**。`createOrder` 只接收 `skuCode`/`channel`，`title/kind/amountCents/payload` 全部来自 `server/payments/skus.js:3-8` | `server/payments/index.js:40-51`；`server/routes/payments.js:35` 的 `req.body` 只取这两个字段 |
| 货币单位是否整数分（有无浮点） | **是整数分**，无浮点金额。DDL 为 `amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0)`；浮点只出现在展示层 | `server/migrations/008_payments.sql:10`；`server/routes/payments.js:46`、`components/BillingModal.tsx:7`（`/100`） |
| 负数/零元金额 | 被拒。SKU 常量全为正值，且 DDL 有 `CHECK (amount_cents >= 0)` 兜底 | `server/migrations/008_payments.sql:10`；`server/payments/skus.js:4-7` |
| 并发/重复确认是否双倍入账 | **否**（当前唯一路径）。事务 + `WHERE status='pending' RETURNING *` 原子占位，失败方得 `NOT_CONFIRMABLE` | `server/payments/index.js:82-93`；已复现：`["OK","ERR:NOT_CONFIRMABLE"]`、台账 1 行 |
| 是否存在跳过确认直接入账的路径 | **无**。全仓 `status='paid'` 只有 `server/payments/index.js:87` 一处写入，且必须由 `requireAdmin` 触发 | `grep -rn "UPDATE payment_orders" server` 仅 3 处（INSERT/cancel/confirm） |
| 普通用户能否自行把订单标为已付/确认 | **不能**。无用户端确认接口；`cancelOrder` 只写 `cancelled` 且限本人 pending | `server/routes/payments.js:59-67`、`server/payments/index.js:70-78` |
| 订单是否可被越权查看/取消 | **否**。查单有属主校验（他人订单一律 404，不泄露存在性）；取消的 WHERE 同时约束 `order_no` + `user_id` | `server/routes/payments.js:54`、`server/payments/index.js:73` |
| 失败/取消态能否再次入账 | **不能**（`cancelled` 无法再确认，现有测试锁定） | `server/test/payments.test.js:119-126` |
| 余额是否可能为负 | **不可能**。`CHECK (balance >= 0)` + `deductCredits` 先 `FOR UPDATE` 读后比较再扣 | `server/migrations/005_credits.sql:7`、`server/credits.js:69-80` |
| 扣减与入账是否同一事务 | **是**。`confirmOrder` 全程使用同一个 `client`（BEGIN/COMMIT 包裹订单状态、余额、权益、流水） | `server/payments/index.js:82-129`；`grantVip({client})` `server/auth/entitlements.js:23-24` |
| `deductCredits` 幂等 | **正确**。台账 INSERT 无 `ON CONFLICT`，重复键抛 23505 令事务回滚 | `server/credits.js:82-86`；已复现 `E 2nd deduct threw: 23505`，余额不变 |
| VIP 续期叠加（非永久场景） | **正确**。未过期则从当前到期日叠加，现有测试断言两次续购累加约 60 天 | `server/payments/index.js:104-116`；`server/test/payments.test.js:105-117` |
| 到期时间能否被构造为无限 | **不能**。`days` 来自 SKU 常量（30/365），客户端无法传入；永久值只能由管理员显式授予 | `server/payments/skus.js:6-7`、`server/auth/admin-routes.js:88` |
| `PAY_MANUAL_ACCOUNT` 是否被非预期暴露 | **未见暴露**。只在 `createPayment` 的 `instructions` 中返回给「已登录且刚下单的本人」；`GET /payments/skus` 只返回 `key/label`，不含收款说明 | `server/payments/index.js:14,20-23`、`server/routes/payments.js:24-29,37`；`grep` 全仓仅 3 处引用 |
| 迁移顺序与约束名 | **正确**。`009` drop 的 `credit_ledger_reason_check` 与 `005:17-18` 内联 CHECK 的自动命名一致；`db.js` 按文件名 lexical 排序，`009` 在 `008` 之后 | `server/migrations/009_ledger_topup_reason.sql:2-5`、`server/db.js:61` |
| 埋点是否会污染确认结果 | **不会**。`trackEvent` 自带 try/catch 吞掉错误，且在 `COMMIT` 之后调用（浮动 Promise 不会影响响应） | `server/analytics.js:10-20`、`server/payments/index.js:121-122` |

---

## 未验证 / 未覆盖项（如实声明）

1. **未运行 `server/test/payments.test.js` 全量套件**：`server/test/helpers.js:14-22` 的 `resetIdentityTables` 会 `TRUNCATE users ... CASCADE`，而 `manga_studio_test` 库中已有 29 张表的现存数据。为不破坏该库，我改用「进程内直调服务层函数 + 定向 SQL」复现（脚本内自建临时用户，末尾 DELETE，已复核 `throwaway users remaining = 0`）。因此 `PAY-01`/`PAY-02` 的复现是**服务层复现**，不是 HTTP 端到端复现。
2. **未做任何 HTTP 层请求复现**：遵守「禁止启动/重启服务」，未 `app.listen`，未对任何运行中的实例发包。涉及中间件缺失的 `PAY-03`/`PAY-04`/`PAY-08`/`PAY-10`/`PAY-11` 均为读码确证（缺中间件无法用「失败请求」证明），已逐条注明。
3. **未在含存量数据的库上验证迁移 008/009 的真实升级路径**：`009` 是 `DROP CONSTRAINT` + `ADD CONSTRAINT`（`server/migrations/009_ledger_topup_reason.sql:2-5`），会对 `credit_ledger` 全表做校验；行数很大时可能长时间持锁。未实测，属部署域交接项。
4. **未审计真实支付通道**：`server/payments/index.js:25-27` 的 `alipay_qr`/`wechat_native`/`stripe` 全部是抛 `CHANNEL_NOT_CONFIGURED` 的占位实现，无代码可审。PAY-02 的「回调重放」风险是**前瞻性判断**，不是已存在的漏洞。
5. **未审计支付相关的部署/网络层**：nginx 限流、反代 `client_max_body_size`、HTTPS、`COOKIE_SECURE` 对支付会话的影响（属部署配置域）；`PAY_MANUAL_ACCOUNT` 在 `docker-compose.yaml:67` 的注入方式（`${PAY_MANUAL_ACCOUNT:-}`）本人未评估其对配置域的暴露面。
6. **未评估充值对账与运营/财务口径的一致性**（如活动赠送积分是否应计入营收、`signup_grant` 200 分对 `credits_large` 定价口径的影响）——超出代码审查范围，需产品/财务确认。
7. **未验证 `credit_ledger` 的历史漂移**：`PAY-02` 的修复必须假设历史数据可能已存在 `balance <> SUM(delta)` 的分叉（本次审查未查生产库，按只读约束也不应改）。上线前建议先跑一次只读对账查询定位存量差异。

---

## 复核指引（给对抗性复核员）

- 请重点独立验证 **PAY-02 的可达性判定**：如果你的结论是「当前有路径能触发重复加钱」，请给出具体调用链（我是按 `grep` 全仓唯一调用点 `server/payments/index.js:98` + 状态机原子占位得出的「不可达」结论）。这一条决定了是否需要升级为 BLOCKER。
- `PAY-01` 可用一行断言复现（永久 `expires_at=null` → 购买后非 null），建议直接复跑。
- `PAY-03`/`PAY-04` 是「缺中间件」类发现，复核方式应为对照同仓库其它管理端路由（`server/auth/admin-routes.js:39,47,86` 与 `server/routes/model-gateway.js:71,122`）确认标准，而非构造攻击请求。
