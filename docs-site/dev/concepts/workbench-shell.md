---
audience: [dev]
type: explanation
since: v0.9.21
status: stable
last_reviewed: 2026-06-05
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
       -> TaskQueuePanel / ToolDock
       -> 右栏 .rightSplit（列宽可拖拽）
            -> .rightSplitTop: AIInspectorPanel（高度可拖拽）
            -> .rightSplitBottom: DiscussionPanel
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
- `ThreeDWorkbench`：包装 Three.js 点云工作台，持有 3D 框绘制 / gizmo / 三视图浮窗 / 相机投影浮层。

`stages/types.ts` 里的 `StageCapabilities` 用来描述外围能力，例如是否有 class picker、AI 预标、timeline、viewport、comments。它不是内部编辑协议。

## 3D 约束

3D Stage 只复用外围壳：任务流、模式策略、右栏、状态栏、全局 overlay 和快捷键入口。

不要在 3D 接入前抽统一 geometry 或统一 editor 接口。图片 bbox / polygon 是平面 shape；视频 track 是 keyframe 派生的时间序列；3D 可能是 cuboid、点云选择、相机视锥或多视角联动。当前只统一 `StageKind`、`StageCapabilities` 和 `WorkbenchStageHost` 这一层边界。

## Overlay 边界

跨 Stage 的弹窗放在 `WorkbenchOverlays`：待选类别、改类、SAM 接受、批量改类。图片画布自己的浮动控件仍放在 `ImageWorkbench` 内部。

这个边界保证视频 bbox / track 新建时也能显示 class picker，不再依赖 `ImageStage.overlay`。

## 右栏：AI 检查器 + 讨论面板

右栏是一个上下两段的可调整布局（`WorkbenchLayout.tsx` 的 `.rightSplit`）：

- **上段 `.rightSplitTop`**：`AIInspectorPanel`，与下段之间有一个上下拖拽 handle。上段高度持久化到 localStorage `workbench.rightSplit.topHeight`（默认 360px，范围 160–720px）。
- **下段 `.rightSplitBottom`**：`DiscussionPanel`，承载评论 / 历史 / issue 的统一讨论入口。
- **列宽拖拽 handle** 提升到 `.rightSplit` 全高层级，覆盖两段，不再只贴在 AI 检查器一侧。
- **布局偏好**：左右栏开合、左右栏宽度、任务队列 / 类别面板 / 标注详情 / 讨论面板浮窗、3D 三视图浮层状态写入 `user.preferences.workbench.layout`；前端提交全量 `workbench` 子树，后端只做顶层 `workbench` / `ai` 合并。
- **侧栏区块分离**：`TaskQueuePanel` 内的任务队列和类别面板、`AIInspectorPanel`、`DiscussionPanel` 都可由 `WorkbenchLayout` 改用 `FloatingPanelShell` 渲染。分离操作默认收起对应侧栏；后续展开只显示仍嵌入的区块，不会自动合并浮窗。合并回侧栏只恢复嵌入状态，不主动展开侧栏。若一侧两个区块都已分离，侧栏 toggle 是可见 no-op。

`DiscussionPanel`（`shell/DiscussionPanel.tsx`）有三个常驻 tab：

| Tab | 内容 | 实现 |
|---|---|---|
| comments | 标注级 / 任务级评论 | 复用 `CommentsPanel`（`hideTabs` + `forceTab='comments'`） |
| history | 标注 / 任务级 audit 历史 | 复用 `CommentsPanel`（`forceTab='history'`） |
| issues | `kind=issue` 反馈列表 + 图钉联动 | `DiscussionIssuesTab` |

图钉单击 / hover 会通过 `useActiveIssueStore` 的 `tabRequestTick` 自动把面板切到 issues tab。

DiscussionPanel 是默认组件：旧 feature flag `DISCUSSION_PANEL_ENABLED` 与旧浮层 `IssueListPanel` 已删除。讨论面板与评论画布、issue 图钉的交互细节见 [审核模块](./review-module)。

## 浮窗与布局偏好（v0.13.10）

左右侧栏的四个区块（任务队列 / 类别面板 / 标注详情 / 讨论 Issue）与 3D 三视图都可分离为**同窗口浮窗**。所有浮窗 chrome 统一由 `shell/FloatingPanelShell` + `shell/useDragMove` 承载：顶栏拖动、右下角 resize、窗口 resize 时 clamp 回视口、边界防丢，以及合并回侧栏 / 关闭入口。`floatingPanelSizing.ts` 提供统一的最小尺寸与首次默认位置。

### 状态契约

布局状态是 `user.preferences.workbench.layout`（`WorkbenchLayoutPreferences`，定义于 `apps/web/src/api/auth.ts`）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `leftOpen` / `rightOpen` | `boolean` | 左 / 右侧栏开合 |
| `leftWidth` / `rightWidth` | `number` | 侧栏列宽（clamp 200–560 / 220–600） |
| `floatingTaskQueue` / `floatingClassPalette` / `floatingInspector` / `floatingDiscussion` | `FloatingPanelState` | 四个侧栏区块的浮窗态 |
| `triViewFloat` | `TriViewFloatState` | 3D 三视图浮层态 |

`FloatingPanelState = { detached: boolean; x/y/w/h: number｜null }`；`TriViewFloatState` 把 `detached` 换成 `collapsed`（三视图常驻浮层，只折叠不分离）。`x/y/w/h` 为 `null` 表示尚未拖动过、用首次默认位置。

### 分离 / 合并状态机

- **分离**某区块时默认收起对应侧栏。
- 之后**展开**侧栏只渲染仍嵌入的区块，不会把已分离浮窗自动收编。
- **合并回侧栏**只把该区块恢复为嵌入态，不主动展开侧栏。
- 若一侧两个区块都已分离，侧栏 toggle 是可见 no-op。

### localStorage ↔ 服务端同步

`state/useWorkbenchConfig.ts` 是单一入口：

- `setLayout()` 先本地立即生效并写 `localStorage`（key 见 `LAYOUT_STORAGE_KEYS`，作为离线 / 未登录兜底和远端缺省）。
- 登录在线时再以 **300ms debounce** `PATCH /me/preferences`，提交**全量 `workbench` 子树**（不是只发 nested `layout`），避免覆盖同子树下的其它渲染偏好。后端只做顶层 `workbench` / `ai` 合并。
- 远端值缺失字段用 `localStorage` / `DEFAULT_WORKBENCH_PREFERENCES` 逐字段兜底合并（`mergeFloatingPanelState` / `mergeTriViewFloatState`）。

<!-- history: DiscussionPanel and the split right rail shipped through the v0.11 workbench slices. FloatingPanelShell + layout preferences shipped in v0.13.10. -->
