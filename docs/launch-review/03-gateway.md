# 03 模型网关与密钥/配额/上游安全审查

- 审查目标：当前工作树（分支 `feat/public-model-platform`，HEAD `8fd19fd`，`git status --porcelain` 仅 `?? .agent-teams/`，即相对 HEAD 无未提交改动）
- 审查范围：`server/model-gateway/*`、`server/routes/model-gateway.js`、`server/routes/migration.js`、`server/migration/legacy-config.js`、`server/credits.js`、`server/db.js`、`server/index.js`、`server/migrations/00*_*.sql`、`services/modelRegistry.ts` / `modelGatewayClient.ts` / `gatewaySetup.ts`、部署脚本
- 取证方式：只读代码审计 + 静态证据链（未启动服务、未连数据库、未向任何上游发请求）
- 结论一句话：**同步链路（chat/image/video/tts）的密钥加密、所有权校验、SSRF 私网拦截、幂等设计基本成立；但「租户隔离实际失效」「异步链路计费与退款系统性错误」「遗留迁移明文存 Key」「密钥不可轮换」四项必须在上线前处理。**

## 汇总表

| ID | 严重度 | 标题 | 证据位置 | 已复现 |
|----|--------|------|----------|--------|
| GW-01 | BLOCKER（条件性） | NODE_ENV 非 production 时凭据退化用公开常量派生密钥，并放行 localhost 上游 | `server/model-gateway/crypto.js:11-18`、`server/model-gateway/upstream.js:79-80`、`server/routes/model-gateway.js:44-46`、`server/package.json:7-8`、`start-all.sh:31` | 静态证据链（未启动服务验证） |
| GW-02 | HIGH | RLS 被超级用户绕过且查询无显式租户过滤 → 跨租户读取 provider/model 元数据 | `server/migrations/003_model_gateway.sql:178-217`、`docker-compose.yaml:46-50`、`server/routes/model-gateway.js:104-118,322-338,397-401` | 静态证据链（未连库验证） |
| GW-03 | HIGH | 异步分支把 image 异步（i2i）按 video 计价：多扣 15 倍，且配额记错维度 | `server/model-gateway/gateway.js:178,201`、`server/routes/model-gateway.js:582-611`、`server/credits.js:10,151-166` | 逻辑可复现（未发真实请求） |
| GW-04 | HIGH | 异步任务失败/取消/超时/下载失败一律不退款；确定性错误被归入 `submission_uncertain` 永不终结 | `server/model-gateway/gateway.js:230-243,273-306,317-327,353-361,364-376` | 静态证据链 |
| GW-05 | HIGH | 遗留迁移路径把厂商 API Key 明文存入 `user_settings`（JSONB，无加密） | `server/migration/legacy-config.js:42-53`、`server/repositories/settings.js:23-29`、`server/migrations/002a_settings.sql:10-16`、`server/test/migration.test.js:93-94` | 单元测试断言即为明文（未运行） |
| GW-06 | HIGH | `MODEL_ENC_KEY` 无 keyring/无重加密工具，轮换即全量凭据不可解密 | `server/model-gateway/crypto.js:7,11-18,36-46` | 静态证据链 |
| GW-07 | MEDIUM | 同一 Idempotency-Key 并发时重复打上游（一次扣费两次厂商调用）并竞争写同一 invocation | `server/model-gateway/gateway.js:129-141,144-172` | 静态证据链 |
| GW-08 | MEDIUM | 同步链路 `uploadResult` 抛错不退款且 invocation 永久停在 `submitting`；`remoteUrl` 分支必然 TypeError | `server/model-gateway/gateway.js:167-172`、`server/routes/model-gateway.js:454-507,721-731` | 静态证据链（deps 形状可静态判定） |
| GW-09 | MEDIUM | 日配额检查在事务外、仅按 `model_invocations` 计数：并发可超限，失败重试白耗配额 | `server/routes/model-gateway.js:524`、`server/credits.js:151-166` | 静态证据链 |
| GW-10 | MEDIUM | 网关无速率限制/无存储配额；150MB JSON + 50MB×16 媒体 + 200MB 结果全缓冲内存 | `server/index.js:56-57`、`server/model-gateway/media.js:35-61`、`server/model-gateway/upstream.js:96-130`、`server/routes/model-gateway.js:760-770` | 静态证据链 |
| GW-11 | MEDIUM | 无后台 worker：任务仅靠用户读取 `GET /jobs/:jobId` 推进，弃单即永不交付 | `server/routes/model-gateway.js:774-811`、`server/model-gateway/gateway.js:273-306` | 静态证据链 |
| GW-12 | MEDIUM | 上游与内部错误原文透传客户端（含私网判定细节） | `server/routes/model-gateway.js:228,797`、`server/model-gateway/discovery.js:43-48`、`server/model-gateway/gateway.js:317-327,353-361` | 静态证据链 |
| GW-13 | MEDIUM | 无主机允许列表：任意公网 https 主机可作上游（盲 SSRF/外呼代理） | `server/routes/model-gateway.js:37-49`、`server/model-gateway/upstream.js:71-94` | 静态证据链 |
| GW-14 | LOW | 结果下载不带厂商鉴权（部分厂商结果 URL 需鉴权 → 401 下载失败） | `server/routes/model-gateway.js:760-770` | 静态证据链 |
| GW-15 | LOW | 预设与 capability 无配对校验；未知视频预设静默回退；`baseUrlOverride` 是唯一未过 `validateBaseUrl` 的 URL 字段 | `server/model-gateway/presets.js:352-381`、`server/routes/model-gateway.js:275,309` | 静态证据链 |
| GW-16 | LOW | 前端遗留注册表仍把 Key 明文写 localStorage 且可直连上游；前端"测试模型"路由不存在；TTS 前端一等能力但服务端不支持（免费无配额死分支） | `services/modelRegistry.ts:34,232-233,558-562`、`services/modelGatewayClient.ts`、`server/routes/model-gateway.js:555`、`server/migrations/003_model_gateway.sql:34`、`server/credits.js:21,151` | 静态证据链 |
| GW-17 | LOW | 前端每次调用生成新 Idempotency-Key，跨重试不幂等 → 超时重试重复扣费 | `services/modelGatewayClient.ts`（`makeIdempotencyKey`） | 静态证据链 |

计数：BLOCKER 1（条件性）、HIGH 5、MEDIUM 7、LOW 4，合计 17。

---

### [BLOCKER（条件性）] GW-01 NODE_ENV 非 production 时凭据退化用公开常量派生密钥，并放行 localhost 上游

- 证据：
  - `server/model-gateway/crypto.js:11-18`
    ```js
    const deploymentKey = () => {
      const raw = process.env.MODEL_ENC_KEY;
      if (!raw && isProd()) throw new Error('MODEL_ENC_KEY is required in production (32-byte hex)');
      return crypto.createHash('sha256').update(raw || 'dev-only-model-enc-key').digest();
    };
    ```
    `isProd = () => process.env.NODE_ENV === 'production'`（`crypto.js:9`）。即：**NODE_ENV 不等于 production 时，密钥缺失不会报错，而是静默使用仓库内公开常量 `dev-only-model-enc-key`** 派生 AES-256-GCM 密钥。`requestHmacKey()` 同构（`crypto.js:20-24`，常量 `dev-request-hmac-key`）。
  - `server/model-gateway/upstream.js:76-80`
    ```js
    if (!secure && !isLocalHttp) throw new Error('insecure protocol');
    const devLocal = isLocalHttp && net.isIP(host) && process.env.NODE_ENV !== 'production';
    if (devLocal) return { url, ip: host };
    ```
    `isLocalHttp`（`upstream.js:75`）判定 `http:` + `localhost`/`127.0.0.1`。非 production 时直接放行本机地址，跳过私网校验。
  - `server/routes/model-gateway.js:37-49` 的 `validateBaseUrl` 只校验 scheme，`localhost` 明文 http 在任何环境都被接受（注释写 "or localhost http in dev"，但**不看 NODE_ENV**）。
  - 触发面：`server/package.json:7-8` `"start": "node index.js"`、`"dev": "node --watch index.js"` 均不设置 NODE_ENV；根目录 `start-all.sh:31-35` 直接 `SERVER_PORT=3001 npm run dev`。`docker-compose.yaml:45` 才设置 `NODE_ENV=production`；仓库 `.env` 无 `NODE_ENV` 行，且服务端未加载 dotenv（无 `dotenv` 依赖、无 `--env-file`）。
- 影响：若生产部署以 `npm start` / `start-all.sh` / `docker run` 方式启动（未显式 `NODE_ENV=production`），则 (1) **全部用户 provider API Key、请求载荷、结果文本都用公开常量派生的密钥加密**，任何拿到数据库/备份的人可直接解密（密钥泄露，命中 BLOCKER 定义）；(2) 上游私网拦截对本机地址失效，用户可把 provider 指向 `http://127.0.0.1:*/`，服务端以其自身身份请求本机服务（可打内网，命中 BLOCKER 定义）。
- 复现步骤（只读证据链，未启动服务）：阅读上述 4 处代码 + 部署脚本；确认启动路径未注入 NODE_ENV 即可。条件验证：`docker-compose.yaml` 路径下不成立（已设 `NODE_ENV=production` 且 `MODEL_ENC_KEY` 缺失会被 compose 拒绝启动）。
- 建议修复：(a) 把「生产」判定改为显式且不可静默的开关（如 `APP_ENV`，或直接要求 `MODEL_ENC_KEY` 必须存在，缺失一律抛错，不再有 dev 常量回退）；(b) 启动时断言 `MODEL_ENC_KEY` 为 64 位 hex；(c) 移除 `upstream.js` 的 `devLocal` 逃逸阀，dev 需要时用显式环境变量（如 `ALLOW_LOCAL_UPSTREAM=true`）并在 production 下硬拒；(d) `start-all.sh` 明确标注为本地开发脚本，生产启动文档统一走 compose。
- 验证方式：`NODE_ENV=production MODEL_ENC_KEY= node -e "import('./server/model-gateway/crypto.js').then(m=>console.log(m))"` 应抛错；非 production 下应显式提示使用 dev key（或同样抛错）。SSRF：非 production 且 `ALLOW_LOCAL_UPSTREAM` 未设时，`http://127.0.0.1:3001/` 必须被拒。

### [HIGH] GW-02 RLS 被超级用户绕过且查询无显式租户过滤 → 跨租户读取 provider/model 元数据

- 证据：
  - `server/migrations/003_model_gateway.sql:178-183` 六张表全部 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`（含 `model_providers`、`models`、`model_credential_versions`、`media_assets`、`model_invocations`、`model_jobs`）。
  - `003_model_gateway.sql:185-217` 只创建了 6 个策略：`providers_visible` / `providers_owner_write` / `providers_owner_update` / `media_owner` / `invocation_owner` / `job_owner`。**`models` 与 `model_credential_versions` 无任何策略**；migrations 全目录无 `CREATE ROLE` / `GRANT` / `FORCE ROW LEVEL SECURITY`。
  - `docker-compose.yaml:46-50` 只注入 `DB_HOST/DB_PORT/DB_NAME/DB_USER=postgres/DB_PASSWORD`，未设 `DATABASE_URL`（实测 `.env`、`.env.example`、`.env.production.example` 中 `DATABASE_URL` 出现 0 次）→ 连接身份为 Postgres 超级用户，**默认 BYPASSRLS**。
  - 查询侧无兜底过滤：`server/routes/model-gateway.js:104-118`（`GET /providers`：`... FROM model_providers WHERE deleted_at IS NULL ORDER BY created_at`，无 `scope`/`owner_user_id` 条件）、`server/routes/model-gateway.js:322-338`（`GET /models`：`... WHERE m.deleted_at IS NULL ...`，无租户条件）、`server/routes/model-gateway.js:397-401`（`loadModel`：`WHERE m.id = $1 AND m.deleted_at IS NULL`，只按 id）。旁证：`server/model-gateway/media.js:47-61` 用裸 `pool.query` 向启用了 RLS 的 `media_assets` 写入且未设置 `app.user_id` GUC——若 RLS 真正生效（NULL 判定为假）该功能会直接失败，说明线上就是 BYPASSRLS 身份。
- 影响：任何已登录用户（含免费用户）可枚举**全部租户**的 provider 名称/`base_url`/`auth_type`/是否已配置凭据，以及全部模型的 `api_model`/`endpoint_path`/`protocol_preset`。这是竞品/攻击者侦察面和信息泄露（内网自建网关地址、企业内部模型名会被暴露）。**凭据本身未泄露**：`GET /providers` 只返回 `(active_credential_version_id IS NOT NULL) AS credential_configured`，密文只由 `loadModel` 内部读取、从不回给客户端，且跨租户调用被 `assertModelAccess`（`server/model-gateway/policy.js:24-52`）以 404 拦住。
- 复现步骤（只读证据链，未连库验证）：新建两个账号 A/B，A 创建私有 provider+模型；以 B 的会话调 `GET /api/model-invocations/providers`、`GET /api/model-invocations/models`，预期返回 A 的记录（因为 SQL 无租户条件且 RLS 不生效）。实际执行需真实数据库，未运行。
- 建议修复：三重兜底，任一都应在合并前落地：(a) 所有租户表查询显式补 `AND (p.scope='shared' OR p.owner_user_id = $userId)`；(b) 用独立的应用角色（`NOBYPASSRLS`）+ `FORCE ROW LEVEL SECURITY` + 为 `models`/`model_credential_versions` 补策略；(c) compose/部署文档禁止用 `postgres` 超级用户连接。
- 验证方式：`server/test/isolation.test.js` 已有跨用户隔离用例（`ensureMigrated`+`resetIdentityTables`+`startTestServer`）；补一条「用户 B 看不到 A 的 private provider 与模型」用例，并用非超级用户角色跑 `npm test`。

### [HIGH] GW-03 异步分支把 image 异步（i2i）按 video 计价：多扣 15 倍，且配额记错维度

- 证据：
  - `server/model-gateway/gateway.js:177-179`
    ```js
    export const createAsyncJob = async ({ userId, isAdmin, model, provider, idempotencyKey, payload, buildRequest, deps }) => {
      const operation = 'video';
    ```
    以及 `gateway.js:200-201`
    ```js
    // 计量扣费：与 job 创建同事务；submission_uncertain 不退款（见实施方案 §5.3）
    const cost = await creditCost(client, 'video');
    ```
    计费操作与 invocation 的 `operation` 都被硬编码为 `'video'`，与 `model.capability` 无关。
  - `server/routes/model-gateway.js:582-611`：`operation === 'image'` 且命中 `resolveImageAsyncPreset(model.protocol_preset)`（当前仅 `dashscope-image-async`，`server/model-gateway/presets.js:352-357`）时，走的正是 `createAsyncJob`。
  - `server/credits.js:10` `export const DEFAULT_PRICES = { chat: 1, image: 2, video: 30 };` → 图片异步每次扣 **30** 分而非 2 分（15 倍）。
  - `server/routes/model-gateway.js:524` 配额以 `capability: model.capability` 判定（image），但 `server/credits.js:158-162` 的计数按 `operation` 统计，而该 invocation 的 `operation` 被写成 `'video'` → image 日配额漏计、video 日配额被图片任务吃掉（VIP video 日配额仅 20）。
- 影响：直接多扣用户积分（资金/信任风险），并使日配额统计与产品定价表不一致；对 VIP 用户，i2i 会挤占其视频额度。
- 复现步骤（未发真实请求）：静态等价复现——构造 `capability='image'` + `protocolPreset='dashscope-image-async'` 的模型，调用 `POST /api/model-invocations/invocations {operation:'image'}`，`DEFAULT_PRICES` 路径下余额减少 30 而非 2，且 `model_invocations.operation` 记录为 `'video'`。
- 建议修复：`createAsyncJob` 增加 `operation` 参数（由路由按 `model.capability` 推导），`creditCost(client, operation)` 用该值；配额计数与 invocation 的 `operation` 统一。
- 验证方式：补单测断言「image 异步任务的扣费额 = `DEFAULT_PRICES.image`、`model_invocations.operation='image'`」；`server/test/credits-quota.test.js` / `dashscope-image-async.test.js` 是合适落点。

### [HIGH] GW-04 异步任务失败/取消/超时/下载失败一律不退款；确定性错误被归入 `submission_uncertain` 永不终结

- 证据：
  - `server/model-gateway/gateway.js:230-243`（提交上游的 `catch` 无参数、不区分错误类型、不退款、不记错误码）：
    ```js
    let taskId;
    try {
      const upstream = await deps.fetchUpstream({ provider, model, operation, payload, buildRequest, parseResponse: deps.parseCreateResponse });
      taskId = upstream.taskId;
    } catch {
      return withUserContext({ userId, isAdmin }, async (client) => {
        await client.query(`UPDATE model_jobs SET status = 'submission_uncertain', updated_at = NOW() WHERE id = $1`, [job.id]);
        return { ...job, status: 'submission_uncertain' };
      });
    }
    ```
    而 `server/routes/model-gateway.js:496-498` 的 caller 对任何非 2xx 抛 `upstream ${status}: ${text}`（确定性错误：401/402/400 等），同样落入该分支。
  - `server/model-gateway/gateway.js:286-291`：`submission_uncertain` 之后没有 `upstream_task_id` → 后续轮询再被置回 `submission_uncertain`；`gateway.js:280-285` 过期仅置 `expired`，**不退款**。
  - `gateway.js:317-327`（上游 `failure`）：置 `failed` + 通知，**无 `refundCredits`**。
  - `gateway.js:353-361`（结果下载失败）：置 `failed`/`DOWNLOAD_FAILED`，**无退款**。
  - `gateway.js:364-376`（取消）：置 `cancel_requested` → `cancelled`，**无退款**。
  - 对照：同步路径 `gateway.js:155-165` 会 `refundCredits(...)` 全额退款。
- 影响：单次 30 分（i2i 场景同额，见 GW-03）在以下任一情况全额损失，且无终止态：厂商返回 4xx（Key 失效、余额不足、参数错误）、厂商任务失败、平台下载失败、用户取消。用户重试会再次扣费。`submission_uncertain` 的记录在无人再轮询时永久停留（24h 后也只有在再次 `GET /jobs/:jobId` 时才被置 `expired`）。
- 复现步骤（未发真实请求）：配置一个 Key 无效（或厂商返回 402）的 provider，调用 `operation:'video'`；余额立即 -30，`GET /jobs/:jobId` 返回 `status:'submission_uncertain'`，余额不恢复。
- 建议修复：(1) 区分「确定性提交失败」（HTTP 4xx / 协议解析失败）→ 立即 `failed` + 全额退款；(2) 仅网络超时/连接中断等真不确定场景保留 `submission_uncertain`，并加 TTL 到期退款或人工对账流程；(3) `cancelJob` 在厂商确认取消后按未消耗退款；(4) `DOWNLOAD_FAILED` 属平台侧失败，应退款或提供补偿入口。
- 验证方式：`server/test/invocation.test.js` 用注入的 mock `fetchUpstream` 断言：上游抛 4xx 后 `credit_accounts.balance` 恢复、`model_jobs.status='failed'`；取消后余额恢复。

### [HIGH] GW-05 遗留迁移路径把厂商 API Key 明文存入 `user_settings`（JSONB，无加密）

- 证据：
  - `server/migration/legacy-config.js:42-53`
    ```js
    if (registry) {
      await setUserSetting(adminId, 'model_registry', { ...registry, migrationOwnership: report.ownership });
    }
    if (apiKey) {
      await setUserSetting(adminId, 'antsk_api_key', apiKey);
    }
    ```
  - `server/repositories/settings.js:23-29`：`INSERT INTO user_settings (user_id, key, value) ... JSON.stringify(value)` —— 原样 JSON 序列化，**无任何加密**。
  - `server/migrations/002a_settings.sql:10-16`：`value JSONB NOT NULL`，未启用 RLS。
  - `server/test/migration.test.js:93-94` 直接断言明文落库：
    ```js
    const storedKey = await getUserSetting(adminId, 'antsk_api_key');
    assert.equal(storedKey, 'sk-secret-key-123456');
    ```
  - 数据来源：`services/modelRegistry.ts:96-101` 把整个遗留 registry（含 `providers[].apiKey`、`model.apiKey` 明文，见 `modelRegistry.ts:587-633`）POST 到 `/admin/migration/model-config`；`server/auth/admin-routes.js:43-54` → `importModelConfig`。
- 影响：与网关侧 AES-256-GCM + AAD 的凭据保护设计直接矛盾——同一个库里既有加密凭据又有**明文**凭据；数据库/备份/快照泄露即可拿到全部被迁移的厂商 Key（可能包含管理员自建/共享 provider 的高价值 Key）。目前没有 HTTP 读取口（`getAllUserSettings`/`getUserSetting` 在 `server/` 内无任何路由调用方），因此不是接口泄露，但仍是「密钥泄露」防线上的实质性缺口。此外明文 Key 无轮换/吊销入口（仅 `clearImportedSettings` 可删，`legacy-config.js:67-71`）。
- 复现步骤：阅读上述 4 处代码；未运行测试（需真实数据库，且会 `ensureMigrated`/清表）。
- 建议修复：(a) 迁移时用 `sealSecret` 加密（`table/owner/record/field` 用 adminId 绑定），或只存「已配置」标记而不落 Key；(b) 迁移完成后立即删除 `model_registry`/`antsk_api_key` 明文条目并回填加密版本；(c) 为 `user_settings` 中敏感键建立加密约定与审计；(d) 更新 `migration.test.js` 断言为「不可逆/已加密」。
- 验证方式：迁移后 `SELECT value FROM user_settings WHERE key='antsk_api_key'` 不应出现 `sk-` 前缀明文；补测试断言存储值不等于输入值且可解密回原值。

### [HIGH] GW-06 `MODEL_ENC_KEY` 无 keyring/无重加密工具，轮换即全量凭据不可解密

- 证据：
  - `server/model-gateway/crypto.js:7` `const DEFAULT_KEY_ID = process.env.MODEL_ENC_KEY_ID || 'v1';`（模块加载时求值一次）。
  - `crypto.js:36-46` `openSecret`：只用**当前** `MODEL_ENC_KEY` 解密，仅校验 `sealed.keyId !== keyId` 字符串相等（`keyId` 由调用方从库中读出传入），没有历史密钥表、没有按 `keyId` 选择密钥的逻辑。
  - 全仓无密钥轮换/重加密实现：`grep -rn "rotate|reencrypt|re-encrypt" server/` 命中项全部是会话/CSRF 相关（`server/auth/session.js:87` 等），与 `MODEL_ENC_KEY` 无关。
  - `crypto.js:16` 缺失时才抛错，且错误信息只提示 "32-byte hex"，但 `crypto.js:17` 实际是 `sha256(raw)`，对输入长度/格式无强校验。
- 影响：`MODEL_ENC_KEY` 一旦怀疑泄露或需要按合规周期轮换，**无法安全轮换**——换新值后所有已存密文（provider 凭据、invocation 请求载荷、结果文本）都因 GCM 认证失败而不可解，表现为调用 502 / `unknown key id` / 解密异常；也没有渐进迁移（双写双读）路径。同时 `MODEL_ENC_KEY_ID` 只是随密文一起记录的标签，改它并不改变解密所用密钥。
- 复现步骤（只读）：阅读 `crypto.js` 全文与上述 grep；不存在任何读取 `MODEL_ENC_KEY_v2` 之类的代码路径。
- 建议修复：引入 keyring——支持 `MODEL_ENC_KEY_v1/_v2...` 多值 + `MODEL_ENC_KEY_ID` 选择当前写密钥；解密按记录中的 `keyId` 选择；提供离线重加密脚本（事务内逐行 re-seal）；启动时校验各密钥格式（64 hex）与 `MODEL_ENC_KEY_ID` 必须存在。
- 验证方式：单测：用 v1 写入 → 切到 v2 仍能读出 v1 数据；重加密脚本跑完后删除 v1 仍可读。

### [MEDIUM] GW-07 同一 Idempotency-Key 并发时重复打上游（一次扣费两次厂商调用）并竞争写同一 invocation

- 证据：`server/model-gateway/gateway.js:129-141`
  ```js
  const id = await insertInvocation(client, { userId, model, operation, idempotencyKey, hash, payload });
  if (!id) {
    const other = await findInvocation(client, { userId, operation, idempotencyKey });
    if (other && other.request_hash !== hash) throw new IdempotencyConflictError();
    return other?.id ?? null;      // 注意：只跳过扣费，没有跳过后续上游调用
  }
  chargedCost = await creditCost(client, operation);
  await deductCredits(client, { userId, cost: chargedCost, refId: id });
  ```
  以及 `gateway.js:144-172`：无论 `invocationId` 来自首次插入还是并发冲突分支，都会继续 `deps.fetchUpstream(...)` 与 `uploadResult(...)`；`gateway.js:155-163` 在 loser 失败时会把同一条 invocation 写成 `failed`（即使 winner 正在成功入库）。
- 影响：同一用户并发重放同一 Idempotency-Key（前端双击、代理重试）会让平台向厂商发起**两次计费调用而只收一次费用**（成本泄漏）；两边还会对同一 invocation/结果指针竞争写入（状态可能被 loser 覆写成 failed，或产生重复媒体资产与 `ref_count`）。
- 复现步骤（未执行）：并发发出两个相同 `Idempotency-Key` 的请求（同一 payload），观察上游收到两次调用、`credit_ledger` 只有一条 `inv:*`。
- 建议修复：`if (!id)` 分支直接查已有 invocation（或 job）并返回其当前状态，不进入上游调用；或对 `(user_id, operation, idempotency_key)` 先 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` 拿到唯一「执行权」令牌后再决定是否调用上游。
- 验证方式：`server/test/invocation.test.js` 增加并发用例，断言 mock 上游只被调用一次、扣费一次。

### [MEDIUM] GW-08 同步链路 `uploadResult` 抛错不退款且 invocation 永久停在 `submitting`；`remoteUrl` 分支必然 TypeError

- 证据：
  - `server/model-gateway/gateway.js:167-172`
    ```js
    return withUserContext({ userId, isAdmin }, async (client) => {
      const result = await uploadResult({ client, userId, invocationId, model, upstreamResult });
      await rewardReferrerOnFirstSuccess(client, userId);
      return result;
    });
    ```
    `uploadResult` 没有 try/catch：抛错时 invocation 停在 `'submitting'`、`error_code`/`error_message` 不写、`refundCredits` 不执行，异常冒泡到路由 502。
  - `server/routes/model-gateway.js:721-731`（`storeSyncMedia` 的 `remoteUrl` 分支）调用 `deps.downloadRemote({ url: ... })`，而 image/video/tts 分支传入的 `deps` 就是 `caller`（`server/routes/model-gateway.js:566,631`），`buildUpstreamCaller`（`server/routes/model-gateway.js:454-507`）**只返回 `{ call }`** → `deps.downloadRemote is not a function` 必然 TypeError。
  - 该分支可达：`presets.js:75-86 parseImageResponse` 在上游返回 JSON 且含 `data[0].url`/`output[0].url` 时返回 `{ remoteUrl }`；`presets.js:97-103 parseVideoSyncResponse` 同理。
- 影响：用户被扣费却拿不到结果、状态无从恢复（`loadInvocationResult` 对无结果的 invocation 返回 `{ kind:'job', status:'submitting' }`，`server/model-gateway/gateway.js:97-112`；且没有 `GET /invocations/:id` 恢复接口）；同步失败会退款、入库失败不退，计费不一致。
- 建议修复：把 `uploadResult` 纳入与上游调用同级的 `try`（或独立 catch 中置 `failed` + 退款）；为 `storeSyncMedia` 补齐 `downloadRemote`（复用 `fetchUpstream`，天然带 SSRF 绑定）或改为直接 `fetchUpstream({ url: remoteUrl, maxBodyBytes })` 下载。
- 验证方式：单测用 mock 上游返回 `{ data:[{ url:'https://example.com/a.png' }] }`，断言返回资产且不再抛 `downloadRemote is not a function`；再补一条「入库失败 → 余额恢复且 invocation=failed」。

### [MEDIUM] GW-09 日配额检查在事务外、仅按 `model_invocations` 计数：并发可超限，失败重试白耗配额

- 证据：`server/routes/model-gateway.js:521-524`
  ```js
  const model = await loadModel({ userId: req.user.user_id, isAdmin, modelId });
  await assertModelAccess({ model, provider: model?.provider, userId: req.user.user_id, isAdmin });
  if (model) await assertDailyQuota({ userId: req.user.user_id, capability: model.capability, isAdmin });
  ```
  配额检查发生在 `invokeSync`/`createAsyncJob` 之前、独立事务中；实现见 `server/credits.js:151-166`：
  ```js
  if (isAdmin || !DAILY_QUOTA_DEFAULTS.free[capability]) return;
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM model_invocations WHERE user_id=$1 AND operation=$2 AND created_at >= date_trunc('day', NOW())`, [...]);
  if (rows[0].c >= limit) throw new PolicyError('QUOTA_EXCEEDED', ..., 429);
  ```
  （无行锁、无与扣费同事务的序列化点；计数包含**已失败并已退款**的 invocation。）
- 影响：并发突发请求可突破日配额上限（积分仍在闸门内，故不是无限盗刷，但与配额产品承诺不符）；上游失败（已退款）仍占用当日配额，用户重试若干次后被 429 拦住，体验与计费语义不一致。
- 建议修复：配额计数与扣费放进同一事务并对账户行加锁（或使用原子计数器/Redis），失败退款时回滚配额计数。
- 验证方式：`server/test/credits-quota.test.js` 增加「并发 N > limit 请求」用例，断言计数不超过 limit；增加「上游失败后配额不消耗」用例。

### [MEDIUM] GW-10 网关无速率限制/无存储配额；150MB JSON + 50MB×16 媒体 + 200MB 结果全缓冲内存

- 证据：
  - `server/index.js:56-57`：`app.use('/api/model-invocations/media-assets', express.json({ limit: '150mb' }));`、`app.use('/api/model-invocations', express.json({ limit: '1mb' }));`。
  - `server/model-gateway/media.js:35-61`：白名单类型 + `sizeBytes > MAX_REFERENCE_BYTES`（50 MiB）→ 413、`count > 16` → 413，随后写本地磁盘（`MEDIA_STORAGE_DIR`），**无单用户/全局容量配额与清理策略**。
  - `server/model-gateway/upstream.js:96-130`：整包缓冲并按 `maxBodyBytes` 断流；调用方给 50 MiB（`server/routes/model-gateway.js:493-494`），结果下载给 `200 * 1024 * 1024`（`server/routes/model-gateway.js:760-770`）。
  - 速率限制：`server/package.json` 无 `express-rate-limit`；`RATE_LIMIT_DISABLED` 只影响登录/注册（`server/auth/middleware.js:107-108`），模型网关路由无任何 limiter 中间件。
- 影响：单用户可持续上传写满磁盘；若干并发 150MB 请求 × Buffer 复制（base64 解码、multipart 序列化、上游响应缓冲）可耗尽内存（DB 池上限 20，无并发闸门）。额度/余额是唯一的滥用闸门。
- 建议修复：网关路由加速率限制与并发上限；媒体存储加用户配额与生命周期清理（含孤儿资产回收）；结果下载改流式写盘；`media-assets` 的 body limit 收敛到「单请求 16 × 50MiB」以下的实际需要。
- 验证方式：压测脚本（在测试环境）并发提交大体积媒体请求，观察 RSS 与磁盘增长上限。

### [MEDIUM] GW-11 无后台 worker：任务仅靠用户读取 `GET /jobs/:jobId` 推进，弃单即永不交付

- 证据：`server/routes/model-gateway.js:774-811`
  ```js
  // Poll-on-read: there is no external worker yet, so each read advances one
  // poll cycle when the job is due. ...
  const dueForPoll = POLLABLE_JOB_STATUSES.has(job.status) && job.upstream_task_id && (!job.next_poll_at || new Date(job.next_poll_at).getTime() <= Date.now());
  ```
  轮询状态机见 `server/model-gateway/gateway.js:273-306`（无 `upstream_task_id` → `submission_uncertain`；过期 → `expired`），退避 `Math.min(5000 * 2 ** Math.min(attempts,6), 300000)`。
- 影响：用户提交视频/i2i 后关闭页面，厂商任务即便成功也不会被下载入库（24h 后仅在再次查询时置 `expired`，且按 GW-04 不退款）；交付成功率取决于客户端是否持续轮询；每次读取只推进一个周期，长任务需要多次读取。
- 建议修复：引入后台轮询 worker（或启动时扫描 `next_poll_at <= NOW()` 的任务），并处理过期任务的退款/对账。
- 验证方式：worker 单测 + 「无客户端读取时任务最终进入终态」用例。

### [MEDIUM] GW-12 上游与内部错误原文透传客户端（含私网判定细节）

- 证据：
  - `server/routes/model-gateway.js:228`：`throw new PolicyError('UPSTREAM_ERROR', e?.message || '模型列表拉取失败', 502);`，而 `server/model-gateway/discovery.js:43-48` 把**上游响应体前 200 字符**拼进 `e.message`。
  - `server/routes/model-gateway.js:797`：`GET /jobs/:jobId` 返回 `errorMessage: job.error_message`。
  - `server/model-gateway/gateway.js:317-327`：`error_message = String(upstream.error || 'upstream failed')`（厂商失败原文）。
  - `server/model-gateway/gateway.js:353-361`：`error_message = String(err.message)`（内部错误，例如 `download upstream 500`，或 `resolveAndBind` 抛出的 `private address` / `insecure protocol`）。
  - 对照：同步调用失败已做脱敏（`server/routes/model-gateway.js:690-694` → `message: 'upstream call failed'`）。
- 影响：泄露厂商错误原文（可能含厂商回显的请求片段）与平台内部网络校验结论；结合 `private address` 之类的文案可用于探测哪些主机名解析到内网（辅助 GW-13 的侦察）。
- 建议修复：对外统一错误码 + 脱敏摘要，完整信息只进服务端日志（`error_message` 内部保留，不下发）。
- 验证方式：单测断言 502 响应体不含上游原文；`GET /jobs/:jobId` 的 `errorMessage` 为固定文案。

### [MEDIUM] GW-13 无主机允许列表：任意公网 https 主机可作上游（盲 SSRF/外呼代理）

- 证据：`server/routes/model-gateway.js:37-49`（`validateBaseUrl` 仅校验能否 `new URL`、以及 `https:` 或 `http:`+localhost，不校验主机是否属于已知厂商）；`server/model-gateway/upstream.js:71-94`（`resolveAndBind` 仅拒绝私网/环回/链路本地/组播与 `metadata.google.internal`，DNS 解析后逐 IP 校验并固定 IP 连接，抗 rebinding）；`server/model-gateway/upstream.js:164-212`（跨源重定向拒绝、POST 重定向拒绝）。
- 影响：任何登录用户都能让服务端向任意**公网**主机发请求（带自定义路径与方法），平台成为外呼/探测代理；响应只有在能被厂商形状解析时才回给用户，`discover-models` 可回读 `/models` 形状 JSON 的 `id` 字段，因此主要是**盲 SSRF**（可用于时序探测、内部仅经公网 DNS 暴露的服务）。误导性：`127.0.0.1`/`169.254.169.254`/RFC1918 已被拦截（`upstream.js:49-67`），本条不是「打内网」级别。
- 建议修复：为主机引入允许列表（或要求 provider 来自 `provider-presets` 目录并校验 host 白名单）；出站走统一代理并记录目标域名；对 `discover-models` 结果做严格 schema 校验。
- 验证方式：单测：`baseUrl='https://example.com'` + 非白名单主机应被拒（或记录告警）；现有 `server/test/no-unsafe-proxy.test.js` 可扩展。

### [LOW] GW-14 结果下载不带厂商鉴权

- 证据：`server/routes/model-gateway.js:760-770`
  ```js
  const transport = callerDeps?.downloadUpstream || fetchUpstream;
  const res = await transport({ url: resourceId, method: 'GET', maxBodyBytes: 200 * 1024 * 1024, timeoutMs: 300000 });
  ```
  未传 `upstreamAuth`（对比 `buildUpstreamCaller` 的 `buildAuth()`，`server/routes/model-gateway.js:461-475`）。
- 影响：需要鉴权的结果 URL（部分厂商）会 401 → `DOWNLOAD_FAILED`（并叠加 GW-04 的不退款）。正面意义：不会把厂商密钥发给第三方结果主机。
- 建议修复：按厂商配置决定是否对结果下载注入凭据（仅当 host 与 provider base 同源时），或改由厂商 SDK 提供的带鉴权下载。
- 验证方式：mock 上游返回需鉴权的资源 URL，断言下载路径按策略注入/不注入 Authorization。

### [LOW] GW-15 预设与 capability 无配对校验；未知视频预设静默回退；`baseUrlOverride` 未过 URL 校验

- 证据：
  - `server/model-gateway/presets.js:380-381` `resolveVideoAsyncPreset = (protocolPreset) => VIDEO_ASYNC_PRESETS[protocolPreset] || OpenAIVideoAsync;` → `openai-video-sync`（在白名单 `presets.js:8-16` 内且可由 `POST /models` 创建）会被当作**异步** openai 形状处理。
  - `server/routes/model-gateway.js:270-312`：`capability` 只校验枚举（`L279`），`protocolPreset` 只校验白名单（`L280-282`），二者不校验组合；`baseUrlOverride` 直接入库（`L275`、`L309` `baseUrlOverride || null`），是唯一未过 `validateBaseUrl` 的 URL 字段（`base_url_override` 在 `resolveUpstreamUrl` 中优先级最高，`server/routes/model-gateway.js:444-449`）。
- 影响：错误组合产生静默的错误路由/协议不匹配（表现为难以诊断的 502）；`baseUrlOverride` 绕过创建期 URL 校验（调用期仍有 `resolveAndBind` 兜底，故未升级为安全问题）。
- 建议修复：建立 preset↔capability 映射表并在创建时校验；未知 preset 报错而非回退；`baseUrlOverride` 走 `validateBaseUrl`。
- 验证方式：单测：`capability='video' + preset='openai-video-sync'` 应 422；非法 `baseUrlOverride` 应 422。

### [LOW] GW-16 前端遗留注册表仍把 Key 明文写 localStorage 且可直连上游；"测试模型"路由不存在；TTS 前后端能力不一致

- 证据：
  - `services/modelRegistry.ts:34,43`（`window.localStorage`）、`services/modelRegistry.ts:232-233` `setConfig(API_KEY_STORAGE_KEY, state.globalApiKey)`、`services/modelRegistry.ts:558-562` `setGlobalApiKey` 写入 registry；`getApiKeyForModel`（`modelRegistry.ts:587-633`）把明文 Key 交给 `services/geminiService.ts` 的浏览器直连上游分支（该文件有 `[API Request] ... URL: ${fullUrl}` 等日志，未打印 Key 明文）。
  - `services/modelGatewayClient.ts` 的 `testModel` 调 `POST /model-invocations/test`，服务端无该路由（`server/routes/model-gateway.js` 全文无 `'/test'`）→ 前端"测试模型"必然 404。
  - TTS：`services/gatewaySetup.ts:15,32` 把 `tts` 当一等能力（`capabilityLabels.tts='配音'`），`server/routes/model-gateway.js:555` 有 `operation==='tts'` 分支，但 `server/migrations/003_model_gateway.sql:34` `CHECK (capability IN ('chat','image','video'))` 且 `POST /models` 拒绝 tts（`server/routes/model-gateway.js:279`）→ 该分支为死代码；同时 `server/credits.js:21` `if (!DEFAULT_PRICES[operation]) return 0;` 与 `credits.js:151-152`「不在 free 配额表即放行」使 tts 既免费又无配额（当前不可达，但一旦有人放开 CHECK 就是免费无闸门通道）。
- 影响：遗留路径与新网关路径共存，明文 Key 仍可留在浏览器（XSS/共享终端风险）；功能按钮 404；能力矩阵前后端不一致，未来放开 TTS 时无计费与配额保护。
- 建议修复：上线前确认并下线/隐藏遗留注册表入口（或至少移除 localStorage 明文持久化与浏览器直连分支）；补 `/test` 路由或移除前端按钮；TTS 要么补齐 `DEFAULT_PRICES.tts` + 配额 + DB CHECK，要么从 UI 能力表移除。
- 验证方式：UI 走查 + 单测：`capability='tts'` 的创建请求应被明确拒绝并给出提示；`grep -rn "localsStorage.*apiKey"` 不再命中。

### [LOW] GW-17 前端每次调用生成新 Idempotency-Key，跨重试不幂等 → 超时重试重复扣费

- 证据：`services/modelGatewayClient.ts` 中 `makeIdempotencyKey(action) = `${action}-${randomUUID()}``，`invokeChat/invokeImage/invokeVideo` 在**调用时**生成并放入请求头，未做「同一逻辑请求复用同一 Key」的持久化。
- 影响：请求在服务端已成功但响应丢失（超时/断网）时，用户重试会带新 Key → 再次扣费并再次调用厂商（重复计费）。服务端幂等保护无法覆盖此场景。
- 建议修复：把 Key 与「待发送请求」一起持久化（内存 + 失败重试复用），或由服务端按「用户 + 模型 + payload 指纹 + 短时间窗」去重。
- 验证方式：单测断言同一逻辑请求重试时复用同一 Idempotency-Key。

---

## 已核实「无问题」清单（避免复核重复劳动）

1. **凭据加密算法与绑定**：AES-256-GCM、96-bit CSPRNG nonce、AAD 绑定 `table/owner/record/field/keyId`（`server/model-gateway/crypto.js:26-46`），生产缺失 `MODEL_ENC_KEY` 时 fail-closed（`crypto.js:16`），compose 亦强制注入（`docker-compose.yaml:56-57`）。
2. **密钥不回显**：`GET /providers` 只给 `credential_configured` 布尔（`server/routes/model-gateway.js:104-118`）；`POST /providers/:id/credential` 只回 `{success, credentialConfigured}`（`L120-162`）；`GET /models` 不含 `base_url`；错误响应统一脱敏（`L690-694`）。密文只在 `loadModel` 内部读取（`L397-401`）。
3. **SSRF 私网拦截**：`isPrivateAddress` 覆盖 10/127/0/169.254/172.16-31/192.168/≥224 与 IPv6 环回/链路本地/ULA/`::ffff:`（`server/model-gateway/upstream.js:49-67`），`metadata.google.internal` 显式拒绝（`L26,81`），DNS 解析后**固定 IP 连接**防 rebinding（`L82-93`、`L96-130`），跨源重定向拒绝 + POST 重定向默认拒绝（`L164-212`）；实测语义上 `127.0.0.1`/`169.254.169.254` 无法经 provider `base_url` 触达。
4. **媒体所有权与体积**：`media.js:28-33` 强制 `user/<userId>/` 前缀（防路径穿越），`getMediaRecord/deleteMedia` 均带 `user_id` 条件（`L63-70,82-90`），`uploadMedia` 首行强制 50MiB/类型/数量校验（`L47-61`），输入仅接受 data URL（`L97-105`）。
5. **上游请求不可被客户端指定目标**：`targetUrl` 由客户端提供即抛错（`upstream.js:139`），客户端 headers 逐个过黑名单（含 `host`/`cookie`/`authorization`/`x-forwarded-*`）（`upstream.js:10-34`），凭据仅由服务端注入（`upstream.js:36-47`、`routes:461-475`）。
6. **并发透支**：`deductCredits` 在事务内 `SELECT ... FOR UPDATE` + `balance < cost` 抛 402（`server/credits.js:66-88`），DB 层另有 `CHECK (balance >= 0)`（`server/migrations/005_credits.sql:5-8`）；扣费 `idempotency_key='inv:'+refId` 唯一（`credits.js:85`、`005_credits.sql:22`）→ 同一 invocation 不可能重复扣费。
7. **余额/额度为 0 会拦住**：`CREDIT_REQUIRED` 402（`credits.js:74-76`）；chat/image/video 均有定价（`credits.js:10`），无「未定价即免费」的可达路径（tts 见 GW-16）。
8. **`provider-presets.js` 清单干净**：9 家厂商全为公网官方端点 + 官方控制台链接，无测试残留、无内网地址、无个人 Key；`listProviderPresets()` 仅返回协议元数据不含凭据字段（`server/model-gateway/provider-presets.js:205-231`）。
9. **前端新网关客户端不送凭据/目标地址**：`modelGatewayClient.ts` 只发 `modelId + operation + 业务参数 + Idempotency-Key`（文件头注释 + 三个 invoke 函数）。
10. **`.env` 未被 git 跟踪**（`.gitignore:31:.env`；`git ls-files .env` 报未跟踪）→ 不是仓库级密钥泄露。`.env` 中 `MODEL_ENC_KEY`/`REQUEST_HMAC_KEY` 是长度 23/26 的 `$(openssl rand -hex 32)` 形态**字面量**（未展开），部署域需确认生产 `.env` 的实际取值——若原样上生产，等于使用可预测字符串派生加密密钥（与 GW-01 同性质，归部署域处置）。

## 未验证 / 未覆盖项

**未验证（附原因）**
1. 全部「复现」均未实际执行：约束禁止启动/重启服务、禁止连库、禁止向真实上游发请求。因此 GW-01/02/03/04/07/09/10/11 均为静态证据链 + 逻辑推演，标记为「未运行验证」。
2. 未运行 `server/test/*.test.js`：测试需真实 Postgres（`ensureMigrated`、`resetIdentityTables`、`startTestServer`、`pool.end()`），会执行迁移并清表，违反本次「只读为主」约束。建议由 CI/部署域在隔离库执行 `NODE_ENV=test DB_NAME=manga_studio_test npm test`，重点看 `isolation`、`no-unsafe-proxy`、`credits-quota`、`invocation`、`dashscope-image-async`、`tts-preset`、`provider-scope-policy`。
3. 生产实际部署形态未确认：无法判断生产是否严格走 `docker-compose.yaml`（若走 `npm start`/`start-all.sh`，GW-01 由「条件性」升级为确定 BLOCKER）。需部署域交叉确认。
4. 生产 `.env` 实际值未（也不应）读取：`.env` 中 `MODEL_ENC_KEY`/`REQUEST_HMAC_KEY` 为 23/26 字符的字面量占位形态，是否为真实密钥由部署域确认。
5. 数据库实际角色权限未验证（未连库）：GW-02 的「BYPASSRLS」是由「迁移无 CREATE ROLE/GRANT」+「compose 用 postgres」+「无策略的表仍能写入（media.js 裸 pool）」推导；建议用 `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user` 确认。
6. `model_snapshot` 字段写而不读（`grep model_snapshot` 仅 `gateway.js:204` 的 INSERT）→ `base_url_override`/`auth_override_type` 变更对已提交任务的影响未评估（轮询时 `loadModel` 重新读取当前模型行，`routes:789`）。
7. 未对前端 UI 做可达性核查（遗留注册表入口是否仍在菜单/路由中渲染），GW-16 的「仍可达」未验证。
8. 未审计支付侧回调（`topupCredits` 的「先加钱后记流水」不幂等在 `server/credits.js:91-106`，仅记录，归支付账务域）与 `rewardReferrerOnFirstSuccess` 的邀请奖励刷取面。

**未覆盖（明确不在本次取证范围）**
- 认证/会话/CAPTCHA/CSRF 细节（除网关路由已确认 `router.use(requireUser)` + 各写路由 `csrfProtection`）。
- nginx/TLS/容器加固、备份恢复、构建与依赖漏洞（其他域负责）。
- 前端 XSS 与 CSP 对 localStorage 明文 Key 的放大效应（GW-16 已提，未量化）。

## 建议处置顺序（供队长汇总）

1. GW-01（确认生产启动路径；若无法保证 `NODE_ENV=production` 则按 BLOCKER 阻断上线）。
2. GW-02（跨租户元数据泄露：加显式 WHERE 是低成本高收益修复）。
3. GW-03 / GW-04（计费与退款：直接影响用户资金与信任，建议与支付账务域合并出「退款状态机」方案）。
4. GW-05 / GW-06（密钥治理：明文迁移数据 + 轮换能力）。
5. GW-07～GW-13（并发、幂等、配额、资源、worker、错误脱敏、主机白名单）。
6. GW-14～GW-17（功能性/一致性改进项，可随版本排期）。
