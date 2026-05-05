# E2E 测试（Playwright）

完整跨服务的端到端测试，验证「前端 + FastAPI + Postgres + Redis + MinIO」整条链路。

## 何时写 E2E

- 用户关键路径：登录、创建项目、提交标注、批次审核、导出
- 跨页面流程：项目创建 → 任务分配 → 标注 → 审核
- 涉及 WebSocket / 文件上传 / 长流程的功能

**不要**用 E2E 测试组件细节或纯逻辑——这些用 vitest 单测覆盖。

## 本地运行

```bash
# 1. 起基础设施
docker compose up -d postgres redis minio

# 2. 起后端
cd apps/api && uv run alembic upgrade head
cd apps/api && uv run uvicorn app.main:app --port 8000 &

# 3. 起前端 dev server
cd apps/web && pnpm dev &

# 4. 跑 E2E
cd apps/web && pnpm test:e2e            # 全跑
pnpm test:e2e e2e/tests/auth.spec.ts    # 单文件
pnpm test:e2e --headed                   # 看着浏览器跑
pnpm test:e2e --ui                       # 交互式 UI 模式
```

首次运行需要 `pnpm exec playwright install chromium` 装浏览器。

## 数据准备

避免每个 spec 重复造数据：在 `e2e/fixtures/` 下定义 fixture，调后端 `/api/v1/...` 直接创建测试数据。

测试结束后通过 fixture teardown 清理；CI 中每个 job 都用独立的 postgres service，无需手动清理。

## 文件组织

```
e2e/
├── fixtures/          # 共享 fixture（authedPage, seedProject 等）
├── tests/             # 实际 spec
│   ├── auth.spec.ts
│   ├── annotation.spec.ts
│   └── batch-flow.spec.ts
└── utils/             # 辅助函数
```
