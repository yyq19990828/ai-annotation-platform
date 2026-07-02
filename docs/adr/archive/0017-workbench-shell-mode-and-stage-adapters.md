# 0017 — 工作台 Shell 采用 Mode Hooks 与 Stage Adapters

- **Status:** Accepted
- **Date:** 2026-05-11
- **Deciders:** platform team
- **Supersedes:** —

## Context

`WorkbenchShell` 同时承载图片、视频、标注、审核、任务流、快捷键、弹窗、离线队列、history、AI、评论与右栏逻辑。继续把 `mode === "review"` 和 `isVideoTask` 分支堆在 Shell 中，会让后续视频能力和 3D 接入继续污染同一文件。

主要候选方案：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **一个 Shell + Mode Hooks + Stage Adapters** | 保留共享任务流和 UI 壳，按模式与 Stage 拆边界 | Shell 仍需要装配较多依赖 |
| 拆成 `AnnotateWorkbench` / `ReviewWorkbench` 两套页面 | 单页表面上更直接 | Stage、右栏、离线、history、快捷键会重复维护 |
| 抽统一 geometry editor | 理论上可统一 image / video / 3D 操作 | 过早抽象，三类 geometry 语义差异过大 |

## Decision

保留一个 `WorkbenchShell`，通过两条正交轴扩展工作台：

- Mode 轴：`useAnnotateMode()` 和 `useReviewMode()` 注入权限、横幅、topbar actions、review claim、approve / reject、diffMode。
- Stage 轴：`WorkbenchStageHost` 根据 `StageKind = "image" | "video" | "3d"` 分派到 `ImageWorkbench`、`VideoWorkbench` 或 `ThreeDWorkbench.placeholder`。

Shell 负责路由、数据、mutation、history、offline、hotkeys 等编排；Stage 具体 annotation payload 由 stage-specific action hooks 管理：

- `apps/web/src/pages/Workbench/stages/image/useImageAnnotationActions.ts`
- `apps/web/src/pages/Workbench/stages/video/useVideoAnnotationActions.ts`

3D 只统一外围协议，不统一内部 geometry。`StageCapabilities` 只能描述 class picker、AI preannotate、timeline、viewport、comments 这类壳能力；不要在 3D 接入前抽 `UniversalGeometry` 或统一 editor 接口。

## Consequences

正向：

- 审核模式自动继承 image / video / 未来 3D Stage 能力，不需要同步两套页面。
- Shell 不再直接渲染大块 image/video Stage 分支，也不直接拼视频 track payload。
- 视频 class picker、全局改类、SAM 接受、批量改类等 overlay 脱离 `ImageStage.overlay`，避免跨 Stage 渲染缺口。

负向：

- Shell 仍是装配层，依赖列表较长；后续只能继续按职责外提，不能把业务语义重新塞回 Shell。
- `StageCapabilities` 不是权限系统或几何协议，调用方不能据此推断内部可编辑能力。
- 3D Stage 接入时仍需独立设计 cuboid / point-cloud / 多视角编辑模型。

## Alternatives Considered

**拆成 AnnotateWorkbench / ReviewWorkbench 两套页面**：未采用。标注和审核共享任务队列、Stage、右栏、状态栏、评论、离线队列、history 和快捷键主体。复制页面会让视频和未来 3D 能力每次都要改两遍，审核模式长期落后。

**抽统一 geometry editor**：未采用。图片 bbox / polygon 是平面 shape；视频 track 是关键帧派生的时间序列；3D 可能是 cuboid、点云选择、相机视锥或多视角同步。现在只能统一外围 Stage 边界。

## Notes

- 实现代码位置：`apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx`
- Stage Host：`apps/web/src/pages/Workbench/shell/WorkbenchStageHost.tsx`
- Stage 类型：`apps/web/src/pages/Workbench/stages/types.ts`
- 架构文档：`docs-site/dev/concepts/workbench-shell.md`
- 相关 Roadmap：`ROADMAP/[archived]2026-05-11-workbench-shell-decomposition.md`
