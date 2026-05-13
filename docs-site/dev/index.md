# 开发文档

面向贡献者和团队工程师。文档按 [Diátaxis](https://diataxis.fr/) 四象限组织：**起步**（跑通） / **概念**（理解） / **How-to**（任务） / **故障排查**（问题）。

## 5 分钟跑通

```bash
git clone https://github.com/yyq19990828/ai-annotation-platform
cd ai-annotation-platform
cp .env.example .env
docker compose up -d
# API: http://localhost:8000  Web: http://localhost:5173
```

详见 [本地开发](./local-dev)。

## 我该改哪里？

| 任务 | 入口 |
|---|---|
| 加一个后端 API | [How-to: 新增 API 端点](./how-to/add-api-endpoint) |
| 加一个前端页面 | [How-to: 新增前端页面](./how-to/add-page) |
| 改数据库结构 | [How-to: Alembic 迁移](./how-to/add-migration) |
| 写 / 调试后台任务 | [How-to: 调试 Celery](./how-to/debug-celery) |
| 理解项目模块 | [概念：项目模块](./concepts/project-module) |
| 理解任务模块 | [概念：任务模块](./concepts/task-module) |
| 理解批次模块 | [概念：批次模块](./concepts/batch-module) |
| 理解派题与锁 | [Scheduler 与派题](./concepts/scheduler-and-task-dispatch) · [Task Lock](./concepts/task-locking) |
| 理解状态流 | [状态机总览](./concepts/state-machines) |
| 理解横切机制 | [计数与派生字段](./concepts/counters-and-derived-fields) · [审计与通知](./concepts/audit-and-notifications) |
| 理解整体架构 | [概念：架构地图](./concepts/) |
| 排查运行时问题 | [故障排查总览](./troubleshooting/) |
| 查协议规范 | [ML Backend 协议](./ml-backend-protocol) · [WebSocket 协议](./ws-protocol) · [视频帧服务](./reference/video-frame-service) |

## 项目仓库结构

`apps/` 下两个子项目：

| 子项目 | 语言 | 框架 | 入口 |
|---|---|---|---|
| `apps/api` | Python 3.11+ | FastAPI + SQLAlchemy + Alembic + Celery | `app/main.py` |
| `apps/web` | TypeScript | React + Vite + Zustand + TanStack Query | `src/main.tsx` |

`docs-site/` 是你正在看的这个 VitePress 文档站。

## 关键参考文件

- 行为准则：`/CLAUDE.md`
- 版本历史与 roadmap：`/CHANGELOG.md`
- 架构决策：`/docs/adr/` · [ADR 列表](./adr/)（侧边栏）
- 部署 / 运维：[部署与运维](/ops/)
