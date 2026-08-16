# 漫剧工场 (MangaStudio)

> **AI 一站式短剧/漫剧生成平台**  
> *Industrial AI Motion Comic & Video Workbench*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

- 项目主页: https://coderx.me/
- 源码仓库: https://github.com/bo961386926/manga-studio


**漫剧工场** 是一个面向短剧、漫剧、动态漫画与影视分镜创作者的 AI 生产工作台，目标是把故事创意快速转化为可预览、可导出、可继续剪辑的视觉资产与视频片段。

项目采用 **Script-to-Asset-to-Keyframe** 工作流：先完成剧情与分镜，再生成角色/场景资产，随后在 AI工作台中制作关键帧与视频，最后统一预览和导出。

## 界面展示

### 项目管理

![项目管理](./images/项目管理.png)

### Phase 01: 剧情创作

![剧本创作](./images/剧本创作.png)
![剧情创作](./images/剧本与故事.png)

### Phase 02: 场景角色

![角色场景](./images/角色场景.png)
![场景](./images/场景.png)

### Phase 03: AI工作台

![AI工作台](./images/导演工作台.png)
![镜头与帧](./images/镜头与帧.png)

### Phase 04: 制片导出

![制片导出](./images/成片导出.png)

### 资产管理

![资产管理](./images/提示词管理.png)

## 核心理念：关键帧驱动

传统 Text-to-Video 往往难以稳定控制角色、构图和镜头起止画面。漫剧工场引入动画与影视制作中的关键帧思路：

1. **先画后动**：先生成镜头的起始帧与结束帧。
2. **插值生成**：通过视频模型在关键帧之间生成运动过渡。
3. **资产约束**：画面生成会参考角色定妆、服装变体和场景概念图，提升角色一致性与场景连续性。
4. **流程化生产**：每个阶段都围绕同一个项目状态推进，减少反复复制提示词和手工整理资产的成本。

## 核心功能模块

### Phase 01: 剧情创作

剧情创作阶段用于把故事、小说片段或短剧创意整理为可生产的结构化内容。

- **智能剧本拆解**：输入故事大纲或正文，AI 自动生成剧本结构、角色、场景和分镜。
- **分镜规划**：按目标时长和节奏生成镜头列表，包含动作、台词、画面提示词等信息。
- **视觉化翻译**：将文字描述转为更适合图像生成模型使用的画面提示词。
- **手动编辑**：支持编辑角色描述、场景描述、镜头动作、台词和分镜画面提示词。
- **项目配置**：支持目标时长、语言、模型和视觉风格等基础参数。

### Phase 02: 场景角色

场景角色阶段用于沉淀后续画面生成需要使用的核心视觉资产。

- **角色定妆**：为每个角色生成标准参考图。
- **服装变体**：为角色维护多套造型，如日常、战斗、受伤、礼服等。
- **场景概念图**：为故事中的关键场景生成环境参考图。
- **图片上传**：支持手动上传角色、服装或场景图片作为参考资产。
- **批量生成**：可以按角色或场景批量生成资产，减少重复操作。

### Phase 03: AI工作台

AI工作台是关键帧与视频片段制作的核心区域。

- **镜头管理**：以网格和工作台形式管理所有镜头。
- **关键帧生成**：为镜头生成起始帧和结束帧，便于控制构图和动作变化。
- **上下文参考**：生成时会结合当前场景、角色定妆和服装变体，提升连续性。
- **镜头拆分**：支持将长镜头拆分为子镜头，细化动作节奏。
- **视频生成**：支持基于关键帧的视频生成流程，并记录渲染日志与状态。

### Phase 04: 制片导出

制片导出阶段用于集中预览、检查和下载项目成果。

- **时间轴预览**：按镜头顺序查看已生成的视频片段。
- **视频播放**：支持逐段预览镜头成片。
- **渲染日志**：集中查看角色、场景、关键帧和视频生成记录。
- **资产下载**：导出关键帧、视频片段和项目资产，便于进入后期剪辑流程。

### 资产管理

资产管理用于集中查看和调整项目中的提示词资产。

- **角色提示词**：查看与编辑角色、服装变体相关提示词。
- **场景提示词**：查看与编辑场景描述和图像提示词。
- **关键帧提示词**：查看与编辑镜头关键帧提示词。
- **视频提示词**：查看和调整视频生成描述。
- **搜索与筛选**：按角色、场景、镜头和状态快速定位资产。

## 技术架构

- **前端框架**：React 19 + TypeScript + Vite
- **界面样式**：Tailwind CSS + 工业风深色界面
- **图标库**：lucide-react
- **本地存储**：IndexedDB，用于保存项目、角色、场景、镜头和生成记录
- **AI 接口**：GitCC API，兼容 OpenAI 风格接口
- **图片/视频资产**：支持 Base64、远程 URL、关键帧图像与视频片段
- **桌面端**：Electron + electron-builder
- **容器部署**：Docker + Nginx

## AI 能力

项目默认围绕 GitCC API 提供的文本、图像与视频模型组织工作流：

- **文本模型**：用于剧本拆解、角色/场景分析、提示词改写和视频描述生成。
- **图像模型**：用于角色定妆、服装变体、场景概念图和关键帧生成。
- **视频模型**：用于根据提示词、起始帧或起止关键帧生成视频片段。

模型配置可以在应用内调整，适配不同上游模型名称、接口路径和参数。

## 数据与隐私

- 项目数据主要保存在浏览器 IndexedDB 中。
- API Key 保存在本地配置中，用于调用 GitCC API。
- 应用不依赖自建业务后端，开发和桌面端会通过代理解决浏览器跨域问题。
- 若清理浏览器站点数据，项目内容也会被清除，请按需导出备份。

## 项目启动

### 本地开发

```bash
npm install
npm run dev
```

启动后访问终端输出的本地地址。Vite 开发环境会代理 `/api-proxy` 到 GitCC API，便于本地调试。

### 构建生产版本

```bash
npm run build
npm run preview
```

### Docker 部署

```bash
docker-compose up -d --build
docker-compose logs -f
docker-compose down
```

默认通过 `3005` 端口访问。Compose 会生成 `manga-studio:latest` 镜像、`manga-studio-app` 容器和 `manga-studio-network` 网络。Nginx 会托管前端静态文件，并代理 `/api-proxy` 到 GitCC API。

### Docker 命令方式

```bash
docker build -t manga-studio .
docker run -d -p 3005:80 --name manga-studio-app manga-studio
docker logs -f manga-studio-app
docker stop manga-studio-app
```

### 桌面端

```bash
npm run electron:dev
npm run electron:build
npm run electron:build:win
```

- `electron:dev`：先构建前端，再启动 Electron 窗口。
- `electron:build`：使用 electron-builder 生成桌面安装包。
- Windows 安装包会以 `漫剧工场` 为产品名输出到 `release/` 目录。
- 桌面端内建本地 HTTP 服务，托管前端并代理 `/api-proxy` 到 GitCC API。

## 快速开始

1. 启动应用后，在模型配置中填写 GitCC API Key。
2. 进入 Phase 01「剧情创作」，输入故事创意并生成剧本和分镜。
3. 进入 Phase 02「场景角色」，生成角色定妆、服装变体和场景图。
4. 进入 Phase 03「AI工作台」，逐个生成关键帧和视频片段。
5. 进入 Phase 04「制片导出」，预览并下载关键帧、视频和项目资产。
6. 如需调整提示词，进入「资产管理」统一查看和编辑。

## 常用命令

```bash
npm install
npm run dev
npm run build
npm run preview
npm run electron:dev
npm run electron:build
docker-compose up -d --build
docker-compose down
```

## 测试

项目使用 [Vitest](https://vitest.dev/) 作为测试框架。当前已搭建最小示范，后续可以围绕 `components/StageDirector/utils.ts` 等纯函数模块扩展。

### 运行测试

```bash
# 跑一次（CI 场景）
npm run test

# watch 模式（开发时使用，自动重跑）
npm run test:watch

# 生成覆盖率报告（V8 provider）
npm run test:coverage
```

覆盖率报告会输出到 `coverage/` 目录，可直接打开 `coverage/index.html` 查看。

### 目录约定

```text
tests/
├── StageDirector.utils.test.ts                 # 工具函数单元测试
└── StageDirector.cameraMovementGuides.test.ts   # 镜头运动指南测试
```

新增测试文件时遵循以下约定：

- 与被测文件同名 + `.test.ts` 后缀，例如 `tests/foo.test.ts`
- 也可以就近放在被测文件同目录下，例如 `components/StageDirector/utils.test.ts`
- `vitest.config.ts` 的 `test.include` 已经覆盖 `tests/**`、`components/**`、`services/**`

### 如何扩展测试

1. **纯函数优先**：先为 `services/adapters/*`、`components/StageDirector/utils.ts` 这类无副作用、可独立测试的模块补用例。
2. **adapter 层测试**：先用 `vi.mock` 拦截 fetch，把请求 URL、headers、body 断言清楚，再覆盖响应解析分支。
3. **组件测试**：需要先安装 `@testing-library/react` 与 `@testing-library/jest-dom`，再考虑为表单、状态机等复杂组件编写。
4. **集成测试**：建议放到 `tests/integration/` 或 `.e2e.test.ts` 后缀，已在 `vitest.config.ts` 的 exclude 中默认排除。

### 与 CI 集成建议

```yaml
# GitHub Actions 示例
- name: Run tests
  run: npm run test
- name: Upload coverage
  uses: codecov/codecov-action@v4
  with:
    directory: ./coverage
```

## 目录概览

```text
.
├── App.tsx
├── components/
│   ├── Dashboard.tsx
│   ├── Sidebar.tsx
│   ├── ModelConfig/
│   ├── Onboarding/
│   ├── StageScript/
│   ├── StageAssets/
│   ├── StageDirector/
│   ├── StageExport/
│   └── StagePrompts/
├── electron/
├── public/
├── services/
├── types/
├── types.ts
├── vite.config.ts
├── Dockerfile
├── docker-compose.yaml
└── nginx.conf
```

## 适合场景

- 短剧和漫剧前期开发
- 动态漫画和分镜预演
- 角色与场景视觉设定
- AI视频片段批量生成
- 创意原型验证和资产整理
