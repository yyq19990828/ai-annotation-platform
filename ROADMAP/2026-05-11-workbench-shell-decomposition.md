# WorkbenchShell 拆分路线图 · Image / Video / 3D 与标注 / 审核模式

> 类型：P0 架构优化路线图（**not yet a milestone plan**）
>
> 背景：v0.9.20 视频工作台补齐工具语义后，`WorkbenchShell` 已同时承载图片、视频、标注员模式、审核员模式、任务流、快捷键、弹窗、离线队列、history、AI、评论与右栏逻辑。当前文件规模约 **1732 行**，`ImageStage` 约 **1108 行**，`VideoStage` 约 **1055 行**。
>
> 结论：**现在有必要拆 `WorkbenchShell`，但不应该为了 3D 预先做大一统抽象。**拆分目标是收束职责边界，避免 image/video/mode 互相污染；3D 只预留 stage adapter 插槽，不提前统一内部几何模型。

---

## 0. TL;DR

- 推荐拆分，但按 **小步、可验证、低风险** 推进，不做一次性大重构。
- 第一优先级不是把 `ImageStage`、`VideoStage`、未来 `3DStage` 统一成同一个 props 接口，而是把 `WorkbenchShell` 里的职责拆清楚：
  - Stage 维度：`image | video | 3d`
  - Mode 维度：`annotate | review`
  - Cross-cutting 维度：overlay、hotkeys、history、offline、task navigation、right panel
- 标注员 / 审核员不建议拆成两套完整页面。应保留一个工作台入口，通过 mode controller 注入不同权限、横幅、review claim、approve/reject、diffMode 和快捷键。
- 3D 只需要先定义最薄的 `StageKind` / `StageCapabilities` / `StageHost` 边界。不要现在设计统一 `Geometry` 编辑抽象，图片 bbox/polygon、视频 track/keyframe、3D cuboid/point-cloud 语义差异太大。
- 建议先做 **M6.0 overlay 外提**，因为 v0.9.20 已出现过视频工具画完不生效的问题：视频 pending drawing 进入了 Shell 状态，但类别弹窗挂在 ImageStage overlay 中，导致视频分支不渲染。

---

## 1. 为什么现在拆

### 1.1 已经出现跨 Stage 污染

v0.9.20 的视频工具语义补齐后，视频创建路径也开始复用图片侧 `pendingDrawing + ClassPickerPopover`。这本身是合理复用，但当前 overlay 渲染被嵌在 `ImageStage` 的 `overlay` prop 内，导致视频分支拿不到弹窗。

这类问题不是某一行代码偶然写错，而是结构上缺少"stage 无关 overlay 层"：

| 问题 | 根因 | 应该归属 |
|---|---|---|
| 视频 pending drawing 弹窗不显示 | popover 挂在 ImageStage overlay | `WorkbenchOverlays` |
| 图片 / 视频创建语义不同 | Shell 同时知道 bbox、polygon、track、keyframe | stage-specific action hook |
| review 横幅与 annotate 横幅散落 | `mode === "review"` / `mode === "annotate"` 判断混在 Shell JSX | mode controller |
| 未来 3D 会继续追加分支 | Shell 直接 `isVideoTask ? VideoStage : ImageStage` | `WorkbenchStageHost` |

### 1.2 规模已经越过可维护线

当前体量：

| 文件 | 行数 | 主要职责 |
|---|---:|---|
| `WorkbenchShell.tsx` | ~1732 | 布局、任务流、图片/视频分发、mutation、history、offline、review、AI、overlay、右栏 |
| `ImageStage.tsx` | ~1108 | 图片渲染、绘制、选择、resize、polygon/canvas/SAM 接入 |
| `VideoStage.tsx` | ~1055 | 视频播放、轨迹插值、keyframe 编辑、工具栏语义、轨迹侧栏 |

`ImageStage` 和 `VideoStage` 大可以继续较重，因为它们是交互密集组件；但 `WorkbenchShell` 作为编排层不应继续增长到 2000+ 行。

### 1.3 后续需求都会继续压 Shell

已知后续方向：

- 视频属性面板（track 级 + frame 级）
- 视频多选 / 批量操作
- 视频 keyframe 复制粘贴
- Review diff 视频化
- 3D 标注工作台
- 更细的 offline/conflict diff

如果不先拆 Shell，这些能力会继续用 `isVideoTask`、`mode === "review"`、`task?.status` 分支堆在同一个文件里。

---

## 2. 拆分原则

### 2.1 不按页面复制

不建议：

```txt
AnnotateWorkbenchShell.tsx
ReviewWorkbenchShell.tsx
ImageAnnotateWorkbench.tsx
ImageReviewWorkbench.tsx
VideoAnnotateWorkbench.tsx
VideoReviewWorkbench.tsx
```

理由：

- 标注员和审核员共享任务队列、Stage、右栏、状态栏、评论、离线队列、history、快捷键主体。
- 复制页面会让未来每个 Stage 能力都要改两遍。
- 审核模式只是工作流权限和附加操作不同，不是全新的渲染模型。

推荐：

```txt
WorkbenchShell.tsx
  ├─ useAnnotateMode()
  ├─ useReviewMode()
  ├─ WorkbenchStageHost
  ├─ WorkbenchOverlays
  └─ WorkbenchSidePanels
```

### 2.2 不统一内部几何模型

不建议现在抽：

```ts
interface UniversalShapeEditor {
  create(shape: UniversalGeometry): void;
  move(shapeId: string, delta: Vec): void;
  resize(shapeId: string, patch: unknown): void;
}
```

原因：

- 图片：bbox / polygon / canvas / SAM candidate 是扁平 shape。
- 视频：track 是 annotation + keyframes，当前帧 box 是派生结果。
- 3D：可能是 cuboid、point cloud selection、camera frustum、多视角同步。

真正可以统一的是外围协议，而不是内部编辑模型：

```ts
type StageKind = "image" | "video" | "3d";

type StageCapabilities = {
  classPicker: boolean;
  aiPreannotate: boolean;
  diffMode: boolean;
  timeline: boolean;
  viewport: boolean;
  comments: boolean;
};
```

### 2.3 Shell 只做编排，不知道具体 shape 语义

目标：

- Shell 知道当前任务、当前模式、当前 StageKind。
- Shell 不直接拼 `video_track` payload。
- Shell 不直接决定 keyframe split/copy 细节。
- Shell 不把某个 Stage 的 overlay 塞进另一个 Stage 的渲染树。

---

## 3. 目标结构

建议目录：

```txt
apps/web/src/pages/Workbench/
  shell/
    WorkbenchShell.tsx
    WorkbenchStageHost.tsx
    WorkbenchOverlays.tsx
    WorkbenchBanners.tsx
    WorkbenchSidePanels.tsx
    WorkbenchTopbarSlot.tsx
  modes/
    useAnnotateMode.ts
    useReviewMode.ts
    types.ts
  stages/
    image/
      ImageWorkbench.tsx
      useImageAnnotationActions.ts
    video/
      VideoWorkbench.tsx
      useVideoAnnotationActions.ts
      useVideoTrackConversion.ts
    three-d/
      ThreeDWorkbench.placeholder.tsx
      types.ts
    types.ts
```

### 3.1 `WorkbenchShell`

职责保留：

- 拉取 project / task / annotations / predictions 等顶层数据。
- 管理左右栏宽度、当前任务、全局 activeClass。
- 组装布局：左队列、工具栏、中间 stage、右面板、状态栏、全局 modal。
- 把 stage kind 和 mode context 传给子模块。

目标：从 ~1732 行降到 **600–800 行**。

### 3.2 `WorkbenchStageHost`

职责：

- 根据 `stageKind` 渲染 `ImageWorkbench` / `VideoWorkbench` / 未来 `ThreeDWorkbench`。
- 提供 stage-agnostic overlay 层挂载点。
- 暴露 stage controls 给 hotkeys，例如 video playback controls、image viewport controls、未来 3D camera controls。

示意：

```tsx
<WorkbenchStageHost
  stageKind={stageKind}
  mode={mode}
  task={task}
  annotations={annotations}
  overlay={<WorkbenchOverlays />}
/>
```

### 3.3 `WorkbenchOverlays`

职责：

- `pendingDrawing` class picker
- `editingClass` class picker
- SAM candidate class picker
- batch change class picker
- 未来视频 / 3D 的锚点弹窗

原则：

- 不依赖 `ImageStage.overlay`。
- 支持两类定位：
  - image viewport 坐标：`geom + imgW/imgH + vp`
  - viewport/client 坐标：`anchor: { left, top }`

### 3.4 `useAnnotateMode` / `useReviewMode`

职责拆分：

| 能力 | annotate | review |
|---|---|---|
| 任务状态过滤 | active / pre_annotated / annotating / rejected 等 | review / reviewing 等 |
| 锁定策略 | review / completed 锁，rejected 需接受退回 | 审核员可编辑 review 态任务 |
| 顶部动作 | submit / skip / withdraw / reopen | approve / reject / claim |
| 横幅 | 已提交、已通过、已退回、重做中 | 被其他审核员认领、skip reason |
| 快捷键 | smart next / submit | A approve / R reject |
| diffMode | 通常无 | raw / diff / final |

目标：Shell JSX 不再散落大量 `mode === "review"` 判断。

### 3.5 `ImageWorkbench` / `VideoWorkbench`

职责：

- 连接对应 Stage。
- 组装对应 action hook。
- 把 Stage 专属能力封在局部。

`VideoWorkbench` 应接管：

- `videoTool`
- `handleVideoCreateWithClass`
- `handleVideoPendingDraw`
- `handleVideoUpdate`
- `handleVideoRename`
- `handleVideoConvertToBboxes`
- video selected object class change

`ImageWorkbench` 应接管：

- image bbox / polygon / SAM / canvas commit
- image move / resize / nudge / clipboard
- image batch change class / batch delete

---

## 4. 分阶段计划

### M6.0 · Overlay 外提（最高优先）

**目标**：所有工作台弹窗脱离 `ImageStage.overlay`，成为 stage-agnostic overlay。

任务：

1. 新建 `WorkbenchOverlays.tsx`。
2. 把 `pendingDrawing`、`editingClass`、SAM accept、batch change class 四类 popover 移入。
3. 明确 `ClassPickerPopover` 的两种定位模式：
   - image 模式：`geom + imgW/imgH + vp`
   - anchored 模式：`anchor + position: fixed`
4. `ImageStage.overlay` 只保留真正属于图片画布的 overlay，例如 `FloatingDock`、`Minimap`、`CanvasToolbar`。
5. 视频创建 bbox / track 的 pending class picker 必须由 `WorkbenchOverlays` 渲染。

验收：

- 图片画框选类正常。
- 视频 bbox 工具画框选类正常。
- 视频 track 工具新建 track 选类正常。
- 视频选中已有 track 后追加 keyframe 不弹选类。
- `ClassPickerPopover` 不再依赖 `stageGeom.imgW > 0` 才能在视频分支出现。

### M6.1 · Mode controller 外提

**目标**：收束 `annotate | review` 的状态机和权限逻辑。

任务：

1. 新建 `modes/types.ts`：

```ts
type WorkbenchMode = "annotate" | "review";

type WorkbenchModeState = {
  isLocked: boolean;
  diffMode?: DiffMode;
  banners: React.ReactNode;
  topbarActions: {
    canSubmit?: boolean;
    canApprove?: boolean;
    canReject?: boolean;
    canWithdraw?: boolean;
    canReopen?: boolean;
  };
};
```

2. 新建 `useAnnotateMode.ts`：
   - submit / skip / withdraw / reopen
   - rejected / completed / review 状态横幅
   - smart next actions

3. 新建 `useReviewMode.ts`：
   - claim task
   - approve / reject
   - review hotkeys
   - diffMode
   - reviewer mini panel slot

4. Shell 中保留 `mode` prop，但不直接写复杂状态分支。

验收：

- `/annotate` 行为不变。
- `/review` 行为不变。
- A / R 审核快捷键仍可用。
- review claim 逻辑只在 review 模式触发。

### M6.2 · Stage-specific action hooks

**目标**：Shell 不再直接知道 image/video 的 annotation payload 细节。

任务：

1. 新建 `stages/video/useVideoAnnotationActions.ts`：
   - create video bbox
   - create video track
   - upsert keyframe
   - rename video annotation
   - convert track to bboxes
   - selected object reclassify

2. 新建或整理 `stages/image/useImageAnnotationActions.ts`：
   - bbox create
   - polygon commit
   - SAM accept
   - move / resize / nudge
   - clipboard / batch class change

3. action hooks 接收共享依赖：
   - `taskId`
   - `queryClient`
   - `history`
   - `offline queue`
   - `pushToast`
   - `annotationsRef`

4. Shell 只拿到高层 callbacks：

```ts
const imageActions = useImageAnnotationActions(...);
const videoActions = useVideoAnnotationActions(...);
```

验收：

- Shell 中不再手写 `annotation_type: "video_track"`。
- Shell 中不再直接调用 `tasksApi.convertVideoTrackToBboxes`。
- 图片和视频 action hook 均有 focused tests。

### M6.3 · StageHost 收口 Image / Video / 3D

**目标**：Stage 分发从 Shell JSX 中移出，为未来 3D 留入口。

任务：

1. 新建 `stages/types.ts`：

```ts
type StageKind = "image" | "video" | "3d";

type StageAdapter = {
  kind: StageKind;
  capabilities: StageCapabilities;
  render(): React.ReactNode;
};
```

2. 新建 `WorkbenchStageHost.tsx`，内部按 `stageKind` 分发。
3. `ImageWorkbench` / `VideoWorkbench` 作为 Host 的 concrete implementation。
4. 新建 `ThreeDWorkbench.placeholder.tsx`，只返回 unsupported placeholder，不接真实业务。

验收：

- Shell 中不再出现大块 `isVideoTask ? <VideoStage /> : <ImageStage />`。
- 新增 `stageKind === "3d"` 时可以显示明确占位，不影响 image/video。
- 现有 image/video 快捷键行为不变。

### M6.4 · 收尾与文档

任务：

1. 更新 `docs-site/dev/concepts/` 工作台架构文档。
2. 更新 `docs-site/user-guide/` 中标注员 / 审核员工作台说明。
3. 补 ADR：为什么不拆成 AnnotateWorkbench / ReviewWorkbench 两套页面。
4. 记录 3D Stage adapter 约束：只统一外围，不统一内部 geometry。

验收：

- `WorkbenchShell.tsx` 降到 600–800 行。
- image/video 关键流程均有测试。
- 类型检查通过。
- ROADMAP 中 M6 状态更新。

---

## 5. 标注员 / 审核员模式决策

### 推荐：一个 Shell，两个 Mode Controller

保留：

```tsx
<WorkbenchShell mode="annotate" />
<WorkbenchShell mode="review" />
```

但内部改为：

```ts
const modeState = mode === "review"
  ? useReviewMode(...)
  : useAnnotateMode(...);
```

理由：

- 标注和审核共享 80% 工作台能力。
- 审核员需要继承未来所有 Stage 能力，包括视频和 3D。
- 单独维护两套页面会导致 review 模式长期落后。

### 不推荐：按角色拆页面

不做：

```txt
AnnotatorWorkbench.tsx
ReviewerWorkbench.tsx
```

除非未来出现以下变化：

- 审核员工作台 UI 与标注员完全不同。
- 审核员不再编辑原始标注，只做独立 diff / comment flow。
- 业务上需要 reviewer 在多任务批量审核视图中操作，不再以单任务 stage 为中心。

当前不满足这些条件。

---

## 6. 3D 准备边界

### 6.1 现在要准备的

- `StageKind = "image" | "video" | "3d"`
- `StageCapabilities`
- `WorkbenchStageHost`
- stage-level overlay anchor 协议
- stage controls ref 协议，例如 playback / viewport / camera control

### 6.2 现在不要准备的

- 不设计统一 2D/3D geometry 编辑接口。
- 不把 video track 强行套进 image annotation action。
- 不在没有真实 3D 需求前引入 Three.js / point cloud 依赖。
- 不为了 3D 改现有后端 schema。

### 6.3 未来 3D 可能需要的能力

仅记录，不进入 M6：

- 3D viewport / camera controls
- cuboid / polyline / point cloud selection
- 多视角相机同步
- 2D projection overlay
- 3D diff review
- 大点云切片 / LOD

---

## 7. 风险与控制

| 风险 | 说明 | 控制方式 |
|---|---|---|
| 抽象过度 | 为 3D 做不存在的统一编辑模型 | 只抽 StageHost / capabilities，不抽 UniversalGeometryEditor |
| 回归图片工作台 | 图片侧功能多，overlay / SAM / canvas 易回归 | M6.0 先补 image smoke tests |
| 回归审核模式 | review claim / diffMode / A/R 快捷键散落 | M6.1 专门测试 review mode |
| 视频工具再断 | video pending / selected track / convert 动作链路长 | `useVideoAnnotationActions` 加单元测试 |
| 一次 PR 太大 | Shell 拆分触点多 | 每个 M6.x 单独 PR / commit，保持可回滚 |

---

## 8. 不做清单

- 不把 `ImageStage` 和 `VideoStage` 改成同一个 props 接口。
- 不删除现有 `mode="annotate" | "review"` 入口。
- 不新建两套完整工作台页面。
- 不在 M6 引入真实 3D 标注能力。
- 不顺手重写 task queue、right panel、Topbar 的视觉设计。
- 不在拆分过程中改变现有 API 协议。

---

## 9. 建议优先级

如果 v0.9.20 之后继续做视频能力，建议先做：

1. **M6.0 Overlay 外提**：直接降低 image/video 互相污染风险。
2. **M6.2 Video action hook**：继续做视频属性、多选、复制粘贴前，先把视频语义从 Shell 移出。
3. **M6.1 Mode controller**：如果下一步优先做 review diff，则提前做。
4. **M6.3 StageHost**：等 overlay 和 action hook 稳定后再收口 stage 分发。

一句话：**先拆会继续变动的边界，再拆稳定的布局壳。**
