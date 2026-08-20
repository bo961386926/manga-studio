# 受认证保护的自建云端模型接入设计

## 1. 背景与依赖

漫剧工场目前由浏览器保存模型注册表和密钥，并通过未认证的 `/api/ai-forward` 把客户端提交的任意 `targetUrl`、Header 和请求体转发到上游。该结构在公网环境中会形成匿名通用代理，也无法保证不同用户的模型配置和密钥隔离。

本设计依赖《用户身份、访问控制与 VIP 权益设计》先行完成。所有模型调用必须建立在有效服务端会话、用户数据隔离、VIP/共享模型授权、审计和限流之上。

目标是在保持现有内置模型业务行为的前提下，支持用户自行部署的文本、图片、同步视频和异步视频模型；支持统一网关或分别部署；支持 Provider 默认配置、单模型覆盖及无鉴权、Bearer Token、自定义 API Key Header。

## 2. 稳定性与安全原则

### 2.1 保留业务语义，不保留不安全传输契约

- 现有内置模型的提示词、参数、响应解析和厂商特殊模式尽量保持不变。
- 不借本需求统一或重写所有厂商 Adapter。
- 先为现有文本、图片和视频请求建立 golden/characterization tests。
- 新自建协议使用独立模块。
- 公网安全要求优先于旧代理契约；未认证任意转发接口必须下线。

### 2.2 服务端拥有模型资源和密钥

- 前端只提交 `modelId`、操作名和业务参数。
- 服务端从登录会话确定 user ID，验证模型归属、共享授权和 VIP 权益。
- 服务端解析 Provider、固定 Endpoint 和鉴权，并注入上游凭证。
- 前端不能提交上游 Base URL、任意目标 URL、上游 Authorization 或自定义鉴权 Header。

### 2.3 协议预设而非通用编排

```ts
type ProtocolPreset =
  | 'openai-chat'
  | 'openai-image'
  | 'openai-video-sync'
  | 'openai-video-async';
```

第一版不支持任意 JSON 模板、脚本、JSONPath、动态 Header 或通用 API 编排。无法满足预设协议的服务需在自有网关完成转换，或以后新增经过审查的专用适配器。

## 3. 总体架构

```text
Web / Electron
  -> 已认证业务请求（Cookie + CSRF）
  -> POST /api/ai/models/{modelId}/{operation}
  -> 会话、状态、VIP/共享授权、限流
  -> 加载用户或共享模型
  -> 解析 Provider 与模型覆盖
  -> 解密服务端凭证
  -> 固定协议 Adapter 构造上游请求
  -> 安全上游 HTTP Client
  -> 标准化结果或创建服务端任务记录
  -> 用量记录与脱敏审计
```

调用者不能选择服务器未保存的 origin。状态轮询和结果下载使用服务端生成的 job ID，不接受任意资源 URL。

## 4. 必要的现有系统触点

“稳定优先”不再表述为完全零改动。公网安全和真实业务接入要求以下受控修改：

1. `storageService`：所有 API 请求携带 Cookie/CSRF，401 时清理用户状态。
2. `modelRegistry`：前端只保存非敏感模型元数据；移除密钥 localStorage 持久化；自建模型不受旧关键词清理规则影响。
3. `apiClient`：从任意 URL 转发改为 `modelId + operation` 请求，并贯通 AbortSignal。
4. `geminiService`：在实际使用的文本、流式文本、图片和视频入口最前面按协议预设分流；内置模型原有请求构造逻辑由特征测试保护。
5. `services/adapters/*`：新自建协议独立实现；旧 Adapter 仅做调用安全传输层所需的最小调整。
6. `server`：新增用户级 Provider/Model/密钥存储、安全模型网关、任务记录、HTTP 安全策略和用量记录。
7. Electron：连接同一个 HTTPS 后端，不内嵌模型代理或数据库。

真实业务分流至少覆盖普通文本、JSON 文本、续写/改写流式 helper、角色/场景/关键帧图片、同步视频和异步视频。

自建文本第一版不提供真正流式上游转发。现有流式业务选择 `openai-chat` 时使用非流式请求，完成后一次性调用现有回调；UI 明确该模型不提供逐字输出。内置模型原流式行为不变。

## 5. 服务端数据模型

### 5.1 Providers

```sql
CREATE TABLE model_providers (
  id UUID PRIMARY KEY,
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('private', 'shared')),
  name VARCHAR(120) NOT NULL,
  base_url TEXT NOT NULL,
  auth_type VARCHAR(32) NOT NULL CHECK (
    auth_type IN ('none', 'bearer', 'api-key-header')
  ),
  auth_header_name VARCHAR(128),
  active_credential_version_id UUID,
  timeout_ms INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (scope = 'private' AND owner_user_id IS NOT NULL)
    OR (scope = 'shared' AND owner_user_id IS NULL)
  )
);
```

只有管理员可创建 `shared` Provider。VIP 用户只能创建自己的 `private` Provider。

### 5.2 Models

模型不重复保存 owner/scope，而是从 Provider 派生，避免两份租户字段漂移：

```sql
CREATE TABLE models (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES model_providers(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  api_model VARCHAR(255) NOT NULL,
  capability VARCHAR(16) NOT NULL CHECK (
    capability IN ('chat', 'image', 'video')
  ),
  adapter_kind VARCHAR(64) NOT NULL,
  protocol_preset VARCHAR(64),
  endpoint_path TEXT NOT NULL,
  base_url_override TEXT,
  auth_override_type VARCHAR(32),
  auth_override_header_name VARCHAR(128),
  auth_override_credential_version_id UUID,
  timeout_ms INTEGER,
  capabilities JSONB NOT NULL DEFAULT '{}',
  protocol_config JSONB NOT NULL DEFAULT '{}',
  access_level VARCHAR(16) NOT NULL CHECK (
    access_level IN ('verified', 'vip', 'admin')
  ),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    auth_override_type IS NULL
    OR auth_override_type IN ('none', 'bearer', 'api-key-header')
  )
);
```

- `adapter_kind` 标识现有专用 Adapter 或自建协议 Adapter。
- `protocol_preset` 只用于自建协议。
- Provider 为 `private` 时，其模型天然归属于同一 `owner_user_id`；Provider 为 `shared` 时，其模型天然为共享模型。
- VIP 用户只能在 `SELECT ... FOR UPDATE WHERE provider.id=$1 AND provider.owner_user_id=req.auth.userId AND scope='private' AND enabled=TRUE AND deleted_at IS NULL` 成功的同一事务中创建模型。
- 共享 Provider 下的模型只能由管理员创建；普通用户不能从共享 Provider 派生模型。
- `access_level` 只控制共享模型；私有模型只允许 Provider owner 调用，创建和调用均要求有效 VIP。
- Provider/Model 默认软删除。存在 job/usage 的资源不得物理级联删除；后台清理按保留策略执行。

数据库启用并强制 RLS，应用运行账号不是表 owner。每个事务用 `SET LOCAL app.user_id/app.is_admin` 绑定认证上下文；GUC 缺失、格式非法或事务回滚时 policy fail closed。写入模型的约束触发器锁定 Provider 并验证上述 owner/scope/enabled/deleted_at 规则。创建、更新、猜测其他 Provider UUID、普通用户写共享 Provider 均有负向测试。

当 `base_url_override` 的规范化 origin 与 Provider origin 不同，模型必须配置完整独立鉴权覆盖（包括显式 `none`）；禁止继承 Provider 凭证。相同 origin 才可继承 Provider 鉴权。该规则在保存事务和调用时双重校验。

### 5.2.1 Credential versions

Provider 或 Model 的凭证替换不覆盖仍被排队 job 使用的版本。正规化凭证版本表保存加密值：

```sql
CREATE TABLE model_credential_versions (
  id UUID PRIMARY KEY,
  provider_id UUID REFERENCES model_providers(id) ON DELETE CASCADE,
  model_id UUID REFERENCES models(id) ON DELETE CASCADE,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  tag BYTEA NOT NULL,
  encryption_key_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  CHECK ((provider_id IS NOT NULL) <> (model_id IS NOT NULL))
);

ALTER TABLE model_providers
  ADD CONSTRAINT model_providers_active_credential_fk
  FOREIGN KEY (active_credential_version_id)
  REFERENCES model_credential_versions(id);
ALTER TABLE models
  ADD CONSTRAINT models_override_credential_fk
  FOREIGN KEY (auth_override_credential_version_id)
  REFERENCES model_credential_versions(id);
```

Provider/Model 当前配置只引用 active credential version；job snapshot 固定该 version UUID。版本只有在没有未终态 job 引用时才可物理清理。

`auth_type='none'` 时 Provider 的 active version 必须为 NULL；Bearer/API-Key Header 必须引用所属 Provider 的 version。Model 的 override type 为 `none` 时 override version 必须为 NULL，其他 override type 必须引用同一 Model 的 version。job 的 nullable version 与 snapshot 中固定的 `authType/headerName` 一起决定调用，绝不回退到当前新凭证。

### 5.3 异步任务

```sql
-- Migration order: create media_assets and model_invocations before model_jobs.
CREATE TABLE model_jobs (
  id UUID PRIMARY KEY,
  invocation_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_snapshot JSONB NOT NULL,
  credential_version_id UUID REFERENCES model_credential_versions(id),
  upstream_task_id TEXT,
  upstream_resource_id TEXT,
  status VARCHAR(32) NOT NULL CHECK (status IN (
    'created', 'submitting', 'submission_uncertain', 'queued', 'polling', 'succeeded',
    'failed', 'cancel_requested', 'cancelled', 'expired'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_poll_at TIMESTAMPTZ,
  lease_owner VARCHAR(128),
  lease_expires_at TIMESTAMPTZ,
  error_code VARCHAR(64),
  error_message VARCHAR(500),
  result_origin TEXT,
  result_url_ciphertext BYTEA,
  result_url_iv BYTEA,
  result_url_tag BYTEA,
  result_url_key_id VARCHAR(64),
  result_object_key TEXT,
  result_content_type VARCHAR(128),
  result_size_bytes BIGINT,
  cancel_requested_at TIMESTAMPTZ,
  upstream_cancel_confirmed BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE model_invocations
  ADD CONSTRAINT model_invocations_id_user_unique UNIQUE (id, user_id);
ALTER TABLE model_jobs
  ADD CONSTRAINT model_jobs_invocation_owner_fk
  FOREIGN KEY (invocation_id, user_id)
  REFERENCES model_invocations(id, user_id)
  ON DELETE RESTRICT;
```

只向前端暴露内部 job UUID。上游 task ID、resource ID 和结果 URL 不能成为客户端选择目标的依据。

上游 task/resource ID 可能包含租户信息，日志中必须掩码；带签名结果 URL 使用与模型凭证相同的 AEAD 机制加密，或只保存在受限对象存储任务元数据中。

Job 状态机与执行规则：

1. 先以用户提供的 idempotency key、规范化请求哈希和 AEAD 加密请求 payload 创建 invocation，再以 invocation ID 创建 `created` job；AAD 绑定 invocation/job/user/model/operation。同 key 同 hash 返回原 invocation，不同 hash 返回冲突。
2. worker 通过 `FOR UPDATE SKIP LOCKED` 获取带过期时间的 lease，再进入 `submitting`；多实例只能有一个有效 lease owner。
3. worker 从 invocation 解密请求 payload；上游支持幂等 Header 时透传 invocation 的内部确定性 key；上游创建成功后必须在同一事务中持久化 task ID、credential version 和 `queued/polling` 状态。
4. 若连接在获得确定响应前断开且上游不支持幂等查询，进入 `submission_uncertain`，禁止自动重提以免重复收费；管理员可按审计 request ID 对账后绑定 task ID、标记失败或允许重试。
5. 轮询失败按上限和指数退避更新 `attempt_count/next_poll_at`；进程重启由恢复扫描重新领取过期 lease。
6. 成功媒体写入受限对象存储或受大小限制的流式响应，job 只保存 object key/元数据；不把大 Base64 放入数据库。
7. `cancel_requested` 表示用户希望停止。如果协议配置了受支持的上游 cancel endpoint，则尝试取消并记录是否确认；否则只停止本地后续轮询，并明确提示“上游任务可能继续运行和计费”。
8. 终态 job 保留模型不可变快照和脱敏错误；按保留策略清理对象、签名 URL 和过期 job。

任何 lease 过期的 `submitting` job 默认转为 `submission_uncertain`，不得直接重新提交；只有上游提供相同幂等 key 查询或已证明安全重放时才可恢复。必须注入测试“上游成功后、数据库提交 task ID 前进程崩溃”，验证不会重复创建收费任务。

`model_snapshot` 只包含协议版本、Provider/Model UUID、规范化 origin、endpoint、api_model、能力配置和 credential version ID，绝不复制凭证明文或凭证密文。排队任务固定创建时的 credential version；Provider 凭证替换不影响已提交任务。

源参考媒体在 job 终态前通过对象版本或 job 专用引用保留；用户删除原媒体只减少普通引用，不删除 job 仍需要的对象。终态后按媒体保留策略释放引用。

### 5.4 媒体资产

现有 `assets` 表继续表示角色/场景 JSON 资产库，不把它当作二进制媒体表。新增专用媒体表：

```sql
CREATE TABLE media_assets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type VARCHAR(128) NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('uploading', 'ready', 'failed', 'deleted')),
  ref_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

对象 key 由服务端生成并带 user/job namespace；bucket 默认私有。接口为：

```text
POST /api/media-assets              # multipart 上传，返回 MediaRef
GET  /api/media-assets/{id}/content # owner 校验后流式读取
DELETE /api/media-assets/{id}       # 软删除，等待 ref_count 为 0 清理
```

上传限制：单文件最大 50 MiB、图片/视频 MIME 白名单、每请求最多 16 个文件、每日每用户默认 2 GiB。`GET` 只允许已认证 owner 或其 job owner，设置 `Content-Disposition: attachment`、`X-Content-Type-Options: nosniff`，不支持未授权 Range 穿透。

新业务使用：

```ts
type MediaRef = { kind: 'media'; id: string; contentType: string; sizeBytes: number };
```

`MediaRef` 是新网关和项目 JSON 的规范表示。为兼容现有 Stage，阶段 3 过渡 DTO 暂时使用 `string | MediaRef`：旧字符串只允许在 UI 展示和迁移边界出现；进入新网关前由 `ensureMediaRef()` 上传/解析为 MediaRef，网关响应的 `AssetResultV1` 映射回 MediaRef。需要 `<img>/<video>` 播放时由客户端通过已认证 content API 获取临时 object URL，不把公开远程 URL 写回项目。

项目迁移顺序为：先创建/导入 media_assets，再替换项目 JSON 中的 Data URL/已知本地媒体引用为 MediaRef，最后启用只接受 MediaRef 的新网关。无法导入的旧远程 URL 只保留展示字符串并标记 `legacy_unimported`，重新生成前必须由用户重新上传。

旧 URL/Data URL 只作为兼容输入；在进入新模型网关前必须由前端一次性上传成 MediaRef，服务端不抓取任意远程 URL。旧项目中的远程 URL 若无法由用户导入，则保留为展示引用但不能作为新模型参考图；迁移和首次使用导入均写入用户确认报告。

### 5.5 统一调用幂等记录

所有可能收费的 chat/image/video/test 调用先创建统一 invocation：

```sql
CREATE TABLE model_invocations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id UUID REFERENCES models(id) ON DELETE SET NULL,
  operation VARCHAR(32) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  request_payload_ciphertext BYTEA NOT NULL,
  request_payload_iv BYTEA NOT NULL,
  request_payload_tag BYTEA NOT NULL,
  request_payload_key_id VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN (
    'created', 'submitting', 'submission_uncertain', 'succeeded',
    'failed', 'cancelled'
  )),
  lease_owner VARCHAR(128),
  lease_expires_at TIMESTAMPTZ,
  upstream_request_id VARCHAR(255),
  result_media_asset_id UUID REFERENCES media_assets(id),
  result_text_ciphertext BYTEA,
  result_text_iv BYTEA,
  result_text_tag BYTEA,
  result_text_key_id VARCHAR(64),
  result_json_ciphertext BYTEA,
  result_json_iv BYTEA,
  result_json_tag BYTEA,
  result_json_key_id VARCHAR(64),
  error_code VARCHAR(64),
  error_message VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, operation, idempotency_key)
);
```

`request_hash` 使用部署秘密 HMAC，而不是可字典枚举提示词的裸 SHA-256。所有收费调用（包括 chat 和 test）都必须要求 `Idempotency-Key`，并在向上游发出前落库 invocation；Chat/Test 的小结果使用 AEAD 加密字段保存，图片/视频保存 MediaRef。每个非空结果字段必须同时保存对应的 `*_key_id`；其 AAD 固定绑定 invocation、user、model、operation、结果字段名和 key ID，轮换后按显式 key ID 选择当前或受支持的旧密钥，不能遍历密钥或静默回退。响应丢失后的相同 key 读取原结果，不重复收费。上游成功但进程在结果落库前崩溃时进入 `submission_uncertain`，无上游幂等查询不得自动重提。异步 `model_jobs` 一对一引用 invocation；test 调用也使用相同机制。

## 6. 凭证所有权与加密

模型凭证使用应用层 AES-256-GCM 加密，主密钥来自部署环境或密钥管理服务：

```env
MODEL_CREDENTIAL_KEY_ID=v1
MODEL_CREDENTIAL_KEY_BASE64=
```

- 数据库分别保存 ciphertext、IV、tag 和 key ID。
- 主密钥不进入数据库、API 响应或日志。
- 生产环境缺少有效主密钥时，服务拒绝启动模型网关。
- 密钥轮换使用显式任务；读取阶段允许当前密钥和有限旧密钥集合。
- 每次加密使用 CSPRNG 生成唯一 96-bit nonce，禁止在同一 key 下复用。
- AAD 绑定表名、记录 UUID、Provider owner、字段名、auth type 和 key ID；跨行、跨用户或跨字段交换密文必须解密失败。
- 解密或 tag 校验失败时 fail closed、产生脱敏安全告警，不回退到其他凭证。
- 轮换任务保持相同 AAD 语义，并覆盖中断恢复和跨行密文交换测试。

配置 GET 只返回鉴权类型、`credentialConfigured` 和掩码。更新使用显式动作：

```ts
type CredentialUpdate =
  | { action: 'keep' }
  | { action: 'replace'; value: string }
  | { action: 'remove' };
```

### 6.1 鉴权真值表

| 模型覆盖 | Provider | 结果 |
|---|---|---|
| `none` | 任意 | 不发送鉴权并终止回退 |
| `bearer` + credential | 任意 | 模型 Bearer |
| `api-key-header` + credential/header | 任意 | 模型自定义 Header |
| 未覆盖 | `none` | 不发送鉴权 |
| 未覆盖 | `bearer` + credential | Provider Bearer |
| 未覆盖 | `api-key-header` + credential/header | Provider 自定义 Header |
| 配置不完整 | 任意 | 保存或调用时 fail closed |

自建路径不使用其他 Provider Key、旧 `mixed` 模式或全局 Key 兜底。上游鉴权只发送到最终有效 Provider origin；跨 origin 重定向默认拒绝且绝不携带原鉴权。

## 7. 有效配置与 URL 规则

解析优先级为“模型覆盖 > 所属 Provider > 协议默认值”。

- Base URL 必须是绝对 `https:`；开发环境可允许 localhost `http:`。
- URL 禁止 username、password 和 fragment。
- Endpoint 必须以 `/` 开头，只能是相对路径，禁止 scheme 和 authority。
- Base URL 可包含固定路径前缀；使用统一 URL builder，不能简单字符串拼接。
- 模板只允许 `{taskId}`、`{resourceId}`，值作为单一 path segment 编码。
- 模型 Base URL override 受同一管理员网络策略约束。

视频同步/异步由 `protocol_preset` 唯一决定。保存时校验模型类型与 preset 映射；旧 `params.mode` 仅服务旧 Adapter，不参与自建协议分流。

`capabilities` 与 `protocol_config` 必须带 `schemaVersion: 1` 并通过版本化 TypeScript/JSON Schema 校验。视频能力结构为：

```ts
interface VideoCapabilitiesV1 {
  schemaVersion: 1;
  supportsStartFrame: boolean;
  supportsEndFrame: boolean;
  allowedSizes: string[];
  allowedDurations: number[];
  maxFrameBytes: number;
}

interface ChatCapabilitiesV1 {
  schemaVersion: 1;
  supportsJsonResponseFormat: boolean;
  maxPromptBytes: number;
}

interface ImageCapabilitiesV1 {
  schemaVersion: 1;
  maxReferenceImages: number;
  allowedSizes: string[];
  maxImageBytes: number;
}
```

未知版本、未知必填字段或超出服务端安全上限时拒绝保存，不把任意 JSONB 直接传给 Adapter。

## 8. 协议预设线格式

### 8.1 `openai-chat`

默认端点 `/v1/chat/completions`，固定非流式请求：

```json
{
  "model": "configured-model-name",
  "messages": [
    {"role": "system", "content": "optional system prompt"},
    {"role": "user", "content": "prompt"}
  ],
  "temperature": 0.7,
  "max_tokens": 8192,
  "stream": false
}
```

可选 capability `supportsJsonResponseFormat`；为 true 且业务要求 JSON 时发送 `response_format: {type: 'json_object'}`。成功响应必须包含 `choices[0].message.content` 字符串。

### 8.2 `openai-image`

```ts
interface OpenAiImageProtocolConfig {
  schemaVersion: 1;
  generationEndpoint: string; // /v1/images/generations
  editEndpoint: string;       // /v1/images/edits
  maxReferenceImages: number; // 0..16
  responseFormat: 'b64_json' | 'url';
}
```

无参考图时向 generation endpoint 发送 JSON：

```json
{
  "model": "configured-model-name",
  "prompt": "prompt",
  "size": "1280x720",
  "n": 1,
  "response_format": "<configured b64_json or url>"
}
```

有参考图时向 edit endpoint 发送 multipart；字段为 `model`、`prompt`、`size`、`response_format`，每张图片以重复 `image` 字段按原顺序发送。文件必须通过 MIME、数量和解码后大小校验。

响应支持 `data[0].b64_json`、`data[0].url`、`output[0].url` 或直接 `image/*` 二进制。结果 URL 通过受控下载流程获取，不由浏览器任意直连。

### 8.3 `openai-video-sync`

默认端点 `/v1/videos/generations`，发送固定 JSON：

```json
{
  "model": "configured-model-name",
  "prompt": "prompt",
  "size": "1280x720",
  "duration": 8,
  "image_url": "optional start-frame data URL",
  "end_image_url": "optional end-frame data URL"
}
```

起止帧字段只在 capability 声明支持时发送。响应支持 `data[0].url`、`data[0].b64_json`、`url`、`video_url` 或直接 `video/*` 二进制。

### 8.4 `openai-video-async`

```ts
interface OpenAiVideoAsyncProtocolConfig {
  schemaVersion: 1;
  createEndpoint: string;   // /v1/videos
  statusEndpoint: string;   // /v1/videos/{taskId}
  contentEndpoint: string;  // /v1/videos/{resourceId}/content
  cancelEndpoint?: string;  // 可选；未配置时只能停止本地轮询
  pollingIntervalMs: number;
  maxPollingTimeMs: number;
}
```

创建使用与同步视频相同的固定 JSON。创建响应识别 `id`、`task_id`。状态字段为 `status`：

- 等待：`queued`、`pending`、`processing`、`running`；
- 成功：`completed`、`succeeded`；
- 失败：`failed`、`error`、`cancelled`。

结果依次识别 `url`、`video_url`、`download_url`、`output.url`、`video_id`、`output.id`、`id`；错误识别 `error.message`、`message`、字符串 `error`。缺少字段视为协议错误。

Content endpoint 只接受直接 `video/*` 二进制，或 JSON 中的 `url`、`video_url`、`download_url`。JSON URL 再经过同一 SSRF/重定向策略下载；HTML、未知 MIME、无上限 Base64 JSON 和其他结构一律拒绝。

默认轮询 5 秒，最小 1 秒；默认总等待 20 分钟，最大 60 分钟。前端只轮询内部 job API。

## 9. 安全模型网关 API

```text
POST /api/ai/models/{modelId}/chat
POST /api/ai/models/{modelId}/images
POST /api/ai/models/{modelId}/videos
GET  /api/ai/jobs/{jobId}
POST /api/ai/jobs/{jobId}/cancel
GET  /api/ai/jobs/{jobId}/content
POST /api/ai/models/{modelId}/test
```

API 使用版本化 DTO：

```ts
interface ChatInvokeV1 {
  schemaVersion: 1;
  prompt: string;          // UTF-8 <= 256 KiB
  systemPrompt?: string;   // UTF-8 <= 64 KiB
  responseFormat?: 'text' | 'json';
}

interface ChatResultV1 {
  schemaVersion: 1;
  kind: 'chat';
  content: string;
  responseFormat: 'text' | 'json';
}

interface ImageInvokeV1 {
  schemaVersion: 1;
  prompt: string;          // UTF-8 <= 256 KiB
  aspectRatio: '16:9' | '9:16' | '1:1';
  referenceAssetIds?: string[]; // <= 16 UUIDs
}

interface VideoInvokeV1 {
  schemaVersion: 1;
  prompt: string;          // UTF-8 <= 256 KiB
  aspectRatio: '16:9' | '9:16' | '1:1';
  duration: number;        // only configured allowed durations
  startAssetId?: string;
  endAssetId?: string;
}

type AssetResultV1 = {
  schemaVersion: 1;
  kind: 'asset';
  assetId: string;
  contentType: string;
  sizeBytes: number;
};

type JobAcceptedV1 = {
  schemaVersion: 1;
  kind: 'job';
  jobId: string;
  status: string;
};
```

- Chat 成功返回 `200 ChatResultV1`；图片与同步视频成功返回 `200 AssetResultV1`；异步视频返回 `202 JobAcceptedV1`。
- 图片/视频引用服务端 `assetId`，不允许任意远程 URL；服务端读取前验证资产 owner、MIME 和大小。单次图片最多 16 张参考图；视频最多 2 个帧引用，每个引用最大 50 MiB，prompt 最大 256 KiB。
- 所有可能收费的 chat/image/video/test 调用都要求 `Idempotency-Key` Header；同用户/operation/key 同 hash 返回原结果，不同 hash 返回 `409 IDEMPOTENCY_CONFLICT`。客户端必须在业务重试期间复用同一 key，服务端按 invocation 保留期处理过期 key。
- job 查询、取消和内容必须使用 `WHERE id=$jobId AND user_id=req.auth.userId`；不存在和他人 job 统一返回 `404`，防止 IDOR。
- `GET /jobs/{id}/content` 只对 succeeded job 返回受限流式媒体；不把大媒体放入 JSON Base64。
- 错误统一为 `{schemaVersion:1,error:{code,message,requestId,retryable}}`，使用明确的 400/401/403/404/409/413/422/429/502/504；不返回上游原始正文或 stack。
- `test` 对图片/视频要求请求体 `confirmCharge: true`，否则返回 `409 CHARGE_CONFIRMATION_REQUIRED`。

共同处理顺序：验证会话/邮箱/CSRF；加载模型；验证 owner/shared/VIP/enabled；应用限流；校验参数和媒体；解析固定 Provider/Endpoint；解密并注入凭证；安全调用上游；记录脱敏 usage/audit；返回标准结果或内部 job ID。

旧 `/api/ai-forward` 在前端完成切换后删除。过渡期只能在非生产环境通过显式 flag 启用并要求管理员认证；生产启动检测到该 flag 时拒绝启动。

## 10. 上游 HTTP 安全

### 10.1 网络策略

- 公网 HTTPS 默认允许；HTTP 只允许开发环境 localhost。
- 私网、环回、链路本地和保留地址默认拒绝。
- 管理员可配置精确域名、IP 或 CIDR allowlist；普通用户不能修改。
- 云元数据地址和已知 metadata hostname 永久拒绝。
- 规范化 IPv4、IPv6、IPv4-mapped IPv6 和特殊数字表示后判断。
- 域名全部 A/AAAA 结果都必须符合策略。

### 10.2 DNS 与重定向

- 手动重定向并限制最大跳数。
- 每跳重新解析、执行网络策略和 origin 策略。
- 连接固定到已校验 IP，同时保留 hostname 用于 Host/TLS SNI，消除 DNS 重绑定窗口。
- 跨 origin 重定向默认拒绝；无鉴权结果下载也必须重新校验且不得携带原凭证。
- POST 创建类请求默认不跟随 301/302/303；307/308 也默认拒绝，只有 Adapter 明确允许、请求体可安全重放且目标同 origin 时才可按协议配置跟随。GET 状态/内容请求仍逐跳校验。

### 10.3 Header、超时和大小

上游 Header 由服务器 Adapter 生成。禁止客户端传 Authorization、Cookie、Host、逐跳 Header、Forwarded 系列和预设外 Header。

自定义 API Key Header 名即使来自服务端配置也必须通过 RFC token 校验，并大小写不敏感地拒绝：`Host`、`Cookie`、`Authorization`、`Proxy-Authorization`、`Connection`、`Keep-Alive`、`TE`、`Trailer`、`Transfer-Encoding`、`Upgrade`、`Content-Length`、`Forwarded`、`Via`、所有 `X-Forwarded-*` 以及 Adapter 保留字段。保存和调用时双重校验，非法配置 fail closed。

每个请求定义连接、Headers、Body idle 和总超时；浏览器 AbortSignal 贯通同步调用。异步任务不因页面断开自动取消，只响应显式 cancel。Nginx 与应用超时必须形成一致预算。请求体、单文件、文件数、Base64 解码后数据、错误体和最终媒体均有限制；二进制使用流式转发或受限对象存储，不使用无上限 `arrayBuffer()`。

### 10.4 日志

只记录 request ID、用户 ID、模型 ID、目标 origin、operation、状态、耗时和字节数。不得记录完整查询值、Header 值、Cookie、CSRF、密码、模型凭证、正文、完整提示词、Base64、签名 URL 或生产 stack。

## 11. UI 与用户流程

配置 API 明确区分私有与管理空间：

```text
GET/POST        /api/model-providers
GET/PATCH/DELETE /api/model-providers/{providerId}
GET/POST        /api/models
GET/PATCH/DELETE /api/models/{modelId}
GET/POST        /api/admin/shared-model-providers
GET/PATCH/DELETE /api/admin/shared-model-providers/{providerId}
GET/POST        /api/admin/shared-models
GET/PATCH/DELETE /api/admin/shared-models/{modelId}
```

普通 Provider 路由只返回当前用户私有资源；`GET /api/models` 返回当前用户私有模型及其有权使用的共享模型，但共享条目不暴露 Provider 地址或鉴权元数据。普通 POST/PATCH/DELETE 只能操作当前用户私有资源。管理路由要求 admin 和近期密码再认证。创建/更新 DTO 使用版本化 schema、凭证 keep/replace/remove 和原子事务；响应只返回掩码状态。

- VIP 用户可创建私有 Provider 和私有模型；管理员可创建共享 Provider/模型。
- 凭证只显示“已配置”，编辑时选择保持、替换或删除。
- 自建模型使用独立 draft editor，一次 Save 原子校验，避免半配置状态。
- 高级 Base URL/鉴权/超时覆盖默认折叠。
- 共享模型配置 `verified`、`vip`、`admin` 访问级别。
- Provider 测试区分 DNS、TLS、HTTP 可达；404/405 不能表示鉴权成功。
- 图片/视频模型测试可能收费，必须主动确认；保存不自动生成。

## 12. 兼容与迁移

### 12.1 旧注册表迁移

1. 备份现有 `config` 并生成只读迁移报告；
2. 内置 Provider/模型定义迁为 `shared`、owner NULL，由管理员确认 `verified/vip/admin` access level；
3. 旧自定义 Provider/模型迁为 bootstrap admin 的 `private` 资源；
4. Provider 专属 Key 只绑定对应 Provider；模型专属 Key 只绑定对应模型；
5. 旧全局 Key 不复制到多个 Provider，迁移报告要求管理员人工选择唯一目标或创建 admin private 兼容 Provider；
6. 加密写入正规化表，并为内置模型设置专用 `adapter_kind`；
7. 保存旧 ID/API model name 到新 UUID 的明确映射并迁移全局激活模型；
8. 扫描并迁移 `projects.data.shotGenerationModel` 等项目内模型引用；同名映射歧义时停止并要求管理员选择，不静默回退；
9. 验证旧项目重新生成分镜，以及文本、图片、同步/异步视频 golden tests；
10. 前端响应移除完整密钥，并在确认服务端导入成功后清除浏览器旧密钥缓存。

服务器 migration 只能迁移已成功保存到数据库的数据。为处理后端写入曾失败、浏览器持有唯一副本的情况，bootstrap admin 首次登录提供一次性“旧模型配置导入”向导：

- Web 端只能扫描当前远端 origin 的已知 key。Electron 旧 localhost origin 无法被远端页面跨 origin 读取，因此发布顺序固定为：先发布桥接版本增加“导出加密迁移包”功能；用户在旧 Electron 中导出后，再在新远端 Web 应用中导入。新版本不实现本地迁移窗口，也不能假设远端向导能读取旧 localStorage；
- 只扫描 `manga_studio_model_registry`、`antsk_api_key`、`manga_studio_model_config` 三个已知 key；
- 同时解析字符串 JSON 和对象 JSON，先在本地展示脱敏摘要；
- 只有管理员明确确认后，才通过专用一次性导入 API 上传；
- 服务端按上述 private/shared/Key 规则校验、加密和生成报告；
- 导入成功且管理员再次确认后才删除本地副本；失败保持原数据并可重试；
- API 在该部署完成一次导入或管理员明确跳过后永久关闭；
- 普通用户不能使用该迁移入口。

迁移包使用独立、版本化的 AEAD envelope，仅允许这三个已知配置 key、项目内媒体/模型引用摘要和必要凭证。v1 envelope 至少包含 `format_version`、`kdf`（推荐 Argon2id 参数 `salt`、`memory_kib`、`iterations`、`parallelism`）、`nonce`、`ciphertext`、`tag` 和 `aad_context`；明文不含解密密钥。桥接版本导出时由管理员设置一次性迁移口令（不复用登录密码），口令只用于本地 Argon2id 派生包密钥，参数随 envelope 保存；导入时管理员在远端向导中再次输入口令，服务端仅在内存中解密并立即擦除口令/明文。若部署不允许口令输入，则改用一次性恢复密钥：导出端仅显示一次，用户通过独立安全渠道输入远端向导，恢复密钥绝不与文件同包。AAD 绑定部署迁移 ID、导出用户、格式版本和固定用途字符串；版本、KDF、tag 或 AAD 校验失败时拒绝导入并删除内存明文，不覆盖现有配置。导出文件由用户自行保管，导入成功后服务端和客户端都擦除临时副本。桥接版本的导出、远端版本的导入、错误口令、密钥丢失和失败恢复分别有端到端测试。

迁移报告逐项列出旧 ID、新 UUID、scope、owner、access level、credential 状态和项目引用数量，不显示完整密钥。

### 12.2 关键词清理

现有按 ID 包含 `gpt`、`claude`、`gemini`、`sora`、`veo` 删除模型的规则不得作用于正规化模型。迁移只针对明确废弃内置 ID，不按关键词删除用户模型。测试覆盖这些名称的保存、重载和激活。

### 12.3 旧代理下线

生产开放前，代码搜索和运行测试必须证明没有前端路径发送 `targetUrl` 或上游鉴权 Header。之后删除 `/api/ai-forward`，路由测试确认 404。

### 12.4 删除与保留

Provider/模型 API 默认执行软删除并立即禁止新调用。Job 和 usage 保存不可变模型快照，不因模型删除丢失；运行中 job 存在时拒绝物理删除。对象媒体、job、usage 和审计分别按管理员保留策略清理。

## 13. Electron

Electron 首版只有一种模式：本地设置页配置服务器后，BrowserWindow 直接加载该 HTTPS origin 的远端 Web 应用；登录、Cookie、CSRF、VIP、Provider、模型和任务 API 全部同源。不打包 Express 网关、PostgreSQL 或模型密钥，不提供本地任意代理。BrowserWindow 强制 `sandbox: true`、`nodeIntegration: false`、`contextIsolation: true`、`webSecurity: true`，不注入远端 preload；权限请求默认拒绝，外链交给系统浏览器。服务器切换清理旧会话，证书错误不自动忽略，导航限制到配置服务器。Android 不在本轮范围。

## 14. 测试策略

### 14.1 改造前特征测试

- 现有文本、JSON、流式请求构造和响应解析；
- 现有图片无参考图、多参考图调用；
- 现有视频各模式创建、轮询、下载；
- 当前激活模型和注册表重载；
- 真实 Stage 页面入口 smoke tests。

### 14.2 配置与权限

- 私有资源 owner 隔离；共享资源管理员管理；
- RLS/约束触发器拒绝猜测他人 Provider UUID、普通用户写共享 Provider、私有模型引用共享 Provider；
- 跨 origin Base URL override 在继承 Provider 凭证时拒绝，独立 `none`/独立凭证时按策略验证；
- 自定义鉴权 Header 名 RFC token、保留 Header 拒绝及保存/调用双重校验；
- verified/VIP/admin access level；
- VIP 到期阻止新调用但保留配置；
- 凭证 keep/replace/remove 和掩码响应；
- 鉴权真值表与 `none` fail-stop。

### 14.3 协议 contract tests

- 四类协议精确请求快照；
- chat JSON 开关和非流式降级；
- image generation/edit、多文件顺序/MIME/大小；
- 同步视频起止帧能力；
- 异步 ID、状态、错误、结果和超时；
- job idempotency、lease、多实例竞争、崩溃恢复、退避、取消语义和对象清理；
- URL、Base64、二进制响应和缺失字段错误。

### 14.4 网关安全测试

- 身份和权益矩阵；客户端不能提交目标或鉴权 Header；
- 非法协议/URL/Endpoint；公网、私网 allowlist、元数据永久拒绝；
- 多 A/AAAA、mapped IPv6、特殊 IP；DNS 连接绑定；
- 同/跨 origin 重定向和 Header 剥离；
- 大小、流式媒体、超时、取消；
- 日志与 usage/audit 脱敏。
- 用户 A 的 job ID 对用户 B 始终表现为 404；
- AES-GCM nonce 唯一性、AAD 绑定、跨行密文交换失败和轮换恢复；

### 14.5 回归与三端

- 内置文本、图片和视频 golden tests；
- Web、Docker 端到端测试；
- Electron 连接 HTTPS 后端完成登录、模型选择和调用；
- 生产环境不存在旧任意代理；
- 自建协议使用本地受控 mock upstream 验证。
- 一次性浏览器旧配置导入、明确跳过、失败保留和成功清除；
- 项目内旧模型引用迁移后可重新生成分镜。
- `submitting` lease 过期转 uncertain、上游成功后 DB 提交前崩溃注入；
- job credential version 和源媒体 refcount/版本保留；
- media_assets owner、MIME、对象 key、配额、Range 和 content API 隔离；
- 同步 invocation 在响应丢失重试时复用结果，裸提示词不能从 request hash 反推；
- 结果密钥轮换后按 `*_key_id` 成功重放 Chat/Test 幂等结果，未知 key ID fail closed；
- Electron 远端页面不能读取旧 localhost localStorage，受信导出/迁移窗口和 renderer hardening。
- Electron 迁移 envelope 的口令 KDF/一次性恢复密钥独立交付、AAD 校验、错误清除和跨版本导入。

## 15. 验收标准

- 统一网关或独立服务均可配置文本、图片和视频模型。
- Provider/Model 严格归属用户或管理员共享空间。
- 单模型可覆盖 Base URL、鉴权、Endpoint 和超时。
- 支持无鉴权、Bearer、自定义 API Key Header。
- 前端读取不到完整凭证，不能控制任意目标或上游鉴权。
- 四类协议通过 contract tests。
- 用户不能调用其他用户私有模型；共享模型遵守访问级别。
- 凭证不跨 Provider 或全局串用。
- 私网只按管理员 allowlist 开放，云元数据永久拒绝。
- 内置模型行为通过特征回归，自建常见模型名重载不消失。
- Web、Docker、Electron 共享同一安全后端。
- 生产环境不存在未认证任意转发接口。

## 16. 非目标

- 任意请求模板、脚本、JSONPath 或通用 API 编排；
- OpenAI Responses API；
- 自建文本真正流式转发；
- 自动识别任意厂商私有协议；
- 统一重构现有所有厂商 Adapter；
- 用户积分、计费、购买和兑换；
- 用户自定义私网 allowlist；
- Electron 内嵌数据库或代理；
- Android 客户端。

以上能力需要独立设计，不能在实现阶段顺带加入。
