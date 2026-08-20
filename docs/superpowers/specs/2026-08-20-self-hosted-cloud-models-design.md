# 自建云端模型增量接入设计

## 1. 背景与目标

漫剧工场目前通过模型注册表、Provider 配置和文本/图片/视频适配器接入多个云厂商模型。系统已经允许用户填写 Provider Base URL、API Key、模型名和 Endpoint，但实际调用仍依赖现有厂商协议、Bearer 鉴权和固定响应结构，因此尚不能稳定接入用户自行部署的云端模型服务。

本需求在不重构现有调用链的前提下，新增自建云端模型旁路，支持：

- 自建文本模型；
- 自建图片模型；
- 自建同步视频模型；
- 自建异步视频模型；
- 统一网关承载三类模型；
- 文本、图片、视频分别部署；
- Provider 共享配置与单模型覆盖配置；
- 无鉴权、Bearer Token、自定义 API Key Header 三种鉴权方式。

本设计的首要约束是现有系统稳定性。内置模型和已有自定义模型继续使用原调用逻辑；只有显式选择自建协议预设的新模型才进入新适配器。

## 2. 设计原则

### 2.1 稳定优先

- 不重写现有 `geminiService.ts` 和内置厂商适配逻辑。
- 不改变现有模型字段的含义。
- 不要求旧配置整体迁移。
- 新路径失败不得改变旧路径行为。
- 每个新增字段均为可选字段；缺失时按旧逻辑处理。

### 2.2 增量接入

模型是否进入自建旁路，由 `protocolPreset` 是否存在决定：

```ts
type SelfHostedProtocolPreset =
  | 'openai-chat'
  | 'openai-image'
  | 'openai-video-sync'
  | 'openai-video-async';
```

- 无 `protocolPreset`：使用现有调用路径。
- 有 `protocolPreset`：使用新增的自建模型适配器。

不额外引入必须迁移的 `source` 字段，避免与已有 `isBuiltIn`、自定义模型逻辑重复。

### 2.3 明确协议边界

第一版只支持预定义的 OpenAI 风格协议，不提供任意请求 JSON、脚本、JSONPath 或通用 API 编排能力。无法满足预设协议的服务需要在其网关侧完成协议转换，或后续以独立适配器扩展。

## 3. 方案选择

本次采用“协议预设适配层”方案。

未采用的方案：

- 在现有适配器中继续增加厂商条件判断：改动看似较少，但会进一步耦合旧逻辑，增加回归风险。
- 通用 API 编排器：覆盖面广，但配置、安全、验证和维护成本过高，不适合本轮范围。

## 4. 总体架构

业务层接口保持不变：

```ts
chat(options)
generateImage(options)
generateVideo(options)
```

调用分流如下：

```text
业务调用
  -> 获取当前激活模型
  -> 检查 protocolPreset
       |- 未配置：进入原有适配器和厂商逻辑
       `- 已配置：解析自建有效配置
                    -> 构造鉴权 Header
                    -> 选择自建协议适配器
                    -> 经现有 /api/ai-forward 代理调用
                    -> 标准化并返回现有业务可消费的结果
```

新代码以独立模块承载，不把协议判断继续堆入现有厂商实现。现有调用入口只增加最小分流判断。

## 5. 配置模型

### 5.1 鉴权配置

```ts
type AuthType = 'none' | 'bearer' | 'api-key-header';

interface ModelAuthConfig {
  type: AuthType;
  credential?: string;
  headerName?: string;
}
```

约束：

- `none` 不发送认证 Header，也不要求 API Key。
- `bearer` 使用 `Authorization: Bearer <credential>`。
- `api-key-header` 使用用户配置的 `headerName`；Header 名必须通过合法名称校验。
- `credential` 和 `headerName` 不允许被写入运行日志。

### 5.2 Provider 增量字段

在现有 `ModelProvider` 上增加可选字段：

```ts
interface ModelProvider {
  // 现有字段保持不变
  auth?: ModelAuthConfig;
  timeoutMs?: number;
}
```

现有 `apiKey` 保留。没有 `auth` 的 Provider 继续按旧逻辑使用 `apiKey` 和 Bearer Header。

### 5.3 Model 增量字段

在模型基础定义上增加：

```ts
interface ModelDefinitionBase {
  // 现有字段保持不变
  protocolPreset?: SelfHostedProtocolPreset;
  baseUrlOverride?: string;
  authOverride?: ModelAuthConfig;
  timeoutMs?: number;
}
```

视频异步模型增加：

```ts
interface SelfHostedVideoAsyncConfig {
  statusEndpoint?: string;
  contentEndpoint?: string;
  pollingIntervalMs?: number;
  maxPollingTimeMs?: number;
}
```

端点模板允许 `{taskId}` 和 `{resourceId}` 两个受控占位符，不执行任意表达式。

### 5.4 有效配置解析

自建模型的解析优先级为：

```text
模型覆盖值 > 所属 Provider 值 > 协议预设默认值
```

Base URL：

```text
model.baseUrlOverride > provider.baseUrl
```

鉴权：

```text
model.authOverride > provider.auth > 旧 apiKey 的 Bearer 兼容映射
```

超时：

```text
model.timeoutMs > provider.timeoutMs > 协议默认超时
```

自建路径禁止从其他 Provider 获取凭证。全局 API Key 只有在所属 Provider 没有新式鉴权、没有 `apiKey`，并且用户当前全局 Key 模式明确允许时才可沿用，以保持旧配置兼容。新建自建 Provider 默认使用自身鉴权配置。

## 6. 协议预设

### 6.1 文本：`openai-chat`

默认端点：`/v1/chat/completions`。

请求采用 OpenAI Chat Completions 非流式格式，包含 `model`、`messages`、`temperature`、`max_tokens` 等现有业务参数。JSON 输出模式在服务声明支持时发送 `response_format`；否则继续依赖提示词约束并清理 Markdown 代码块。

成功响应从 `choices[0].message.content` 读取。缺少该字段时返回明确的协议不兼容错误。

第一版不增加流式输出，避免改变现有剧本解析和结构化 JSON 调用。

### 6.2 图片：`openai-image`

默认端点：`/v1/images/generations`。

纯文生图使用 JSON 请求：

```json
{
  "model": "configured-model-name",
  "prompt": "prompt text",
  "size": "1280x720",
  "n": 1,
  "response_format": "b64_json"
}
```

存在参考图时使用 `multipart/form-data`，发送 `model`、`prompt`、`image` 和 `size`。模型能力配置决定是否允许参考图、多张参考图及支持的画面比例；不支持时在发起网络请求前提示用户。

响应按固定兼容集合解析：

- `data[0].b64_json`；
- `data[0].url`；
- `output[0].url`；
- `image/*` 二进制响应。

结果统一转换为现有业务可消费的 URL 或 Data URL。自建图片模型不再被强制发送到 `/v1/chat/completions`；原有特殊图片模型仍走旧路径。

### 6.3 同步视频：`openai-video-sync`

默认端点：`/v1/videos/generations`。

请求包含 `model`、`prompt`、`size`、`duration`，有起始帧时增加 `image_url`。结束帧只在模型能力明确支持时发送。

响应按固定兼容集合解析：

- `data[0].url`；
- `data[0].b64_json`；
- `url`；
- `video_url`；
- `video/*` 二进制响应。

### 6.4 异步视频：`openai-video-async`

默认端点：

- 创建：`POST /v1/videos`；
- 状态：`GET /v1/videos/{taskId}`；
- 内容：`GET /v1/videos/{resourceId}/content`。

创建响应中的任务 ID 依次识别 `id`、`task_id`。状态依次识别 `status`，并支持：

- 等待状态：`queued`、`pending`、`processing`、`running`；
- 成功状态：`completed`、`succeeded`；
- 失败状态：`failed`、`error`、`cancelled`。

成功结果依次识别：

- `url`、`video_url`、`download_url`；
- `output.url`；
- `video_id`、`output.id`、`id`。

错误信息依次识别 `error.message`、`message`、字符串形式的 `error`。

若状态响应直接提供 URL，则直接下载；否则使用结果 ID 访问内容端点。下载响应可为视频二进制，也可为包含 URL 的 JSON。

默认轮询间隔为 5 秒，最小允许 1 秒；默认最长等待 20 分钟，最大允许 60 分钟。前端取消操作和页面请求终止必须传播到代理请求。

## 7. 用户界面

### 7.1 Provider 配置

在现有 Provider 管理区域增加自建服务字段：

- 服务名称；
- Base URL；
- 鉴权方式；
- 凭证；
- 自定义 Header 名；
- 默认超时；
- 保存；
- Provider 连通性检查。

Provider 连通性检查只验证 URL、代理连通性和鉴权可达性，不假设固定模型名。即使上游返回 404 或 405，只要能证明到达目标服务，也应与 DNS、TLS、超时错误区分展示。

### 7.2 Model 配置

新增“自建云端模型”创建入口，配置：

- 模型类型；
- 展示名称；
- API 模型名；
- 所属 Provider；
- 协议预设；
- Endpoint；
- 能力参数；
- 模型级 Base URL 覆盖；
- 模型级鉴权覆盖；
- 模型级超时。

模型级覆盖放在“高级配置”中，默认关闭，避免普通配置流程过于复杂。

视频异步模式额外配置状态端点、内容端点、轮询间隔和最大等待时间。

### 7.3 模型测试

- 文本模型：发送最小提示词并验证 `choices[0].message.content`。
- 图片模型：触发一次最小图片生成。
- 视频模型：触发一次最短时长视频生成并完成结果解析。

图片和视频测试可能产生费用，必须由用户主动触发，并在发送前显示明确提示。保存配置不自动发起生成请求。

## 8. 错误处理

自建适配器将错误分为：

- 配置错误：Base URL、Endpoint、Header 名、模型名或能力参数无效；
- 鉴权错误：401、403；
- 协议错误：成功 HTTP 响应中缺少预期字段；
- 上游错误：上游返回的 4xx、5xx；
- 网络错误：DNS、TLS、连接失败；
- 超时和取消；
- 异步任务失败或超过最长等待时间；
- 代理安全策略拒绝。

错误消息需包含模型显示名称、阶段和可操作建议，但不得包含凭证、完整请求体或大段 Base64。

重试只用于网络错误、429 和部分 5xx。401、403、配置错误及协议错误不得自动重试。异步状态查询的短暂失败可继续轮询，但必须受连续失败次数和总超时限制。

## 9. 后端代理安全

继续复用 `/api/ai-forward` 及其请求格式，避免改变现有前端调用契约。增量增加以下校验：

- 仅允许 `http:`、`https:`；
- 拒绝带用户名或密码的 URL；
- 限制允许的 HTTP Method；
- 移除 `Host`、`Connection`、`Content-Length`、`Transfer-Encoding` 等逐跳或危险 Header；
- 默认拒绝云元数据地址、环回、链路本地和私有网络；
- 每次 DNS 解析和重定向后重新校验目标地址；
- 限制重定向次数；
- 设置连接、响应和总请求超时；
- 日志对 Authorization、自定义鉴权 Header、Base64 和大请求体脱敏。

公网自建服务默认可用。局域网、本机或 Docker 内部模型服务需由部署管理员显式设置：

```env
AI_PROXY_ALLOW_PRIVATE_NETWORK=true
```

为降低对现有部署的影响，安全拒绝应返回独立错误码和中文说明。部署文档必须列出 Docker 容器访问宿主机模型服务时的地址配置方式。

## 10. 数据存储与隐私

本轮延续现有模型注册表持久化方式，不借此需求迁移存储系统。文档和 UI 必须与实际行为一致：模型配置目前由业务后端持久化，不应继续宣称“仅保存在本地浏览器”。

要求：

- 配置查看接口和诊断工具始终掩码凭证；
- 代理日志不得记录凭证；
- 前端密码输入框不回显完整凭证；
- 删除 Provider 时仍按现有行为处理其所属模型，并在 UI 中二次确认；
- 文档明确说明当前数据库凭证存储边界。

服务端密钥引用、操作系统密钥链或数据库字段加密属于后续安全增强，不纳入本轮实现，以避免扩大修改范围。

## 11. 向后兼容与迁移

本轮不对所有旧配置执行强制版本迁移。

- 旧模型没有 `protocolPreset`，继续走旧路径。
- 旧 Provider 没有 `auth`，继续使用现有 `apiKey` 语义。
- 现有内置模型不自动添加 `protocolPreset`。
- 现有自定义模型不自动改为自建协议，避免误判其返回格式。
- 用户只有在编辑模型并明确选择协议预设后，模型才切换到新路径。
- 删除新字段或回退版本后，旧字段仍可被旧版本读取。

如新模型配置不完整，保存时拒绝并说明缺少字段，不允许静默回退到其他 Provider 或旧适配器。

## 12. 文档交付

实现前后需要维护以下文档：

1. 本设计文档；
2. 实施计划；
3. 自建云端模型配置指南；
4. 协议兼容规范，包含四类请求和响应示例；
5. Web、Docker、Electron 部署说明；
6. 公网、私网和宿主机网络说明；
7. 常见错误排查指南。

## 13. 测试策略

### 13.1 单元测试

- 有效配置解析及覆盖优先级；
- 三种鉴权 Header 构造；
- 无鉴权模型可用性；
- URL 和端点模板校验；
- 文本响应解析；
- 图片 URL、Base64、二进制响应解析；
- 同步视频响应解析；
- 异步任务 ID、状态、结果和错误解析；
- 超时、取消和重试分类；
- 旧模型没有 `protocolPreset` 时的分流结果。

### 13.2 代理测试

- 允许公网 HTTP/HTTPS；
- 拒绝非法协议和 URL 凭证；
- 默认拒绝云元数据、环回、链路本地和私有地址；
- 显式开启后允许私网；
- 重定向目标重新校验；
- 敏感 Header 和日志脱敏。

### 13.3 回归测试

- 现有文本模型仍可完成普通文本和 JSON 调用；
- 现有图片模型仍可生成资产；
- 现有同步和异步视频模型仍可工作；
- 原有 Provider、模型启用状态和激活模型不丢失；
- 现有 Vitest 测试通过；
- 生产构建通过。

### 13.4 三端验证

- Web 开发环境；
- Docker Compose 部署；
- Electron 桌面端。

网络条件允许时使用兼容服务做实际冒烟测试；自动化测试使用本地 Mock Server，避免依赖外部模型和产生费用。

## 14. 验收标准

- 可以创建一个统一 Provider，并挂载文本、图片、同步或异步视频模型。
- 可以为三种能力分别创建独立 Provider。
- 单模型可以覆盖 Base URL、鉴权、Endpoint 和超时。
- 支持无鉴权、Bearer Token、自定义 API Key Header。
- 文本模型可完成剧本生成所需的普通文本和 JSON 响应。
- 图片模型可解析 URL、Base64 和图片二进制。
- 同步视频模型可解析 URL、Base64 和视频二进制。
- 异步视频模型可创建任务、轮询状态并下载结果。
- 旧模型未配置新字段时行为不变。
- 凭证不跨 Provider 自动串用。
- 图片和视频测试不会在保存配置时自动触发。
- 默认阻止敏感内网和云元数据目标，管理员可显式允许私网。
- 现有测试、生产构建和三端冒烟验证通过。

## 15. 非目标

本轮不包含：

- 任意请求模板、脚本或 JSONPath 映射；
- OpenAI Responses API；
- 文本流式输出；
- 任意厂商私有协议自动识别；
- 重构或统一现有所有厂商适配器；
- 将旧自定义模型自动迁移为自建协议；
- 密钥链、Vault 或数据库字段加密；
- 模型服务的部署和运维管理。

这些能力可在本轮稳定交付后按实际服务兼容需求单独设计。
