# Contributing Guide

感谢你考虑为 Manga Studio（漫剧工场）贡献代码！请阅读以下指南。

## 开发环境准备

```bash
# 核心工具版本（通过 mise/asdf/nvm 管理）
Node.js    22.x
Python     3.14.x
Go         1.26.x
Rust       1.95.x
Java       26.x

# 依赖安装
pnpm install        # 根目录（前端 + Electron）
cd server && npm install   # 后端
```

## 分支策略

| 分支 | 用途 | 保护 |
|------|------|------|
| `main` | 仅发布标签，受保护 | ✅ |
| `feat/*` | 功能开发，PR 合入 `main` | - |
| `fix/*` | 缺陷修复，PR 合入 `main` | - |
| `release/*` | 发布准备，仅版本号/CHANGELOG | - |

**禁止**直接推送到 `main`。

## Commit 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)：

```
<type>(<scope>): <subject>

<body>

<footer>
```

| type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `refactor` | 重构（无功能变更） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `docs` | 文档更新 |
| `chore` | 构建/工具/依赖维护 |
| `security` | 安全加固 |

示例：
```
feat(video): add minimax adapter via factory
fix(auth): captcha answer leakage in SVG text nodes
refactor(model-registry): split into 8 modules
```

## PR 流程

1. **从 `main` 切分支**：`git checkout -b feat/your-feature main`
2. **开发 + 测试**：
   ```bash
   npm run test:all    # 前端 216 + 后端 160 = 376 passed
   npx tsc --noEmit    # 类型检查
   npm run build       # 生产构建
   ```
3. **自检清单**（PR 描述中勾选）：
   - [ ] `npm run test:all` 全绿
   - [ ] `npx tsc --noEmit` 无错误
   - [ ] `npm run build` 成功
   - [ ] 新增/修改功能有对应测试
   - [ ] CHANGELOG.md 已更新（`## [Unreleased]` 段）
4. **提交 PR**：目标分支 `main`，填写模板
5. **Code Review**：至少 1 人 Approve，CI 绿灯后可合并
6. **合并方式**：Squash and merge（保持历史整洁）

## 代码风格

- **TypeScript/TSX**：`eslint` + `prettier`（根目录 `.eslintrc.cjs` / `.prettierrc`）
- **Python**：`ruff` + `black`（`server/` 目录）
- **Go**：`gofmt` / `golangci-lint`
- **Rust**：`rustfmt` / `clippy`
- **Shell**：`shellcheck`（`scripts/` 目录）

提交前自动格式化：
```bash
npx prettier --write .      # 前端
cd server && npm run lint   # 后端（含 ruff/shellcheck）
```

## 测试要求

| 类型 | 覆盖率要求 | 运行命令 |
|------|------------|----------|
| 单元测试 | 新增代码 ≥ 80% | `npm run test:all` |
| 集成测试 | 关键路径必覆盖 | `cd server && npm test` |
| E2E | 核心用户流程 | 手动 / CI 后续接入 |

- **新增功能必须有测试**，修复 Bug 必须加回归测试
- 测试文件命名：`*.test.ts` / `*.test.tsx` / `*_test.py` / `*_test.go`

## 安全规范

- **禁止**提交任何密钥/Token/私钥（`.env` 已在 `.gitignore`）
- 依赖更新前跑 `npm audit` / `pip-audit` / `cargo audit`
- 涉及认证/授权/支付/加密的变更，**必须**标记 `security` 类型并请安全审核
- 发现安全漏洞请走 `SECURITY.md` 流程，**勿公开 Issue**

## 发布流程

仅维护者执行：

```bash
# 1. 切 release 分支
git checkout -b release/v0.1.0 main

# 2. 更新版本号 + CHANGELOG
npm version minor --no-git-tag-version
# 手动编辑 CHANGELOG.md 移动 [Unreleased] → [0.1.0] - YYYY-MM-DD

# 3. 提交 PR 合并到 main
# 4. 打标签触发 CI/CD
git tag v0.1.0 && git push origin v0.1.0
```

---

## 行为准则

遵循 [Contributor Covenant](https://www.contributor-covenant.org/zh-CN/version/2/1/code_of_conduct/)：
- 尊重、包容、建设性
- 拒绝骚扰、歧视、人身攻击
- 关注技术问题，而非个人

---

## 联系方式

- 技术讨论：GitHub Discussions / PR 评论
- 安全漏洞：见 [SECURITY.md](SECURITY.md)
- 紧急联系：项目维护者邮箱（见 `package.json` `author`）