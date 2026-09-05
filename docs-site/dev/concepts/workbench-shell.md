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
            -> 3D shared render surface（单 GPU canvas）
            -> canvas: ToolDock / WorkbenchStageHost / StatusBar
                 -> stageOverlay（候选审阅条）
            -> task-queue: TaskQueuePanel（任务队列）
            -> class-palette: TaskQueuePanel（类别面板）
            -> inspector: AIInspectorPanel
            -> discussion: DiscussionPanel
            -> ai-task: AIPredictionPopover
            -> video-tracker: VideoTrackerPropagateDialog
            -> tri-view: TriViewPanel（整体三行）
            -> camera-view: CameraDockPanel（整组相机图库）
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
- `ThreeDWorkbench`：包装 Three.js 点云工作台，持有 3D 框绘制、gizmo、三视图及相机投影的业务状态；将辅助视图 portal 到稳定的布局内容宿主。

`stages/types.ts` 里的 `StageCapabilities` 用来描述外围能力，例如是否有 class picker、AI 预标、timeline、viewport、comments。它不是内部编辑协议。

## 3D 约束

3D Stage 只复用外围壳：任务流、模式策略、右栏、状态栏、全局 overlay 和快捷键入口。

不要在 3D 接入前抽统一 geometry 或统一 editor 接口。图片 bbox / polygon 是平面 shape；视频 track 是 keyframe 派生的时间序列；3D 可能是 cuboid、点云选择、相机视锥或多视角联动。当前只统一 `StageKind`、`StageCapabilities` 和 `WorkbenchStageHost` 这一层边界。

### 3D 共享渲染 surface

`ThreeDWorkbench` / `usePointCloudScene` 保持唯一 Scene、renderer、geometry、草稿及回退 owner。`WorkbenchDockWorkspace` 提供覆盖整个工作区的 GPU canvas 宿主和稳定的三视图、相机内容宿主；`Workbench3DLayoutContext` 只传递宿主、可见区域及布局动作，不复制业务 session。三视图移到主画布之外也使用同一 renderer。

渲染 surface 与主画布交互宿主分离。主相机宽高比、OrbitControls、TransformControls、拾取及选点使用主画布的完整内容矩形；三视图各使用自己的完整行矩形。遮挡后的可见矩形只用于 scissor，不能用剩余面积重新计算投影或命中坐标。每次提交先清理共享 surface，再按可见区域绘制主 pass 和三视图 pass，移动或隐藏后不保留旧位置像素。

共享 canvas 位于 Dockview DOM 后方，结构背景与当前 GPU 面板内容透明。`workbenchViewportRegions` 按浮窗实际层级做矩形相减，将互不重叠的可见区域同时用于 DOM 裁剪和 GPU scissor。裁剪覆盖较低 group 的背景、标题、边框及独立 `dv-render-overlay`，不裁剪含上层浮窗的公共祖先；独立 CSS 变量承载应用遮罩，避免与 Dockview 自己写入的 `clipPath` 冲突。几何与层级变化合帧测量，纯位置移动及原生 overlay 延迟定位也会触发更新，结束后停止调度并清理旧遮罩。

可见性取原生 group 的活动标签、panel/group visibility 和 parking 状态；不能使用表示全局焦点的 `panel.api.isActive`，也不以延迟更新的 React `aria-hidden` 作为渲染真值。隐藏三视图停止正交 pass，隐藏相机图库暂停投影与深度覆盖层工作。相机编辑模态层和桌宠关联的 PSR 面板通过 portal 避开工作区内容裁剪，保留其坐标和编辑行为。

三视图管线预热、geometry generation、单帧调度及 device-lost 回退仍由现有渲染 owner 管理。布局移动不重建 Scene、不重复下载点云、不增加 renderer 或 GPU context。决策见 [ADR-0073](../adr/archive/0073-shared-surface-for-3d-docking)。

### Scene 连续浏览

Shell 持有当前会话的 `scenePlaybackActive`，将预览状态接到 `useTaskLock(enabled)` 和既有写操作边界。播放时停止心跳并释放旧锁；暂停后仅恢复当前帧的正常锁流程，在锁就绪前保持只读。锁请求按任务串行执行，取消后迟到的获取结果先释放，再允许同任务的新会话获取，防止旧清理释放新锁。

`ThreeDWorkbench` 汇总 PSR 的防抖提交、无效输入、在途保存、绘制草稿和编辑面板，向 `SceneTimeline` 提供启动阻塞原因；同时用任务身份、标注查询和已加载点云 URL 派生 `loading/ready/error`。相机图和渐进上色不阻塞点云就绪。播放中的编辑快捷键或画布点击先暂停，本次手势不提交编辑。

`SceneTimeline` 复用摘要窗口和唯一导航执行器，人工点选保留 160ms 合并，`useScenePlayback` 在目标帧就绪后按所选最高浏览速率停留，再串行导航。它以真实 Scene 身份区分内部切帧和外部跳转；页面隐藏、画布隐藏、资源错误或等待超过 15 秒均暂停，恢复后不自动播放。摘要每次最多 200 帧，展开轨道继续虚拟化，默认紧凑总览不假装掌握全 Scene 的标注密度。

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

### 设置窗口的输入隔离

设置窗口内容与遮罩带 `data-workbench-settings`，打开时 `data-state="open"`。独立的背景键盘和全局滚轮监听先调用 `isWorkbenchSettingsInteractionBlocked(event)`；窗口打开或事件的 `composedPath()` 包含设置标记时直接返回，不阻止传播，让设置自身的键盘、焦点与滚动行为继续工作。事件路径判断保留已卸载的标记，防止关闭设置的同一次事件落到背景。

主快捷键还通过 `disabled` 暂停，开窗时清空空格平移与视频按住状态，并提交此前已有的方向键微移。`keyup`、`pointerup`、`mouseup` 中的释放和拖拽收尾继续执行。视频入口调用 `pausePlayback({ snapToGrid: false })`，暂停但不对齐采样网格、不切换帧；关闭设置后保持暂停。这一边界只负责设置窗口，不改变其它弹窗或后台任务的生命周期。

## 右栏：AI 检查器 + 讨论面板

`WorkbenchDockWorkspace` 是 Dockview 的唯一 React 适配层。`workbenchPanelRegistry` 定义稳定面板 ID、渲染槽、生命周期和布局能力；`workbenchLayoutExecutor` 负责移动、停靠、浮动、隐藏、预设与紧凑布局重放。Shell 继续提供业务状态和回调，布局快照不保存 React props、工具、选择、任务、播放位置或编辑草稿。

| Panel ID        | 内容                            | 生命周期与约束                                                         |
| --------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `canvas`        | ToolDock、当前 Stage、StatusBar | `always`；独占稳定 group，可从菜单换到根边缘，禁止浮动、关闭或标签化   |
| `task-queue`    | 任务队列                        | `onlyWhenVisible`；允许停靠、标签、浮动与隐藏                          |
| `class-palette` | 类别面板                        | `onlyWhenVisible`；允许停靠、标签、浮动与隐藏                          |
| `inspector`     | 标注详情、人工标注与 AI 候选    | `always`；隐藏时保留未完成的属性编辑                                   |
| `discussion`    | 评论、历史、Issue               | `always`；隐藏时保留未发送输入                                         |
| `ai-task`       | 当前题 AI 运行与候选审阅        | `always`；仅图片、视频标注 context 提供入口                            |
| `video-tracker` | 视频追踪配置与运行              | `always`；仅视频标注 context 提供入口                                  |
| `tri-view`      | 俯视、侧视、正视三行精修        | `always`；仅 3D context 提供入口，作为一个面板移动与隐藏               |
| `camera-view`   | 相机停靠图库                    | `always`；仅 3D context 提供入口，禁止原生图库浮窗，模式由整组命令切换 |

- **上段 `.rightSplitTop`**：`AIInspectorPanel`，与下段之间有一个上下拖拽 handle。上段高度持久化到 localStorage `workbench.rightSplit.topHeight`（默认 360px，范围 160–720px）。
- **下段 `.rightSplitBottom`**：`DiscussionPanel`，承载评论 / 历史 / issue 的统一讨论入口。
- **列宽拖拽 handle** 提升到 `.rightSplit` 全高层级，覆盖两段，不再只贴在 AI 检查器一侧。
- **布局偏好**：左右栏开合、左右栏宽度、任务队列 / 类别面板 / 标注详情 / 讨论面板浮窗、3D 三视图浮层、2D 相机面板布局和点云主视角快照写入 `user.preferences.workbench.layout`；前端提交全量 `workbench` 子树，后端递归合并偏好字典，列表覆盖；`workbench.layout.cameraPanels` 按原子 map 替换。
- **侧栏区块分离**：`TaskQueuePanel` 内的任务队列和类别面板、`AIInspectorPanel`、`DiscussionPanel` 都可由 `WorkbenchLayout` 改用 `FloatingPanelShell` 渲染。分离操作默认收起对应侧栏；后续展开只显示仍嵌入的区块，不会自动合并浮窗。合并回侧栏只恢复嵌入状态，不主动展开侧栏。若一侧两个区块都已分离，侧栏 toggle 是可见 no-op。

外围面板可放到画布左、右或底部，也可与其他外围面板组成标签。同窗口浮窗可以包含标签，但浮窗内部不支持再次切分网格。画布换位命令将同一个 `canvas` group 放到整棵可见树的左、右、上、下边缘；画布继续隐藏 header 并锁住原生拖放。`parking` 不显示 header，也不接收用户拖放。适配层不提供 popout，不调用 `addPopoutGroup`，快照清洗也不保留外部窗口描述。

隐藏面板时，executor 先记录原 group、tab index、停靠锚点与尺寸或浮窗矩形，再移动同一实例到不可见的 `parking` group。恢复优先使用仍存在的合法返回位置，否则按保存的锚点或 registry 默认区放置。标题栏常驻 × 与菜单共用隐藏命令，只隐藏该组当前活动标签；上下分割的其他组不受影响，画布不提供 ×。布局入口不调用 `close` 或 `removePanel`；`always` 面板保持 DOM，隐藏时停止非必要的持续工作。

顶部“布局”菜单提供“标准标注”“专注画布”“审核协作”，并按 context 提供“图片 AI 审阅”或“视频追踪”、面板列表和“重置为标准布局”。3D context 另提供框体精修、传感器融合、点级分割、整组相机模式切换与“恢复相机排列”。三种 3D 工作方式只改变辅助面板显隐，保留画布和其他面板的位置及当前工具；相机沿用上次呈现模式。专注画布使用现有 canvas group 的 maximize / restore。预设替换与一次会话级撤销都通过 executor 原位重排现有面板，不触发全树 `fromJSON`，也不改变标注内容和 Stage 的 React 身份。

相机有互斥的 `floating` 与 `docked` 两种呈现：前者使用现有逐路相机浮层，后者只挂载一个 `CameraDockPanel`。图库在窄列单列滚动，按最小图宽 240px、间距 8px 自适应网格；名称、朝向、图像与投影都来自当前帧。切换只改变整组呈现，不支持逐路混合；缺帧、加载或错误不移除布局节点，也不沿用上一帧图片。相机编辑大图继续复用现有种框、标定与人工 2D 成员流程。

### 讨论面板与已有入口

顶部左右按钮按画布左右两侧的实际停靠位置收起或展开整个区域，不绑定任务队列或标注详情名称。它们保留列宽、上下比例和标签顺序，不影响浮窗。单个面板由标题栏 × 或菜单隐藏，再从“布局”菜单找回。Issue FAB、评论跳转和 `requestIssuesTab()` 先打开或聚焦 `discussion`，再切换其内部 tab。

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
      schemaVersion: 5,
      snapshot: {
        layout: serializedDockview,
        returns: panelReturnPositions,
        visibilityIntent: {
          "ai-task": "shown", "video-tracker": "hidden",
          "tri-view": "hidden", "camera-view": "hidden"
        },
        cameraPresentation: "floating"
      }
    }
  }
}
```

context 是 `annotate|review × image|video|3d` 的六项闭集，按账号分别保存。`snapshot.layout` 只保留引擎布局字段，`returns` 保存隐藏面板的 group、index、停靠锚点与尺寸或浮窗矩形，`visibilityIntent` 记录四个工具面板的显示或隐藏意图。`cameraPresentation` 独立记录相机整组模式；floating 时 `camera-view` 位于 parking，但相机仍可按整体显隐意图显示为逐路浮层。

当前客户端解释 schema 1–5 并统一写入 schema 5。旧五面板或七面板快照补齐缺少的固定节点，保留原树与尺寸；九个节点在六个 context 中均存在，不适用的工具停在 parking 并隐藏入口。schema 6 或更高版本显示只读标准布局，提示刷新到新版，也不允许重置覆盖。损坏快照和引擎恢复失败同样使用只读标准布局，但允许用户在桌面模式显式重置。

`workbenchLayoutSnapshot` 对读写执行同一套清洗：UTF-8 JSON 上限 64 KiB、树深度不超过 12、最多 40 个树节点；持久化包含 9 个 panel、最多 9 个用户 group 和 1 个 parking group。非有限尺寸、非法 canvas、重复 panel 和不合法树会触发恢复路径，业务 params、popout 与不支持的引擎字段不进入快照。浮窗边界按工作区实际 client rect 夹取。外围停靠组可保留位置并收起，canvas 及其祖先必须可见，活动组必须可见。左右区域由 canvas 祖先路径上的横向兄弟子树确定；收起前的尺寸写回隐藏节点的缓存尺寸，展开时由画布吸收空间变化。

### 单一写入者

`useWorkbenchWorkspaceLayout` 独占当前 context 的 workspace 写入，复用 `useUserPreferences` 的账号级 React Query key 与请求缓存：

1. 冷启动先读取 `workbench.<userId>.workspace.<context>` 本地缓存，但初始 preferences GET 和该账号尚在途的旧布局保存结算前，禁用全部布局 mutation，不发 workspace PATCH。
2. 初始 GET 返回受支持、清洗通过且不同于本地的快照时，适配层最多进行一次 `fromJSON(remote, { reuseExistingPanels: true })` 回灌。初始化完成后的 refetch 不再替换当前树，GET 失败则沿用本地布局并显示提示，有效快照可以继续调整。
3. 布局操作结束后防抖 300ms，只 PATCH 当前 context。一个请求在途时合并后续变化，只保留最新 dirty 快照，前一请求结束后再提交，避免响应乱序覆盖较新调整。
4. 普通 PATCH 失败保留本地调整与 dirty 状态，不回滚用户看到的布局，也不循环重试；下一次调整可再次保存。`409 layout_schema_downgrade` 会丢弃待写内容并进入不可重置的只读状态。

本地缓存按账号和 context 隔离，切换后取消旧 context 尚未发送的定时写入，旧请求回包不回灌新会话。`useWorkbenchConfig` 的 `setLayout`、`setFields` 和完整偏好保存继续负责其他字段，但通用本地与服务端 writer 都剔除 workspace 副本和已退役的 `triViewFloat`，不产生第二份布局写入。

后端复用 `GET/PATCH /auth/me/preferences`。PATCH 在事务中锁定并刷新当前用户偏好，将 `workspace.contexts.<context>` 作为原子替换路径，锁内拒绝 schemaVersion 降级；不同 context 仍分别合并。同 context、同 schema 的多标签页和多设备采用最后一次写入生效，不引入 revision 或 ETag。部署时先上线后端 schema，再上线可写 workspace 的前端。

### 初次迁移与保留字段

没有当前 context 快照时，从旧左右栏开合、四个分离面板、栏宽和右栏 split 构造初始布局，并由 workspace owner 保存。转换后这些旧字段不再驱动 Docking UI，也不反向同步新树；旧字段与 localStorage key 保留供前端回滚使用，回滚恢复的是升级前的旧布局。

3D 首次迁移仅在当前账号的权威 preferences 返回后读取一次 `triViewFloat` 显隐意图，采用新的默认停靠位置；旧绝对坐标不直接转换为列宽，也不使用无账号归属的历史坐标。相机初次迁移继续使用悬浮模式并保留 `cameraPanels`。后续三视图、相机图库空间状态和相机整组模式 / 显隐只由 workspace writer 管理；旧 `triViewFloat` 值留作回滚资料，不再更新。

下列布局状态仍由原有业务组件和 `useWorkbenchConfig` 管理：

| 字段                | 作用                                               |
| ------------------- | -------------------------------------------------- |
| `floatingSelection` | 选中信息卡的位置、尺寸和折叠态                     |
| `cameraPanels`      | 仅按相机 role 保存悬浮位置和折叠态，停靠切换不清空 |
| `pointcloudCamera`  | `persistCameraView` 开启时记录与恢复点云主视角     |

三视图和相机图库进入 Docking 树，逐路悬浮相机仍使用原有浮层系统。PSR、选中信息卡、桌宠、Drawer、Modal、候选审阅条与 Toast 不进入 Docking 树；其中需要越过内容裁剪的 PSR 与相机编辑层通过 portal 渲染。

## 偏好四分树与设置窗口

`user.preferences.workbench` 从平铺字段重构为四个模态子树 + 顶层 `layout`：

```
workbench
├── common      # 跨模态通用（longTaskSampleRate / confirmDelete / recentClassesLimit / crossFrameOverlay*）
├── image       # 图像渲染与交互（smoothImage / cssImageFilter / controlPointsSize / autoFitOnResize / ...）
├── video       # 视频播放与步进（defaultPlaybackRate / largeFrameStep）
├── pointcloud  # 点云渲染、导航、上色与深度（pointSize / persistCameraView / colorize* / showDepthHint / ...）
└── layout      # 壳层布局，保持顶层不动（见上节）
```

- **后端**：`apps/api/app/schemas/user.py` 四个子树 Model 均 `extra="forbid"`；存量 JSONB 由 alembic `0103` 数据迁移就地改写（up/down 可逆、幂等）。`update_preferences` 入口保留一层 legacy 平铺键提升器兼容旧 tab。
- **`ProjectRenderingConfig` 保持平铺**：项目侧不迁移；`useWorkbenchConfig.applyProjectOverride` 把平铺的项目覆盖映射到 `image.*` 子树字段,`lockedFields` 语义不变。
- **字段注册表**：`state/workbenchSettingsFields.ts` 是设置 UI 的单一来源（key / 分类 / section 分组 / 控件类型 / 是否可锁定）。Settings 页「标注偏好」与工作台设置窗口共用它 + `components/SettingsFieldControl` 渲染，**新增设置项 = 后端子树加字段 → `auth.ts` 类型同步 → 注册表加一行 → 消费点读配置**。
- **设置窗口**：`shell/WorkbenchSettingsDialog.tsx` 复用 Radix Dialog / Tabs。桌面居中双栏，窄屏全屏；固定显示界面布局、标注显示、编辑与辅助、画布与视角、播放与轨迹、性能与实验六类，搜索匹配名称、说明、分组与选项，并保留命中子项的父开关。`WORKBENCH_SETTING_GROUPS` / `WORKBENCH_SETTING_SECTIONS` 和 `groupWorkbenchSettings()` 统一窗口、搜索与个人页的展示顺序，`category` 仍只表示原有偏好子树。窗口不接收 Stage 类型，不做模态可见性过滤。`SettingsFieldControl` 的 `settings` 布局显示说明，个人页保留默认 `compact` 布局。
- **关闭与焦点**：`DialogContent.overlayProps` 为当前窗口配置遮罩层级和事件。仅从遮罩开始的完整点击触发关闭，避免滑块拖出窗口误关闭；关闭与切换分类前 blur 活跃字段。Dialog 接管焦点陷阱与恢复，组合输入期间不响应 Esc，背景输入按上文统一隔离。
- **保存**：写路径仍走 `useWorkbenchConfig.setFields()`（本地立即生效、300ms 防抖 PATCH、卸载 flush）；各实例经模块广播同步，滑块提交后画布更新。hook 不随窗口关闭卸载；初次加载失败提供 `loadError` / `retryLoad` 并禁止写入，保存失败通过 toast 告知未同步。二次推理面板显隐沿用 `useSecondaryBarHiddenPref`，各任务均可调整但仅影响图片工具条；隐藏孤儿标注仍是会话回调。

<!-- history: DiscussionPanel and the split right rail shipped through the v0.11 workbench slices. FloatingPanelShell + layout preferences shipped in v0.13.10. The four-subtree preferences split + settings window shipped in v0.15.3. -->
