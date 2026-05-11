---
audience: [dev]
type: explanation
since: v0.9.21
status: stable
last_reviewed: 2026-05-11
---

# 工作台 Shell 架构

Workbench 是图片标注、视频追踪、审核流共用的页面壳。它的边界不是按角色复制页面，而是把「模式」和「Stage」拆成两条正交轴：

```
WorkbenchShell
  -> useAnnotateMode() / useReviewMode()
  -> WorkbenchLayout
       -> WorkbenchBanners
       -> Topbar
       -> WorkbenchStageHost
       -> StatusBar
       -> TaskQueuePanel / ToolDock / AIInspectorPanel
  -> WorkbenchOverlays
```

## Shell 的职责

`WorkbenchShell.tsx` 只负责路由参数、项目与任务数据、React Query mutations、history、离线队列、快捷键注册，以及把这些依赖装配到子模块。

它不直接渲染 `ImageStage` 或 `VideoStage`，也不直接拼装某个 Stage 的 annotation payload。图片和视频的创建、更新、改类、撤销相关语义分别下沉到：

- `stages/image/useImageAnnotationActions.ts`
- `stages/video/useVideoAnnotationActions.ts`

## Mode 轴

`mode: "annotate" | "review"` 由入口页传入，Shell 通过 mode hook 得到页面策略：

- `useAnnotateMode()`：提交、跳过、撤回、重开、smart next。
- `useReviewMode()`：领取审核、通过、退回、review diff、审核快捷键 slot。

这样审核模式继承同一套 Stage、任务队列、右栏、状态栏、离线队列和 history，不需要维护 `AnnotateWorkbench` / `ReviewWorkbench` 两套页面。

## Stage 轴

Stage 由 `StageKind` 分派：

```ts
type StageKind = "image" | "video" | "3d";
```

`WorkbenchStageHost` 根据 `stageKind` 选择具体实现：

- `ImageWorkbench`：包装图片 `ImageStage`，持有图片专属的 FloatingDock、CanvasToolbar、Minimap。
- `VideoWorkbench`：包装视频 `VideoStage`，持有视频时间轴、轨迹与 keyframe 操作。
- `ThreeDWorkbench.placeholder`：只提供明确的未支持占位，不接真实业务。

`stages/types.ts` 里的 `StageCapabilities` 用来描述外围能力，例如是否有 class picker、AI 预标、timeline、viewport、comments。它不是内部编辑协议。

## 3D 约束

3D Stage 只复用外围壳：任务流、模式策略、右栏、状态栏、全局 overlay 和快捷键入口。

不要在 3D 接入前抽统一 geometry 或统一 editor 接口。图片 bbox / polygon 是平面 shape；视频 track 是 keyframe 派生的时间序列；3D 可能是 cuboid、点云选择、相机视锥或多视角联动。当前只统一 `StageKind`、`StageCapabilities` 和 `WorkbenchStageHost` 这一层边界。

## Overlay 边界

跨 Stage 的弹窗放在 `WorkbenchOverlays`：待选类别、改类、SAM 接受、批量改类。图片画布自己的浮动控件仍放在 `ImageWorkbench` 内部。

这个边界保证视频 bbox / track 新建时也能显示 class picker，不再依赖 `ImageStage.overlay`。
