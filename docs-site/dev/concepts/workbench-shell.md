---
audience: [dev]
type: explanation
since: v0.9.21
status: stable
last_reviewed: 2026-09-05
---

# 工作台 Shell 架构

Workbench 是图片标注、视频追踪、审核流共用的页面壳。它的边界不是按角色复制页面，而是把「模式」和「Stage」拆成两条正交轴：

```
WorkbenchShell
  -> useAnnotateMode() / useReviewMode()
  -> WorkbenchLayout
       -> WorkbenchBanners
       -> Topbar
       -> WorkbenchDockWorkspace
            -> canvas: ToolDock / WorkbenchStageHost / StatusBar
                 -> stageOverlay（候选审阅条）
            -> task-queue: TaskQueuePanel（任务队列）
            -> class-palette: TaskQueuePanel（类别面板）
            -> inspector: AIInspectorPanel
            -> discussion: DiscussionPanel
            -> ai-task: AIPredictionPopover
            -> video-tracker: VideoTrackerPropagateDialog
  -> WorkbenchOverlays
```

## Shell 的职责

`WorkbenchShell.tsx` 只负责路由参数、项目与任务数据、React Query mutations、history、离线队列、快捷键注册，以及把这些依赖装配到子模块。

它不直接渲染 `ImageStage` 或 `VideoKonvaStage`，也不直接拼装某个 Stage 的 annotation payload。图片和视频的创建、更新、改类、撤销相关语义分别下沉到：

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
- `VideoWorkbench`：包装视频 `VideoKonvaStage`，持有视频时间轴、轨迹与 keyframe 操作。
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

视频候选审阅条仍使用 `WorkbenchLayout.stageOverlay`，相对中间 Stage 定位。当前题 AI 与视频追踪是独立 Dockview panel，视频标注中可以同时显示；打开入口会显示或聚焦已有实例，不创建第二份业务 session。

## 可停靠工作区

`WorkbenchDockWorkspace` 是 Dockview 的唯一 React 适配层。`workbenchPanelRegistry` 定义稳定面板 ID、渲染槽、生命周期和布局能力；`workbenchLayoutExecutor` 负责移动、停靠、浮动、隐藏、预设与紧凑布局重放。Shell 继续提供业务状态和回调，布局快照不保存 React props、工具、选择、任务、播放位置或编辑草稿。

| Panel ID        | 内容                            | 生命周期与约束                                                       |
| --------------- | ------------------------------- | -------------------------------------------------------------------- |
| `canvas`        | ToolDock、当前 Stage、StatusBar | `always`；独占稳定 group，可从菜单换到根边缘，禁止浮动、关闭或标签化 |
| `task-queue`    | 任务队列                        | `onlyWhenVisible`；允许停靠、标签、浮动与隐藏                        |
| `class-palette` | 类别面板                        | `onlyWhenVisible`；允许停靠、标签、浮动与隐藏                        |
| `inspector`     | 标注详情、人工标注与 AI 候选    | `always`；隐藏时保留未完成的属性编辑                                 |
| `discussion`    | 评论、历史、Issue               | `always`；隐藏时保留未发送输入                                       |
| `ai-task`       | 当前题 AI 运行与候选审阅        | `always`；仅图片、视频标注 context 提供入口                          |
| `video-tracker` | 视频追踪配置与运行              | `always`；仅视频标注 context 提供入口                                |

外围面板可放到画布左、右或底部，也可与其他外围面板组成标签。同窗口浮窗可以包含标签，但浮窗内部不支持再次切分网格。画布换位命令将同一个 `canvas` group 放到整棵可见树的左、右、上、下边缘；画布继续隐藏 header 并锁住原生拖放。`parking` 不显示 header，也不接收用户拖放。适配层不提供 popout，不调用 `addPopoutGroup`，快照清洗也不保留外部窗口描述。

隐藏面板时，executor 先记录原 group、tab index 与浮窗矩形，再移动同一实例到不可见的 `parking` group。恢复优先使用仍存在的合法返回位置，否则按 registry 默认区放置。布局入口不调用 `close` 或 `removePanel`；`always` 面板保持 DOM，隐藏时停止非必要的持续工作。

顶部“布局”菜单提供“标准标注”“专注画布”“审核协作”，并按 context 提供“图片 AI 审阅”或“视频追踪”、面板列表和“重置当前布局”。专注画布使用现有 canvas group 的 maximize / restore。预设替换与一次会话级撤销都通过 executor 原位重排现有面板，不触发全树 `fromJSON`，也不改变标注内容和 Stage 的 React 身份。

### 讨论面板与已有入口

顶部原左栏按钮映射为任务队列的显示 / 隐藏与聚焦，原右栏按钮映射为标注详情，类别面板由“布局”菜单独立控制。Issue FAB、评论跳转和 `requestIssuesTab()` 先打开或聚焦 `discussion`，再切换其内部 tab。

`DiscussionPanel` 的内部业务 tab 保持原边界：

| Tab      | 内容                            | 实现                                                  |
| -------- | ------------------------------- | ----------------------------------------------------- |
| comments | 标注级 / 任务级评论             | `CommentsPanel`（`hideTabs` + `forceTab='comments'`） |
| history  | 标注 / 任务级 audit 历史        | `CommentsPanel`（`forceTab='history'`）               |
| issues   | `kind=issue` 反馈列表与图钉联动 | `DiscussionIssuesTab`                                 |

图钉和讨论入口通过 `useActiveIssueStore` 的 `tabRequestTick` 请求切到 issues tab。评论画布与图钉的业务交互见[审核模块](./review-module)。布局不拆分 `AIInspectorPanel` 或 `DiscussionPanel` 的内部业务 tab。

### 桌面与紧凑布局

工作区宽度不超过 1024px 时，适配层在初始偏好读取结算后进入紧凑模式：先锁存已清洗的桌面快照，再把外围面板移到 `parking`；面板菜单每次只将一个现有实例放入 `compact-overlay` 同窗口浮窗。预设、重置、布局撤销、停靠、浮动与 resize 都禁用，进入紧凑模式时丢弃已有预设撤销点。

返回桌面宽度后，executor 以固定 canvas group 为锚点，使用 move / visibility / size API 重建原有 group、tab 顺序、活动标签、浮窗和隐藏状态。切换过程不使用 `fromJSON`，不重新挂载 Stage；3D 主视图和三视图继续遵守单 renderer / canvas 的约定。

紧凑投影、重放中间状态和临时 `compact-overlay` 都不提交给服务端。重放失败时保留桌面快照并进入只读标准布局；用户返回桌面宽度后显式重置，才允许写入恢复结果。小于 768px 的窗口继续显示现有阻断页。

## 布局偏好与恢复

可停靠布局存放于 `user.preferences.workbench.layout.workspace`：

```ts
{
  engine: "dockview@8",
  contexts: {
    "annotate:image": {
      schemaVersion: 4,
      snapshot: {
        layout: serializedDockview,
        returns: panelReturnPositions,
        visibilityIntent: { "ai-task": "shown", "video-tracker": "hidden" }
      }
    }
  }
}
```

context 是 `annotate|review × image|video|3d` 的六项闭集，按账号分别保存。`snapshot.layout` 只保留引擎布局字段，`returns` 只保留隐藏面板的 group、index 与可选浮窗矩形，`visibilityIntent` 记录两个工具面板的显示或隐藏意图。

当前客户端解释 schema 1 / 2 / 3 / 4 并统一写入 schema 4。旧五面板快照第一次变更时补齐两个工具节点；schema 5 或更高版本显示只读标准布局，提示刷新到新版，也不允许重置覆盖。损坏快照和引擎恢复失败同样使用只读标准布局，但允许用户在桌面模式显式重置。

`workbenchLayoutSnapshot` 对读写执行同一套清洗：UTF-8 JSON 上限 64 KiB；持久化最多 7 个 panel、7 个用户 group 和 1 个 parking group；schema 1 / 2 接受五个核心 panel，schema 3 / 4 恰好包含七个 panel。非有限尺寸、非法 canvas、重复 panel 和不合法树会触发恢复路径，业务 params、popout 与不支持的引擎字段不进入快照。浮窗边界按工作区实际 client rect 夹取。schema 4 允许外围停靠组保留位置并收起，canvas 及其祖先必须可见，活动组必须可见。左右区域由 canvas 祖先路径上的横向兄弟子树确定；收起前的尺寸写回隐藏节点的缓存尺寸，展开时由画布吸收空间变化。

### 单一写入者

`useWorkbenchWorkspaceLayout` 独占当前 context 的 workspace 写入，复用 `useUserPreferences` 的账号级 React Query key 与请求缓存：

1. 冷启动先读取 `workbench.<userId>.workspace.<context>` 本地缓存，但初始 preferences GET 和该账号尚在途的旧布局保存结算前，禁用全部布局 mutation，不发 workspace PATCH。
2. 初始 GET 返回受支持、清洗通过且不同于本地的快照时，适配层最多进行一次 `fromJSON(remote, { reuseExistingPanels: true })` 回灌。初始化完成后的 refetch 不再替换当前树，GET 失败则沿用本地布局并显示提示，有效快照可以继续调整。
3. 布局操作结束后防抖 300ms，只 PATCH 当前 context。一个请求在途时合并后续变化，只保留最新 dirty 快照，前一请求结束后再提交，避免响应乱序覆盖较新调整。
4. 普通 PATCH 失败保留本地调整与 dirty 状态，不回滚用户看到的布局，也不循环重试；下一次调整可再次保存。`409 layout_schema_downgrade` 会丢弃待写内容并进入不可重置的只读状态。

本地缓存按账号和 context 隔离，切换后取消旧 context 尚未发送的定时写入，旧请求回包不回灌新会话。`useWorkbenchConfig` 的 `setLayout`、`setFields` 和完整偏好保存继续负责其他字段，但所有旧 writer 的 PATCH 都剔除 workspace 副本。

后端复用 `GET/PATCH /auth/me/preferences`。PATCH 在事务中锁定并刷新当前用户偏好，将 `workspace.contexts.<context>` 作为原子替换路径，锁内拒绝 schemaVersion 降级；不同 context 仍分别合并。同 context、同 schema 的多标签页和多设备采用最后一次写入生效，不引入 revision 或 ETag。部署时先上线后端 schema，再上线可写 workspace 的前端。

### 初次迁移与保留字段

没有当前 context 快照时，从旧左右栏开合、四个分离面板、栏宽和右栏 split 构造初始布局，并由 workspace owner 保存。转换后这些旧字段不再驱动 Docking UI，也不反向同步新树；旧字段与 localStorage key 保留供前端回滚使用，回滚恢复的是升级前的旧布局。

下列布局状态仍由原有业务组件和 `useWorkbenchConfig` 管理：

| 字段                | 作用                                           |
| ------------------- | ---------------------------------------------- |
| `floatingSelection` | 选中信息卡的位置、尺寸和折叠态                 |
| `triViewFloat`      | 3D 三视图浮层位置、尺寸和折叠态                |
| `cameraPanels`      | 按相机 role 保存 2D 相机面板布局               |
| `pointcloudCamera`  | `persistCameraView` 开启时记录与恢复点云主视角 |

3D 三视图、相机面板、PSR、选中信息卡和桌宠继续位于各自 Stage overlay；Drawer、Modal、候选审阅条与 Toast 也不进入 Docking 树。

## 偏好四分树与设置抽屉

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
