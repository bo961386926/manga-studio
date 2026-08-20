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
  credential_ciphertext BYTEA,
  credential_iv BYTEA,
  credential_tag BYTEA,
  credential_key_id VARCHAR(64),
  timeout_ms INTEGER,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
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

```sql
CREATE TABLE models (
  id UUID PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('private', 'shared')),
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
  auth_override_ciphertext BYTEA,
  auth_override_iv BYTEA,
  auth_override_tag BYTEA,
  auth_override_key_id VARCHAR(64),
  timeout_ms INTEGER,
  capabilities JSONB NOT NULL DEFAULT '{}',
  protocol_config JSONB NOT NULL DEFAULT '{}',
  access_level VARCHAR(16) NOT NULL CHECK (
    access_level IN ('verified', 'vip', 'admin')
  ),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (scope = 'private' AND owner_user_id IS NOT NULL)
    OR (scope = 'shared' AND owner_user_id IS NULL)
  ),
  CHECK (
    auth_override_type IS NULL
    OR auth_override_type IN ('none', 'bearer', 'api-key-header')
  )
);
```

- `adapter_kind` 标识现有专用 Adapter 或自建协议 Adapter。
- `protocol_preset` 只用于自建协议。
- 共享模型只能引用共享 Provider。
- `access_level` 控制共享模型调用权益。
- 私有模型只允许 owner 调用，创建和调用均要求有效 VIP。

### 5.3 异步任务

```sql
CREATE TABLE model_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES models(id),
  upstream_task_id TEXT,
  upstream_resource_id TEXT,
  status VARCHAR(32) NOT NULL,
  result_origin TEXT,
  result_url_ciphertext BYTEA,
  result_url_iv BYTEA,
  result_url_tag BYTEA,
  result_url_key_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
```

只向前端暴露内部 job UUID。上游 task ID、resource ID 和结果 URL 不能成为客户端选择目标的依据。

上游 task/resource ID 可能包含租户信息，日志中必须掩码；带签名结果 URL 使用与模型凭证相同的 AEAD 机制加密，或只保存在受限对象存储任务元数据中。

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
  "response_format": "b64_json"
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
  createEndpoint: string;   // /v1/videos
  statusEndpoint: string;   // /v1/videos/{taskId}
  contentEndpoint: string;  // /v1/videos/{resourceId}/content
  pollingIntervalMs: number;
  maxPollingTimeMs: number;
}
```

创建使用与同步视频相同的固定 JSON。创建响应识别 `id`、`task_id`。状态字段为 `status`：

- 等待：`queued`、`pending`、`processing`、`running`；
- 成功：`completed`、`succeeded`；
- 失败：`failed`、`error`、`cancelled`。

结果依次识别 `url`、`video_url`、`download_url`、`output.url`、`video_id`、`output.id`、`id`；错误识别 `error.message`、`message`、字符串 `error`。缺少字段视为协议错误。

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

### 10.3 Header、超时和大小

上游 Header 由服务器 Adapter 生成。禁止客户端传 Authorization、Cookie、Host、逐跳 Header、Forwarded 系列和预设外 Header。

每个请求定义连接、Headers、Body idle 和总超时；浏览器 AbortSignal 贯通同步调用。异步任务不因页面断开自动取消，只响应显式 cancel。Nginx 与应用超时必须形成一致预算。请求体、单文件、文件数、Base64 解码后数据、错误体和最终媒体均有限制；二进制使用流式转发或受限对象存储，不使用无上限 `arrayBuffer()`。

### 10.4 日志

只记录 request ID、用户 ID、模型 ID、目标 origin、operation、状态、耗时和字节数。不得记录完整查询值、Header 值、Cookie、CSRF、密码、模型凭证、正文、完整提示词、Base64、签名 URL 或生产 stack。

## 11. UI 与用户流程

- VIP 用户可创建私有 Provider 和私有模型；管理员可创建共享 Provider/模型。
- 凭证只显示“已配置”，编辑时选择保持、替换或删除。
- 自建模型使用独立 draft editor，一次 Save 原子校验，避免半配置状态。
- 高级 Base URL/鉴权/超时覆盖默认折叠。
- 共享模型配置 `verified`、`vip`、`admin` 访问级别。
- Provider 测试区分 DNS、TLS、HTTP 可达；404/405 不能表示鉴权成功。
- 图片/视频模型测试可能收费，必须主动确认；保存不自动生成。

## 12. 兼容与迁移

### 12.1 旧注册表迁移

1. 备份现有 `config`；
2. 将 Provider、模型和 Key 归属 bootstrap admin；
3. 加密写入正规化表；
4. 内置模型标记专用 `adapter_kind`；
5. 保存旧 ID 到新 UUID 映射并迁移激活模型；
6. 验证文本、图片、同步/异步视频 golden tests；
7. 前端响应移除完整密钥；
8. 清除浏览器旧密钥缓存。

### 12.2 关键词清理

现有按 ID 包含 `gpt`、`claude`、`gemini`、`sora`、`veo` 删除模型的规则不得作用于正规化模型。迁移只针对明确废弃内置 ID，不按关键词删除用户模型。测试覆盖这些名称的保存、重载和激活。

### 12.3 旧代理下线

生产开放前，代码搜索和运行测试必须证明没有前端路径发送 `targetUrl` 或上游鉴权 Header。之后删除 `/api/ai-forward`，路由测试确认 404。

## 13. Electron

Electron 使用用户配置的同一个 HTTPS 后端；登录、Cookie、CSRF、VIP、Provider、模型和任务 API 与 Web 一致。不打包 Express 网关、PostgreSQL 或模型密钥，不提供本地任意代理。服务器切换清理旧会话，证书错误不自动忽略，导航限制到配置服务器和必要外链。Android 不在本轮范围。

## 14. 测试策略

### 14.1 改造前特征测试

- 现有文本、JSON、流式请求构造和响应解析；
- 现有图片无参考图、多参考图调用；
- 现有视频各模式创建、轮询、下载；
- 当前激活模型和注册表重载；
- 真实 Stage 页面入口 smoke tests。

### 14.2 配置与权限

- 私有资源 owner 隔离；共享资源管理员管理；
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
- URL、Base64、二进制响应和缺失字段错误。

### 14.4 网关安全测试

- 身份和权益矩阵；客户端不能提交目标或鉴权 Header；
- 非法协议/URL/Endpoint；公网、私网 allowlist、元数据永久拒绝；
- 多 A/AAAA、mapped IPv6、特殊 IP；DNS 连接绑定；
- 同/跨 origin 重定向和 Header 剥离；
- 大小、流式媒体、超时、取消；
- 日志与 usage/audit 脱敏。

### 14.5 回归与三端

- 内置文本、图片和视频 golden tests；
- Web、Docker 端到端测试；
- Electron 连接 HTTPS 后端完成登录、模型选择和调用；
- 生产环境不存在旧任意代理；
- 自建协议使用本地受控 mock upstream 验证。

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
