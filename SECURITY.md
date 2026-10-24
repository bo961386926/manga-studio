# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | ✅ Active          |
| < 0.1   | ❌ End of life     |

**仅最新 minor 版本接收安全更新**。请尽快升级。

---

## Reporting a Vulnerability

**请勿在公开 Issue 报告安全漏洞。**

### 报告渠道

| 方式 | 适用场景 | 响应 SLA |
|------|----------|----------|
| 邮件 `security@manga-studio.local` | 所有漏洞 | 48 小时确认，7 天修复 |
| GitHub Security Advisories (私有) | 代码库相关 | 同邮件 |
| 微信/钉钉联系维护者 | 紧急/已被利用 | 即时 |

### 报告模板

请包含以下信息：

```
**漏洞类型**：(XSS / SQLi / RCE / 认证绕过 / 信息泄漏 / 逻辑漏洞 / 其他)
**影响版本**：(如 0.1.0)
**复现步骤**：
1. ...
2. ...
**预期行为**：
**实际行为**：
**影响范围**：(用户数 / 数据敏感度 / 业务影响)
**PoC/Exp**：(如有，请加密发送)
**建议修复**：(可选)
```

### 处理流程

1. **确认收到**（48 小时内）：分配 CVE 编号（如适用），评估 CVSS
2. **验证复现**：在隔离环境确认
3. **制定修复**：最小化变更，准备回滚方案
4. **协调披露**：
   - 修复合并后 7 天内发布补丁版本
   - 发布 Security Advisory（GitHub + 邮件列表）
   - 致谢报告者（如同意公开）
5. **事后复盘**：根因分析、防复发措施、更新威胁模型

---

## Security Architecture

### 认证与授权
- **密码**：Argon2id (memory=64MiB, iter=3, parallelism=1)
- **会话**：HttpOnly + Secure + SameSite=Lax Cookie，CSRF 双重校验（Header + Token）
- **验证码**：自托管 SVG，矢量路径字形 + 动态扰动，**零明文答案**
- **API Key**：前端不持有，统一走网关（`adapter_kind=gateway`），服务端加密存储（AES-256-GCM + HMAC-SHA256）
- **RLS**：PostgreSQL 行级安全，所有多租户表强制 `app.user_id` GUC，**生产使用非超级用户 `manga_studio_app`**

### 数据保护
- **传输**：生产强制 HTTPS（HSTS + TLS 1.2+），内网 mTLS 可选
- **静态加密**：
  - 敏感配置（API Key/凭据）：AES-256-GCM + 随机 IV + 标签
  - 备份：age (X25519 + ChaCha20-Poly1305)，**加密后验证可解密才删明文**
- **密钥管理**：
  - `MODEL_ENC_KEY` / `REQUEST_HMAC_KEY` / `EMAIL_DELIVERY_KEY` / `IP_HMAC_SALT`：32 字节 hex，独立生成
  - **无密钥轮换工具**（GW-06），轮换需人工脚本 + 重加密

### 支付与积分
- **幂等键**：支付订单 `pay:{orderNo}`、扣减 `inv:{invocationId}`、退款 `refund:{invocationId}`
- **退款闭环**：异步任务失败/取消/超时/下载失败 → 自动退款；`submission_uncertain` 超 1 小时自动退款
- **账本**：`credit_ledger` 全量流水，余额与台账可对账

### 审计与监控
- **结构化日志**：Pino JSON，含 `requestId`、`userId`、脱敏字段
- **指标**：Prometheus `/metrics`（HTTP/模型/积分/DB/业务），**无高基数标签**
- **关键操作审计**：登录/注册/支付/模型调用/配置变更 → `audit_logs` 表

### 已知风险与接受项

| ID | 风险 | 状态 | 补偿措施 |
|----|------|------|----------|
| DATA-02 | 无异地备份副本 | **风险接受** | RPO=24h / RTO=4h，需业务确认 |
| GW-06 | 密钥无轮换工具 | **已知限制** | 轮换需停机 + 重加密脚本 |
| SEC-08 | Argon2 参数硬编码 | **低风险** | 参数偏强，非暴露面 |

---

## Secure Deployment Checklist

部署前**必须**确认：

- [ ] `.env` 四大密钥均为 64 位 hex（`openssl rand -hex 32`）
- [ ] `CAPTCHA_ENABLED=true`、`COOKIE_SECURE=true`
- [ ] `BACKUP_AGE_RECIPIENT` 已设置（生产强制）
- [ ] `DB_USER=manga_studio_app`（已执行 `010_rls_app_role.sql`）
- [ ] `CORS_ORIGINS` 仅包含生产 HTTPS 域名
- [ ] `PUBLIC_APP_URL` 为 HTTPS
- [ ] 前端端口绑定 `127.0.0.1:3005`（仅内网反代）
- [ ] `NODE_ENV=production` 显式写入 `.env`
- [ ] `EMAIL_VERIFICATION_DISABLED=false`、`RATE_LIMIT_DISABLED=false`
- [ ] `POSTGRES_PASSWORD` ≥ 12 位

---

## Security Contacts

| 角色 | 联系方式 |
|------|----------|
| 安全负责人 | security@manga-studio.local |
| 主维护者 | maintainer@manga-studio.local |
| 紧急电话 | +86-xxx-xxxx-xxxx（内部文档） |

---

## 致谢

感谢以下研究者负责任地披露漏洞：

<!-- 格式：- 姓名/ID - 漏洞类型 - 日期 -->
<!-- 示例：- @researcher - SQL Injection in /api/models - 2026-10-15 -->