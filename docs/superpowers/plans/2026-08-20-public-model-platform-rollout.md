# 公网身份与自建模型平台实施总计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不重构现有生成业务的前提下，分阶段交付可公网运行的邮箱身份系统、用户数据隔离，以及服务端持凭证的自建文本/图片/视频模型网关。

**Architecture:** 先建立认证、CSRF、限流和管理员 bootstrap，再迁移项目/素材/设置的 user_id 隔离；最后以新增安全模型网关承接自建模型调用，保留现有厂商路径并用 characterization tests 防回归。Electron 只作为远端 HTTPS Web 客户端，不在本地打包数据库、网关或模型密钥。

**Tech Stack:** React 19 + TypeScript + Vite；Node.js 20+、Express、PostgreSQL；Vitest（前端）、Node test runner（服务端）；AES-256-GCM、Argon2id、HttpOnly cookie session。

---

## 计划拆分与硬性顺序

本项目拆成三个可独立验收的子计划：

1. [身份与公网安全基础](/Users/wuxb/Desktop/QH-Dev/AIProgects/gcc-printfilm/docs/superpowers/plans/2026-08-20-identity-foundation-implementation-plan.md)
2. [用户数据隔离与迁移](/Users/wuxb/Desktop/QH-Dev/AIProgects/gcc-printfilm/docs/superpowers/plans/2026-08-20-data-isolation-migration-implementation-plan.md)
3. [自建文本/图片/视频模型网关](/Users/wuxb/Desktop/QH-Dev/AIProgects/gcc-printfilm/docs/superpowers/plans/2026-08-20-self-hosted-model-gateway-implementation-plan.md)

必须按 1 → 2 → 3 执行。每个子计划完成后运行其验收命令并单独提交；下一阶段不得绕过前一阶段的门禁。

## 总体发布闸门

- 阶段 1 完成后：服务只能内部试运行；未完成阶段 2/3 前不得公网开放生成接口。
- 阶段 2 完成后：旧 `/api/config/:key` 和未带 user_id 的项目/素材查询停止对外服务；Electron 先发布“导出加密迁移包”桥接版本，再切换远端 Web。
- 阶段 3 完成后：生产环境删除 `/api/ai-forward`；所有模型调用只接受 `modelId + operation`，服务端从数据库加载目标 URL 和凭证。
- 任一阶段失败：保留旧可用路径，回滚当前阶段数据库迁移和路由，不通过临时开关绕过认证。

## 总体禁止事项

- 不把完整模型密钥返回浏览器、写入日志、写入审计或写入错误消息。
- 不接受客户端任意 `targetUrl`、任意上游鉴权 Header 或任意 JSON 模板。
- 不修改现有 stage 的业务语义；所有新网关接入点必须先有旧行为 golden/characterization test。
- 不引入积分、支付、短信、Android、团队/组织、OAuth、2FA 或 SaaS 计费。
- 不使用 `ON DELETE CASCADE` 删除用户内容；删除、迁移和重放都必须带 `user_id`。

## 每个子计划的执行协议

实现 AI 对每个任务执行：写失败测试 → 运行确认失败 → 最小实现 → 运行定向测试 → 运行阶段回归 → 单独提交。提交信息使用 `feat(auth): ...`、`feat(isolation): ...`、`feat(model-gateway): ...` 或 `test: ...`。不得把多个阶段混在一个提交中。

## 设计规格覆盖自检

- 身份规格第 4–8 节：身份计划 Tasks 2–5 覆盖 users/session/token/outbox、注册验证、密码重置、VIP、管理员暂停注册和 bootstrap。
- 身份规格第 9–15 节：隔离计划 Tasks 1–4 覆盖 user_id 复合主键、设置命名空间、旧配置迁移、Electron bridge、审计和失败恢复；身份计划 Task 3 覆盖 CSRF/CORS/限流。
- 模型规格第 5–10 节：模型计划 Tasks 2–5 覆盖 Provider/Model/credential version/media/invocation/job、四种 preset、加密、幂等、异步不确定状态和上游网络安全。
- 模型规格第 11–14 节：模型计划 Tasks 6–8 覆盖 UI、Stage 直连点、Electron hardening、旧代理下线和测试。
- 两个规格的非目标（SAS、短信、积分、支付、Android、团队/组织、OAuth、2FA）均未进入任务。

计划自检结果：没有占位步骤；每个代码任务都列出精确文件、失败测试、命令、预期结果和提交点。若实现过程中发现文件路径与当前仓库不一致，代理必须先停在该任务并报告，不得自行重构目录。

## 最终总验收

```bash
pnpm test
pnpm build
cd server && npm test
cd .. && git diff --check
```

预期：前端 Vitest 全部通过、Vite build 成功、服务端 Node tests 全部通过、无 diff whitespace 错误；安全审计应能证明生产代码中不存在 `/api/ai-forward`、任意目标 URL 转发或客户端模型凭证注入。
