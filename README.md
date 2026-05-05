# AI Annotation Platform

一站式 AI 辅助多媒体数据标注平台。

| | |
|---|---|
| **前端** | React 18 + TypeScript + Vite + Zustand + TanStack Query + Konva |
| **后端** | FastAPI + SQLAlchemy + Alembic + Celery |
| **数据** | PostgreSQL 16 / Redis 7 / MinIO |
| **AI** | GroundingDINO / SAM 等模型集成（占位） |

## 文档

| 受众 | 入口 |
|---|---|
| 标注员 / 项目管理员 | [文档站 / 用户手册](./docs-site/user-guide/) |
| 工程师 | [文档站 / 开发文档](./docs-site/dev/) + [DEV.md](./DEV.md) |
| 集成方 | [文档站 / API](./docs-site/api/) + 实时 [Swagger UI](http://localhost:8000/docs)（启动后端后） |
| 历史与变更 | [CHANGELOG.md](./CHANGELOG.md) |
| 架构决策 | [docs/adr/](./docs/adr/) |
| 调研 | [docs/research/](./docs/research/) |

发布后文档站托管于 GitHub Pages：[https://yyq19990828.github.io/ai-annotation-platform/](https://yyq19990828.github.io/ai-annotation-platform/)

## 快速开始

```bash
# 1. 装依赖
pnpm install
cd apps/api && uv sync --extra test && cd ../..
pre-commit install         # 启用 git hooks（推荐）

# 2. 起基础设施
docker compose up -d       # postgres / redis / minio

# 3. 起后端 + 前端
pnpm dev:api &             # http://localhost:8000
pnpm dev:web               # http://localhost:3000
```

详见 [DEV.md](./DEV.md) 与 [docs-site/dev/local-dev.md](./docs-site/dev/local-dev.md)。

## 测试

```bash
# 后端
cd apps/api && uv run pytest --cov=app

# 前端单测
pnpm test:coverage

# 前端 E2E（需后端 + docker compose 起着）
pnpm test:e2e

# OpenAPI 契约校验
pnpm openapi:check
```

详见 [文档站 / 测试指南](./docs-site/dev/testing.md)。

## 目录结构

```
ai-annotation-platform/
├── apps/
│   ├── api/                       # FastAPI 后端
│   │   ├── app/                   # 路由 / 服务 / 模型
│   │   ├── tests/                 # pytest
│   │   └── openapi.snapshot.json  # 前后端契约真值源
│   └── web/                       # React 前端
│       ├── src/                   # pages / components / api / mocks
│       ├── e2e/                   # Playwright
│       └── eslint.config.js
├── docs-site/                     # VitePress 文档站（用户/开发/API）
├── docs/
│   ├── adr/                       # 架构决策记录
│   ├── research/                  # 竞品调研
│   └── plans/                     # 工作流档案
├── scripts/
│   └── export_openapi.py          # 刷新 openapi.snapshot.json
├── infra/docker/
├── docker-compose.yml
├── .pre-commit-config.yaml
├── .codecov.yml
└── .github/workflows/
    ├── ci.yml                     # pytest / vitest / lint / e2e
    └── docs.yml                   # docs-site → GitHub Pages
```

## License

MIT
