# E2E 测试（Playwright）

完整跨服务的端到端测试，验证「前端 + FastAPI + Postgres + Redis + MinIO」整条链路。

## 何时写 E2E

- 用户关键路径：登录、创建项目、提交标注、批次审核、导出
- 跨页面流程：项目创建 → 任务分配 → 标注 → 审核
- 涉及 WebSocket / 文件上传 / 长流程的功能

**不要**用 E2E 测试组件细节或纯逻辑——这些用 vitest 单测覆盖。

## 本地运行

```bash
# 只需先起共享基础设施
docker compose up -d postgres redis minio

# Playwright 自动准备 annotation_e2e、迁移数据库，并启动专用 Web/API
cd apps/web && pnpm test:e2e            # 全跑
pnpm test:e2e e2e/tests/auth.spec.ts    # 单文件
pnpm test:e2e --headed                   # 看着浏览器跑
pnpm test:e2e --ui                       # 交互式 UI 模式
```

首次运行需要 `pnpm exec playwright install chromium` 装浏览器。

本地 E2E 固定使用 `annotation_e2e` 逻辑库、Web `127.0.0.1:3001`、API
`127.0.0.1:8010`。Playwright 不会复用开发端口 `3000/8000`；专用端口被占用时
直接失败，防止测试误写开发服务。如需使用其它隔离测试库，用
`PLAYWRIGHT_E2E_DATABASE_URL` 覆盖；目标库名仍必须以 `_e2e` 或 `_test` 结尾。

## 数据准备

避免每个 spec 重复造数据：`e2e/fixtures/seed.ts` 通过
`/api/v1/__test/seed/*` 创建固定 fixture。这组路由需要同时满足：

- `E2E_SEED_ENABLED=true`；
- 当前数据库名以 `_e2e` 或 `_test` 结尾；
- `production` 环境永不挂载路由。

正常结束时 `globalTeardown` 会调用 `/api/v1/__test/seed/cleanup` 清除固定 E2E
数据。这只是卫生性兜底：强制中断或进程被终止时 teardown 可能来不及执行，
所以数据库隔离才是不污染开发库的根本保障。下次运行会通过 reset/cleanup
重新收敛专用库的状态。

## 文件组织

```
e2e/
├── fixtures/          # 共享 fixture（seed、authedPage 等）
├── global-teardown.ts # 正常结束时的 cleanup 兜底
├── tests/             # 实际 spec
│   ├── auth.spec.ts
│   ├── annotation.spec.ts
│   └── batch-flow.spec.ts
└── utils/             # 辅助函数
```
