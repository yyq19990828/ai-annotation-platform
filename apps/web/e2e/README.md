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

CI 使用 `line` reporter 显示正在执行的用例及重试，同时保留 GitHub annotations 和 HTML 报告。分片内按单 worker 串行运行；排查长时间执行时先查看当前用例和超时信息，不能只凭 WebSocket 断连日志判断测试卡死。

CI 单用例最多重试一次，首个用例最终失败后终止当前分片；其他分片继续完成各自诊断。每个 Playwright 测试进程总限时 15 分钟，测试步骤限时 20 分钟，整个 E2E job（含安装和构建）限时 30 分钟。分层限时为清理和报告上传保留余量，并在测试进程无法自行退出时由 Actions 兜底。本地运行不启用这些 CI 早退限制。

本地 E2E 固定使用 `annotation_e2e` 逻辑库、Web `127.0.0.1:3001`、API
`127.0.0.1:8010`。Playwright 不会复用开发端口 `3000/8000`；专用端口被占用时
直接失败，防止测试误写开发服务。如需使用其它隔离测试库，用
`PLAYWRIGHT_E2E_DATABASE_URL` 覆盖；目标库名仍必须以 `_e2e` 或 `_test` 结尾。

本地并行运行多组测试时，每组须使用独立测试数据库、服务端口和 `MINIO_DATASETS_BUCKET`。WebCodecs 夹具清理会删除桶内整个测试前缀；共享同一个桶的测试应串行执行，避免另一组 reset 删除正在读取的视频对象。CI 分片使用各自 runner 上的独立 MinIO 服务。

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

## 当前题 AI 的真实异步作业 E2E

`workbench-ai-inspector-phases.spec.ts` 需要与隔离 API 使用同一测试数据库和专用
Redis broker 的 Celery worker；确认后设置 `PLAYWRIGHT_AI_REQUEST_WORKER=1` 才会执行。
不能把 worker 连到开发数据库或复用开发任务队列。API 和 worker 同时覆盖
`DATABASE_URL`、`MIGRATION_DATABASE_URL`、`REDIS_URL`、`CELERY_BROKER_URL`，并设置相同的
`PREANNOTATE_GPU_QUEUE` / `PREANNOTATE_CPU_QUEUE`。worker 订阅这两个队列及 `default,audit`，
使用当前 checkout 的虚拟环境，不启动 beat。关闭 GPU arbiter 和 backend router，防止
继承开发环境调度：`GPU_ARBITER_MODE=off`、`GPU_ARBITER_ROLLOUT_ENABLED=false`、
`GPU_ARBITER_RESOURCES_JSON={}`、`ML_BACKEND_ROUTER_MODE=off`。

模型夹具以 Node HTTP server 提供确定性的 setup / predict，在真实 API 注册路径中临时
替换 seed backend 并于每例结束恢复。它只模拟模型输出、延迟和失败，预标派发、作业查询、
取消、预测落库和候选采纳均使用真实服务。`PLAYWRIGHT_ML_FIXTURE_HOST` 可指定 API/worker
能访问的非 loopback IPv4；缺省选择本机接口地址。该检查不验证模型质量。

```bash
PLAYWRIGHT_AI_REQUEST_WORKER=1 pnpm test:e2e \
  e2e/tests/workbench-ai-inspector-phases.spec.ts --project=chromium
```

每例在输出目录保存不含凭据的 `ai-request-metadata.json`，记录项目与模型收到的任务 ID。
结束时先释放模型等待并等作业终态，再恢复 seed backend、清理测试数据；按记录中的任务 ID
从 import 桶删除精确的 `frame-predict/{task_id}/` 临时帧前缀，停止自有 worker 及 broker，
清理报告与临时端口配置。服务异常中断时仍需执行相同清理。

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

spec 已实现 Konva media canvas 的区域像素采样：按背景亮度与四角 bit 验证 key / P /
B / GOP / VFR 目标帧，并同步核对诊断中的目标 PTS。默认冒烟环境若明确缺少 H.264
解码能力，会把像素和 pending→precise 用例标为 capability skip。浏览器资格测试必须
显式开启严格能力门，此时缺少 WebCodecs 原语、codec 不支持或 `decode_failed` 都会失败，
不能用回退或 `ready` 属性代替像素证据：

```bash
cd apps/web
DISPLAY=:0 XAUTHORITY=/run/user/1000/gdm/Xauthority \
PLAYWRIGHT_CHROMIUM_CHANNEL=chrome PLAYWRIGHT_REQUIRE_WEBCODECS=1 \
pnpm exec playwright test \
  e2e/tests/video-webcodecs-precise-frame.spec.ts --project=chromium --headed
```

GPU runner 应显式选择系统 Google Chrome；Playwright bundled Chromium 的 codec
发行配置可能与用户 Chrome 不同。`DISPLAY` / `XAUTHORITY` 按 runner 的本地 X11
会话调整，不能把不可用的 SSH 转发显示误记为浏览器能力失败。

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
