---
audience: [dev]
type: tutorial
since: v0.1.0
status: stable
last_reviewed: 2026-07-11
---

# 本地开发

## 前置依赖

- Node.js >= 20
- pnpm >= 10
- Python >= 3.11
- [uv](https://docs.astral.sh/uv/)
- Docker & Docker Compose
- 可选：[pre-commit](https://pre-commit.com/)（推荐装上）

## 一次性 setup

```bash
# 仓库根
pnpm install
# pnpm install 会运行 prepare；若提示缺 pre-commit，再安装后执行 pre-commit install

# 后端
cd apps/api
uv sync --extra test       # 安装 + dev 依赖

# 起基础设施
cd ../..
docker compose up -d       # postgres / redis / minio / mailpit / workers / beat
```

## 日常启动

```bash
# 1. 基础设施（如未运行）
docker compose up -d

# 2. 后端（终端 1）
pnpm dev:api               # 等价于 cd apps/api && uvicorn app.main:app --reload --port 8000

# 3. 前端（终端 2）
pnpm dev:web               # http://localhost:3000

# 4. worker 已由 compose 拉起；按需查看队列消费者
docker compose ps celery-worker celery-worker-gpu celery-worker-cpu celery-worker-export celery-beat
```

API 文档：
- 实时 Swagger UI：http://localhost:8000/docs
- 静态化文档：[/api/](/api/)（来自 openapi.snapshot.json）

## 常用脚本

```bash
# 测试
pnpm test                  # 前端 vitest
pnpm test:e2e              # 前端 Playwright
cd apps/api && uv run pytest

# 代码生成
pnpm codegen               # 从 snapshot 生成 TS 类型
pnpm openapi:export        # 重新生成 snapshot（改了 API 后必须）
pnpm openapi:check         # 校验 snapshot 与运行时一致

# Lint / Typecheck
pnpm lint
pnpm typecheck
cd apps/api && uv run ruff check .
cd apps/api && uv run ruff format --check .

# 文档
pnpm docs:dev              # VitePress 本地预览 :5173
pnpm docs:build
```

## 数据库迁移

```bash
cd apps/api
uv run alembic upgrade head                          # 升到最新
uv run alembic revision --autogenerate -m "..."      # 生成新迁移
uv run alembic downgrade -1                          # 回滚 1 步
```

详见 [How-to / Alembic 迁移](../how-to/add-migration)。
