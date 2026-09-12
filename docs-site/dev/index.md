---
pageClass: docs-hub-page
aside: false
audience: [dev]
type: explanation
status: stable
last_reviewed: 2026-07-29
---

# 开发文档

面向贡献者和团队工程师。先跑通本地环境，再按开发任务查找操作指南、系统架构和协议参考；已有运行问题可直接进入故障排查。

## 5 分钟跑通

从[本地开发](./tutorials/local-dev)开始，按其中的依赖、环境变量、基础设施和日常启动步骤准备工作树。第一次提交代码时，接着阅读[第一个贡献](./tutorials/first-contribution)；如果改的是文档，直接看[编写文档](./how-to/write-documentation)。

<div class="doc-card-grid cols-3">
  <DocLinkCard title="本地开发" desc="准备依赖、启动基础设施并运行 API、Web 和 Worker" href="/dev/tutorials/local-dev" />
  <DocLinkCard title="第一个贡献" desc="从一次小改动开始，完成验证并提交 PR" href="/dev/tutorials/first-contribution" />
  <DocLinkCard title="编写文档" desc="按页面类型组织正文、媒体、锚点和真值来源" href="/dev/how-to/write-documentation" />
</div>

## 四个主入口

<div class="doc-card-grid">
  <DocLinkCard title="新增 API 或页面" desc="从端点、页面、迁移到测试和代码生成" href="/dev/how-to/add-api-endpoint" />
  <DocLinkCard title="理解架构" desc="从模块、状态机和数据流进入系统设计" href="/dev/concepts/" />
  <DocLinkCard title="使用 SDK 与 CLI" desc="Python SDK、CLI、TUI 监控面板和 Cookbook" href="/dev/sdk/quickstart" />
  <DocLinkCard title="排查运行时问题" desc="按症状查找容器、网络、任务和配置问题" href="/dev/troubleshooting/" />
</div>

## 我该改哪里？

| 任务                            | 入口                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 加一个后端 API                  | [How-to: 新增 API 端点](./how-to/add-api-endpoint)                                                                                             |
| 加一个前端页面                  | [How-to: 新增前端页面](./how-to/add-page)                                                                                                      |
| 改数据库结构                    | [How-to: Alembic 迁移](./how-to/add-migration)                                                                                                 |
| 写 / 调试后台任务               | [How-to: 调试 Celery](./how-to/debug-celery)                                                                                                   |
| 理解项目模块                    | [概念：项目模块](./concepts/project-module)                                                                                                    |
| 理解任务模块                    | [概念：任务模块](./concepts/task-module)                                                                                                       |
| 理解批次模块                    | [概念：批次模块](./concepts/batch-module)                                                                                                      |
| 理解派题与锁                    | [Scheduler 与派题](./concepts/scheduler-and-task-dispatch) · [Task Lock](./concepts/task-locking)                                              |
| 理解状态流                      | [状态机总览](./concepts/state-machines)                                                                                                        |
| 理解横切机制                    | [计数与派生字段](./concepts/counters-and-derived-fields) · [审计与通知](./concepts/audit-and-notifications)                                    |
| 修改批量或多阶段 AI 预标        | [预标注流水线](./concepts/prediction-pipeline) · [异步任务 API](/api/guides/async-jobs)                                                        |
| 修改视频 AI 追踪                | [视频 AI 追踪](./concepts/video-ai-tracking) · [Video Tracker Jobs API](/api/guides/video-tracker-jobs)                                        |
| 修改 backend 能力声明或项目启用 | [AI 模型集成](./concepts/ai-models) · [ML Backend API](/api/guides/ml-backend) · [ML Backend 协议](./reference/ml-backend-protocol)            |
| 编写或重排文档                  | [编写文档](./how-to/write-documentation) · [更新截图](./how-to/update-screenshots)                                                             |
| 理解整体架构                    | [概念：架构地图](./concepts/)                                                                                                                  |
| 排查运行时问题                  | [故障排查总览](./troubleshooting/)                                                                                                             |
| 查协议规范                      | [ML Backend 协议](./reference/ml-backend-protocol) · [WebSocket 协议](./reference/ws-protocol) · [视频帧服务](./reference/video-frame-service) |

## 项目仓库结构

`apps/` 下两个子项目：

| 子项目     | 语言         | 框架                                    | 入口           |
| ---------- | ------------ | --------------------------------------- | -------------- |
| `apps/api` | Python 3.11+ | FastAPI + SQLAlchemy + Alembic + Celery | `app/main.py`  |
| `apps/web` | TypeScript   | React + Vite + Zustand + TanStack Query | `src/main.tsx` |

`docs-site/` 是你正在看的这个 VitePress 文档站。

## 关键参考文件

- 行为准则：`/CLAUDE.md`
- 版本历史与 roadmap：`/CHANGELOG.md`
- 架构决策：`/docs/adr/` · [ADR 列表](./adr/)（侧边栏）
- 文档规范：[编写文档](./how-to/write-documentation)
- 部署 / 运维：[部署与运维](/ops/)
- 面向 AI / Coding Agent：[llms.txt](https://yyq19990828.github.io/ai-annotation-platform/llms.txt)（文档索引）· [llms-full.txt](https://yyq19990828.github.io/ai-annotation-platform/llms-full.txt)（全文语料）· [openapi.json](../openapi.json)（API 契约）
