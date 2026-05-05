# 开发文档

面向贡献者和团队工程师。第一次进入项目请按以下顺序：

1. [本地开发](./local-dev) — 怎么把 Postgres / API / Web 跑起来
2. [架构 / 系统全景](./architecture/overview) — 模块怎么划分
3. [测试指南](./testing) — 怎么写单测、契约测试、E2E
4. [约定与规范](./conventions) — 命名、提交、PR
5. [发布流程](./release) — 版本号、CHANGELOG

## 项目仓库

`apps/` 下两个子项目：

| 子项目 | 语言 | 框架 | 入口 |
|---|---|---|---|
| `apps/api` | Python 3.11+ | FastAPI + SQLAlchemy + Alembic + Celery | `app/main.py` |
| `apps/web` | TypeScript | React + Vite + Zustand + TanStack Query | `src/main.tsx` |

`docs-site/` 是你正在看的这个 VitePress 文档站。

## 关键参考文件

- 行为准则：`/CLAUDE.md`
- 版本历史与 roadmap：`/CHANGELOG.md`
- 调研报告：`/docs/research/`
- 架构决策：`/docs/adr/`
- 计划档案：`/docs/plans/`

## 我该改哪里？

| 任务 | 改动位置 |
|---|---|
| 加一个后端 API | [How-to: 新增 API 端点](./how-to/add-api-endpoint) |
| 加一个前端页面 | [How-to: 新增前端页面](./how-to/add-page) |
| 改数据库结构 | [How-to: Alembic 迁移](./how-to/add-migration) |
| 写一个后台任务 | [How-to: 调试 Celery](./how-to/debug-celery) |
| 改 OpenAPI schema | [测试指南 / OpenAPI 契约](./testing#openapi-契约测试) |
