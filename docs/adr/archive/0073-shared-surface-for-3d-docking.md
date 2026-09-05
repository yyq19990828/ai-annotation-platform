# 0073 — 3D 自由布局采用工作区共享渲染 surface 与整组相机呈现

- Status: Accepted
- Date: 2026-09-05
- Deciders: AI Annotation Platform maintainers
- Supersedes: 部分替代 ADR-0070 的主画布覆盖范围前提及 ADR-0072 的三视图、相机排除范围；单 context、受控布局与单一写入者约束继续有效

## Context

三视图需要与其他工作台面板一样停靠、组成标签和浮动。原先正交底图绘制在主点云 canvas 上，三视图的 DOM 只承载编辑覆盖层；直接把 DOM 移到侧栏会离开 canvas 范围，导致底图缺失。为每个面板创建 renderer 则会复制 GPU 资源，并重新引入 backend、设备丢失与销毁的多 owner 问题。

用户需要保留当前相机悬浮体验：逐路朝向贴边、拖动、折叠、归位和放大；停靠时则希望全部相机合成一个组件。布局不能因切帧、相机数量或选中对象变化而重排，也不能让一次模式切换清空另一模式的位置记忆。

## Decision

### 稳定面板与业务 owner

在既有七个 panel 上固定增加 `tri-view` 和 `camera-view`，六个工作台 context 都保留九个节点，不适用的面板停在 parking。三视图是一个稳定实例，内部俯视、侧视和正视三行均分可用高度；无选中对象时显示提示，不能删除布局节点。三视图支持停靠、标签、同窗口浮动与隐藏。

`ThreeDWorkbench` / `usePointCloudScene` 继续拥有 Scene、geometry、renderer、选择、PSR 草稿和相机编辑回调。布局层只提供稳定 DOM 宿主、空间命令和可见性，通过 `Workbench3DLayoutContext` 接线；不新增业务 store 或复制 3D session。运行中的布局变更使用原位 API，不通过反复 `fromJSON` 重建 Stage。

### 一块覆盖工作区的 GPU canvas

GPU canvas 宿主扩展到整个 Dockview 工作区，与主视图的交互宿主分开。每次提交先清理共享 surface，再依次绘制主视图与可见的三视图 pass；旧位置没有有效视图时保持清空，避免拖动、隐藏后的残影。

每个相机的 viewport 和投影宽高比使用对应视图的完整内容矩形。主视图的 OrbitControls、TransformControls、辅助器、拾取及矩形 / 多边形选点也使用主画布内容矩形。遮挡计算只改变 scissor，不用剩余矩形重新定义投影或输入坐标。

共享 canvas 位于 Dockview DOM 下方；结构容器以及当前主画布 / 三视图 group 内容透明，普通面板、标题和菜单保持不透明。按原生浮窗的实际层级，逐个从较低视图矩形中减去遮挡矩形，得到互不重叠的可见区域。DOM clip-path 与 GPU scissor 使用同一份区域，覆盖较低 group 背景、标题、边框和独立 `dv-render-overlay`，不裁剪含上层浮窗的公共祖先。

应用裁剪通过独立 CSS 变量写入，避开 Dockview 自身对 overlay `style.clipPath` 的维护。位置、尺寸、层级、标签与显隐变化合帧测量；浮窗纯位置拖动及原生 overlay 延迟定位都必须更新区域，恢复或销毁时清理旧遮罩。相机编辑模态层与桌宠关联 PSR 使用 portal 越过内容裁剪，不通过提高被裁剪子节点的 z-index 规避问题。

可见性基于 group 的活动标签、panel / group visibility 和 parking 状态，不能把全局焦点 `panel.api.isActive` 当作可见性。隐藏视图停止非必要绘制。现有 renderer 调度、geometry generation、`compileAsync` 预热去重、Legacy / WebGPU 选择和 device-lost 回退仍归同一个 owner；本决策不批准默认开启 WebGPU。

### 相机整组切换

`cameraPresentation` 取 `floating` 或 `docked`，与 `visibilityIntent.camera-view` 的整体显隐独立：

- `floating`：`camera-view` 位于 parking，显示时沿用现有逐路浮层及 `cameraPanels` 偏好。
- `docked`：只呈现一个图库组件；窄列纵向滚动，宽列按最小图宽 240px、间距 8px 自适应网格，图像和投影等比缩放。

两种模式互斥，切换覆盖全部相机。浮层与顶部布局菜单提供“全部相机停靠”，停靠组标题提供“悬浮显示”；相机图库不生成第三种原生 Dockview 浮窗，不支持部分相机停靠、部分继续悬浮。

固定 role 仅是组件内部数据身份，切帧、加载失败或缺相机不能改变 Dockview 拓扑，也不能沿用上一帧图像。投影、深度、反选、最佳相机提示与放大后的种框、标定和人工 2D 成员编辑复用现有流程。

### 布局命令与偏好所有权

可隐藏面板组标题常驻 ×，与菜单共用隐藏命令，只隐藏当前活动 panel；画布没有该动作。移到 parking 前保存返回位置，找回时恢复已有位置及业务状态。新建列继续使用工作区宽度的 15%，后续允许手动调整。

主视角工具栏只保留俯视和重置；点级分割激活时增加选点方式下拉。框体精修、传感器融合、点级分割以及恢复相机排列位于顶部布局菜单。工作方式只调整 3D 辅助面板的显隐，保留主画布和其他面板位置，沿用既有一次布局撤销。

workspace schema 升至 5，固定九个 panel，新增相机模式及三视图 / 相机显隐意图。保留 64 KiB 与深度 12 限制，允许最多九个用户 group 加一个 parking、40 个树节点；旧 schema 1–4 补齐固定节点并保留旧树、尺寸和返回位置，未来 schema 保持只读与降级 409 保护。

`useWorkbenchWorkspaceLayout` 独占三视图和图库空间状态、相机整组模式及显隐。`cameraPanels` 继续只保存逐路悬浮位置和折叠态，停靠切换不清空。初次升级从当前账号的权威 preferences 读取一次旧三视图显隐意图，采用默认停靠位置；不把旧绝对坐标换成列宽。`useWorkbenchConfig` 的通用服务端及本地 writer 停止写入 `triViewFloat`，旧值仅留作回滚资料。

不新增 endpoint、数据库迁移、依赖或环境变量。部署先后端 schema、后前端；旧前端回滚不删除新快照，按未来 schema 只读处理，标注数据不随布局迁移。

## Consequences

### Positive

- 三视图可离开主画布区域，同时保留单 renderer、单 context 与共享 geometry。
- 相机悬浮和停靠分别保留位置，数据更新与布局身份解耦。
- 快捷隐藏、菜单和预设统一走已有命令及写入者，业务草稿与编辑流程不随布局切换而重建。

### Negative

- 透明 GPU 面板要求 DOM 遮挡、scissor、投影与输入坐标一致；仅验证截图不足以证明拾取和编辑正确。
- 独立 render-overlay 的原生异步定位需要纳入几何更新，不能只观察尺寸或拖动结束。
- 同一次提交可能包含多个 scissor pass；本决策减少重复资源，不承诺多视图等于一次 draw。

## Alternatives Considered

**每个面板各建 renderer**：会复制 GPU buffer、相机纹理与设备生命周期，违反单 context 约束。

**RenderTarget atlas 或逐帧图像复制**：所有视图仍在同一工作区窗口内，共享 surface 足以覆盖；增加纹理分配和合成链路没有必要。

**每路相机独立 Dockview panel**：用户选择整组切换，逐路节点会把相机数据数量变成布局拓扑，也需要另一套浮窗兼容语义。

## Notes

- 布局与遮挡：`apps/web/src/pages/Workbench/layout/WorkbenchDockWorkspace.tsx`、`workbenchViewportRegions.ts`、`workbenchLayoutExecutor.ts`。
- 3D owner：`apps/web/src/pages/Workbench/stages/three-d/ThreeDWorkbench.tsx`、`usePointCloudScene.ts`、`PointCloudScene.ts`、`PointCloudTriViewPass.ts`。
- 偏好合同：`apps/web/src/pages/Workbench/state/useWorkbenchWorkspaceLayout.ts`、`useWorkbenchConfig.ts`、`apps/api/app/schemas/workbench_workspace.py`。
- 本 ADR 记录已接受的设计决策，不代替功能验收、性能测量或发布记录。
