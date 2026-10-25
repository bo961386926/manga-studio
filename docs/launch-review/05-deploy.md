# 05 部署配置审查：环境门可绕过性、容器安全、TLS、回滚

- 审查目标：当前工作树（分支 `feat/public-model-platform`，HEAD `8fd19fd`，`git status --porcelain` 仅 `?? .agent-teams/`，即相对 HEAD 无未提交改动）
- 审查范围：`docker-compose.yaml`、`docker-compose.tls.yaml`、`nginx.conf`、`deploy/nginx-tls.conf`、`Dockerfile`、`server/Dockerfile.server`、`.dockerignore`、`server/.dockerignore`、`.gitignore`、`scripts/deploy.sh`、`scripts/health-check.sh`、`scripts/backup-now.sh`、`.env.production.example`、`.env.example`、`docs/部署手册.md`、`docs/database-rollback.md`
- 取证方式：静态只读审计 + 允许的只读校验（`docker compose --env-file .env config` 仅用于计数/定位，不输出配置全文）。**未执行** `deploy.sh`，**未执行** `docker compose up/build/down`。
- 一句话结论：**手册描述的目标拓扑（compose 固定 NODE_ENV=production、api/DB 不出内网、TLS 由 override 提供）本身是成立的；但「照手册从零部署」的实际路径上有三处会静默降级为不安全状态（密钥字面量、CAPTCHA 默认关、默认明文暴露 3005），TLS 形态下的后续发布/回滚会退回 HTTP，自动回滚覆盖不到最可能的故障形态。**

## 汇总表

| ID | 严重度 | 标题 | 证据位置 | 已复现 |
|----|--------|------|----------|--------|
| DEP-01 | BLOCKER | `.env` 四个密钥/盐是 `$(openssl rand ...)` 字面量，compose 原样注入 → 密钥材料公开且跨部署恒定 | `.env`（形态：`MODEL_ENC_KEY`/`REQUEST_HMAC_KEY`/`EMAIL_DELIVERY_KEY`/`IP_HMAC_SALT` 均 len=23 的 `$(...)` 字面量）、`docker-compose.yaml:56-59`、`scripts/deploy.sh:32,36-37`、`docs/部署手册.md:42,50,63,65` | **已复现（只读）**：`docker compose --env-file .env config \| grep -c 'openssl rand'` = 6 |
| DEP-02 | BLOCKER | `CAPTCHA_ENABLED` 默认 false，且 `.env.example` / 手册 / deploy.sh 预检三处全无该变量 → 生产静默关闭人机验证 | `docker-compose.yaml:65`、`server/auth/captcha.js:14`、`scripts/deploy.sh:34-45`、`docs/部署手册.md:29,31-66` | 已复现（grep 全仓仅 1 处命中） |
| DEP-03 | BLOCKER | 默认 compose 以 `0.0.0.0:3005` 明文 HTTP 暴露 frontend（`/api/` 全量反代），而手册 §3.3 首发命令正是该形态 | `docker-compose.yaml:123-124`、`nginx.conf:2,11-22`、`docs/部署手册.md:110,250` | 静态证据链（未启动容器） |
| DEP-04 | BLOCKER（条件性：TLS 形态） | deploy.sh 与手册 §5.1 的发布命令都不带 TLS override → TLS 形态下第二次发布/回滚静默退回 HTTP(3005) | `scripts/deploy.sh:10,61,67,70`、`docs/部署手册.md:217`（唯一带 `-f` 的命令）vs `docs/部署手册.md:275` | 静态证据链（未执行部署） |
| DEP-05 | HIGH | 手册 §3.2 让用户 `cp .env.example .env`，而 `.env.example:16` 是 `COOKIE_SECURE=false` → 会话 Cookie Secure 被静默关闭 | `docs/部署手册.md:96`、`.env.example:16`、`server/auth/session.js:15-18`、`.env.production.example:27`、`scripts/deploy.sh:34-45` | 静态证据链 |
| DEP-06 | HIGH | 「NODE_ENV 生产门」判定：仅 compose 硬编码，无其他生产启动路径；deploy.sh 的 grep 对容器无效（GW-01 分叉结论） | `docker-compose.yaml:45,126`、`docs/部署手册.md:38,110`、`scripts/deploy.sh:41`、`start-all.sh:31`、`package.json:8-10` | 静态证据链（全仓 grep 穷举） |
| DEP-07 | HIGH | 自动回滚只覆盖 build/up 失败；健康检查与冒烟失败（`die`→`exit`）不触发 ERR trap；迁移无逆 SQL（003+） | `scripts/deploy.sh:25,57-64,71,78,85-86`、`docs/部署手册.md:358-370`、`docs/database-rollback.md:9-13` | 静态证据链（未执行部署） |
| DEP-08 | HIGH | `PUBLIC_PORT` 默认 3005 与 TLS 形态（仅发布 80/443）不一致 → 部署冒烟与 health-check 在 TLS 后必然失败 | `scripts/deploy.sh:13,85-86`、`scripts/health-check.sh:10,31-32`、`docker-compose.tls.yaml:14-16`、`docs/部署手册.md:125` | 静态证据链 |
| DEP-09 | MEDIUM | 容器安全基线缺失：root 运行、无 `cap_drop`/`read_only`/`no-new-privileges`/资源限制/TZ | `docker-compose.yaml`（全文无 user/cap_drop/read_only/security_opt/resources/TZ）、`server/Dockerfile.server:1-21`、`Dockerfile:23-32` | 静态证据链 |
| DEP-10 | MEDIUM | 镜像固定用 `latest`，无不可变锚点/构建元数据；回滚仅同主机 `:previous` 一跳 | `docker-compose.yaml:38,121`、`scripts/deploy.sh:52-55,59-60`、`docs/部署手册.md:171-178` | 静态证据链 |
| DEP-11 | MEDIUM | 构建不可重复：`npm install`（非 ci）、根目录无 package-lock（只有 pnpm-lock）、内联依赖版本与 package.json 漂移 | `Dockerfile:16-17`、`package.json:41,44,45`、`server/Dockerfile.server:13-15` | 静态证据链（`ls package-lock.json` 不存在） |
| DEP-12 | MEDIUM | `--skip-preflight` 无审计/无二次确认；预检漏 CAPTCHA_ENABLED / COOKIE_SECURE / 密钥 hex 形态 / 示例域名；BACKUP_AGE_RECIPIENT 仅警告 | `scripts/deploy.sh:5,14,18,28,34-45` | 静态证据链 |
| DEP-13 | MEDIUM | 模板预填 `manga.example.com` 可通过全部门禁；首发 http + https CORS → 登录 403 的一致性链断裂 | `.env.production.example:16-17,42`、`scripts/deploy.sh:39`、`docs/部署手册.md:110,212`、`docker-compose.yaml:51-54` | 静态证据链 |
| DEP-14 | MEDIUM | TLS 证书缺失无预检（`deploy/certs` 不存在）、续期靠手工 hook、签发需停 frontend、无证书到期监控 | `docker-compose.tls.yaml:19`、`deploy/nginx-tls.conf:18-19`、`.gitignore:93`、`docs/部署手册.md:196,228`、`scripts/health-check.sh`（无证书检查） | 静态证据链（`deploy/` 下仅有 nginx-tls.conf） |
| DEP-15 | LOW | 杂项：TLS 套件参数与 `server_name _`、mailpit 用 latest 且 8025 绑 0.0.0.0（靠 profile 门控）、deploy.sh 默认关 BuildKit 且 `source .env` 按 shell 执行、arm64→amd64 未 pin `platform:` | `deploy/nginx-tls.conf:9,16,20-21`、`docker-compose.yaml:104,108-109`、`scripts/deploy.sh:32,67`、`docs/部署手册.md:159-181` | 静态证据链 |

计数：BLOCKER 4（其中 1 条条件性）、HIGH 4、MEDIUM 7、LOW 1，合计 15。

---

### [BLOCKER] DEP-01 `.env` 四个密钥/盐是 `$(openssl rand ...)` 字面量，compose 原样注入容器 → 密钥材料公开且跨部署恒定

- 证据：
  - 工作树 `.env`（未被 git 跟踪，权限 600）中四个密钥项的**值形态**为命令替换字面量（长度均为 23，而手册要求 32 字节 hex = 64 字符）：`MODEL_ENC_KEY`、`REQUEST_HMAC_KEY`、`EMAIL_DELIVERY_KEY`、`IP_HMAC_SALT`。为遵守「不改/不读取密钥」约束，本报告不复制其值，仅给出形态与长度（用 `awk` 提取 `$1` 与 `length`，未打印值）。
  - `docker-compose.yaml:56-59` 用 `${VAR:?...}` 注入，只校验**非空**：
    ```yaml
    - MODEL_ENC_KEY=${MODEL_ENC_KEY:?MODEL_ENC_KEY must be set in .env}
    - REQUEST_HMAC_KEY=${REQUEST_HMAC_KEY:?REQUEST_HMAC_KEY must be set in .env}
    - EMAIL_DELIVERY_KEY=${EMAIL_DELIVERY_KEY:?EMAIL_DELIVERY_KEY must be set in .env}
    - IP_HMAC_SALT=${IP_HMAC_SALT:?IP_HMAC_SALT must be set in .env}
    ```
  - **实测（只读，不落地容器）**：`docker compose --env-file .env config | grep -c 'openssl rand'` → `6`。即 compose 变量替换**不做命令替换**，字面量被原样写入 api 容器环境；容器内 `MODEL_ENC_KEY` 就是那个公开字符串。
  - 手册要求与正确形态：`docs/部署手册.md:63,65,42,50` 均写 `openssl rand -hex 32`（64 位 hex）；`crypto.js:11-18` 对该 raw 直接 `sha256(raw)` 派生密钥（跨域 GW-01）。
  - `scripts/deploy.sh:32` `set -a; source .env; set +a` → bash **会执行** `.env` 里的命令替换：预检时 `need MODEL_ENC_KEY`（L36）看到的是随机明文值，因此**预检必然通过、不报任何错**；而容器拿到的是字面量。部署者与脚本的认知因此脱节。
- 影响：
  - 密钥材料 = `sha256(<公开字面量>)`，任何拿到 `.env` 字面量的人（该字符串即文档里的示例命令，人尽可知）都能解密数据库/备份中的 Provider 凭据、网关请求载荷与结果文本；`EMAIL_DELIVERY_KEY` 失效使邮件动作令牌（验证/重置）的封装机密性为零；`IP_HMAC_SALT` 失效使审计 IP 哈希可被字典攻击还原。
  - 四个变量在所有部署间**完全相同**（同一字面量），无法按客户/环境隔离；轮换也毫无意义。
  - 具体可利用面取决于信封格式（`server/migration/envelope.js` 等未在本域审计）→ 该部分**未验证**。
- 复现步骤（已复现，全部只读）：
  1. `cd <repo> && docker compose --env-file .env config | grep -c 'openssl rand'` → 期望看到 `6`（证明字面量进容器）。
  2. `awk -F= '/^(MODEL_ENC_KEY|REQUEST_HMAC_KEY|EMAIL_DELIVERY_KEY|IP_HMAC_SALT)=/{print $1, length(substr($0,index($0,"=")+1))}' .env` → 4 项长度均为 23（≠64）。
- 建议修复：用 `openssl rand -hex 32` 生成后把**结果明文粘贴**进 `.env`（不要写 `$(...)`）；`.env.production.example` 与手册补一句显式禁令；`scripts/deploy.sh` 预检增加形态校验：`[[ "$MODEL_ENC_KEY" =~ ^[0-9a-f]{64}$ ]] || die`（REQUEST_HMAC_KEY / EMAIL_DELIVERY_KEY / IP_HMAC_SALT 同）；并把 `.env` 的 `source`（L32）改为只读解析（避免执行任意命令，见 DEP-15）。
- 验证方式：修复后 `docker compose --env-file .env config` 输出中不应再出现 `$(`；`grep -c 'openssl rand'` 应为 0；四项长度均为 64 且 `[0-9a-f]`。

### [BLOCKER] DEP-02 `CAPTCHA_ENABLED` 默认 false，且 `.env.example`/手册/deploy.sh 预检三处全无该变量 → 生产静默关闭人机验证

- 证据：
  - `docker-compose.yaml:64-65`：
    ```yaml
    # 人机验证（登录/注册 SVG 图形验证码）：生产设 true；测试环境默认关闭
    - CAPTCHA_ENABLED=${CAPTCHA_ENABLED:-false}
    ```
    `:-false` 意味着**忘设即关闭**，且这是全仓唯一提到该变量的地方：`grep -n 'CAPTCHA' .env.example docs/部署手册.md scripts/deploy.sh docker-compose.yaml` → 仅 `docker-compose.yaml:65` 一行命中。
  - `server/auth/captcha.js:14`：`export const captchaEnabled = () => process.env.CAPTCHA_ENABLED === 'true';`（每请求读取，未设家即 false）。
  - `scripts/deploy.sh:34-45` 的生产门预检项为 `POSTGRES_PASSWORD / CORS_ORIGINS / PUBLIC_APP_URL / MODEL_ENC_KEY / REQUEST_HMAC_KEY / NODE_ENV / EMAIL_VERIFICATION_DISABLED / RATE_LIMIT_DISABLED / 密码长度`，**不含 CAPTCHA_ENABLED**。
  - `docs/部署手册.md:29` 声称环境变量表与 `.env.example` 一一对应（共 32 个），但 §2 表格（`docs/部署手册.md:31-66`）中**没有 CAPTCHA_ENABLED 行**；只有 `.env.production.example:28-29` 写了「生产必须 true」。
- 影响：按手册 §3.2（`cp .env.example .env`）+ §3.3 部署，`CAPTCHA_ENABLED` 从未出现在 `.env` 中 → 容器取默认 false → 登录/注册的人机验证被**静默关闭**（无任何日志/告警）。这正是「静默关闭安全开关」，且与邮箱验证/限流已被预检强制保护形成明显反差（同一类开关三种待遇）。
- 复现步骤（已复现，只读）：`grep -n CAPTCHA .env.example docs/部署手册.md scripts/deploy.sh docker-compose.yaml` → 仅 compose:65；对照 `docs/部署手册.md:52-53` 已被预检强制的 EMAIL_VERIFICATION_DISABLED / RATE_LIMIT_DISABLED。未启动容器（硬约束），故「容器内实际取值」由 compose 默认值语义推出。
- 建议修复：compose 改为 `${CAPTCHA_ENABLED:?CAPTCHA_ENABLED must be true in production}`（或 `:-true` 并保留 dev 显式关闭）；`.env.example` 与 `.env.production.example` 都加入该变量；`scripts/deploy.sh` 增加 `grep -q '^CAPTCHA_ENABLED=true' .env || die`；手册 §2 表格补齐。
- 验证方式：`docker compose --env-file .env config | grep CAPTCHA_ENABLED` 应显示 `true`；故意从 `.env` 删掉该行后 `docker compose config` 应报错（`:?`）或 `deploy.sh` 预检应 die。

### [BLOCKER] DEP-03 默认 compose 以 `0.0.0.0:3005` 明文 HTTP 暴露 frontend（`/api/` 全量反代），而手册 §3.3 首发命令正是该形态

- 证据：
  - `docker-compose.yaml:123-124`：
    ```yaml
    ports:
      - "3005:80"
    ```
    无 `127.0.0.1:` 前缀 → 绑定全部网卡（0.0.0.0:3005，IPv6 亦然）。对比同文件 `:18-20`（postgres `expose: 5432`，注释「不映射宿主机端口」）与 `:40-43`（api 只 `expose: 3001`）——**db/api 的收敛是做到了的**，唯独 frontend 直接在宿主面暴露明文 HTTP。
  - `nginx.conf:2,11-13`：`listen 80;` + `location /api/ { proxy_pass http://manga-studio-api:3001; }` → 3005 上的 nginx 把**整个 API**（登录/注册/模型网关/管理端）以 http 转发，不只是静态资源。
  - `docs/部署手册.md:107-111`（§3.3 启动）给出的首发命令是 `docker compose --env-file .env up -d --build`（**不带** TLS override）→ 官方首发形态 = 明文 HTTP + 3005 全网卡。
  - `docs/部署手册.md:250`（§4.2 方案 B）自承：「compose 保持默认（frontend 已映射 `3005:80`）；建议将绑定改为 `127.0.0.1:3005:80` 只收回环（**属 compose 调整，需另行提交**）」→ 即该加固**尚未落地**；§1 `docs/部署手册.md:10` 只要求开放 80/443、未提 3005。
  - `docs/部署手册.md:125` 承认「启用 §4 TLS 后…3005 收回」，即 3005 是过渡形态，但没有任何门禁阻止过渡形态长期存在。
- 影响：按手册从零部署（先 §3.3 后 §4）期间，任何能访问该主机 3005 的人都可以用 curl 直接调 `/api/*` —— CORS 只约束浏览器，命令行客户端不受限：明文传输口令、会话 Cookie、模型调用请求；若该窗口期内 `.env` 来自 `.env.example`（`COOKIE_SECURE=false`，见 DEP-05），会话 Cookie 还会被浏览器以明文回传。命中严重度定义「生产上线后暴露端口」。
- 复现步骤（静态；未启动容器 —— 任务硬约束禁止 `up`）：
  1. 读 `docker-compose.yaml:123-124` 与 `nginx.conf:11-13`；
  2. 只读校验（允许）：`docker compose --env-file .env config | grep -A2 'published'`（本报告未执行，避免输出配置全文）；
  3. 若要真机复现（**本轮未做**）：在非生产机上 `up -d` 后 `curl -sS http://<ip>:3005/api/health`。
- 建议修复：默认改为 `127.0.0.1:3005:80`（或仅在有 TLS override 时发布 80/443）；把「开机即 TLS」写成默认路径（§4 提到 §3 之前）；在 nginx.conf 的 80 server 上加显式跳转或拒绝策略，避免长期明文。
- 验证方式：`docker compose --env-file .env config` 中 frontend 的 published 端口应带 `host_ip: 127.0.0.1`；`ss -ltnp | grep 3005` 应只显示 127.0.0.1。

### [BLOCKER（条件性：TLS 形态）] DEP-04 deploy.sh 与手册 §5.1 的发布命令都不带 TLS override → 第二次发布/回滚静默退回 HTTP(3005)

- 证据：
  - `scripts/deploy.sh:10`：`COMPOSE="docker compose --env-file .env"` —— **没有** `-f docker-compose.tls.yaml`；该变量用于 L61（回滚 `$COMPOSE up -d --no-build`）、L67（`$COMPOSE build api frontend`）、L70（`$COMPOSE up -d`）。
  - `docs/部署手册.md:275`（§5.1 更新发布）：`docker compose --env-file .env up -d --build` —— 同样无 `-f`。全手册只有 `docs/部署手册.md:217`（§4.1 第 5 步首次 TLS 启动）出现 `-f docker-compose.yaml -f docker-compose.tls.yaml`。
  - `docker-compose.tls.yaml:14-16` 用 `ports: !override` 把端口替换为 80/443，并（`:17-19`）挂载 `deploy/nginx-tls.conf` 与 `deploy/certs`。不带该文件时，frontend 的最终配置回落到基础 `docker-compose.yaml:123-124`（`3005:80`）与镜像内 `nginx.conf`。
- 影响：TLS 形态上线后，任何人按手册 §5.1 更新（或运行 `scripts/deploy.sh`，包括它的自动回滚路径）都会把 frontend 重建为「3005 明文 HTTP、无 TLS 配置、无证书挂载」→ 443 消失、明文端口回归 = 既「暴露端口」又「静默关闭 TLS」。故障表现是 443 拒绝连接，容易被误判为主机防火墙/证书问题而拖延数小时。
- 复现步骤（静态；未执行部署）：
  1. 对照 `docs/部署手册.md:217` 与 `:275` 两条命令的差异（唯一差别就是 `-f` 叠加）；
  2. 只读校验（允许，本报告未执行）：`docker compose --env-file .env -f docker-compose.yaml config | grep -A3 'published'` vs 追加 `-f docker-compose.tls.yaml` 的结果对比。
- 建议修复：deploy.sh 检测到 `docker-compose.tls.yaml` 与证书存在时自动叠加 `-f`（或引入 `.env` 中的 `COMPOSE_FILE` 变量统一声明）；手册 §5.1 的命令行补上 `-f`；在 §7.1 回滚步骤中同样带上。
- 验证方式：TLS 形态下重跑发布脚本后 `curl -sI http://<域名>/` 应仍为 301、`curl -sI https://<域名>/` 应为 200；`docker compose ... config | grep -c '3005'` 应为 0。

### [HIGH] DEP-05 手册 §3.2 让用户 `cp .env.example .env`，而 `.env.example:16` 是 `COOKIE_SECURE=false` → 会话 Cookie Secure 被静默关闭

- 证据：
  - `docs/部署手册.md:93-98`（§3.2 生成 .env）：
    ```bash
    cp .env.example .env
    chmod 600 .env
    ```
  - `.env.example:15-16`：
    ```
    # Cookie Secure flag (auto-enabled when NODE_ENV=production).
    COOKIE_SECURE=false
    ```
    注释说「production 下自动开启」，下一行却显式写成 `false` —— 而 `server/auth/session.js:15-18` 的语义是**显式值优先**：
    ```js
    secure:
      process.env.COOKIE_SECURE !== undefined && process.env.COOKIE_SECURE !== ''
        ? process.env.COOKIE_SECURE === 'true'
        : process.env.NODE_ENV === 'production',
    ```
    `docker-compose.yaml:63` `- COOKIE_SECURE=${COOKIE_SECURE:-}` 会把该 `false` 原样传入容器（空值才回落到 NODE_ENV）。
  - 生产模板与之矛盾：`.env.production.example:24-27` 写 `COOKIE_SECURE=true`，并注明「切换 HTTPS 后必须改回 true」；手册 §2 `docs/部署手册.md:41` 却称「`COOKIE_SECURE` 生产无需设置」——即三处文档互相矛盾。
  - `scripts/deploy.sh:34-45` 预检**不检查** `COOKIE_SECURE`（对照 L42-43 对 EMAIL_VERIFICATION_DISABLED / RATE_LIMIT_DISABLED 的强制）。
  - 补充事实（当前工作树 `.env` 未含 `COOKIE_SECURE` 行）→ 当前这套 `.env` 会走 NODE_ENV 回落、是安全的；风险点在于**手册教的操作路径**。
- 影响：按手册 §3.2 生成的 `.env` 会让 Secure 标志关闭，叠加 DEP-03 的明文 3005 形态 → 会话 Cookie（`ms_session`，7 天有效）可被同网段嗅探/中间人获取，直接冒用账号；而这发生在运维「完全照手册做」的前提下。
- 复现步骤（静态；未启动容器）：读 `.env.example:16` + `server/auth/session.js:15-18`；环境变量优先级由 `docker-compose.yaml:63` 的透传确定。未执行 `up`，故「浏览器实际是否带 Secure」未实测。
- 建议修复：`.env.example:16` 删除该行或改成注释掉的 `# COOKIE_SECURE=true`；手册 §2/§3.2 改为对着 `.env.production.example` 填写；`deploy.sh` 预检在 TLS 形态下强制 `COOKIE_SECURE` 不为 `false`。
- 验证方式：`docker compose --env-file .env config | grep COOKIE_SECURE` 应为空或 `true`；登录后 `Set-Cookie` 应包含 `Secure` 与 `HttpOnly`。

### [HIGH] DEP-06 「NODE_ENV 生产门」判定：仅由 compose 硬编码，不存在其他受支持的生产启动路径（GW-01 分叉结论）

- 证据：
  - 强制点：`docker-compose.yaml:45`（api）、`:126`（frontend）硬编码 `NODE_ENV=production`；容器环境变量由 compose 决定，与 `.env` 是否含该行无关。
  - 手册判定：`docs/部署手册.md:38` 明确写「`NODE_ENV` | 否 | compose 把 api/frontend 固定为 `production`，此处仅影响本地脚本」；`docs/部署手册.md:110`（§3.3）与 `:275`（§5.1）是手册给出的全部启动/更新命令，都是 compose。
  - 穷举 grep（`grep -rn 'NODE_ENV\|npm start\|systemd\|pm2\|node index.js' docs/部署手册.md scripts/*.sh docker-compose.yaml Dockerfile server/Dockerfile.server start-all.sh`）命中仅：`docs/部署手册.md:38`、`:227`（certbot 的 systemd timer，与 Node 无关）、`scripts/deploy.sh:41`、`docker-compose.yaml:45,126`。**没有任何 systemd unit / pm2 / `node index.js` 的部署说明。**
  - 非 compose 的两条路径均为本地开发定位且手册未引用：`start-all.sh:29-36`（`cd server; SERVER_PORT="$BACKEND_PORT" npm run dev &` + 前端 `npm run dev`）、根 `package.json:8-10`（`dev` / `dev:server` / `dev:all`）。`server/package.json:7` `"start": "node index.js"` 不设 NODE_ENV（若有人手动 `npm start`，即为未设 NODE_ENV 的生产运行 → crypto.js 退化 + upstream.js 放行 127.0.0.1）。
  - `scripts/deploy.sh:41` `grep -q '^NODE_ENV=production' .env || die ...`：只校验 `.env` 文本，**对容器无作用**（compose 已硬编码），属于「看起来有门禁、实际只是文档检查」。
- 结论（回答队长的问题）：**是 -> 不存在手册支持的、可绕过 `NODE_ENV=production` 的生产启动路径**；compose 内的 `:45` 是唯一强制点，且该行不可由 `.env` 覆盖（`environment:` 显式赋值优先于 `env_file`，且投影型 compose 未使用 `env_file`）。**残留风险**：运维若脱离手册用 `npm start`/pm2/systemd 跑 `server/index.js`，NODE_ENV 未设 → 跨域 GW-01 的密钥退化与 localhost SSRF 逃逸阀立即复活，且备份/迁移调度（`server/backup.js`）等行为也随之不同。
- 影响：GW-01 的严重度在这些前提下是「条件性」而非「必然」——条件是「是否严格走 compose」。建议把它转为不依赖部署方式的安全性：`server/index.js` 启动时打印并断言运行模式（如 `assertProcessEnvSafe()`），`crypto.js:11-18` 的 dev 回退改为必须显式 `ALLOW_DEV_CRYPTO_KEY=true`（缺省即抛错）。
- 复现步骤（只读）：`grep -rn 'NODE_ENV\|npm start\|pm2\|systemd' docs/部署手册.md scripts/*.sh | grep -v certbot`；`sed -n '44,46p;125,127p' docker-compose.yaml`。
- 验证方式：在无 `NODE_ENV` 的环境里 `cd server && npm start`，期望启动即报错（当前会静默使用 dev 密钥，需先修）。该行为**未实测**（不启动服务）。

### [HIGH] DEP-07 自动回滚只覆盖 build/up 失败；健康检查与冒烟失败不触发回滚；迁移无逆 SQL

- 证据：
  - `scripts/deploy.sh:3` 注释宣称「失败时自动回滚到 `:previous` 镜像」；实现为 `:64` `trap rollback ERR`，并在 `:71` `trap - ERR` 解除。
  - 失败出口却使用 `die`：`:25` `die() { ...; exit 1; }`，健康检查超时 `:78` `... && die "API 300s 未健康..."`，冒烟失败 `:85-86` `curl ... || die` —— bash 的 `ERR` trap **不会因 `exit` 内建而触发**，因此这三处最可能的故障形态都**不会**执行 `:57-63` 的 rollback。
  - 首次部署无锚点：`:52-55` 用 `docker image inspect ... >/dev/null 2>&1 && docker tag ...:previous || true`，无旧镜像时静默跳过；此时若 build/up 失败，rollback（`:59-61`）只会执行 `up -d --no-build` 后 `die`。
  - 手册另有一套说法：`docs/部署手册.md:358-368`（§7.1）给的是 `git switch <上一个可用版本> && docker compose up -d --build`（人工、全量重建），**全文未提及 `:previous` 机制**（`grep -n 'previous' docs/部署手册.md` 无命中）→ 脚本行为与手册不一致，运维无法判断回滚是否已发生。
  - 迁移不可回退：`docs/部署手册.md:370` 自承「迁移 runner 只向前应用、无自动 down；回退代码不会撤销已应用迁移」；`docs/database-rollback.md:9-13` 的迁移清单只覆盖 `001_identity` / `001a_entitlements` / `002_user_ownership` / `002a_settings` / `002b_migration_imports`，而网关阶段新增的 `003_model_gateway`、`005_credits` 等**没有逆操作 SQL**（该文档 `:15-30` 要求「先备份 + 手工逆操作」，但新增迁移无从参照）。
- 影响：命中「无法回滚」的最常见形态 —— 新版本能构建、能启动，但健康检查失败或冒烟失败（例如迁移耗时、CORS 配错、依赖上游不可达）时，脚本以 `die` 结束且**不执行回滚**，服务处于「新镜像 + 无告警」的半死状态；即便人工回滚镜像，已应用的 003+ 迁移也无法逆操作，旧代码对新 schema 运行缺少文档化兜底。
- 复现步骤（静态；未执行 deploy.sh —— 任务硬约束）：读 `scripts/deploy.sh:25,57-64,71,78,85-86`；Bash 语义可独立验证：`bash -c 'trap "echo TRAP" ERR; f(){ exit 1; }; f; echo after'` 只输出 `after`（不触发 ERR trap）。
- 建议修复：把滚动改为显式调用（健康检查/冒烟失败时 `rollback "reason"`）；部署前自动 `pg_dump` 并把 dump 名写入部署日志；为 003+ 迁移补逆 SQL 或在发布闸门中把「仅前滚」写成硬策略（含失败时的数据一致性判断）。
- 验证方式：在非生产环境注入一次「新版本健康检查必失败」（例如故意把 `/api/health` 依赖打断）后跑 `deploy.sh`，期望看到 rollback 日志与 `:previous` 镜像重新生效。

### [HIGH] DEP-08 `PUBLIC_PORT` 默认 3005 与 TLS 形态（仅发布 80/443）不一致 → 部署冒烟与 health-check 在 TLS 后必然失败

- 证据：
  - `scripts/deploy.sh:13` `PUBLIC_PORT="${PUBLIC_PORT:-3005}"`；`:85-86` 冒烟：
    ```bash
    curl -fsS "http://localhost:${PUBLIC_PORT}/api/health" >/dev/null || die "GET /api/health 失败"
    curl -fsS -o /dev/null "http://localhost:${PUBLIC_PORT}/" || die "前端首页返回失败"
    ```
  - `scripts/health-check.sh:10,31-32` 同样默认 3005 且硬编码 `http://`。
  - `docker-compose.tls.yaml:14-16` `ports: !override - "80:80" - "443:443"` → TLS 形态下 3005 **不再发布**；`docs/部署手册.md:125` 也承认「启用 §4 TLS 后…3005 收回」。
  - `.env.production.example:69-70` 只留了注释 `# PUBLIC_PORT=3005`，未提示 TLS 形态应设为 `80`（或 `443` 且脚本需 `https`/`-k`）。
- 影响：TLS 形态下 `deploy.sh` 会在最后一步（服务其实已起来）以 `die` 收场 —— 叠加 DEP-07 则**不触发回滚**，运维看到「部署失败」而实际是新版本在跑；`health-check.sh` 放进 cron 后则永久 FAIL，告警疲劳并掩盖真实故障。反向地，若运维为了通过检查而把 `PUBLIC_PORT` 设成 `3005` 并保留明文映射，就退回 DEP-03 的暴露状态。
- 复现步骤（静态；未执行部署/未启动容器）：读 `scripts/deploy.sh:13,85-86`、`scripts/health-check.sh:10,31-32`、`docker-compose.tls.yaml:14-16`；在 TLS 形态下对宿主机 `curl -s http://localhost:3005/api/health` 会连接被拒（未实测）。
- 建议修复：脚本按「https(443) → http(80) → http(3005)」顺序探测并允许 `PUBLIC_SCHEME`；或要求 TLS 形态显式 `PUBLIC_PORT=443` 且在 `.env.production.example` 中给出 TLS 示例；health-check 增加「443 可用性」检查项替代 3005 假设。
- 验证方式：TLS 形态下 `PUBLIC_PORT=443 ./scripts/health-check.sh` 应全绿；删除该变量时应自动探测到 443（而非失败）。

### [MEDIUM] DEP-09 容器安全基线缺失：root 运行、无 cap_drop/read_only/no-new-privileges、无资源限制与 TZ

- 证据：
  - `docker-compose.yaml` 全文（`:9-146`）**无** `user:`、`cap_drop`、`read_only`、`security_opt`、`deploy.resources`/`mem_limit`、`TZ`、`stop_grace_period` 任何一项（`grep -nE 'cap_drop|read_only|security_opt|mem_limit|resources|TZ|stop_grace' docker-compose.yaml` 无命中）。
  - `server/Dockerfile.server:1-21` 无 `USER` 指令，`CMD ["node", "index.js"]`（`:21`）→ 以 root 运行 API；根 `Dockerfile:23` `FROM nginx:alpine`（`:23-32`）亦无 `USER`（nginx master 默认 root）。
  - `docker-compose.yaml:90-95` api healthcheck 仅 `wget -q -O- http://localhost:3001/api/health`（不检查迁移状态/DB 写入）。
- 影响：任何应用层 RCE/原型链问题直接等于容器内 root，而 api 挂载了可写的 `/app/backups` 卷（`docker-compose.yaml:85-86`）→ 可污染备份/宿主机共享卷；无内存上限叠加跨域 GW-10 的 150MB（`server/index.js:56`）与 200MB（`routes/model-gateway.js:760-770`）缓冲，单次并发即可打满宿主内存；未设 `TZ` 使日志/备份时间戳为 UTC，与运维判断（health-check 的 26h 备份窗口）易错。
- 复现步骤（静态；未启动容器）：`grep -nE 'user:|cap_drop|read_only|security_opt|mem_limit|TZ' docker-compose.yaml server/Dockerfile.server Dockerfile` → 0 命中；`docker compose --env-file .env config | grep -cE 'cap_drop|read_only|mem_limit'` 预期 0（未执行，避免输出全文）。
- 建议修复：api 与 frontend 增加 `user: "10001:10001"`、`cap_drop: [ALL]`、`security_opt: ["no-new-privileges:true"]`；api `read_only: true` + `tmpfs: [/tmp]` + backups 卷写权限；`mem_limit: 2g`（按实测校准）；显式 `TZ=Asia/Shanghai`、`stop_grace_period: 30s`。
- 验证方式：`docker compose config | grep -E 'user:|cap_drop|read_only|mem_limit|TZ'` 应出现上述键；容器内 `id` 应非 uid 0。

### [MEDIUM] DEP-10 镜像使用 `latest`，无不可变锚点与构建元数据；回滚仅同主机 `:previous` 一跳

- 证据：`docker-compose.yaml:38` `image: manga-studio-api:latest`、`:121` `image: manga-studio:latest`；`scripts/deploy.sh:52-55` 用 `docker tag ...:latest ...:previous` 造回滚锚点（`|| true` 容错）、`:59-61` 回滚靠 retag；脚本内无任何 push/pull 或 tag 语义（`:66-67` 只 `build`）；`docs/部署手册.md:171-178`（§3.7）建议镜像仓库用 `<tag>`，但 compose 仍写死 `latest`。
- 影响：无法回答「线上跑的是哪个 commit」；跨主机无法回滚（`:previous` 只在本机存在）；连续两次部署后旧锚点被覆盖；审计/取证困难（无 image label 记录 GIT_SHA/构建时间）。
- 复现步骤（静态）：`grep -n 'latest\|GIT_SHA\|label' docker-compose.yaml scripts/deploy.sh Dockerfile server/Dockerfile.server` → 仅 latest 命中。
- 建议修复：`image: manga-studio-api:${IMAGE_TAG:-latest}` 并由脚本注入 `--label org.opencontainers.image.revision=$(git rev-parse --short HEAD)`；回滚锚点改按 tag 保留最近 N 个。
- 验证方式：`docker image inspect <tag> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'` 应返回 commit。

### [MEDIUM] DEP-11 构建不可重复：`npm install`（非 ci）、根目录无 lockfile、内联依赖版本与 package.json 漂移

- 证据：
  - 前端：`Dockerfile:16` `RUN npm install --omit=dev ...`、`:17` 内联安装构建期依赖并**与 package.json 不一致**：`tailwindcss@^3.4.17` / `postcss@^8.4.0` / `autoprefixer@^10.4.0`（Dockerfile:17）vs `package.json:45 tailwindcss ^3.4.19` / `:44 postcss ^8.5.28` / `:41 autoprefixer ^10.6.1`；`Dockerfile:14` 注释却自称「与 package.json devDependencies 保持一致」。
  - 根目录**无 `package-lock.json`**（`ls package-lock.json` → No such file），只有 `pnpm-lock.yaml`，而 Dockerfile 使用 npm → lockfile 完全未参与构建；`server/package-lock.json` 存在（37,766 B），但 `server/Dockerfile.server:15` 同样是 `npm install --omit=dev`（未用 `npm ci`）。
- 影响：`^` 范围会随 registry 最新小版本漂移 → 两次构建产物可能不同，本地/CI/生产三方不可复现；无 lockfile integrity 校验（供应链面）；回滚验证（「同一 tag 是否真的同一产物」）失去前提。
- 复现步骤（静态）：`ls package-lock.json`（不存在）；`grep -n 'npm install\|npm ci' Dockerfile server/Dockerfile.server` → 两处均为 install。
- 建议修复：根目录补 lockfile（或统一改为 pnpm + `--frozen-lockfile`）；两处改用 `npm ci`；把 vite/typescript/tailwind 等放入 devDependencies 由同一 lockfile 驱动（构建后再 prune）。
- 验证方式：连续两次干净构建比较镜像 digest（应一致）；`npm ci` 在 CI 中应成功。

### [MEDIUM] DEP-12 `--skip-preflight` 无二次确认/无审计；预检漏掉 5 个关键项

- 证据：`scripts/deploy.sh:5`（用法含 `--skip-preflight`）、`:14`（`--skip-preflight)` → `SKIP_PREFLIGHT=true`）、`:28`（`if [ "$SKIP_PREFLIGHT" = false ]; then` 跳过 `:30-46` 全部门禁）；预检实际覆盖 `:35-44`（POSTGRES_PASSWORD / CORS_ORIGINS / PUBLIC_APP_URL / MODEL_ENC_KEY / REQUEST_HMAC_KEY / NODE_ENV / EMAIL_VERIFICATION_DISABLED / RATE_LIMIT_DISABLED / 密码长度），**未覆盖**：`CAPTCHA_ENABLED`、`COOKIE_SECURE`、密钥 hex 形态（`:?` 只保证非空）、示例域名黑名单、`SMTP_HOST`；`:45` 对 `BACKUP_AGE_RECIPIENT` 仅 `say` 警告不阻断。
- 影响：一次 `--skip-preflight`（或直接把 `.env.example` 复制成 `.env`）就能让「CAPTCHA 关 + Cookie 不 Secure + 示例域名 + `$(...)` 密钥字面量 + 无 SMTP」的组合静默上线，且脚本只输出到 stdout，无审计记录、无二次确认。
- 复现步骤（静态）：`sed -n '5p;14p;18p;28p;35,46p' scripts/deploy.sh`（未执行脚本，仅读）。
- 建议修复：`--skip-preflight` 要求交互确认并写入部署日志（含操作者与跳过项）；预检补齐上述 5 项（密钥形态用 `^[0-9a-f]{64}$`）。
- 验证方式：从 `.env` 删除 `CAPTCHA_ENABLED` 后 `./scripts/deploy.sh --preflight-only` 应 die（当前会通过）。

### [MEDIUM] DEP-13 示例域名预填可通过全部门禁；「首发 HTTP + https CORS」一致性链断裂

- 证据：`.env.production.example:16-17` `CORS_ORIGINS=https://manga.example.com` / `PUBLIC_APP_URL=https://manga.example.com`；`scripts/deploy.sh:39` 只校验 `https://` 前缀 → 示例值直接通过；`.env.production.example:42` `SMTP_FROM=no-reply@manga.example.com`；`docs/部署手册.md:107-111`（§3.3）首发访问形如 `http://127.0.0.1:3005`，而 `docs/部署手册.md:212`（§4.1 第 4 步）才提醒「同步 `.env` 为 https，否则登录 403」；`docker-compose.yaml:51-54` 的注释也提示 CORS 不匹配会导致 403。
- 影响：忘改域名 → 真实域登录被 CORS/Origin 校验拒绝（表现为「明明部署成功却登录不了」）；按手册顺序（先 §3 明文后用 §4 TLS）必然经历一次 `.env` 改动与一次 403 窗口，叠加 DEP-04（更新命令不带 TLS override）后状态更易漂移。
- 复现步骤（静态）：`grep -n 'example.com' .env.production.example`；`sed -n '39,40p' scripts/deploy.sh`。
- 建议修复：预检拒绝 `manga.example.com`/`example.com`（示例值黑名单）并要求 `CORS_ORIGINS` 与 `PUBLIC_APP_URL` 同域；§3.2 明确「填真实域名，且与当前访问形态（http/https）一致」，把 §4 的 https 同步前置为检查项。
- 验证方式：把 `.env` 的域名改回 `manga.example.com` 后 `--preflight-only` 应 die；用真实域访问登录 API 不应出现 403。

### [MEDIUM] DEP-14 TLS 证书缺失无预检、续期靠手工 hook、无证书到期监控

- 证据：`docker-compose.tls.yaml:19` 挂载 `./deploy/certs:/etc/nginx/certs:ro`，而仓库 `deploy/` 下只有 `nginx-tls.conf`（`deploy/certs` 不存在，`.gitignore:93` 刻意忽略）→ Docker 会创建 root 属主空目录，nginx 因缺证书启动失败并反复重启；`deploy/nginx-tls.conf:18-19` 固定 `fullchain.pem`/`privkey.pem` 路径；`docs/部署手册.md:196` 说明 HTTP-01 签发前需 `docker compose stop frontend`；`docs/部署手册.md:223-229` 续期依赖手工 deploy-hook（cp + `nginx -s reload`）；`scripts/health-check.sh`（66 行）**无任何证书检查**。
- 影响：首次 TLS 启动失败的报错来自 nginx 容器日志而非部署脚本预检（排查成本高）；证书到期无监控 → 全站不可访问；续期完全依赖人工 cron，漏一次即事故。
- 复现步骤（静态；未启动容器）：`ls deploy/` → 仅 `nginx-tls.conf`；`grep -rn 'certs\|ssl' scripts/health-check.sh` → 0 命中。
- 建议修复：部署前校验 `deploy/certs/{fullchain,privkey}.pem` 存在且私钥权限 600；health-check 增加 `openssl s_client -connect 127.0.0.1:443` 剩余天数 <21 天告警；手册 §4 增加证书目录属主/权限说明。
- 验证方式：证书缺失时 `--preflight-only` 应 die；到期前 21 天 health-check 应 FAIL。

### [LOW] DEP-15 杂项：TLS 参数与占位 server_name、mailpit latest 与 8025 绑全网卡、BuildKit 默认关、`source .env` 执行语义、arm64→amd64 未 pin

- 证据：
  - `deploy/nginx-tls.conf:20-21` 仅 `TLSv1.2 TLSv1.3` + `ssl_ciphers HIGH:!aNULL:!MD5`（未排除 3DES、无 `ssl_prefer_server_ciphers`、无 OCSP stapling、无 `ssl_session_cache`）；`:9,:16` `server_name _` 占位（手册 `:210` 已提醒替换）。
  - `docker-compose.yaml:104` `image: axllent/mailpit:latest`、`:108-109` `"8025:8025"`（0.0.0.0）仅靠 `:106-107 profiles: [dev]` 门控 → 误加 `--profile dev` 即把假邮件收件箱（含全部邮件正文/令牌）暴露到网络。
  - `scripts/deploy.sh:67` `DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-0}"`（默认关闭 BuildKit）；`:32` `set -a; source .env; set +a` → `.env` 内容按 shell **执行**（本仓库 `.env` 的 `$(...)` 因此被真实执行，见 DEP-01；也意味着能写 `.env` 者可执行任意命令）。
  - 架构：`docs/部署手册.md:159-181`（§3.7）给了正确路径（服务器上构建，或 `buildx --platform linux/amd64`），但 compose 未 pin `platform:` → 在 macOS/arm64 上 `docker compose build` 产出的镜像若被分发到 amd64 宿主会 `exec format error`（`argon2` 与 `postgresql16-client` 均为原生产物）。**未验证**（本轮未构建任何镜像）。
  - 工具链与手册不一致：`grep -n 'deploy.sh' docs/部署手册.md` → **0 命中**，而 `.env.production.example:4` 指示执行 `./scripts/deploy.sh`；手册 §7.1（`:356-368`）的回滚说法与脚本 `:previous` 机制是两套。
- 影响：中低（组合后放大）；`source .env` 的代码执行语义与 DEP-01 是同一根因的两面。
- 建议修复：套件补 `!3DES`、开启 `ssl_prefer_server_ciphers` 与 session cache；mailpit 端口改 `127.0.0.1:8025:8025`；BuildKit 默认开；`.env` 解析改为只读 `grep`/`env_file`；手册补一节「用 deploy.sh 还是手工命令」并统一回滚说法。
- 验证方式：`docker compose config | grep -c '127.0.0.1:8025'`；`grep -n '3DES' deploy/nginx-tls.conf`。

---

## 已核实无问题（附证据，避免过度报告）

1. **网络收敛（db/api）**：postgres 只 `expose 5432`（`docker-compose.yaml:19-20`，注释「不映射宿主机端口」）、api 只 `expose 3001`（`:42-43`）→ 5432/3001 不经宿主暴露；与 `docs/部署手册.md:10`（只开放 80/443）一致。**问题只在 frontend 的 `3005:80`（DEP-03）。**
2. **必需变量的 fail-fast**：`${VAR:?}` 共 7 个（`docker-compose.yaml:50,53,54,56,57,58,59`）→ POSTGRES_PASSWORD / CORS_ORIGINS / PUBLIC_APP_URL / MODEL_ENC_KEY / REQUEST_HMAC_KEY / EMAIL_DELIVERY_KEY / IP_HMAC_SALT 缺失时 compose 拒绝启动（与手册 `:29` 声明一致）。
3. **镜像不带密钥/源码外泄面**：`.dockerignore:18-26` 与 `server/.dockerignore:7-8` 排除 `.env`、`.env.*`、`backups`、`coverage`、`server/test`；`git ls-files | grep -i env` 仅 `.env.example`/`.env.production.example`（空值/示例），无真实 `.env`、无证书。
4. **日志轮转已配**：`docker-compose.yaml:2-6` `x-default-logging`（json-file、max-size 10m、max-file 3）被各服务引用；手册 §5.2（`:282-291`）一致。
5. **备份路径三处一致**：`server/Dockerfile.server:6` `WORKDIR /app` + `docker-compose.yaml:85-86` `backups:/app/backups` + `scripts/health-check.sh:44-52` 检查 `/app/backups` 新鲜度（≤26h）+ `scripts/backup-now.sh:11` `docker exec -w /app` → 产物落卷、不随容器重建丢失。
6. **health-check 可用于告警**：`scripts/health-check.sh:65-66` 明确 `exit 0/1`，`set -uo pipefail`（无 `-e`，不会静默中断）；复用点是 DEP-08 的端口假设（需 `PUBLIC_PORT` 配合）。
7. **mailpit 生产默认不启动**：`docker-compose.yaml:106-107` `profiles: [dev]`，手册 §8.6 说明启动方式（误用风险见 DEP-15）。
8. **TLS 形态的传输层加固存在**：`deploy/nginx-tls.conf:7-11` HTTP→HTTPS `return 301`、`:55,:69` `Strict-Transport-Security "max-age=31536000; includeSubDomains"`、`:20` `TLSv1.2 TLSv1.3` → **前提是显式叠加 `-f docker-compose.tls.yaml`**（默认 `nginx.conf` 无 HSTS、无跳转，见答复 F1）。
9. **破坏性命令被显式禁止**：手册 §7.2（`:388`）「严禁 `docker compose down -v`」；回滚文档 `docs/database-rollback.md:15-20` 要求先 `pg_dump`、逆序、禁止 CASCADE 删除用户内容。
10. **备份加密机制存在**（但默认关闭）：`BACKUP_AGE_RECIPIENT` 由 compose `:84` 透传、`server/Dockerfile.server:11` 已装 `age`、手册 §6 提供 age 密钥生成与解密演练；`scripts/deploy.sh:45` 只在为空时警告 → 属 DEP-12 的漏项而非缺失。

## 未验证 / 未覆盖（本轮显式声明）

- **未执行** `scripts/deploy.sh`、**未执行** `docker compose up/build/down`（任务硬约束）→ DEP-03/04/07/14 的运行时行为（明文可达性、TLS 启动失败、回滚是否触发）均为**静态推断 + Bash/compose 语义可独立验证**，未做端到端实测。
- 未在真实 Windows Server / IIS / ARR 上验证手册 §4.2 方案 B；手册自承「`127.0.0.1:3005:80` 回环绑定」与「客户端 IP 归并」为待办（`:250,:264`）。
- 未对 `docker-compose.tls.yaml` 执行 `docker compose config` 验证 `!override` 解析（本机 Compose v5.1.4 满足手册要求 v2.24+，仅确认了 `docker compose --env-file .env config` 对基础文件可用）。
- 未审计 `server/backup.js` / `server/scripts/backup-encrypt.js` 实现（属数据恢复域），仅确认路径/时点/开关的部署侧一致性。
- 未逐项 diff `.env` 与 `.env.production.example`（只抽查安全开关：COOKIE/CAPTCHA/EMAIL_VERIFICATION/RATE_LIMIT）；未确认 `.env` 中 `SMTP_*` 是否指向真实可用 SMTP（不读取值）。
- 未读取任何真实密钥值（仅形态与长度），遵守「不改 `.env`、不读密钥」约束。
- **本报告对跨域结论只做部署侧判定**：`server/index.js` 中间件顺序、RLS 绕过（GW-02/SEC-07）、上游 SSRF（GW-01）等应用层细节以其各自报告为准。

## 两个分叉结论（队长指定必答）

**分叉 A：GW-01（非 production 时退化密钥 + 放行 127.0.0.1）在生产能否被环境绕过？—— 否（不存在手册支持的非 compose 生产启动路径）。**

- 关键证据：`docker-compose.yaml:45`（api）/`:126`（frontend）**硬编码** `NODE_ENV=production`，compose 的 `environment` 显式赋值优先于任何 `.env` 透传；手册 `docs/部署手册.md:38` 亦声明「compose 把 api/frontend 固定为 production，此处仅影响本地脚本」；手册给出的全部生产命令（`:110` §3.3、`:275` §5.1、`:217` §4.1）均为 compose。
- 穷举证据：`grep -rn 'NODE_ENV|npm start|systemd|pm2' docs/部署手册.md scripts/*.sh docker-compose.yaml` 命中仅手册 `:38`、`:227`（certbot 的 systemd timer，与 Node 无关）、`scripts/deploy.sh:41`、`docker-compose.yaml:45,126` → **没有 systemd unit / pm2 / `node index.js` 的生产部署说明**。
- 注意两处弱门：`scripts/deploy.sh:41` 只是 `grep -q '^NODE_ENV=production' .env`（校验文本，对容器无效）；`server/package.json:7` `start: node index.js` 与 `start-all.sh:31`（`npm run dev`）都不设 `NODE_ENV` → **运维若脱离手册用 `npm start`/pm2 启动，GW-01 立即复活**（退化密钥 + localhost 逃逸阀）。
- 结论：GW-01 在本仓库的**受支持部署路径**下为条件性/环境门未绕过；建议把它变成部署方式无关的硬约束（`server/index.js` 启动断言 + `crypto.js` 的 dev 回退需显式 `ALLOW_DEV_CRYPTO_KEY=true`）。

**分叉 B：`.env` 的 `$(openssl rand -hex 32)` 字面量在 compose 下是否原样传入容器？—— 是（已实测）。**

- 实测命令（只读，未启动任何容器）：`docker compose --env-file .env config | grep -c 'openssl rand'` → **`6`**。即 Compose 变量替换**不做 shell 命令替换**，`.env` 的值按字面量写入 api 容器环境；密钥材料 = `sha256(<公开字面量>)`，跨所有部署恒定。
- 干扰项：`scripts/deploy.sh:32` `set -a; source .env` **会**执行命令替换 → 预检看到的是随机值，因此脚本不报错、问题被掩盖（DEP-01）。
- 正确形态：`openssl rand -hex 32` 的**输出**（64 位 hex）粘贴进 `.env`；`docs/部署手册.md:63,65` 就是这么写的，模板 `.env.production.example:49-51` 也留了空值位；建议预检加 `^[0-9a-f]{64}$` 正则（DEP-12）。

## 追加：对 01-security.md（sec-auditor）三项事实的答复

### F1 生产是否启用 TLS 与 HSTS？—— **默认路径：否；显式 TLS 形态：是，但不可持续**（视部署形态而定）

- **默认路径无 TLS**：`docker-compose.yaml:123-124` `ports: - "3005:80"`，`nginx.conf:2 listen 80`，且 `nginx.conf` **全文无 HSTS、无 HTTP→HTTPS 跳转**（`grep -n 'Strict-Transport-Security' nginx.conf` → 0 命中；仅 `deploy/nginx-tls.conf:55,69` 有）。手册 §3.3（`:110`）的首发命令就是这个形态，而 §4 TLS 是「之后」的步骤。
- **TLS 形态确有跳转与 HSTS**：`docker-compose.tls.yaml:12-19` 才挂载 `deploy/nginx-tls.conf` 与 `deploy/certs`；`deploy/nginx-tls.conf:7-11` 80→443 `return 301`、`:55,:69` HSTS `max-age=31536000; includeSubDomains`、`:20` `TLSv1.2 TLSv1.3`。
- **不可持续的证据（DEP-04）**：`scripts/deploy.sh:10` 的 `COMPOSE="docker compose --env-file .env"` 与手册 §5.1（`:275`）的更新命令**都不带 `-f docker-compose.tls.yaml`**（全手册只有 `:217` 首次启动带）→ 下一次发布或脚本回滚都会把 frontend 重建回 `3005:80` 明文形态、丢掉 TLS 配置与证书挂载。
- 对 SEC-01/SEC-06/SEC-09 的影响面判定：**「传输层明文」在生产默认可达**，且 TLS 一旦启用也可能在后续发布中被静默退回明文；不要把「已配 TLS」当作长期前提。

### F2 忘配 `SMTP_HOST` → 令牌明文进容器日志，在生产是否可触发？—— **可触发，门禁不兜底**

- 门禁链：`docker-compose.yaml:70` `SMTP_HOST=${SMTP_HOST:-}`（空默认，非 `:?`）；`.env.production.example:36` `SMTP_HOST=`（模板即空值）；`scripts/deploy.sh:34-45` 预检的 9 项**不含任何 SMTP 变量**。
- 缺 SMTP 时的行为：`server/auth/outbox.js:107-109` `getTransporter()` → `const host = process.env.SMTP_HOST; if (!host) return null;`；`:124-131` `sendMail` → `if (!t) { console.log(\`[mail:dev] to=${mail.to} subject=${mail.subject}\n${mail.text}\`); return; }`。而邮件正文含一次性动作链接：`outbox.js:92` `actionUrl('/reset-password', token)`、`:98` `actionUrl('/bootstrap', token)`（验证邮件同样带 token）→ **完整令牌进入容器 stdout**，再经 `docker-compose.yaml:2-6` 的 json-file 驱动落到宿主机磁盘（`docker compose logs` 可读，手册 §5.2 就是教这个命令）。
- 代码注释 `outbox.js:127-129` 自称「Production never reaches this branch without SMTP configured」，但这只是注释：**无运行时断言、无预检、无告警**（`NODE_ENV=production` 时同样走该分支）。
- 结论：**是**；影响面为账号接管（verify/reset 令牌）与管理员一次性激活（bootstrap 令牌）。建议 compose 用 `SMTP_HOST:?` 或在 deploy.sh 预检 `need SMTP_HOST`，且 outbox 在 production 且无 SMTP 时抛错而非打印正文。

### F3 CAPTCHA 生产默认值？—— **默认 false（可被覆盖），且即使 `true` 该门也无效（确认 SEC-01）**

- 默认/覆盖：`docker-compose.yaml:64-65` `CAPTCHA_ENABLED=${CAPTCHA_ENABLED:-false}`（全仓唯一写入点）；`server/auth/captcha.js:14` `captchaEnabled = () => process.env.CAPTCHA_ENABLED === 'true'`（每请求读取，未设即 false）。
- 文档形态：`.env.example` **无** `CAPTCHA_ENABLED`（手册 §3.2 `:96` 让 `cp .env.example .env`）；`.env.production.example:28-29` 有 `CAPTCHA_ENABLED=true` 并注明「生产必须 true」；手册 §2 表格（`:31-66`）**无该行**（`grep` 全仓仅 compose:65 命中）；`scripts/deploy.sh` 预检也不含它 → **按手册操作即以关闭状态上线**（DEP-02）。
- SEC-01 复核（本域仅作交叉确认，结论归属 01-security.md）：`server/auth/captcha.js:33-42` 把答案字符逐个以 `<text ...>${ch}</text>`（`:40`）写入 SVG，`:61` 逐字符拼接答案、`:64` 返回 `{ captchaId, svg: renderSvg(answer) }`；`verifyCaptcha`（`:68-76`）只是 `text.trim().toLowerCase() === entry.answer`。客户端用正则 `/<text[^>]*>([a-z0-9])<\/text>/g` 即可读出 4 字符并直接通过 → **该门对脚本化攻击不构成门槛**。
- 结论：F3 = **是（默认关闭）**；叠加 SEC-01，「开启」也不能视为防护。二者应一起修（默认值改 `:?`/true + 不再把答案作为文本节点写入 SVG）。

## 跨域标注

- **DEP-06 / DEP-01 与 01-security.md 的关系**：GW-01（`crypto.js:11-18` 退化密钥、`upstream.js:79-80` 放行 127.0.0.1）的严重度取决于部署形态，本报告的**分叉 A 判定为「否（无受支持的非 compose 路径）」**，可据此把 GW-01 从「必然」降为「条件性」，但**不建议**据此降级修复优先级——自建 systemd/pm2 启动是现实存在的运维行为。
- **GW-02 与 SEC-07 同根因**（api 以 `DB_USER=postgres` 超级用户连接，RLS 被 BYPASSRLS 绕过；`GET /providers`（`server/routes/model-gateway.js:104-118`）与 `GET /models`（`:322-338`）无 owner 过滤）：本报告不重复论证，**保留结论并注明同源**；部署侧的相关事实是 `docker-compose.yaml:46-50`（`DB_USER=postgres`、无 `DATABASE_URL`，故无法通过连接串切换受限角色）。

## 建议处置顺序（部署域）

- **P0（阻断上线）**：DEP-01（密钥字面量→粘贴 64 位 hex）、DEP-02（CAPTCHA 默认关 + 预检）、DEP-03（3005 绑回环或开机即 TLS）、DEP-04（发布/回滚命令统一带 TLS override）、F2（SMTP 门禁 + outbox 生产断言）。
- **P1（上线前完成）**：DEP-05（`.env.example` 的 `COOKIE_SECURE=false`）、DEP-06（`server/index.js` 启动断言，消除对 compose 的隐性依赖）、DEP-07（回滚覆盖健康检查/冒烟失败 + 部署前 `pg_dump` + 003+ 迁移逆 SQL 策略）、DEP-08（`PUBLIC_PORT` 与 TLS 形态一致）。
- **P2（排期）**：DEP-09 ~ DEP-15。

计数复核：BLOCKER 4（DEP-04 为条件性）、HIGH 4、MEDIUM 7、LOW 1，合计 **15**。 
