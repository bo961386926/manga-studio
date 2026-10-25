# 构建 / 类型 / 测试 / 仓库卫生审查报告（T-build）

- 审查目标：当前工作树，分支 `feat/public-model-platform`，HEAD `8fd19fd`（`git rev-parse --abbrev-ref HEAD`；上游 `origin/feat/public-model-platform`）。
- 审查视角：准备上线的生产部署（docker compose：nginx 前端 + Express api + postgres:16）。
- 方法：**真实执行**类型检查 / 前后端测试 / 生产构建 / 依赖审计；只读静态取证（`git ls-files`、`git diff`、`grep`、`wc`、`du`、Docker/Postgres 只读探测）。
- 硬约束遵守：未修改任何源码 / 配置 / 测试文件；未 `git add|commit|push|merge|checkout|stash`；未改 `.env`；未 `docker compose up`。产物仅 `dist/`、`coverage/`（构建与覆盖率预期产物）与本报告。
- 审查时刻：2026-10-13 09:20–09:45（本地 macOS，Node 22 环境）。

---

## 一、执行结果表

| 命令 | 退出码 | 结论 | 关键输出摘录 |
|---|---|---|---|
| `npx tsc --noEmit` | 0 | 通过 | 无任何诊断输出（仅 `npm notice run 'tsc' --noEmit`）；前端 0 类型错误 |
| `pnpm test`（vitest run） | 0 | 通过 | `Test Files 15 passed (15)` / `Tests 126 passed (126)` / `Duration 2.27s` |
| `npx vitest run --coverage` | 0 | 通过但口径无意义 | 126/126 通过；`All files 50.6% Stmts / 93.75% Branch / 14.28% Funcs`；仅 2 个文件纳入 |
| `pnpm build`（vite build） | 0 | 通过（有告警） | `✓ built in 3.53s`；`dist/assets/index-Eoj1bSXW.js 680.43 kB │ gzip: 194.08 kB`；5 条 `(!) ... dynamically imported ... but also statically imported`；1 条 `Some chunks are larger than 500 kB` |
| `cd server && npm test`（第 1 次） | **1** | **失败** | `# tests 160 / # pass 158 / # fail 2`；`not ok 46/47`，`server/test/image-reference.test.js:115`，`failureType: 'hookFailed'`，`error: 'fetch failed'`（`TypeError`） |
| `cd server && npm test`（第 2 次，同 commit 同库） | 0 | 通过 | `# tests 160 / # pass 160 / # fail 0 / # skipped 0` |
| `cd server && NODE_ENV=test DB_NAME=manga_studio_test node --test test/image-reference.test.js`（单文件） | 0 | 通过 | `# tests 2 / # pass 2 / # fail 0` → 失败不可在单文件复现 |
| `npm audit --omit=dev`（根目录） | 1 | **未能执行** | `npm error code ENOLOCK` / `This command requires an existing lockfile.` / `loadVirtual requires existing package-lock.json file`——根目录用 pnpm，无 `package-lock.json` |
| `pnpm audit --prod`（根目录，等价替代） | 1 | 有漏洞 | `4 vulnerabilities found` / `Severity: 1 low │ 2 moderate │ 1 critical`（critical = `proxy-addr`，low = `body-parser`，moderate = `qs` ×2） |
| `cd server && npm audit --omit=dev` | 1 | 有漏洞 | `5 vulnerabilities (3 moderate, 1 high, 1 critical)`（critical = `proxy-addr`，high = `nodemailer`，moderate = `body-parser`/`express`/`qs`） |
| `cd server && npm ci --dry-run` | 0 | 锁文件一致 | `up to date in 399ms`（`server/package-lock.json` 与 `package.json` 无漂移） |
| `git status --short` | 0 | 无未提交改动 | 唯一输出 `?? .agent-teams/` |
| `git diff --stat` / `git diff --cached --stat` | 0 | 空 | 无任何未提交/暂存改动（0 文件） |
| `git log --oneline main..HEAD` | 0 | 62 commits | 顶部 `8fd19fd fix(auth): #/bootstrap?token= …` |
| `git diff --stat main..HEAD` | 0 | 差异规模大 | `190 files changed, 20927 insertions(+), 12605 deletions(-)` |
| `docker ps` | 0 | 环境可用 | `neiwang-pg postgres:15-alpine Up 11 hours (healthy) 0.0.0.0:15432->5432`；`manga-studio-db postgres:16-alpine Exited (0) 4 days ago` |
| `pg_isready -h 127.0.0.1 -p 5432` | 0 | 可用 | `127.0.0.1:5432 - accepting connections` |
| `psql -p 5432 -lqt \| grep manga_studio_test` | 0 | 存在 | `manga_studio_test | wuxb | UTF8` |
| `PGPASSWORD=postgres psql -U postgres -d manga_studio_test -c 'select current_database()'` | 0 | 可连 | `manga_studio_test | postgres` → **server 测试前置环境齐备，测试已真实执行（非「环境不可用」）** |

> 说明：`npx vitest run --coverage` 与 `pnpm test` 结果一致（同一 15 文件 / 126 用例），覆盖率报告是判定口径问题的唯一依据，故单列。

---

## 二、审查对象校准（与任务预设不符的一处事实）

- 任务预设「未提交改动 = AuthPage 目录 + `tests/auth-page-hash.test.ts` + `services/authClient.ts`」。
- **实况：工作树未提交改动为零**（`git status --short` 仅 `?? .agent-teams/`；`git diff --stat` 为空）。上述改动已于 HEAD `8fd19fd` 提交，即本次审查的「工作树」= 该提交的内容：

```
$ git show --name-status HEAD
M  components/AuthPage.tsx
A  components/AuthPage/hashAction.ts
M  services/authClient.ts
A  tests/auth-page-hash.test.ts
$ git show --stat HEAD
4 files changed, 110 insertions(+), 25 deletions(-)
```

- 影响：不存在「半成品未提交代码」被漏审的风险；但 TDD 声称的「先红后绿」无法从工作树取证（测试与实现同批入库，见 BUILD-10）。

---

## 三、汇总表

| ID | 严重度 | 标题 | 证据位置 | 已复现 |
|---|---|---|---|---|
| BUILD-01 | HIGH | 服务端测试套件不稳定（flaky）：同 commit 两次运行 158/160 与 160/160 | `server/test/image-reference.test.js:28,62,115` | 是（跑 3 次：2 失败 / 全绿 / 单文件全绿） |
| BUILD-02 | HIGH | 覆盖率口径失真：`coverage.include` 仅 2 个文件，`include` 的 `components/**`、`services/**` 命中 0 个测试 | `vitest.config.ts:12-17,25-29` | 是（命令输出） |
| BUILD-03 | MEDIUM | 上线前无任何端到端保障；`exclude: '**/*.e2e.test.ts'` 是空规则（并不存在被排除的 e2e 文件） | `vitest.config.ts:19`；全仓 `find` 无 `*.e2e.test.ts` | 是 |
| BUILD-04 | MEDIUM | 生产依赖含 1 critical + 1 high 已披露漏洞（`proxy-addr` IP 欺骗、`nodemailer` 高危项含 SMTP 凭据泄露） | 根 + server 的 `npm/pnpm audit` 输出 | 是 |
| BUILD-05 | MEDIUM | 前端生产镜像构建不可复现：镜像内 `npm install`（无根锁文件）按 `^` 重新解析；构建上下文未排除 `.pnpm-store`/`.worktrees`（约 1.5 GB） | `Dockerfile:1-20`；`.dockerignore`（缺 `.pnpm-store`、`.worktrees`） | 是（静态） |
| BUILD-06 | MEDIUM | 双包管理器 / 双锁文件：`server/` 不在 pnpm workspace（`pnpm-workspace.yaml` 无 `packages`），根 22/23 依赖与 server 5/5 依赖全用 `^` | `pnpm-workspace.yaml:1-7`；`package.json:19-45`；`server/package.json:11-17` | 是（静态） |
| BUILD-07 | LOW | 前端生产源码残留 94 处 `console.log` 调试日志（services 86 / components 5 / App.tsx 3），含密钥命中路径日志 | `services/modelRegistry.ts:593-631`；`services/geminiService.ts:67-79` | 是（静态） |
| BUILD-08 | LOW | 生产包单 chunk 680.43 kB（gzip 194.08 kB）超阈值；5 个模块动态+静态混用导入使 `import()` 无法分块 | `pnpm build` 输出；`services/modelGatewayClient.ts`、`modelRegistry.ts`、`gatewayModels.ts`、`geminiService.ts`、`authClient.ts` | 是（命令输出） |
| BUILD-09 | LOW | 无 lint / format 门禁：无 eslint/prettier 配置、无 `lint` 脚本、CI 无 lint 步骤 | 根目录 `ls`；`package.json:6-17`；`.github/workflows/ci.yml` | 是（静态） |
| BUILD-10 | LOW | 新增用例与实现同批提交，`hashAction` 的 TDD 时序无法取证；未提交改动为零（见 §二） | `git show HEAD` | 是（命令输出） |
| BUILD-11 | LOW | `tsc` 覆盖面不含 `server/`、`scripts/`、`electron/`、`vite.config.ts`、`vitest.config.ts`；`tsconfig.json` 允许 `allowJs` 但无 `checkJs` | `tsconfig.json:1-40` | 是（静态） |
| BUILD-12 | LOW | 发布物 `release/` 不存在，Electron 打包未产出且不在 CI 范围（`release.yml` 只 zip `dist/`） | `package.json:16-18`；`electron/`（仅 `main.cjs`+`preload.cjs`）；`.github/workflows/release.yml` | 是（静态） |
| BUILD-13 | LOW | 服务端用例计数虚高：`test/helpers.js` 被 `node --test` 当作用例执行（`ok 14 - test/helpers.js`），另有 3 个空 suite 桩 | `server/test/helpers.js`；`server-test` 输出 `# suites 3`/`# tests 160` | 是（命令输出） |
| BUILD-14 | LOW | 仓库卫生总体通过（0 密钥入库），但工作树 3.3 GB；`recovered-assets/` 含 10 个以第三方 IP 角色名命名的素材（未入库） | `du -sh`；`recovered-assets/character-韩立-*.png` 等 | 是（静态） |

**按严重度计数：BLOCKER 0 / HIGH 2 / MEDIUM 4 / LOW 8（合计 14）。**

**仓库卫生关键结论（对应清单 5）：无密钥入库，无 BLOCKER。** 逐项抽查结果：

| 路径 | 被跟踪文件数 | 结论 |
|---|---|---|
| `node_modules/` | 0 | 未入库 ✅ |
| `dist/` | 0 | 未入库 ✅ |
| `coverage/` | 0 | 未入库 ✅ |
| `backups/` | 0 | 未入库 ✅（工作树存在 597 MB） |
| `recovered-assets/` | 0 | 未入库 ✅ |
| `.playwright-cli/` | 0 | 未入库 ✅ |
| `.worktrees/` | 0 | 未入库 ✅ |
| `promo/` | 0 | 未入库 ✅（本地仅有一个空目录 `promo/tests`） |
| `images/` | 10 | 已入库（9.0 MB 产品截图，最大 `images/镜头与帧.png` 2.1 MB，可接受） |
| `release/` | 0 | 未入库且不存在 ✅ |
| `.DS_Store` | 0 | 未入库 ✅（根目录存在 8 KB 本地文件，被 `.gitignore:40` 覆盖） |
| `.env*` | 2 | 仅 `.env.example`、`.env.production.example`；`git ls-files` 无 `.env`、无 `*.key`、无 `*.pem`、无 `age.key` ✅ |

---

## 四、发现详情

### [HIGH] BUILD-01 服务端测试套件不稳定：同 commit 两次全量运行结果不同（158/160 vs 160/160）

- 证据：
  - 第 1 次 `cd server && npm test` → 退出码 **1**：
    ```
    # tests 160
    # pass 158
    # fail 2
    not ok 46 - 带参考图的 image 调用 → 上游收到 multipart edit 请求并包含图片字节
    not ok 47 - 不带参考图的 image 调用 → 维持 JSON 快速路径
      location: '.../server/test/image-reference.test.js:115:1'
      failureType: 'hookFailed'
      error: 'fetch failed'
      stack: |- node:internal/deps/undici/undici:15157:13
               async registerAndLogin (file://.../server/test/image-reference.test.js:28:3)
               async TestContext.<anonymous> (file://.../server/test/image-reference.test.js:62:19)
    ```
  - 第 2 次 `cd server && npm test`（同 commit、同 DB、无任何代码改动）→ 退出码 **0**：`# tests 160 / # pass 160 / # fail 0`。
  - 单文件复现 → 退出码 **0**：`node --test test/image-reference.test.js` → `# tests 2 / # pass 2 / # fail 0`。
  - 触发点：`server/test/image-reference.test.js:42-62`（`test.before` 里 `await startTestServer()` 后立即 `registerAndLogin` → 第 28 行首个 `fetch`）。失败发生在**自定义 before 钩子内**，因此两条用例被整体标记失败（`hookFailed`），而非断言失败。
- 影响：① 该文件的 2 条 HTTP 全链路用例（图生图参考图不得被静默丢弃——正是历史上出过的生产缺陷）在**全量运行**时可能整组不执行，等于该回归防护间歇性失效；② `.github/workflows/ci.yml:64-69` 的 `server-test` job 会随机红，团队会被迫「重跑即绿」从而钝化对 CI 的信任；③ 上线前的「测试全绿」不能作为客观门禁（第 1 次运行即为红）。
- 复现步骤：`cd server && npm test`（触发一次，若绿则再跑一次）；对比 `node --test test/image-reference.test.js`。
- 建议修复（不在本报告范围执行）：把 HTTP 级用例的监听地址统一为 `127.0.0.1`（`server/test/helpers.js:47` 已用 `127.0.0.1`，但 `app.listen(0)` 未绑定地址，可能落到 `::` 使 `fetch` 在并发/端口回收窗口内失败）；在 `startTestServer()` 内加就绪探测与重试；把 `registerAndLogin` 移出 `before` 钩子或改为带重试的 `fetch`，避免「基础设施抖动 → 用例整组作废」。**不要**用重试掩盖：需先定位 undici 报错的 `error.cause`（本次仅打印 `fetch failed`，无 cause）。
- 验证方式：连续 `npm test` 10 次，要求 10/10 均为 `# fail 0`；CI 上对同一 commit 连续触发 5 次均绿。

### [HIGH] BUILD-02 覆盖率口径失真：只统计 2 个文件，且测试收集路径大半为空

- 证据：
  - `vitest.config.ts:25-29`：`coverage.include` 仅 `['components/StageDirector/utils.ts', 'components/StageDirector/cameraMovementGuides.ts']`（配 `exclude: ['**/*.test.ts','**/node_modules/**']`）。
  - 实测 `npx vitest run --coverage` 输出：
    ```
    All files          | 50.6 | 93.75 | 14.28 | 50.6 |
    ...ementGuides.ts  |  100 |   100 |   100 |  100 |
    utils.ts           | 21.15|  91.3 |  7.69 | 21.15|  ...107-241,244-262
    ```
  - `vitest.config.ts:12-17` 的 `include` 声明 3 条路径，但实测：`find components services -name '*.test.*' -o -name '*.spec.*'` = **0 个文件**；15 个测试文件全部位于 `tests/`。
  - 应用体量对照：`git diff --stat main..HEAD` = 190 文件 / +20927 行；前端源码文件（`components/` + `services/`）数十个，无一纳入覆盖率。
- 影响：① 「50.6%」只描述 2 个文件（其中 `utils.ts` 仅 21.15% 语句覆盖），**不能代表任何产品代码质量**；② 若在 go/no-go 中引用该数字，属于实质性误导向——真正的被测面（认证、支付、网关、导出）覆盖率**完全未知**（既未纳入统计，多数也确无用例）；③ `components/**`、`services/**` 两条 include 是空承诺，会让人误以为「组件与服务已被测试覆盖」。
- 复现步骤：`npx vitest run --coverage`；`find components services \( -name '*.test.*' -o -name '*.spec.*' \) | wc -l`。
- 建议修复：把 `coverage.include` 改为真实代码面（至少 `components/**`、`services/**`，并排除类型文件），设定**按目录的最低阈值**（thresholds per-glob）而不是全局一个数；对 `authClient`、`modelGatewayClient`、`payments`、`export` 等关键模块设硬阈值门禁，未达即 CI 红。在报告里禁止单独引用全局覆盖率数字。
- 验证方式：`npx vitest run --coverage` 输出的文件清单应覆盖 `services/`、`components/` 全部非纯展示文件；`--coverage.thresholds` 生效（人为删一条断言应使 CI 失败）。

### [MEDIUM] BUILD-03 上线前无端到端保障，且 e2e 排除规则是空规则

- 证据：
  - `vitest.config.ts:19` `exclude: [... '**/*.e2e.test.ts']`。
  - 全仓查找被排除的对象：`find . -path ./node_modules -prune -o -name '*.e2e.test.ts' -print` → **无任何输出**；`git ls-files | grep -Ei 'e2e|playwright|cypress|puppeteer'` → 无任何命中。
  - `.playwright-cli/` 仅 5 个**手工调试快照**（`console-*.log`、`page-*.yml`，2026-08-16），不是测试套件，且被 `.gitignore:58-59` 忽略。
  - `vitest.config.ts:20` `environment: 'node'`：126 条前端用例全部在 node 环境运行——无 jsdom、无组件渲染、无真实 HTTP/浏览器。
- 影响：① 上线前**没有任何**跨进程端到端验证（浏览器 → nginx → `/api` → Express → Postgres / 上游网关）；② 该 exclude 规则会产生「我们有 E2E，只是默认不跑」的错误印象，实际是从未存在，属误导性配置；③ 与 BUILD-02 叠加后，「测试全绿」实际只覆盖纯函数与客户端封装，登录/支付/导出等主链路的集成正确性无自动化证据。
- 复现步骤：`find . -name '*.e2e.test.ts' -not -path './node_modules/*'`；`ls -la .playwright-cli`。
- 建议修复：删除这条空 exclude（或保留但必须在 CI 增加独立 e2e job 与最小烟测集）；上线前至少补 1 条真实链路烟测（注册 → 登录 → 生成 → 导出），或把 `scripts/smoke*`/health-check 明确登记为**唯一**的端到端证据并在 go/no-go 中如实降级描述。
- 验证方式：CI 中存在能失败的 e2e job；删掉 nginx `/api` 反代配置时该 job 必须变红。

### [MEDIUM] BUILD-04 生产依赖存在已披露漏洞：1 critical + 1 high（服务端）

- 证据（均为只读审计，未执行 `audit fix`）：
  - `cd server && npm audit --omit=dev` → 退出码 1，`5 vulnerabilities (3 moderate, 1 high, 1 critical)`：
    - `critical` **proxy-addr 2.0.7**（`>=1.1.0 <2.0.8`）— IPv4-mapped IPv6 信任子网导致的 IP 欺骗（GHSA-jqcg-44mw-7w3h），路径 `.>express>proxy-addr`；
    - `high` **nodemailer 9.0.5**（`<=10.0.5`）— 含 `Process-global DNS cache reuses TLS servername across transports → cross-tenant SMTP credential disclosure`（GHSA-6vj9-mwq6-2f5v）、`resolveContent() bypasses disableFileAccess/disableUrlAccess`（GHSA-8m3c-c648-2xjj）等；
    - `moderate` `body-parser` / `express` / `qs 6.14.2`；均标注 `fix available via npm audit fix`。
  - `pnpm audit --prod`（根目录）→ 退出码 1，`4 vulnerabilities (1 low, 2 moderate, 1 critical)`：同样 `proxy-addr` critical（`.>express>proxy-addr`）、`qs` moderate ×2、`body-parser` low。
  - 实测安装版本：root 与 server 同为 `express 4.22.2`、`proxy-addr 2.0.7`；server `nodemailer 9.0.5`（`server/package.json:15` 声明 `^9.0.5`，被锁文件钉在漏洞区间）。
  - 根目录 `npm audit --omit=dev` **无法执行**（`ENOLOCK`，根目录只有 `pnpm-lock.yaml`），已用 `pnpm audit --prod` 等价替代——CI 也没有任何依赖审计步骤。
- 影响：① `proxy-addr` 的 IP 欺骗会影响基于 `req.ip` 的安全决策（限流、审计日志、`IP_HMAC_SALT` 哈希与 `trust proxy` 判定）；② `nodemailer` 高危项直接关联本项目「邮件含一次性 action token」的投递链路，跨租户凭据泄露属可被利用面；③ 上线后修复需重新构建镜像，成本高于现在。
- 复现步骤：`cd server && npm audit --omit=dev`；`pnpm audit --prod`。
- 建议修复：升级 `nodemailer` 到 >10.0.5 并把 `server/package.json` 的 `^` 收敛为明确范围；对 `proxy-addr`/`qs`/`body-parser` 用 `pnpm.overrides` + `npm overrides` 或在锁文件层升级（务必回归 `server/test/upstream-security.test.js`、`no-unsafe-proxy.test.js`、`security.test.js`）；在 CI 增加 `pnpm audit --prod --audit-level high` 与 `npm --prefix server audit --omit=dev --audit-level high`（对已知例外用 advisory ID 白名单并写清理由）。
- 验证方式：两条审计命令退出码为 0（或仅剩白名单项）；回归 `server` 全量测试与 `pnpm test` 仍通过。

### [MEDIUM] BUILD-05 前端生产镜像构建不可复现；Docker 构建上下文未排除约 1.5 GB 本地缓存

- 证据：
  - `Dockerfile:10-20`：仅 `COPY package*.json ./` 后直接 `RUN npm install --omit=dev --registry=${NPM_REGISTRY} && npm install --no-save --registry=... vite@^6.2.0 @vitejs/plugin-react@^4.2.0 typescript@~5.8.2 @types/node@^22.14.0 tailwindcss@^3.4.17 postcss@^8.4.0 autoprefixer@^10.4.0`。
  - 根目录**没有 `package-lock.json`**（`npm audit` 报 `ENOLOCK`；`ls package-lock.json` 不存在），只有 `pnpm-lock.yaml`；而 CI 前端 job 用的是 `pnpm install --frozen-lockfile`（`.github/workflows/ci.yml:26-36`）。
  - `.dockerignore` 排除 `node_modules / dist / release / coverage / backups / recovered-assets / server / electron / .git / .github / docs / images / promo / tests / .env*`，但**未排除 `.pnpm-store`、`.worktrees`、`.playwright-cli`、`.DS_Store`**；实测本地体积：`.pnpm-store` 769 MB、`.worktrees` 711 MB（`du -sh`），合计约 1.48 GB 会被打包进构建上下文。
- 影响：① 生产镜像里的依赖树由 `npm install` 在构建时**重新解析** `^` 范围——与本地/CI 经 pnpm 锁文件验证过的依赖树不是同一棵，出现「CI 绿、线上行为不同」的漂移，且同一 commit 在不同日期构建可产出不同产物（供应链风险：两个包全由 `^` 且无锁）；② 每次镜像构建要上传 ~1.5 GB 无意义上下文，构建慢且可能把本地缓存/废弃 worktree 内容暴露给构建守护进程。
- 复现步骤：`ls package-lock.json`（不存在）；`du -sh .pnpm-store .worktrees`；`docker build --no-cache -t t . --progress=plain`（观察上下文传输量与 `npm install` 解析结果；本次未执行，避免非必要构建）。
- 建议修复：镜像构建改用 pnpm 并 `pnpm install --frozen-lockfile`（或 `pnpm deploy --prod`），彻底去掉无锁的 `npm install`；`--no-save` 追加安装的构建期工具（vite/typescript/tailwind）应落到一个受锁控制的 devDependency 集合里；`.dockerignore` 补 `.pnpm-store`、`.worktrees`、`.playwright-cli`、`.DS_Store`、`*.md`。
- 验证方式：连续两天对同一 commit 构建镜像，`docker run --rm <img> ls -R /usr/share/nginx/html` + 资产哈希一致；构建日志显示 `--frozen-lockfile` 且未出现 `npm install` 解析；构建上下文 < 100 MB。

### [MEDIUM] BUILD-06 双包管理器 / 双锁文件，`server/` 完全在 pnpm workspace 之外；依赖范围全为 `^`

- 证据：
  - `pnpm-workspace.yaml` 全文只有 `allowBuilds: {electron, electron-winstaller, esbuild}`，**没有 `packages:` 字段** → `server/` 不是 workspace 成员，根 `pnpm-lock.yaml` 不覆盖服务端依赖。
  - 两套锁并存：`pnpm-lock.yaml`（162 KB，2026-10-01）与 `server/package-lock.json`（37 KB，2026-08-20）；两个包管理器（根 `packageManager: pnpm@11.9.0`，CI 服务端 job 用 `npm ci`）。
  - 依赖范围统计：根 `dependencies+devDependencies` 共 23 项，**22 项用 `^`**（仅 `typescript` 用 `~5.8.2`）；`server/package.json` 5 项**全部 `^`**（`argon2 ^0.41.1`、`cors ^2.8.5`、`express ^4.21.0`、`nodemailer ^9.0.5`、`pg ^8.13.0`）。
  - 一致性实测：`cd server && npm ci --dry-run` → 退出码 0、`up to date`（服务端锁文件与 package.json 当前是同步的）；`pnpm test` 触发 pnpm 依赖校验输出 `Already up to date`（根锁与 package.json 亦同步）。
- 影响：① 只靠约定而非机制保证两套锁同时更新——任一侧改动依赖只跑一个包管理器就会静默漂移（例：`nodemailer ^9.0.5` 的漏洞区间正是「锁住即中招」，见 BUILD-04）；② 新成员/CI 需同时理解两套安装语义；③ 无 workspace 约束意味着服务端不能用 pnpm 的 `--frozen-lockfile` 单一真源。
- 复现步骤：`cat pnpm-workspace.yaml`；`node -e "…统计 ^ 数量"`；`cd server && npm ci --dry-run`。
- 建议修复：把 `server` 纳入 pnpm workspace（`packages: ['.', 'server']`）并迁移到 `pnpm-lock.yaml` 单锁；若坚持 npm，则在根加 `preinstall`/CI 双校验（`npm ci` + `pnpm install --frozen-lockfile` 都必须跑），并把关键依赖（`express`、`nodemailer`、`pg`、`argon2`）由 `^` 收敛为精确版本或 `~`。
- 验证方式：`git ls-files | grep -c 'lock'` 只剩一套锁；CI 中存在同时校验两侧依赖树的 job；改一处依赖后两侧安装均报漂移。

### [LOW] BUILD-07 前端生产源码残留 94 处 `console.log` 调试日志

- 证据：`grep -rn 'console\.log' components services App.tsx index.tsx types.ts --include='*.ts' --include='*.tsx' | wc -l` → **94**（`services` 86 / `components` 5 / `App.tsx` 3）；其中会打印密钥命中路径（**不含密钥明文**，已逐条核实）：`services/modelRegistry.ts:593,598,607,615,624,631`（`[ApiKey] Found model-level key for …` 等）、`services/geminiService.ts:67,71,76,79`（`[API Key Check] ... FOUND/NOT FOUND`）；另 `components/StageScript/index.tsx:116,130,135`、`components/StageAssets/index.tsx:176,178` 打印流程与提示词长度。服务端另有 18 处（`server/**`，包含 `[DB] Tables initialized successfully`）。全仓 `debugger` 语句 0 处；`grep -E 'TODO|FIXME|XXX|HACK'` 仅 1 处假阳性（`server/test/activities.test.js:155` 的兑换码字面量 `'MSXXXXXXXXXX'`），**无 TODO/FIXME 遗留**。
- 影响：① 生产浏览器控制台向任何使用者暴露内部模型解析、密钥来源与配额路径，便于攻击者摸清网关结构；② 日志噪音淹没真实错误。不构成密钥泄露（未打印密钥值）。
- 复现步骤：上述 `grep` 命令。
- 建议修复：引入 `services/logger.ts`（按 `import.meta.env.PROD` 分级，debug 级在生产静默），把密钥相关分支日志降为 debug；构建期用 esbuild `drop: ['console']`（仅 `console.debug/log`）兜底。
- 验证方式：`pnpm build` 产物 grep 不到 `console.log`（或仅剩被允许的级别）；生产页面控制台无 `[ApiKey]`/`[API Key Check]` 输出。

### [LOW] BUILD-08 生产包单 chunk 680 kB 且动态导入无法分块

- 证据：`pnpm build` 输出 `dist/assets/index-Eoj1bSXW.js 680.43 kB │ gzip: 194.08 kB` + `(!) Some chunks are larger than 500 kB after minification`；另有 5 条 vite:reporter 警告，均为同一模块同时被**动态与静态**导入（`services/modelGatewayClient.ts`、`services/modelRegistry.ts`、`services/gatewayModels.ts`、`services/geminiService.ts`、`services/authClient.ts`，例如 `authClient.ts` 被 `components/MigrationWizard.tsx` 动态导入、同时被 `App.tsx`/`components/AuthPage.tsx`/`Dashboard.tsx`/`GatewayPanel.tsx`/`index.tsx` 静态导入），结论均为 `dynamic import will not move module into another chunk`。
- 影响：首屏需下载 680 kB（gzip 194 kB）单一 JS；代码分割意图（动态导入）实际失效，离线/弱网首屏体验差。不影响构建成功与功能正确性。
- 复现步骤：`pnpm build`（观察 `dist/assets/index-*.js` 体积与 `(!)` 警告）。
- 建议修复：对 `MigrationWizard` 这类真正按需的模块，去掉其入口处的静态引用或改为懒加载组件（`React.lazy`），使动态导入生效；配置 `build.rollupOptions.output.manualChunks` 按功能域拆分（渲染/导出/网关）；`optimizeDeps.exclude: ['@ffmpeg/ffmpeg']` 已正确保留。
- 验证方式：构建后无非预期大 chunk 警告；`dist/assets/` 出现 ≤3 个功能域 chunk 且首屏入口 < 300 kB。

### [LOW] BUILD-09 无 lint / format 门禁

- 证据：根目录 `ls -a | grep -iE 'eslint|prettier'` 无命中；`package.json:6-17` 的 scripts 无 `lint`；无 eslint/prettier 依赖（`package.json:19-45` 全文无相关包）；`.github/workflows/ci.yml` 只有 Type check / Unit tests / Build 三步。
- 影响：未使用变量、`any` 泛滥、hooks 依赖数组错误、`console.log`（BUILD-07 的 94 处）等只能靠人工发现；`tsconfig.json` 放宽项（`skipLibCheck: true`、无 `noUnusedLocals`/`noUncheckedIndexedAccess`）进一步放低门禁。
- 复现步骤：`ls -a | grep -i eslint`；`grep -n lint package.json`。
- 建议修复：加 `eslint`（`@typescript-eslint` + `react-hooks`）+ `prettier`，CI 增 `pnpm lint --max-warnings 0`；开启 `noUnusedLocals`、`noUnusedParameters`。
- 验证方式：CI 中引入一处未使用变量可使 job 变红。

### [LOW] BUILD-10 任务预设的「未提交改动」实为 HEAD 提交，改动内容已核对完整

- 证据：`git status --short` 仅 `?? .agent-teams/`；`git diff --stat` 空；`git show --name-status HEAD` = `M components/AuthPage.tsx`、`A components/AuthPage/hashAction.ts`、`M services/authClient.ts`、`A tests/auth-page-hash.test.ts`（+110/−25）。内容核对：`components/AuthPage/hashAction.ts:1-24` 为纯函数 `parseHashAction`（verify > bootstrap > reset 优先级，`TOKEN_RE` 要求 token ≥1 字符）；`services/authClient.ts:150-159` 新增 `completeBootstrap(token, password)` 调 `POST /api/auth/bootstrap-complete`；`tests/auth-page-hash.test.ts:1-37` 5 条用例覆盖 bootstrap/verify/reset/未知 hash/空 token。**未见半成品、被注释掉的逻辑、调试代码或 TODO/FIXME**；`components/AuthPage/` 目录内仅 `hashAction.ts`，组件本体仍是 `components/AuthPage.tsx`。
- 影响：① 不存在被漏审的未提交代码；② 但测试与实现同批入库，`// TDD RED-first` 注释（`tests/auth-page-hash.test.ts:1`）的时序不可验证——「先红后绿」仅剩自述，不能作为该修复有效的独立证据；③ `pnpm test` 中 `tests/auth-page-hash.test.ts (5 tests)` 确实是**新提交带来的新增防护**（vs `main`：`git log --oneline main..HEAD` 62 commits）。
- 复现步骤：`git status --short`；`git show HEAD`。
- 建议修复：流程层面——纯函数型修复先提交失败用例（可运行的 RED commit），再提交实现；上线前对 `completeBootstrap` 补一条服务端 + 客户端联动的集成用例（当前只有纯函数解析被覆盖，`fetch('/api/auth/bootstrap-complete')` 的路径/字段名无自动化校验）。
- 验证方式：`git log --oneline -2` 中出现先红后绿两个 commit；新增用例在实现回退时确实失败。

### [LOW] BUILD-11 `tsc` 覆盖面不含 server/、scripts/、electron/ 与构建配置

- 证据：`tsconfig.json:33-40` 的 `include` = `['App.tsx','index.tsx','types.ts','declarations.d.ts','components/**/*','services/**/*','tests/**/*']`，`exclude` = `['node_modules','dist','release']`。因此 `vite.config.ts`、`vitest.config.ts`、`scripts/**`、`electron/**`（`main.cjs`/`preload.cjs`）、`server/**`（含 `server/routes/*.js`、`server/model-gateway/*.js` 共 40+ KB 级文件）**均不在类型检查内**；`tsconfig.json:20` 设 `allowJs: true` 但**未启用 `checkJs`**。
- 影响：`npx tsc --noEmit` 退出码 0 只证明前端 `components/`、`services/`、`tests/` 三处无类型错误；服务端（本次上线的 API 主体，纯 JS）与构建脚本的接口漂移无静态检查（例：DTO 字段名变更只能靠服务端用例发现）。
- 复现步骤：`cat tsconfig.json`；`npx tsc --noEmit --listFiles | grep -c 'server/'`（应为 0）。
- 建议修复：新增 `tsconfig.server.json` 并用 `checkJs`+`// @ts-check` 渐进覆盖 `server/routes`、`server/model-gateway`；至少把 `server` 纳入 CI 的独立类型/语法检查（当前仅靠测试执行暴露错误）。
- 验证方式：CI 中改错 `server/routes/model-gateway.js` 的一处字段名，可被静态检查捕获。

### [LOW] BUILD-12 发布物 `release/` 未产出；Electron 打包不在本次上线与 CI 范围

- 证据：`ls -la release` → `No such file or directory`；`electron/` 仅 `main.cjs`、`preload.cjs`；`package.json:16-18` 定义 `electron:dev`/`electron:build`/`electron:build:win|mac`（`build.directories.output = "release"`，`appId com.forsearch.manga-studio`）；`.github/workflows/release.yml` 只在 `v*` tag 时 `pnpm install --frozen-lockfile && pnpm build && zip -r manga-studio-web-dist.zip dist/` 并发 GitHub Release——**不含 `electron-builder`**。
- 影响：如实说明——若本次上线口径是 Web 部署（nginx 静态 + api 容器），则 `release/` 缺失不属缺陷；若对外承诺桌面端安装包，则当前**没有任何可用发布物**，且 mac 签名/公证（`mac.target: dmg`，无 `identity` 配置）与 Windows NSIS（`signAndEditExecutable: false`）都未就绪。
- 复现步骤：`ls release`；`cat .github/workflows/release.yml`；`grep -n electron-builder .github/workflows/*.yml`。
- 建议修复：在 go/no-go 中明确「桌面端不在本次上线范围」；若在范围内，则补 `electron-builder` 的 CI job、签名与自动更新通道。
- 验证方式：`release/` 中产出带版本号的 dmg/nsis 安装包并能安装启动；或书面确认桌面端不在范围。

### [LOW] BUILD-13 服务端用例计数虚高：`test/helpers.js` 被当作用例执行

- 证据：`cd server && npm test` 的 TAP 输出含 `# Subtest: test/helpers.js` / `ok 14 - test/helpers.js`（`test/helpers.js` 是共享工具模块，不是用例文件，但因位于 `test/` 且被 `node --test` 目录发现机制收录而被执行）；同时 `# suites 3` 表明计数里含 suite 桩。汇总口径 `# tests 160` 因此包含至少 1 条非断言条目。
- 影响：用例总数被轻微高估（约 1/160，0.6%），且每次运行都会执行一次纯工具模块；不影响通过/失败判定，属口径准确性问题。
- 复现步骤：`cd server && npm test` 后在输出中 `grep 'test/helpers.js'`。
- 建议修复：把 `helpers.js` 移到 `test/utils/helpers.js` 或改名为 `helpers.mjs`（不被 `node --test` 的测试文件模式匹配）；统一以「断言数」而非「文件数」作为用例口径。
- 验证方式：输出中不再出现 `test/helpers.js` 子测试，`# tests` 与实际用例数一致。

### [LOW] BUILD-14 仓库卫生通过（0 密钥入库）；工作树 3.3 GB，`recovered-assets/` 含第三方 IP 角色命名素材

- 证据：
  - 卫生抽查见 §三 表格：`node_modules/`、`dist/`、`coverage/`、`backups/`、`recovered-assets/`、`.playwright-cli/`、`.worktrees/`、`promo/` 被跟踪文件数均为 **0**；`.DS_Store` 0；`.env*` 仅两个 example 文件；`git ls-files | grep -Ei '\.env$|\.pem$|\.key$|secret|credential|id_rsa'` 无命中（`.gitignore:63-68` 明确覆盖 `deploy/certs/`、`*.key`、`age.key`，且 `deploy/certs/` 当前不存在）。
  - `.env.production.example` 全部敏感项实测为空值占位（`POSTGRES_PASSWORD`、`SMTP_PASSWORD`、`EMAIL_DELIVERY_KEY`、`MODEL_ENC_KEY`、`REQUEST_HMAC_KEY` 均 `len=0`），**无真实密钥入库**。
  - 体积：工作树 3.3 GB（`node_modules` 1.0 G、`.pnpm-store` 769 M、`.worktrees` 711 M、`backups` 597 M、`recovered-assets` 40 M、`dist` 33 M、`public` 31 M）；`.git` 37 MB。已入库最大文件为 `images/镜头与帧.png` 2.1 MB（10 张产品截图共 9.0 MB，可接受）。
  - `recovered-assets/` 10 个文件、40 MB，文件名为真实第三方 IP 角色名：`character-韩立-asset-*.png`、`character-陈巧倩-asset-*.png`、`character-阿越-*`、`character-阿狸-*`、`character-侦探-*`（韩立/陈巧倩出自《凡人修仙传》）；`promo/` 下仅一个空目录 `promo/tests`。
- 影响：① 密钥入库这一 BLOCKER 不存在，卫生基线合格；② `.pnpm-store`/`.worktrees` 未列入 `.dockerignore` 已并入 BUILD-05（会进镜像构建上下文）；③ `recovered-assets/` 与角色命名含第三方 IP 指涉，虽未入库、不随发布物分发，但若被打包/备份/演示材料误用存在版权与商誉风险。
- 复现步骤：§三 表格中的 `git ls-files` 计数命令；`du -sh …`；`ls recovered-assets`。
- 建议修复：把 `.pnpm-store`、`.worktrees`、`.playwright-cli`、`.DS_Store` 补进 `.dockerignore`；为本地调试资产建立 `local-only/` 目录并加 README 说明「不得进入发布物/演示/对外材料」；发布流水线增加体积与「含真实素材」检查。
- 验证方式：`docker build` 上下文体积下降并复核；发布物（`dist/`+`release/`）中不含 `recovered-assets`/`promo` 内容。

---

## 五、测试真实性评估结论（对照清单 1–4）

1. **空断言 / 永真断言 / skip**：**未发现**。`grep -rnE '\.(skip|only|todo)\b|xit\(|xdescribe\('` 在 `tests/`、`components/`、`services/` 零命中；`grep` 永真模式（如 `expect(true).toBe(true)`、`expect('x').toEqual('x')`）零命中；无 matcher 的 `expect(` 4 处经人工核对均为跨行 matcher（如 `tests/video-cancel.characterization.test.ts:11,18` 的 `await expect(...)`），非空断言。
   **用例数 vs 断言数**：前端 15 文件 / **126 用例**（vitest 报告）/ **169 处 `expect(`** → 约 1.34 断言/用例，密度偏低（`tests/video-cancel.characterization.test.ts` 2 用例 2 断言、`tests/legacy-proxy-error.test.ts` 1 用例 5 断言）；服务端 160 用例 / 158–160 通过（含 1 条 `helpers.js` 非用例，见 BUILD-13）。
2. **覆盖率口径**：见 BUILD-02——覆盖的只是 2 个文件（`cameraMovementGuides.ts` 100%、`utils.ts` 21.15%），**能代表**这两个纯函数模块；**不能代表**认证、支付、网关、导出、组件渲染等任何产品面（这些文件既不在 `coverage.include`，多数也确实无用例）。
3. **e2e 排除**：见 BUILD-03——**被排除的 e2e 文件根本不存在**（全仓 0 个匹配 `*.e2e.test.ts`，也无 playwright/cypress 依赖与用例），该 exclude 是空规则；上线前无端到端保障。
4. **未提交改动完整性**：见 §二 与 BUILD-10——工作树无未提交改动，任务预设的 4 个改动已在 HEAD `8fd19fd`；内容完整、无半成品/调试代码/TODO/FIXME（唯一 `TODO-like` 命中是测试里的兑换码字面量）；唯一残留问题是 94 处 `console.log`（BUILD-07，全仓性质，非该提交引入）。

---

## 六、仓库卫生评估结论（对照清单 5–8）

5. **被跟踪文件抽查**：全部合格，**无 `.env` / 密钥文件被跟踪 ⇒ 无 BLOCKER**（详见 §三 表格与 BUILD-14）。
6. **大文件与版权**：`services/geminiService.ts` 137,330 字节单文件（全仓第 12 大文件、前端源码最大），已呈现「上帝模块」特征（94 处 `console.log` 中大部分在该目录），可维护性差 → 建议按 chat/image/video/tts 拆分（不属本次上线阻断）。`recovered-assets/`（40 MB，未入库）与 `promo/`（空，未入库）只见本地文件与空目录，**无第三方素材入库**；版权风险仅存在于「复用第三方 IP 角色名」的使用层面（BUILD-14）。仓库体积 `.git` 37 MB 健康；工作树 3.3 GB 由本地缓存构成。
7. **依赖一致性**：见 BUILD-06（双包管理器/双锁/全 `^`）+ BUILD-04（漏洞）。两套锁当前均与实际安装同步（`npm ci --dry-run` 通过、pnpm `Already up to date`），漂移风险来自机制而非现状。
8. **发布物**：见 BUILD-12——`release/` 不存在，Electron 打包未产出、不在 CI；Web 侧产物 `dist/` 可正常构建产出（33 MB，含 `index-*.js` 680 kB、`index-*.css` 69.57 kB、自托管字体与 `worker-*.js`）。

---

## 七、未验证 / 未覆盖清单（不猜、留白）

1. **CI 实跑未验证**：`.github/workflows/ci.yml` 的 `pnpm install --frozen-lockfile`、`server-test` job（postgres:16 service）本次**未实际触发**（不能在本地复现 GitHub Actions 服务容器）。本地等价证据：pnpm 依赖校验 `Already up to date`、`npm ci --dry-run` 通过、server 测试在本地 postgres 15 上真实跑通（160 用例）。
2. **`docker build` 未执行**：BUILD-05 关于镜像内 `npm install` 解析差异与上下文体积的结论基于 `Dockerfile`/`.dockerignore` 静态阅读 + `du` 实测，**未实际构建镜像**（遵守「禁止 docker compose up」，也未做非必要镜像构建）。构建上下文体积为本地实测值，镜像实际产物体积未测。
3. **Electron 打包未执行**（`electron:build` 会下载 Electron 二进制并产出 `release/`，超出本域必要性与时间预算），仅确认 `release/` 不存在与 CI 未覆盖。
4. **前端覆盖率未对全量代码统计**：未临时修改 `vitest.config.ts`（硬约束禁止），因此「真实全局覆盖率」无数字——这正是 BUILD-02 的结论：**当前无可用口径**。
5. **`server/` 的 2 个失败用例根因未定位**：未取得 undici `fetch failed` 的 `error.cause`（node:test 报告器未打印），仅确证「不可稳定复现 + 单文件不复现 + 同 commit 结果不同」，故定为构建/测试域的 HIGH 不确定性，根因排查需改测试代码（本域禁止）。
6. **`pnpm audit` 的传递依赖修复可行性未验证**：未执行任何 `audit fix`/`overrides`（会改锁文件，违反硬约束），因此 BUILD-04 的「升级后是否破坏 `express`/`nodemailer` 行为」未验证。
7. **生产构建的运行时正确性未验证**：`pnpm build` 仅证明打包成功；未启动 `vite preview`/nginx 做加载烟测（避免与其它域端口冲突，且需要真实后端）。
8. **未审计**：`server/**` 的代码正确性（属其它域）、`docker-compose.yaml` 的部署语义（属部署配置域）、密钥/凭据管理（属安全域）。

---

## 八、TOP3（对 go/no-go 影响最大）

1. **BUILD-01（HIGH）服务端测试套件 flaky**：同 commit 两次全量运行得到 158/160 与 160/160；失败用例恰是「参考图不得被静默丢弃」的回归防护，且 CI 会随机红。**任何「测试全绿」的结论都必须附运行次数，否则不成立。**
2. **BUILD-02（HIGH）+ BUILD-03（MEDIUM）测试保证强度被高估**：覆盖率只统计 2 个文件（其中 1 个仅 21%），`components/**`、`services/**` 测试收集路径命中 0 个文件，端到端文件根本不存在。→ **上线前的自动化保护实际只覆盖纯函数与客户端封装；主链路（认证/支付/网关/导出）无回归网。**
3. **BUILD-04（MEDIUM）生产依赖 1 critical + 1 high**：`proxy-addr 2.0.7` IP 欺骗（影响 `req.ip` 相关安全决策与审计哈希）+ `nodemailer 9.0.5` 含跨租户 SMTP 凭据泄露等多项高危（直接影响一次性 action token 邮件链路），且 **CI 无任何依赖审计**。

（次席：BUILD-05 前端镜像构建不可复现——线上依赖树由无锁 `npm install` 现场解析，与 CI 验证过的 pnpm 依赖树不是同一棵。）

---

## 九、结论（本域视角）

- **无 BLOCKER**：无密钥入库、类型检查通过、前端测试通过、生产构建成功、服务端测试第 2 次运行全绿。
- 但「构建/测试」这一域**不足以给出「测试有保护力」的背书**：HIGH 2 项（flaky 套件、覆盖率口径失真）+ MEDIUM 4 项（无 E2E、生产依赖 critical/high、镜像构建不可复现、双包管理器）意味着**当前测试通过 ≠ 上线风险已受控**。建议在总报告中将 BUILD-01/02/03/04/05 列为「上线前须处置或书面接受」的清单，并在 go/no-go 中把「测试全绿」的表述修正为「纯函数/客户端层 126 用例通过（服务端 160 用例 1/2 次全绿）+ 无端到端验证」。
