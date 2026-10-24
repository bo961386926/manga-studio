# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/).

## [0.1.0] - 2026-10-22

### Added
- **视频生成适配器重构**：策略模式 + 工厂，支持 Veo / Sora / 豆包 / MiniMax 统一路由 (`services/adapters/videoAdapterFactory.ts`)
- **模型注册表模块化**：拆分为 8 个职责单一模块 + 门面导出 (`services/modelRegistry/`)
- **统一环境变量模块**：前端 `src/config/env.ts`、后端 `server/config/env.js`，含生产门校验
- **Prometheus 指标暴露**：`/metrics` 端点，覆盖 HTTP/模型调用/积分/数据库/业务维度 (`server/metrics.js`)
- **结构化日志**：Pino + 请求级子 logger + 脱敏 + 模块化 logger (`server/logger.js`)
- **真实验证码**：32 字符矢量路径字形 + feTurbulence/feDisplacementMap 扰动，零明文泄漏 (`server/auth/glyphPaths.js`, `captcha.js`)
- **Electron macOS 打包**：`npm run electron:build:mac` 产出 `.dmg` (158 MB, arm64 原生)
- **数据库备份加固**：加密后验证可解密才删明文；pg_dump 失败清理残留；生产强制 `BACKUP_AGE_RECIPIENT`
- **异步任务退款闭环**：pollJob 失败/过期/下载失败 + cancelJob 用户取消 → 自动 `refundCredits`；`submission_uncertain` 超 1 小时自动退款

### Fixed
- **P0 回归修复**：`server/metrics.js` TS 类型注解导致语法错误；`server/logger.js` `crypto.v4` 不存在
- **部署阻断项**：
  - `.env` 四个密钥从 `$(openssl rand ...)` 字面量 → 真 64-hex 值
  - `CAPTCHA_ENABLED=true` 补入 `.env`/`.env.example`
  - `docker-compose.yaml` frontend 端口 `3005:80` → `127.0.0.1:3005:80`
  - 新增 `media-store` 卷持久化媒体文件
  - `scripts/deploy.sh` 安全解析 env、hex64 校验、TLS override、健康检查走 `PUBLIC_APP_URL`
- **SEC-01 验证码答案明文泄漏**：原实现把答案写入 `<text>`，现改为纯 `<path>` 渲染
- **GW-04 异步不退款**：上游失败/取消/超时/下载失败现已全链路退款
- **DATA-03/04/05 备份完整性**：加密验证、残留清理、生产强制加密

### Changed
- `getApiKeyForModel` 废弃并强制返回 `undefined`，倒逼网关模型 (`adapter_kind=gateway`)
- Electron `webSecurity` 仅在远程 HTTPS 时开启
- 适配器层按 `adapter_kind === 'gateway'` 分发到服务端网关
- ModelRegistry 兼容层保留 `services/modelRegistry.ts` 一行重导出

### Security
- RLS 非超级用户角色迁移脚本：`server/migrations/010_rls_app_role.sql`（部署时以 postgres 执行一次）
- 验证码零依赖、零明文泄漏（200 样本 0 命中）
- 生产环境备份强制 age 加密，明文落盘即报错

### Tests
- 新增 83 个 ModelRegistry 单测 (`tests/modelRegistry/*.test.ts`)
- 新增 7 个 Video Adapter Factory 测试 (`tests/video-adapter-factory.test.ts`)
- 新增 3 条验证码真实现断言 (`server/test/captcha.test.js`)
- 新增备份加密验证测试 (`server/test/backup-encryption.test.js`)
- 全量测试：前端 216 + 后端 160 = **376 passed**

---

## [Unreleased]

### Planned
- 代码分割：`vite.config.ts` manualChunks 将主包 679kB 拆分
- 异地备份脚本（需确认 RPO/RTO）
- 文档：CONTRIBUTING.md / SECURITY.md