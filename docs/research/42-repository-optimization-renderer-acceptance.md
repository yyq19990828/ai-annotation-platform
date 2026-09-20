# 仓库优化 P10 验证通道：渲染器资格验收（点云 WebGPU / WebCodecs 精确帧）

> 完成日期：2026-09-20 · 隶属计划：`docs/plans/1789880018_repository-optimization-plan.md`（P10 渲染验证通道，非 canonical P10 完成）
> 分支：`worktree-agent-opt-final-renderer`；候选基线 `f90dea73e`（渲染器输入与已测状态 `9e34dfafb` 字节一致，限定范围 diff 为空）
> 证据图例：**[V]** 实际执行；**[BLOCKED-EXTERNAL]** 因外部（非渲染器）缺陷受阻，首错与修复后复跑命令已保留
> 边界：零产品源码变更；不 push；不做 P8/P9/台账编辑；不触碰 main 8000 / feedback 8100 / Grafana 3001；未做全局 pkill。

## 1. 环境与隔离 **[V]**

- 运行时：自有 e2e 模式 `aap_wt_de57dbd75d11794b_e2e`（`dev:worktree -- init --mode e2e`，launcher 保留独立 API/Web 端口并注入 `PLAYWRIGHT_ISOLATED_*`/`E2E_SEED_ENABLED=true`/`ENVIRONMENT=development`；自有测试库、Redis、8 个自有 bucket，alembic head `0174`）。
- 与 P9（opt-p7 的普通全量 E2E）互不共享端口/服务；未触碰共享 Grafana 3001 / main 8000 / feedback 8100。
- 主机：x86_64，2× NVIDIA GeForce RTX 3090（GA102）。

## 2. WebCodecs 精确帧（已通过）**[V]**

命令：`PLAYWRIGHT_REQUIRE_WEBCODECS=1 pnpm playwright test e2e/tests/video-webcodecs-precise-frame.spec.ts --project=chromium --reporter=line`

- **9 passed，退出码 0**（1.2m）。
- 严格门控生效：`PLAYWRIGHT_REQUIRE_WEBCODECS=1` 下测试断言走 WebCodecs 精确解码路径并校验**实际解码像素**与标注几何对齐，而非 UI 时间戳；spec 内的降级分支在严格模式下被禁用（`!REQUIRE_PRECISE_DECODE` 条件分支不执行），不存在 software fallback 冒充通过的情形。
- 视频数据由 `seed.owned()` 命名空间化自有 fixtures 提供（`videoWebCodecs` 构造器），非 shell mock。

## 3. 点云 WebGPU（BLOCKED-EXTERNAL：P7 消费者迁移回归）**[BLOCKED-EXTERNAL]**

命令：`PLAYWRIGHT_POINTCLOUD_WEBGPU=1 pnpm playwright test e2e/tests/workbench-pointcloud-edit.spec.ts e2e/tests/workbench-pointcloud-playback.spec.ts --project=pointcloud`（注意：两 spec 属专用 `pointcloud` project，`chromium` project 会报 No tests found）。

- 结果：退出码 1；列出的全部用例首错一致：`Error: seed/login failed: 404`（`e2e/fixtures/seed.ts:889 injectToken`）。
- 根因（root 追溯，非渲染器问题）：两个 spec 仍注入硬编码全局管理员 `admin@e2e.test`（edit.spec:428 / playback:11），而 owned seed 创建的是命名空间化 `admin-{namespace}@e2e.test`（`_test_seed.py:83`），后端登录因用户不存在返回 404。属于 P7 消费者迁移回归，修复已另行分派（DS），本通道不得改源或重建全局管理员掩饰隔离缺陷。
- 渲染器断言（`pointcloud-renderer-backend` 的 `data-backend="webgpu"` 严格断言）因此**未被执行**，不能宣称 WebGPU 适配器证据。
- 首错全文与修复后复跑命令保留于 `/tmp/aap-opt-final-renderer-evidence/pointcloud-seed404-first-error.md`。

## 4. 复跑程序（外部修复合入后）

```bash
pnpm dev:worktree -- init --mode e2e
pnpm dev:worktree -- exec --mode e2e -- bash -lc \
  'set -o pipefail; cd apps/web && PLAYWRIGHT_POINTCLOUD_WEBGPU=1 \
   pnpm playwright test e2e/tests/workbench-pointcloud-edit.spec.ts \
   e2e/tests/workbench-pointcloud-playback.spec.ts --project=pointcloud --reporter=line'
```

记录点：`pointcloud-renderer-backend` 的实际 `data-backend` 值（webgpu / webgl2-fallback / legacy-webgl2 三态）、`pointcloud-stats` 可见性、实际适配器/回退状态；主机硬件（2× RTX 3090）仅是背景信息，不足以单独作为 WebGPU 证据。

## 5. 候选与输入指纹

- 候选 SHA：`f90dea73e`（验收根；本通道仅新增本文档提交）。
- 渲染器输入字节一致性：`git diff 9e34dfafb..HEAD` 在 apps/web 渲染器/点云/WebCodecs 源与 `playwright.config.ts` 上为空（限定范围核实），故后续 CI/docs-only rebase 可复用本次 WebCodecs 结果；点云 WebGPU 待外部修复后按 §4 复跑。
