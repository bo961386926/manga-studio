# 用户身份、访问控制与 VIP 权益设计

## 1. 背景

漫剧工场当前是免登录的单一数据空间。Express API 未认证，PostgreSQL 中的 `projects`、`assets`、`config` 表没有用户归属；任何能够访问 API 的人都可以读取、覆盖或删除全部项目、资产和模型配置。该状态不适合公开部署，也无法安全承载用户自建模型密钥。

本设计建立公开运营所需的身份与访问基础，并为后续自建云端模型接入提供可信用户边界。本轮包含邮箱注册、邮箱验证、登录、密码重置、服务端会话、用户数据隔离、管理员能力、VIP 权益、共享模型授权、调用记录和审计日志。

本轮不实现组织/团队、多租户 SaaS、支付、套餐购买、积分、兑换、短信登录或双因素认证。

## 2. 目标与原则

### 2.1 目标

- 开放邮箱注册，管理员可暂停注册。
- 未验证邮箱不能进入业务系统。
- 使用安全的服务端会话，不在 localStorage 保存登录令牌。
- 项目、资产、模型配置和模型密钥按用户隔离。
- 支持管理员和普通用户两种系统角色。
- 支持永久 VIP 和有到期时间的 VIP。
- VIP 到期后保留项目浏览、编辑和已有内容导出能力，只停止受限模型调用。
- 管理员可以管理用户、VIP、注册开关、共享模型和调用统计。
- 为后续积分、套餐和付费保留独立权益判断边界，但不提前实现计费。

### 2.2 安全原则

- 身份从服务端会话获取，不信任请求体、查询参数或 Header 中的用户 ID。
- 默认拒绝：路由必须明确声明公开、已登录、VIP 或管理员权限。
- 密码、会话令牌、邮箱验证令牌、重置令牌和模型凭证均不得明文存储。
- 敏感操作可撤销，并写入审计日志。
- 用户内容与管理员运维信息分离；管理员默认不能查看用户项目正文、提示词或模型密钥。
- 先补当前行为特征测试，再进行数据库所有权迁移和 API 保护。

## 3. 范围拆分与实施依赖

身份与访问基础必须先于自建云端模型落地，顺序为：

```text
认证与会话
  -> 用户数据归属与隔离
  -> 管理员与 VIP 权益
  -> 服务端模型配置和密钥所有权
  -> 受控自建模型调用
```

自建模型设计依赖本规格提供的 `req.auth.userId`、角色判断、VIP 权益判断、审计日志和用户级数据访问接口。

## 4. 角色、状态与权限

### 4.1 系统角色

```ts
type UserRole = 'admin' | 'user';
```

- `admin`：用户管理、VIP 管理、注册开关、共享模型、聚合统计和审计管理。
- `user`：只能访问自己的项目、资产和私有模型资源。

本轮不实现自定义角色或权限编辑器。

### 4.2 用户状态

```ts
type UserStatus = 'pending_verification' | 'active' | 'disabled';
```

- `pending_verification`：已注册但邮箱未验证，只能访问验证邮件重发、验证和退出接口。
- `active`：可以使用其权益允许的功能。
- `disabled`：不能登录，所有现有会话失效。

### 4.3 VIP 权益

VIP 不作为系统角色，而是独立权益：

```ts
interface VipEntitlement {
  enabled: boolean;
  expiresAt: string | null;
}
```

- `enabled=false`：无 VIP 权益。
- `enabled=true, expiresAt=null`：永久 VIP。
- `enabled=true, expiresAt>now`：有效期 VIP。
- 到期或撤销后停止新的 VIP 专属模型调用，不删除项目、资产或历史结果。

权限判断统一通过 `hasEntitlement(userId, entitlementKey)`，当前实现 `vip`；以后积分、套餐或活动权益不得散落为页面条件判断。

### 4.4 权限矩阵

| 操作 | 未登录 | 未验证 | 普通用户 | VIP | 管理员 |
|---|---:|---:|---:|---:|---:|
| 注册/登录/找回密码 | 是 | 是 | 是 | 是 | 是 |
| 进入业务系统 | 否 | 否 | 是 | 是 | 是 |
| 管理自己的项目/资产 | 否 | 否 | 是 | 是 | 是 |
| 浏览/编辑/导出已有内容 | 否 | 否 | 是 | 是 | 是 |
| 调用 VIP 专属模型 | 否 | 否 | 否 | 是 | 是 |
| 调用管理员标记的免费模型 | 否 | 否 | 是 | 是 | 是 |
| 创建自己的 Provider/模型 | 否 | 否 | 否 | 是 | 是 |
| 管理用户和共享模型 | 否 | 否 | 否 | 否 | 是 |

## 5. 数据模型

数据库变更使用有版本号的 SQL migration，不继续仅依赖启动时 `CREATE TABLE IF NOT EXISTS`。Migration 必须支持事务、状态记录和幂等检查。

### 5.1 users

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  email_normalized VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'user')),
  status VARCHAR(32) NOT NULL CHECK (
    status IN ('pending_verification', 'active', 'disabled')
  ),
  email_verified_at TIMESTAMPTZ,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
```

`email_normalized` 使用去除首尾空白后的 Unicode 规范化和小写结果。原始 `email` 用于展示和发信。

### 5.2 sessions

```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  session_version INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash CHAR(64),
  user_agent_summary VARCHAR(255),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX sessions_user_active_idx ON sessions(user_id, expires_at)
WHERE revoked_at IS NULL;
```

浏览器只持有高熵随机令牌；数据库只保存 SHA-256 哈希。Cookie 名固定、启用 `HttpOnly`、生产环境 `Secure`、`SameSite=Lax`、`Path=/`，最长 7 天。

IP 审计值使用服务端秘密盐的 HMAC，而不是可离线枚举的普通哈希；该值只用于安全关联和限流排障，不作为会话身份凭据。

### 5.3 one-time tokens

邮箱验证和密码重置使用统一表：

```sql
CREATE TABLE user_action_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(32) NOT NULL CHECK (
    purpose IN ('verify_email', 'reset_password')
  ),
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

验证邮件 24 小时失效，密码重置 30 分钟失效；令牌只能使用一次。创建新令牌时使同用途未使用旧令牌失效。

### 5.4 VIP entitlements

```sql
CREATE TABLE user_entitlements (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement_key VARCHAR(64) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  granted_by UUID REFERENCES users(id),
  reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, entitlement_key)
);
```

### 5.5 用户数据归属

为现有表增加 `user_id`：

```sql
ALTER TABLE projects ADD COLUMN user_id UUID REFERENCES users(id);
ALTER TABLE assets ADD COLUMN user_id UUID REFERENCES users(id);
```

迁移完成后：

- `projects` 主键由全局 `id` 约束调整为 `(user_id, id)` 唯一；
- `assets` 主键由全局 `id` 约束调整为 `(user_id, id)` 唯一；
- 所有 SELECT/UPDATE/DELETE 必须同时包含 `user_id`；
- ID 冲突不能导致跨用户覆盖。

全局 `config` 不再保存用户模型注册表。系统级配置与用户级配置分离：

```sql
CREATE TABLE system_settings (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_settings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, key)
);
```

模型 Provider、模型和密钥使用自建模型设计定义的正规化表，不继续放在普通 JSON 配置中。

### 5.6 审计日志

```sql
CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id),
  target_user_id UUID REFERENCES users(id),
  event_type VARCHAR(96) NOT NULL,
  result VARCHAR(16) NOT NULL,
  request_id VARCHAR(64),
  ip_hash CHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_events_created_idx ON audit_events(created_at DESC);
```

默认保存 180 天。审计 metadata 使用允许字段清单，不写密码、令牌、模型密钥、完整提示词或响应正文。

## 6. 注册、验证和登录流程

### 6.1 开放注册

`POST /api/auth/register` 接收邮箱和密码。服务端依次执行：

1. 检查注册开关；
2. 规范化邮箱；
3. 校验密码长度 10–128；
4. 以 Argon2id 生成密码哈希；
5. 创建 `pending_verification` 用户；
6. 创建一次性验证令牌；
7. 发送验证邮件；
8. 返回不泄漏账号细节的统一结果。

管理员可在系统设置中暂停注册。暂停后注册接口返回服务不可注册状态，登录和已有用户不受影响。

### 6.2 邮箱验证

验证链接包含一次性随机令牌，前端提交到 `POST /api/auth/verify-email`。验证成功后：

- 标记令牌已使用；
- 设置 `email_verified_at`；
- 将用户状态切换为 `active`；
- 记录审计事件。

验证邮件可重发，但按 IP 和邮箱双维度限流。接口不返回邮箱是否已注册。

### 6.3 登录

`POST /api/auth/login` 使用规范化邮箱查找账号并验证 Argon2id 哈希。只有 `active` 用户可建立业务会话。

成功后生成至少 256 bit 随机会话令牌，数据库保存哈希，浏览器获得 HttpOnly Cookie。失败响应不区分邮箱不存在、密码错误或账号被禁用。

登录失败采用 IP + 账号双维度限流和渐进延迟，不使用永久账号锁定。

### 6.4 退出与强制失效

- 当前退出：撤销当前 session。
- 全部退出：递增用户 `session_version` 并撤销全部 session。
- 修改密码、重置密码、禁用账号、管理员强制退出：全部 session 立即失效。
- 会话中保存的 `session_version` 必须与用户当前值一致。

### 6.5 密码重置

找回密码接口始终返回统一成功提示。有效账号收到 30 分钟一次性链接。重置成功后更新 Argon2id 哈希、消费令牌、递增 `session_version` 并撤销全部会话。

## 7. API 认证与授权

### 7.1 中间件

```text
requestId
  -> security headers
  -> CORS allowlist
  -> size limits
  -> rate limit
  -> session authentication
  -> email/status check
  -> entitlement/role authorization
  -> route handler
  -> audit result
```

公开路由仅限健康检查和必要的 `/api/auth/*`。其余 `/api/*` 默认要求有效会话。

### 7.2 Cookie 与 CSRF

本轮使用 Cookie 会话，因此所有有副作用的请求必须防 CSRF：

- 校验 `Origin` 是否在部署允许清单；
- 缺少 Origin 的浏览器写请求默认拒绝；
- 使用 synchronizer CSRF token：服务端向已登录前端提供短期 token，写请求通过专用 Header 回传；
- Cookie 使用 `SameSite=Lax` 作为附加防线，而不是唯一防线。

Electron 使用同一认证和 CSRF 流程，其配置的服务器 origin 必须精确匹配。

### 7.3 CORS

- 禁止 `Access-Control-Allow-Origin: *` 与凭证请求组合；
- 生产环境必须通过环境变量配置精确 Origin 清单；
- 启用 `credentials: true`；
- 拒绝不在清单中的预检和实际请求；
- 不根据任意请求 Origin 动态回显。

### 7.4 速率与并发限制

至少覆盖：

- 注册；
- 登录；
- 验证邮件重发；
- 找回密码；
- 密码重置；
- 模型调用；
- 上传；
- 管理员敏感操作。

认证前使用 IP/网段键，认证后同时使用 user ID。多实例部署时限制状态必须使用共享存储，不能只保存在单进程内存中。

## 8. 邮件系统

首版使用标准 SMTP，通过环境变量配置：

```env
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=true
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
PUBLIC_APP_URL=
```

要求：

- 邮件链接只能使用配置的 `PUBLIC_APP_URL`，不能信任请求 Host；
- SMTP 凭证不得通过管理 API 返回；
- 开发环境支持控制台输出或本地邮件捕获服务；
- 发信失败不回滚已创建用户，但记录可重试状态并允许受限重发；
- 邮件内容不得包含密码或模型凭证。

## 9. 数据访问与隔离

### 9.1 服务端查询约束

数据访问函数不接受可选用户 ID。用户资源函数必须显式要求 `userId`：

```ts
getProject(userId, projectId)
saveProject(userId, projectId, data)
deleteProject(userId, projectId)
getAllProjects(userId)
```

资产、用户设置、Provider 和模型使用同一规则。管理员若需要聚合统计，使用独立管理查询，不能复用绕过 user ID 的普通函数。

### 9.2 前端缓存

- 登录令牌不进入 JavaScript 可读存储。
- 模型密钥不返回前端，也不写 localStorage。
- 登出、账号切换和 401 响应清除用户相关内存状态与本地缓存。
- 本轮服务端数据为权威来源，不承诺离线编辑。
- 为避免账号切换串数据，确需保留的非敏感缓存必须带 user ID 命名空间。

### 9.3 历史数据迁移

升级步骤：

1. 进入维护模式，阻止写入；
2. 完整备份 PostgreSQL；
3. 执行新表和 nullable `user_id` migration；
4. 通过 `BOOTSTRAP_ADMIN_EMAIL` 创建或确定首个管理员；
5. 将全部历史项目、资产和现有模型配置归属该管理员；
6. 验证没有 NULL 归属；
7. 建立非空和复合唯一约束；
8. 记录 migration 版本并退出维护模式。

迁移脚本可重复运行，不重复复制或改写已归属数据。任何校验失败必须回滚并保留备份。

## 10. 管理能力

管理界面首版提供：

- 用户列表、邮箱搜索、状态和注册时间；
- 启用/禁用账号；
- 强制用户全部退出；
- 授予、延长、撤销永久或限时 VIP；
- 暂停/恢复注册；
- 管理共享模型及普通用户/VIP 可用范围；
- 查看聚合调用次数、成功率和耗时；
- 查看脱敏安全审计事件。

管理员默认不能查看用户项目正文、提示词、响应内容或模型密钥。用户模拟登录、排障临时访问和客服代理操作不在本轮范围。

## 11. 调用记录与未来权益扩展

模型调用记录包含：

```sql
CREATE TABLE model_usage_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  model_id UUID,
  capability VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  duration_ms BIGINT NOT NULL,
  input_units BIGINT,
  output_units BIGINT,
  generated_count INTEGER,
  request_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

不记录完整提示词和输出正文。首版记录但不扣积分。未来积分或套餐服务通过消费 usage event 和 entitlement API 扩展，不修改模型调用的身份边界。

管理员可配置：

- 每用户并发模型调用数；
- 每分钟请求数；
- 每日调用次数；
- 上传和请求体大小。

## 12. Electron 与其他客户端

Electron 不内嵌 PostgreSQL、认证系统或模型代理。首次运行要求配置 HTTPS 服务器地址，之后打开该服务器提供的 Web 应用或使用相同 API：

- 服务器地址只允许 HTTPS；开发模式可允许 localhost HTTP；
- 不允许携带 URL 用户名、密码或片段；
- Cookie 由 Electron session 管理，不保存到 localStorage；
- 服务器切换时清除旧 origin 的会话和用户缓存；
- Electron origin/导航/新窗口必须限制到配置服务器和必要外链；
- 证书错误不得自动忽略。

Android 不在本轮实现和验收范围。API 不依赖 Electron 专有认证，以便后续单独设计移动端令牌机制。

## 13. 运行安全

- 生产环境必须配置 HTTPS，应用本身信任反向代理设置需显式开启。
- 设置 HSTS、CSP、`X-Content-Type-Options`、`Referrer-Policy` 和合理的 frame policy。
- 错误响应不返回 stack。
- 请求日志不记录 Cookie、Authorization、CSRF token、密码、邮箱验证/重置 token 或模型密钥。
- 数据库账号使用最小权限，生产环境不得使用默认 PostgreSQL 密码。
- 备份文件属于敏感数据，需加密和访问控制。
- 会话清理、一次性令牌清理和 180 天审计清理使用定时任务。

## 14. 特征测试与验收

### 14.1 改造前特征测试

- 当前项目 CRUD 请求和 JSON 结构；
- 当前资产 CRUD 请求和 JSON 结构；
- 当前模型注册表读取、保存和重载；
- 当前内置文本、图片、视频模型请求构造；
- 当前 Web 和 Docker 基础启动路径。

这些测试锁定兼容输出，但不锁定“无认证”和“全局共享数据”等必须修复的不安全行为。

### 14.2 认证测试

- 邮箱规范化与唯一性；
- Argon2id 密码哈希与错误密码；
- 验证/重置令牌过期、单次使用和重放；
- 注册暂停；
- Cookie 属性；
- 会话过期、撤销、session version；
- 禁用账号和密码重置后的全部退出；
- 登录与邮件接口限流和账号枚举防护；
- CSRF、Origin 和 CORS 拒绝路径。

### 14.3 隔离测试

- 用户 A 无法列出、读取、覆盖或删除用户 B 的项目和资产；
- 猜测 UUID 或自定义项目 ID 不能越权；
- 管理员普通接口同样受自身 user ID 限制；
- 管理聚合接口不返回用户正文或密钥；
- 账号切换不复用前一用户缓存；
- 并发创建相同业务 ID 不跨用户冲突。

### 14.4 VIP 与管理测试

- 永久、限时、到期、撤销和禁用状态；
- VIP 到期只阻止新受限调用，不影响已有内容；
- 普通用户可调用管理员标记的免费模型；
- 非管理员不能访问管理路由；
- 管理员操作完整写入脱敏审计日志。

### 14.5 迁移测试

- 使用生产结构副本执行 migration；
- 历史数据全部归属 bootstrap admin；
- migration 重跑无重复副作用；
- 失败事务回滚；
- 备份恢复演练；
- 升级后现有项目、资产和模型配置可读取。

## 15. 验收标准

- 用户可使用邮箱和密码注册、验证、登录、退出和重置密码。
- 管理员可暂停注册，已有用户仍可登录。
- 用户只能访问自己的项目、资产、设置和私有模型。
- 登录令牌和模型密钥不出现在 localStorage。
- 所有非公开 API 默认要求有效会话。
- 写请求具备 Origin、CSRF、CORS 和限流保护。
- 普通用户、VIP、管理员权限符合矩阵。
- 管理员可发放、延长、撤销 VIP 并强制用户退出。
- VIP 到期不删除或锁死用户已有内容。
- 历史数据安全迁移给首个管理员，且可从备份恢复。
- 审计和用量记录不包含密码、令牌、密钥或生成正文。
- Electron 可连接同一 HTTPS 后端完成登录和业务访问。
- 现有项目/资产业务结构和内置模型行为通过特征回归测试。

## 16. 非目标

- 手机号和短信验证码；
- OAuth、微信、GitHub 等第三方登录；
- 双因素认证；
- 组织、团队和企业租户；
- 用户购买 VIP；
- 支付、订单、发票；
- 积分、兑换和自动扣费；
- 自定义角色或通用权限编辑器；
- 用户模拟登录和客服代操作；
- 用户自助永久删除及完整数据可携带导出；
- Android 客户端。

上述能力需要独立规格，不能在实现阶段顺带加入。
