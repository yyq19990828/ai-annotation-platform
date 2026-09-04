# 0072 — 工作台采用受控 Dockview 布局与单一快照写入者

- Status: Accepted
- Date: 2026-09-05
- Deciders: AI Annotation Platform maintainers
- Supersedes: 无；扩展 ADR-0017，保留 ADR-0070 的单 context 约束

## Context

固定左右栏和四套分离浮窗分别管理宽度、位置、开合与恢复，无法表示停靠标签，也容易让面板显隐出现多份状态。图片、视频和点云共用工作台 Shell，但需要按标注或审核模式保存不同的布局。

引入布局引擎不能重建 Stage 或丢失编辑草稿。点云主视图与三视图共用一个 renderer / canvas；视频播放状态、未发送评论和未完成属性编辑也不能随面板移动而重置。已有用户偏好需要可回滚，并避免旧客户端覆盖未来快照。

## Decision

### 应用适配层与依赖边界

采用精确版本 `dockview-react@8.2.0` 的 MIT 社区包，由 `WorkbenchDockWorkspace` 作为唯一 React 适配层。其他工作台代码通过 panel registry 和 `workbenchLayoutExecutor` 操作布局，不直接持有原始 Dockview API。

不引入 `dockview-enterprise`，不提供浏览器 popout 或多屏拖放。适配层不调用 `addPopoutGroup`，菜单、拖放拦截和快照清洗共同限制工作区边界。Dockview 主题变量映射到现有 `--sc-*`，沿用工作台的亮色与深色语义 token。

### 面板与生命周期

核心面板固定为 `canvas`、`task-queue`、`class-palette`、`inspector`、`discussion`。画布独占固定 `canvas` group，不能拖动、隐藏、浮动、关闭或与其他面板组成标签。外围面板可在画布左、右、底部停靠，也可标签化或在当前工作区内浮动；浮窗支持单 group 的多个 tab，不接受浮窗内部的 edge split。

`canvas`、`inspector` 与 `discussion` 使用 `always` renderer 保留 DOM；任务队列和类别面板使用 `onlyWhenVisible`，从既有业务状态重建。隐藏时记录 group、index 和浮窗矩形，把同一 panel 移到不可见的 `parking` group，不调用 `close` 或 `removePanel`。

“标准标注”和“审核协作”通过 executor 原位重排已有面板，“专注画布”最大化现有 canvas group。预设替换前保存一次会话级撤销点，不持久化活动预设 ID 或布局历史。工具、选择、任务、帧、播放状态和草稿不进入布局命令。

当前题 AI、视频追踪、3D 三视图、相机面板、PSR、选中信息卡和桌宠继续使用原有 Stage overlay，`AIInspectorPanel` 与 `DiscussionPanel` 内部业务 tab 不拆分。

### 快照格式与兼容

沿用 `user.preferences.workbench.layout`，新增 `workspace = { engine: "dockview@8", contexts }`。六个 context 为 `annotate|review × image|video|3d`，各自保存原子信封 `{ schemaVersion, snapshot }`；`snapshot` 包含清洗后的引擎 `layout` 与隐藏面板的 `returns`，不保存业务 params。

本客户端只解释和写入 schema 1，固定使用五个核心面板和锁定画布。后端从开始预留并验证 schema 1、2、3，未来版本可扩展画布位置与工具面板。旧客户端读取 schema 2、3 或更高版本时显示只读标准布局，提示刷新，不降级解释或重置原值。

清洗限制 UTF-8 JSON 不超过 64 KiB、最多 7 个 panel、7 个用户 group 加 1 个 parking group，并按 schema 限制实际 panel 集合、canvas、树结构和有限尺寸。浮窗按当前工作区边界夹取，`compact-overlay` 不进入持久化快照。损坏快照或引擎恢复失败也进入只读标准布局，只有用户在桌面宽度显式重置后才写回；未来 schema 和服务端降级冲突始终禁止重置覆盖。

### 偏好所有权与并发

`useWorkbenchWorkspaceLayout` 是当前 context 的唯一写入者，复用账号级 preferences query。冷启动可显示本地缓存，但初始 GET 结算前禁止布局 mutation。只有初始权威响应中受支持、清洗通过且不同于本地的快照允许一次 `fromJSON` 回灌，并复用现有 panels；后续 refetch 不覆盖运行中的树。

用户操作结束后防抖 300ms，只 PATCH 当前 context。同一时刻最多一个 workspace 请求在途，其间仅保留最新 dirty 快照。账号和 context 的缓存分别隔离，切换不会把旧快照写到新 context；同账号旧 context 的成功响应仍更新其缓存，UI 回调只作用于当前会话。普通偏好 writer 的请求不携带 workspace，并保留已由 workspace owner 更新的缓存分支。

普通保存失败保留本地 dirty 和错误提示，不自动回滚或无限重试。服务端返回 `409 layout_schema_downgrade` 时丢弃待写内容并进入只读标准布局；恢复失败不能把该状态降为允许重置的错误态。

后端复用 `GET/PATCH /auth/me/preferences`，在单事务中锁定并刷新用户偏好，将 `workspace.contexts.<context>` 作为原子替换路径，锁内比较 schemaVersion。不同 context 分别合并，同 context 同 schema 采用最后写入生效，不新增 revision、ETag、数据库表或迁移。部署顺序为后端 schema 先、可写 workspace 的前端后。

### 紧凑投影与回滚

工作区宽度不超过 1024px 时，在初始 hydrate 结算后锁存桌面树，将外围 panel 移入 parking；菜单每次把一个现有实例移到唯一 `compact-overlay` 浮窗。紧凑模式禁用布局重排、缩放、预设、重置与撤销，并暂停 writer。

退出紧凑模式时以现有 canvas group 为锚点，通过原位 API 恢复 group、tab 顺序、活动标签、浮窗、隐藏项和 split 权重。此过程不使用 `fromJSON`，不重建 Stage；临时投影不覆盖桌面快照。恢复失败保留桌面快照，进入稳定的只读恢复路径。

没有当前 context 快照时，用旧开合、分离浮窗、栏宽和右栏 split 做一次初始转换。旧字段与缓存不删除，也不反向维护为新树的副本。前端回滚会恢复升级前最后保存的旧布局，而不是精确还原 Docking 树。

## Consequences

### Positive

- 面板位置、显隐、标签与浮窗由同一布局模型管理，Shell 的业务状态继续保持原有所有权。
- 布局迁移、恢复和尺寸切换保留 Stage 实例与业务草稿，不增加点云渲染 context。
- 当前 context 的原子替换和 schema 降级保护避免旧树残影与旧客户端覆盖未来状态。

### Negative

- 应用需要维护快照 grammar、受控命令、停车组和紧凑重放，不能直接开放布局引擎的所有功能。
- 多设备同 context 编辑没有冲突合并，最后一次写入会替换此前布局。
- 旧前端回滚只能恢复旧布局字段；保留 `always` 面板也需要控制隐藏时的持续渲染工作。

## Alternatives Considered

### 继续扩展 FloatingPanelShell

不采用。单个浮窗的移动和缩放已有实现，但补齐停靠树、drop zone、标签组、层级和统一恢复会成为另一套布局引擎。

### FlexLayout

保留为可替换候选。本次选择 Dockview 的 React 适配、panel renderer 策略与原位布局 API，应用侧保留 registry、预设、快照包装和 executor 边界，避免业务组件依赖特定引擎树。

### 直接序列化完整引擎状态并反复 fromJSON

不采用。业务 params、外部窗口、未来快照和紧凑投影需要分别限制；反复全树恢复也扩大 Stage 重挂载和编辑草稿丢失的风险。

## Notes

- 核心代码：`apps/web/src/pages/Workbench/layout/`、`state/useWorkbenchWorkspaceLayout.ts`。
- 偏好边界：`apps/web/src/api/auth.ts`、`apps/api/app/schemas/user.py`、`apps/api/app/api/v1/me.py`。
- 本决策不开放画布换位，也不扩展为七个业务面板；后续能力须以各自 schema 与单实例约束继续演进。
