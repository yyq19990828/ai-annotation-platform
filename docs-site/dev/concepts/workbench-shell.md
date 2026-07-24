---
audience: [dev]
type: explanation
since: v0.9.21
status: stable
last_reviewed: 2026-07-14
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
       -> stageOverlay（AI 追踪面板 / 候选审阅条）
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

### 3D 快捷键不走集中式 dispatchKey

工作台的集中式快捷键派发（`hotkeys.ts` 的 `dispatchKey`，由 `useWorkbenchHotkeys` 全局注册）是为 2D 画布 / 视频设计的：`HotkeyAction` 联合类型只有 `setTool` / `arrowNudge` / `acceptAi` / `video*` / `submit` 等平面语义，没有 gizmo 模式、3D 工具、点云几何或相机切换。3D 的工具与编辑键（W/E/R gizmo、B/P/V 工具切换、Q 系列框拟合、Shift+→/← 跨帧延续、放大浮层 ←/→ 切相机、Delete/Backspace 删框）因此**由 `ThreeDWorkbench` 组件内 `addEventListener` 本地接管**，原因有三：

1. **键位与 2D 语义冲突**：如 `E` 在 dispatchKey 里是「提交质检」，3D 想用它切旋转 gizmo。`useWorkbenchShellModel` 用 `threeDOwnedKeys`（`w/e/r/b/p/v/Delete/Backspace`）在 `stageKind === "3d"` 时作为 `ignoredKeys` 传入，让 `useWorkbenchHotkeys` 对这批键提前 return，dispatchKey 不再消费它们。
2. **操作对象在组件内**：W/E/R 直接调 `sceneRef.current?.setTransformMode()`（three.js TransformControls），Q 系列调点云专属的 autofit 几何算法——壳层的快捷键 hook 拿不到这些引用。
3. **一键多变体**：如 Q / Shift+Q / Alt+Q 是三种不同拟合，←/→ 只在放大浮层状态下才是切相机，超出 dispatchKey「一键一 action」的表达力。

代价：这些键不在 `HOTKEYS` 派发表里，只作为**纯展示条目**（无 `actionType`）登记进 `?` 帮助面板的「3D / 点云」分组——因此能在面板查到，但不计入「按使用频率排」的统计。

## Overlay 边界

跨 Stage 的弹窗放在 `WorkbenchOverlays`：待选类别、改类、SAM 接受、批量改类。图片画布自己的浮动控件仍放在 `ImageWorkbench` 内部。

这个边界保证视频 bbox / track 新建时也能显示 class picker，不再依赖 `ImageStage.overlay`。

视频 AI 追踪面板和候选审阅条使用 `WorkbenchLayout.stageOverlay`，相对中间 Stage 定位。顶部 `Topbar` 在视频任务中并列「追踪」与「AI 单题」入口，两个配置面板互斥。它们的位置 / 尺寸通过 `useFloatingPanelFrame` 保存到各自的 localStorage key，不属于下文的服务端 `workbench.layout` 偏好树。

## 右栏：AI 检查器 + 讨论面板

右栏是一个上下两段的可调整布局（`WorkbenchLayout.tsx` 的 `.rightSplit`）：

- **上段 `.rightSplitTop`**：`AIInspectorPanel`，与下段之间有一个上下拖拽 handle。上段高度持久化到 localStorage `workbench.rightSplit.topHeight`（默认 360px，范围 160–720px）。
- **下段 `.rightSplitBottom`**：`DiscussionPanel`，承载评论 / 历史 / issue 的统一讨论入口。
- **列宽拖拽 handle** 提升到 `.rightSplit` 全高层级，覆盖两段，不再只贴在 AI 检查器一侧。
- **布局偏好**：左右栏开合、左右栏宽度、任务队列 / 类别面板 / 标注详情 / 讨论面板浮窗、3D 三视图浮层、2D 相机面板布局和点云主视角快照写入 `user.preferences.workbench.layout`；前端提交全量 `workbench` 子树，后端只做顶层 `workbench` / `ai` 合并。
- **侧栏区块分离**：`TaskQueuePanel` 内的任务队列和类别面板、`AIInspectorPanel`、`DiscussionPanel` 都可由 `WorkbenchLayout` 改用 `FloatingPanelShell` 渲染。分离操作默认收起对应侧栏；后续展开只显示仍嵌入的区块，不会自动合并浮窗。合并回侧栏只恢复嵌入状态，不主动展开侧栏。若一侧两个区块都已分离，侧栏 toggle 是可见 no-op。

`DiscussionPanel`（`shell/DiscussionPanel.tsx`）有三个常驻 tab：

| Tab      | 内容                             | 实现                                                       |
| -------- | -------------------------------- | ---------------------------------------------------------- |
| comments | 标注级 / 任务级评论              | 复用 `CommentsPanel`（`hideTabs` + `forceTab='comments'`） |
| history  | 标注 / 任务级 audit 历史         | 复用 `CommentsPanel`（`forceTab='history'`）               |
| issues   | `kind=issue` 反馈列表 + 图钉联动 | `DiscussionIssuesTab`                                      |

图钉单击 / hover 会通过 `useActiveIssueStore` 的 `tabRequestTick` 自动把面板切到 issues tab。

DiscussionPanel 是默认组件：旧 feature flag `DISCUSSION_PANEL_ENABLED` 与旧浮层 `IssueListPanel` 已删除。讨论面板与评论画布、issue 图钉的交互细节见 [审核模块](./review-module)。

## 浮窗与布局偏好（v0.13.10）

左右侧栏的四个区块（任务队列 / 类别面板 / 标注详情 / 讨论 Issue）与 3D 三视图都可分离为**同窗口浮窗**。所有浮窗 chrome 统一由 `shell/FloatingPanelShell` + `shell/useDragMove` 承载：顶栏拖动、右下角 resize、窗口 resize 时 clamp 回视口、边界防丢，以及合并回侧栏 / 关闭入口。`floatingPanelSizing.ts` 提供统一的最小尺寸与首次默认位置。

### 状态契约

布局状态是 `user.preferences.workbench.layout`（`WorkbenchLayoutPreferences`，定义于 `apps/web/src/api/auth.ts`）：

| 字段                                                                                      | 类型                               | 含义                                                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `leftOpen` / `rightOpen`                                                                  | `boolean`                          | 左 / 右侧栏开合                                                                    |
| `floatingTaskQueue` / `floatingClassPalette` / `floatingInspector` / `floatingDiscussion` | `FloatingPanelState`               | 四个侧栏区块的浮窗态                                                               |
| `triViewFloat`                                                                            | `TriViewFloatState`                | 3D 三视图浮层态                                                                    |
| `cameraPanels`                                                                            | `Record<string, CameraPanelState>` | 3D 悬浮相机面板位置 + 折叠态，按相机 role 分桶                                     |
| `pointcloudCamera`                                                                        | `PointcloudCameraState｜null`      | 点云主视图相机快照；仅当 `workbench.pointcloud.persistCameraView` 开启时写入和恢复 |

> 边栏宽度不再属于 layout 子树：旧的 `leftWidth` / `rightWidth`（像素，clamp 200–560 / 220–600）已替换为通用偏好 `workbench.common.leftWidthPct` / `rightWidthPct`（占工作台宽度的百分比，clamp 10–35%，默认 15%），拖拽分隔条与设置面板双向同步。详见 [设置参考](../../user-guide/reference/settings)。

`FloatingPanelState = { detached: boolean; x/y/w/h: number｜null }`；`TriViewFloatState` 把 `detached` 换成 `collapsed`（三视图常驻浮层，只折叠不分离）。`x/y/w/h` 为 `null` 表示尚未拖动过、用首次默认位置。`CameraPanelState = { x/y: number｜null; collapsed?: boolean }`（x/y 为 `null` = 未拖动、用默认贴边位）；某 role 无键 = 用默认位置 + 自动折叠态。早期版本用 `pcwb:cam-pos:*` / `pcwb:cam-collapsed:*` 两个 localStorage 键，v0.15.x 起迁移到此处由后端持久化，旧键首次加载时一次性迁移后清除。

`PointcloudCameraState = { position: [x,y,z]; target: [x,y,z]; up: [x,y,z]; mode: "orbit" | "bev" }`。该字段是布局状态而非渲染偏好：开关 `workbench.pointcloud.persistCameraView` 控制是否记录，实际相机 pose 跟随 `setLayout({ pointcloudCamera })` 走同一条本地缓存 + 300ms PATCH 管线。

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

## 偏好四分树与设置抽屉（v0.15.3）

`user.preferences.workbench` 从平铺字段重构为四个模态子树 + 顶层 `layout`：

```
workbench
├── common      # 跨模态通用（longTaskSampleRate / confirmDelete / recentClassesLimit / crossFrameOverlay*）
├── image       # 图像渲染与交互（smoothImage / cssImageFilter / controlPointsSize / autoFitOnResize / ...）
├── video       # 视频播放与步进（defaultPlaybackRate / largeFrameStep）
├── pointcloud  # 点云渲染、导航、上色与深度（pointSize / persistCameraView / colorize* / showDepthHint / ...）
└── layout      # 壳层布局，保持顶层不动（见上节）
```

- **后端**：`apps/api/app/schemas/user.py` 四个子树 Model 均 `extra="forbid"`；存量 JSONB 由 alembic `0103` 数据迁移就地改写（up/down 可逆、幂等）。`update_preferences` 入口保留一层 legacy 平铺键提升器兼容窗口期旧 tab（v0.16 移除）。
- **`ProjectRenderingConfig` 保持平铺**：项目侧不迁移；`useWorkbenchConfig.applyProjectOverride` 把平铺的项目覆盖映射到 `image.*` 子树字段,`lockedFields` 语义不变。
- **字段注册表**：`state/workbenchSettingsFields.ts` 是设置 UI 的单一来源（key / 分类 / 控件类型 / 是否可锁定）。Settings 页「标注偏好」与工作台设置抽屉共用它 + `components/SettingsFieldControl` 渲染，**新增设置项 = 后端子树加字段 → `auth.ts` 类型同步 → 注册表加一行 → 消费点读配置**。
- **设置抽屉**：`shell/WorkbenchSettingsDrawer.tsx`，齿轮菜单入口，只显示「通用 + 当前模态」分组。写路径走 `useWorkbenchConfig.setFields()`（本地立即生效 + 与 `setLayout` 共用的 300ms 防抖 PATCH 和卸载 flush）；多实例（抽屉 ↔ 画布）经模块级广播同步，实现拖滑块画布实时预览。

<!-- history: DiscussionPanel and the split right rail shipped through the v0.11 workbench slices. FloatingPanelShell + layout preferences shipped in v0.13.10. The four-subtree preferences split + settings drawer shipped in v0.15.3. -->
