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

## WebCodecs 精确帧 E2E

`e2e/tests/video-webcodecs-precise-frame.spec.ts` 用 `seed/video-webcodecs`
造确定性 H.264 fixture（baseline / 主 profile B 帧 / 短 GOP / VFR），验证精确帧
pipeline 的开关边界、精确解码或安全回退、pending→ready 切换。视频舞台容器暴露
`data-video-frame-source` / `data-video-precise-state` / `data-video-frame-index`
三个可观察属性供 spec 读取。

**能力门**：WebCodecs `VideoDecoder` 需 secure context。localhost 下 Chromium 暴露
构造器，但 headless 软解下 `isConfigSupported` / 实际 decode 可能不通过，精确帧会
安全回退。spec 据此 **capability-aware**：先观测 pipeline 实际解析到的
`data-video-frame-source`，精确帧成功才跑 corner_bits 像素断言，回退则验证 fallback
合同并通过 annotation 记录原因 —— 绝不把「回退」伪装成「像素已验证」，也不把
「能力不足」判成失败。

因此 CI / headless 只锁定 flag off 零请求、安全回退与切换 API 契约；corner_bits
像素命中 key / P / B / GOP / VFR 目标帧的断言留给有头 Chrome 或带 GPU 的 runner
（见 spec 内 `TODO(headed)`）。

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
