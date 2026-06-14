# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.14.x | [docs/changelogs/0.14.x.md](docs/changelogs/0.14.x.md) |
| 0.13.x | [docs/changelogs/0.13.x.md](docs/changelogs/0.13.x.md) |
| 0.12.x | [docs/changelogs/0.12.x.md](docs/changelogs/0.12.x.md) |
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## 最新版本

<!-- 0.15.x 版本变更按版本段追加到本区；进入 0.16.x 后整体移到 docs/changelogs/0.15.x.md -->

## [0.15.25] - 2026-06-15

主题偏好持久化到服务端。深色 / 浅色 / 跟随系统主题原先只存浏览器 localStorage(仅本机),升级到用户服务端偏好(`preferences.ui.theme`)后,换设备 / 换浏览器登录同一账号即保持。复用 v0.15.3 偏好基建(`/auth/me/preferences` 顶层子树合并),顺手收尾。

### Changed

- **主题跟随账号跨设备**:`useTheme` 真值源分层——登录后以服务端 `preferences.ui.theme` 为准,登出 / 首屏 hydration 前回落 localStorage(本机缓存),都没有则 `system`。切换主题时本地即时生效 + 写本机缓存,登录态再乐观更新 authStore + `PATCH /auth/me/preferences {ui:{theme}}` 持久化。首屏仍由 localStorage bootstrap(`initThemeFromStorage`)避免闪烁,服务端值在登录后对齐(一般相同,故无闪)。

### Added

- 后端 `UserPreferences.ui` 子树(`theme: light|dark|system`,默认 `system`,`extra:forbid`);沿用既有顶层子树合并,PATCH `ui` 不动 `workbench`/`ai`。+ 端点测试(ui 持久化 / 与 workbench 隔离 / 默认 system / 非法枚举 422)+ `useTheme` 单测(登出只写本地 / 登录 PATCH 服务端 + 乐观写 store / 服务端主题采纳)。

## [0.15.24] - 2026-06-15

点云+图像联合标注 epic · Phase 1 首版:相机图「2D 框种 3D 框」。在放大的相机投影视图上拖一个 2D 矩形 → 该相机标定反算视锥 → 选出锥内点云 → 拟合一个 3D 框初值并选中微调。读方向(3D→2D 投影)v0.13.4 已完成,本版补写方向起点。计划见 `docs/plans/2026-06-14-v0.15.24-camera-2d-box-to-3d-frustum.md`,epic 见 `ROADMAP/2026-06-14-pointcloud-image-joint-annotation.md`。纯前端几何,后端零改动。

### Added

- **相机图种框**(3D 点云工作台,放大相机视图):点「⛶」放大相机 → 左上「种框 ⊹」进模式 → 在目标上拖 2D 矩形 → 松手生成 box_3d 并选中微调。视锥内点按相机系深度取最近簇(默认 8m 带宽,避开背景墙),`psrFromPoints` 拟合 + `fitYaw`/`fitBottom` 精修朝向与贴地;视锥内无点(图上可见但无 lidar 返回)→ 沿中央射线按估计深度放默认尺寸框 + 提示微调。
- 视锥几何核心 `geometry/frustum.ts`(`selectPointsInRect` 前向投影选锥内点 / `depthGate` 最近簇 / `gatherPoints` / `centralRay` 空簇射线)+ 纯函数单测(矩形内/外/相机后方、最近簇门控、中央射线方向,9 例)。
- `projection.projectPoints` 结果新增 `depths`(相机系深度,向后兼容),供 `depthGate` 复用同一条投影链取深度。

### Notes

- **唯一产物是 box_3d**:拖出的 2D 矩形是瞬态种框手势,不落库、不产生 2D 标注(epic 决策 J1/J2);`Esc` 退出种框(再次 `Esc` 关放大视图)。
- **MVP 范围**:种框仅在**放大相机视图**启用(大画布画得准、单相机无歧义);小浮动相机面板保持原行为(点击反选)。投影手柄拖拽微调留 Phase 2,多相机交叉编辑留 Phase 3。
- **局限**:依赖相机标定准确度(无标定相机不开放种框);视锥前后重叠目标深度门控只能缓解,靠收紧矩形重试 + 微调;朝向可能差 180°(车头车尾),微调翻转。

## [0.15.23] - 2026-06-14

邻帧点云叠加 · 逐目标位姿补偿(§C.8-A)。把 v0.15.22 的「剔除动态点」升级为「**搬运**动态点」:落在已标注框内的邻帧点不再丢弃,而是按该目标在邻帧框与当前帧框之间的位姿变化搬到当前帧位置一起加密——静止背景照旧 ego 对齐,**动态目标也对齐加密、无拖影**,等于用已有 track 数据做轻量 scene flow。计划见 `docs/plans/2026-06-14-v0.15.23-neighbor-pointcloud-per-object-compensation.md`。纯前端几何,后端零改动。

### Added

- **邻帧点云逐目标对齐**(3D 点云工作台,设置项 `点云 › 邻帧动态点` 新增第三档「逐目标对齐」,默认仍「保留(拖影)」):选「逐目标对齐」后,落在某邻帧框内的点用 `T = M_当前框 · M_邻帧框⁻¹` 搬到当前帧该目标位置(逐目标补偿,自带 ego + 目标运动),框外背景点仍走 ego 刚体对齐——动态目标随当前帧点一并加密、无拖影。状态栏透出本次搬运点数。**仅对已标注且跨帧成链(`group_id` 配对)的目标有效**;命中邻帧框但当前帧无配对的点默认按剔除处理(不冒新拖影)。
- 几何核心 `geometry/perObjectAlign.ts`(`alignNeighborPointsPerObject`:邻帧 ego 系内 point-in-OBB 路由,复用 `box3d`,命中可配对目标走 `T_obj` 搬运、未命中走 `relMatrix` 背景、命中但无配对走 fallback;输出已是当前帧 ego 系坐标)+ 纯函数单测(背景走 ego / 目标搬到当前位置 / 框内偏移保持 / 当前框旋转 / 未配对 cull+ego fallback / 同位姿恒等 / 混合计数,共 9 例)。
- align 模式独立拉取邻帧「全部」框(`useNeighborAnnotations` scope=all,独立于框叠加 `overlayK`),按 `group_id` 与当前帧框配对;搬运后点已预变换到当前帧 ego 系,渲染走 identity 矩阵(其余路径不变)。

### Notes

- 搬运发生在邻帧叠加层重建时(切帧 / 改设置 / 框编辑提交),不在每渲染帧跑;比 cull 多一遍 CPU 逐点变换,邻帧点已下采样,主线程一次性开销可控。
- 这是 §C.8-A:相比 §C.8-B(cull,动态目标完全不显示)更进一步——动态目标也对齐加密。两者共享 v0.15.22 的 point-in-box 路由。对齐质量依赖 v0.15.1 propagate/插值的邻帧框位姿准确度;track 不准则搬运后会错位。未标注 / 未成链的动态物仍留拖影,留给后续 §C.8-D 学习式动静分割。

## [0.15.22] - 2026-06-14

邻帧点云叠加 · 动态点剔除(§C.8-B)。给 v0.15.18 的邻帧点云叠加补一个开关:把对齐到当前帧后落在已标注框内的邻帧点剔除,只叠静止背景,消除动态目标拖影。计划见 `docs/plans/2026-06-14-v0.15.22-neighbor-pointcloud-dynamic-cull.md`。纯前端几何,后端零改动。

### Added

- **邻帧点云剔除动态点**(3D 点云工作台,设置项 `点云 › 邻帧动态点`,默认「保留(拖影)」):选「剔除动态点」后,邻帧点经 ego 补偿对齐到当前帧再做 point-in-OBB 判定,落在任一当前帧 tracked box 内的点直接剔除——动态目标(其它车 / 行人)的拖影点消失,远处静止背景仍重合加密。状态栏透出本次剔除点数。**仅对已标注目标有效**(未画框的动态物仍留拖影)。
- 几何核心 `geometry/cullDynamicPoints.ts`(`cullPointsInBoxes`:投影法 OBB 测试,复用 `box3d.boxAxisWorldDir`,支持 `margin`,保留点返回原始 ISO ego 坐标使 GPU 渲染路径不变)+ 纯函数单测(框内剔除 / 框外守恒 / 旋转框判定 / margin / 先施加 relMatrix 再判定 / 多框)。

### Notes

- 剔除发生在邻帧叠加层重建时(切帧 / 改设置 / 框编辑提交),不在每渲染帧跑;gizmo 拖框只在松手提交时触发一次重算,性能可控。
- 这是 §C.8-B「开关式简化版」:动态目标完全不显示。让动态目标也对齐加密(无拖影)的「逐目标位姿补偿」§C.8-A 见 v0.15.23 计划。

## [0.15.21] - 2026-06-14

3D 点云工作台浮动面板体系打磨。PSR 编辑面板改渐进式展开缓解对画布的遮挡、浮窗按用户记忆可拖动,修掉浮窗在挂载 / 窗口抖动时被反复归位导致的相机漂移,相机上色三滑块收为「相机上色」开关的子选项。纯前端 3D 工作台 UI,后端零改动。

### Added

- **PSR 面板渐进展开 + 可拖动 + 记忆**:选中框 PSR 编辑面板改为「折叠头(类别 + 尺寸摘要 + 锁 / 删图标 + 展开钮,常驻)→ 展开体(提示 + 自动贴合 + 中心 / 尺寸 / 朝向 + 属性表单)」两段式,缓解常驻面板对 3D 画布的遮挡。整体可按头部拖动(落在交互控件上不起拖),展开态与拖动偏移按 `userId` 记忆到 localStorage(`PsrPanelUiState`,复用 `pcd.*` 键约定),刷新 / 切换选中框不丢。删除按钮从底部整条移入头部图标钮。

### Changed

- **相机上色滑块改为子选项**:「上色对比度 / 亮度 / Gamma」三滑块经 `parentKey` 收为「相机上色」开关的子选项(复用与「邻帧点云叠加 + 帧数」同款 `fieldNested` / `fieldCluster` 父子机制):缩进归组、父开关关闭时子项自动禁用。工作台设置抽屉与 SettingsPage 表现一致。

### Fixed

- **浮动面板挂载 / 抖动自动归位导致相机漂移**:`useDragMove` 的 resize 副作用原在挂载及 bounds / position / size 变化时立即 clamp 回视口并写回 config;HMR 重挂时 `triFloatBounds` 经 null→viewport 显著变化(及亚像素重测抖动)→ 摆放过的相机面板被反复 clamp 微调落库 → 位置逐渐漂移。改为**只在真实窗口缩放(window resize)时归位**,删除挂载时的立即写回;用户主动拖动 / 缩放窗口归位不受影响,展开面板的 `clampPanel` 兜底不变。
- **三视图收起标签跟随展开位置 + 可拖动(B-29)**:收起的「三视图 ▸」标签原 `position:absolute` + 固定右下角,与展开面板(`FloatingPanelShell`,`position:fixed`)脱节且不可拖。改用展开面板记忆坐标(`triFloatPosition`)定位使收起 ↔ 展开一致、整体可拖(`div` + `tabIndex` + `onKeyDown` 保留键盘可达,位移阈值区分点击展开 / 拖动)、`absolute`→`fixed` 统一视口坐标系消除拖动跳变、`z-index` 提到相机浮层之上。
- **相机面板布局稳定化**:相机浮动面板的布局测量 / 贴边初始位计算稳定化,减少首次摆放时的跳动。

## [0.15.20] - 2026-06-14

3D 点云工作台新增上下文敏感右键菜单,并把跨帧延续的「目标帧」从裸数字输入升级为帧选择器。把批量延续 / 跨帧延续 / 插值从左上角视角浮条迁入画布就地右键,同时把对象操作(删除 / 改类别 / 锁定 / 隐藏 / 复制 / 粘贴)从右栏标注列表搬到右键菜单,省去「画布选中 → 右栏找行 → 点击」的往返。

### Added

- **3D 画布右键菜单**:命中框 / 空白两套上下文敏感菜单(对标 2D 的 `imageStageContextMenu`)。命中框含延续 / 插值 + 通用对象操作;空白含批量延续 + 粘贴。右键拖动(相机 pan)/ 放置 / 框选进行中不弹菜单。
- **`FramePicker` 帧选择器**:替代裸数字输入。Layer 1 回显「当前第 X/N 帧」+ 语义步进(+5 / +10 / 到末帧)+ 数字兜底,目标帧经 neighbors(k=20)反查 task,超 ±20 帧提示不可达。Layer 2 相机图缩略图条(±5 邻帧,逐帧拉 manifest 取前向相机图),点缩略图即设目标帧;无相机图时整条隐藏,回落 Layer 1。

### Changed

- **跨帧延续 / 插值 / 批量延续入口**:从左上角视角浮条迁入画布右键菜单;「延续到指定帧…」「向后插值填充…」改为打开 `FramePicker`(插值填充仅在选中框已建跨帧链 `group_id != null` 时可用)。
- **通用对象操作就地右键**:删除 / 改类别 / 锁定 / 隐藏 / 复制 / 粘贴复用画布内部既有回调(与右栏 `AIInspectorPanel` 同走 `is_locked` / `is_hidden` 字段 + 同一 mutation,行为一致)。

### Removed

- **`CrossFrameInterpolateBar` 旧浮条**:连同其 CSS 与单测一并移除,能力由右键菜单 + `FramePicker` 承接。

### Notes

- 后端零改动:延续 / 插值走既有 `propagate-to-task` / `propagate-batch` / `interpolate-range`;邻帧相机图走既有 `point-cloud/manifest`;邻帧位置走既有 `neighbors`。

## [0.15.19] - 2026-06-13

邻帧叠加设置拆分。把邻帧框叠加从“0=关闭的 K 档位”改为独立开关 + 帧数 + 对象范围;邻帧点云叠加也获得独立帧数设置,不再借用邻帧框叠加档位。

### Changed

- **邻帧框叠加设置**:新增 `workbench.common.crossFrameOverlayEnabled`;`crossFrameOverlayK` 仅表示前后帧数(1/3/5/7),`crossFrameOverlayScope` 继续表示对象 / 全部范围。历史 `crossFrameOverlayK=0` 兼容为关闭,历史 `K>0` 自动视为开启。
- **邻帧点云叠加设置**:新增 `workbench.pointcloud.neighborPointOverlayK`(1/2/3),与邻帧框帧数解耦。点云叠加仍默认关闭,开启后默认前后各 1 帧。
- **旧 localStorage 迁移**:`workbench.crossFrameOverlayK` 迁移时同步写入新开关;旧 `0` → 关闭 + 默认 1 帧,旧 `1/3/5/7` → 开启 + 对应帧数。

## [0.15.18] - 2026-06-12

邻帧点云叠加。把 v0.15.1 的「邻帧**框**叠加」延伸到「邻帧**点云**叠加」——用 ego 轨迹把前后帧点云对齐到当前帧车体系一起渲染,解决车端运动场景「背景相对车也在动」时如何有意义叠点云的问题。计划见 `docs/plans/2026-06-12-v0.15.18-neighbor-pointcloud-overlay.md`。纯前端渲染能力,后端零改动。

### Added

- **邻帧点云叠加**(3D 点云工作台,设置项 `点云 › 邻帧点云叠加`,默认关):开启后把前后各 ≤3 帧的点云用 ego 运动补偿(与叠框同一 `inv(T_当前)·T_邻帧` 刚体变换,作为点云对象矩阵在 GPU 端施加,无逐点 CPU 开销)对齐到当前帧车体系再渲染。**静止背景重合加密**(利于远处/稀疏处标注),**动态目标留沿运动方向的拖影**(时序运动可视化)。
- **动态拖影视觉缓解**:邻帧点用**前/后帧分色**(过去冷蓝 / 未来暖橙)+ **按帧距时序淡出**(±1 帧最实、远帧更淡)+ 低透明 + 略小点 —— 拖影读起来是"运动方向"而非乱噪,且与当前帧的高度色带 / 相机上色强区分。
- 邻帧点云强制下采样(目标 = 当前帧抽稀阈值的 1/8,上限 8 万点/帧),帧数取 `min(邻帧叠加档位, 3)`(框叠加关时默认 ±1),异步加载不阻塞当前帧;切帧 / 关开关时整层 geometry+material dispose,避免内存堆积。
- 几何核心 `egoAlign.frameRelMatrix`(从 `alignPsrToFrame` 提取的相对位姿矩阵,框 / 点云共用)+ 纯函数单测(静止点守恒 / 同帧恒等 / 缺 pose 跳过)。

### Notes

- **需 ego 轨迹**:无 ego pose 的 scene(如 SUSTechPOINTS 示例数据)直接叠点云会错位乱影,故无轨迹时自动不叠(静默 no-op);与框叠加同开时共享工具栏「无 ego 轨迹」降级 badge。
- 只做**可视化叠加**辅助观察,不改标注落点、不在合并点云上画框。动态拖影本版只做视觉缓解(分色 + 淡出),**彻底消除拖影**(按 box 轨迹逐目标补偿 / box 内动态点剔除)见 ROADMAP §C.8;不做 Kalman / 多 lidar。
- worker 下采样 / 可调下采样比例为后续优化项:当前下采样在主线程随 PCD 解析后做(K≤3 + 激进下采样已是主要性能闸)。

## [0.15.17] - 2026-06-12

临帧框叠加产品化。v0.15.1 交付了「邻帧框 overlay + ego 对齐」,本版补四个落地缺口:叠加范围可配(对象级/场景级)、批量端点收敛请求、无轨迹降级常驻可见、scene 门控复核。计划见 `docs/plans/2026-06-12-v0.15.17-crossframe-box-overlay-productization.md`。

### Added

- **对象级↔场景级叠加范围**:新增 `workbench.common.crossFrameOverlayScope` 偏好(`selected`=仅叠选中对象的 group,现状默认;`all`=不选对象也叠邻帧全部框,整体时序感知)。3D 工具栏邻帧叠加控件旁加「对象/全部」切换;`all` 模式下选中某对象时,其 group 邻帧框正常显示、其余弱化(dim,更低透明度)。
- **批量邻帧标注端点** `GET /tasks/{id}/neighbor-annotations?k=&group_id=`:一次返回 ±k 帧的邻帧标注,替代前端「对 2k 个邻帧 task 各发一条 `getAnnotations` + client 端按 group 过滤」。`group_id` 给定 → 服务端只回该 group(`selected`,payload 最小);省略 → 回区间全部(`all`)。非 scene task → 200 + `frames=[]`。新增 `AnnotationService.list_by_tasks`(单条 IN 查询)。
- **无 ego 轨迹降级常驻可见**:overlay 开启但该 scene 无 ego pose 时,工具栏常驻 badge「无 ego 轨迹·未对齐」(warning 色),取代仅 propagate 路径的一次性 toast——overlay 显示态的可信度信号常显。

### Notes

- scene 门控复核:邻帧叠加仅 3D 点云工作台使用,gated on `manifest.scene_id`(数据属于 scene 才暴露),语义正确;`CrossFrameOverlayToggle` 无视频侧引用,不存在非 scene 场景误露出。`Project.scene_mode` 是项目调度声明而非 overlay 前提,不强加。
- 前端 overlay 仍保留 `useFrameNeighbors`(取 scene_id / 中心帧 / 邻帧 frame_index 供 ego 对齐),邻帧标注改走批量端点;两者同源(`get_neighbors_for_task`),task 集一致。

## [0.15.16] - 2026-06-12

`aap tui` 监控曲线与交互细节打磨:趋势 / 实时曲线从 `Sparkline` 升级为带横纵坐标的自绘折线图,Jobs 轮询不再把视图弹回顶部,弹窗按钮收敛到与全局一致的扁平风格。纯 TUI/UI 改动,零后端 / 零 `client.py` 改动。

### Added

- **TUI 自绘折线图 `AxisChart`**:braille 点阵连续折线 + 自适应纵轴(顶 = max / 底 = min)与横轴(首末时标)。替代「📊 看板」4 条 12 周趋势曲线与「Backend 实时监控」3 条 1s 滚动曲线(GPU 利用率 / 显存 / 缓存命中率)的 `Sparkline`。**固定 64×8 尺寸**(各图大小一致,不随容器伸缩),折线按指标分配辨识色(GitHub 深色主题配色),标签 / 轴线柔灰;纵轴范围随数据自适应。纯自绘不引绘图依赖,TUI 仍可整体删除。

### Fixed

- **TUI Jobs 轮询弹回顶部**:3s 轮询重建任务表时 `DataTable.clear()` 把光标 / 滚动复位到顶部,盯长列表底部任务时每 3s 被弹回。改为重建前后保存 / 还原光标与滚动位置。
- **TUI 弹窗按钮过大**:导出配置 / 确认 / 路径输入弹窗的按钮用的是 Textual 默认 3 行带框样式,与全局 `.action-bar` 扁平按钮不一致。统一为单行无框扁平风格。
- **TUI Backend 实时屏字段被截断**:① `_fmt_pool` 的键名(`size`/`capacity`)与协议 §4.3 实际字段(`cap`/`current_size`/`loaded_keys` 等)不匹配,退化成打印原始长 dict 再被裁;改为读真实字段输出简洁摘要(`cap=.. · loaded=.. · active=.. · idle=..s`)。② `#ml-static`/`#ml-live` 宽度未约束,`gpu` 等长行在 `VerticalScroll` 里被横向裁切;改为 `width: 1fr` 让长行自动换行。

## [0.15.15] - 2026-06-12

SDK 看板 / 绩效命名空间 + TUI 趋势曲线与角色门控绩效。把 v0.15.12 的 `Sparkline` 从「单设备实时」推广到「项目生产趋势 + 团队绩效」。计划见 `docs/plans/2026-06-12-v0.15.15-dashboard-stats-trends.md`。零后端改动(端点均已存在)。

### Added

- **SDK 统计 / 看板命名空间**:`client.projects.stats()`(`ProjectStats`:标量 + 最近 12 周 `*_series`)、`client.dashboard.admin()/reviewer()/annotator()`(`DashboardStats`,字段经 extra 透传)、`client.dashboard.people(...)`(`list[PersonStat]`)、`client.dashboard.me_performance()`(`MyPerformance`)。
- **CLI `aap stats` / `aap dashboard people` / `aap dashboard me`**:`aap stats` 用 unicode 块字符画 12 周趋势条;`dashboard people` 支持 `--project`/`--role`/`--period`;均带 `--json`。新增共享 `sparkline()` 文本趋势助手。
- **TUI「📊 看板」tab**:`projects.stats()` 标量 + 4 条 12 周 `Sparkline` 趋势(数据总量 / 完成量 / AI 率 / 待审),`r` 刷新不轮询。
- **TUI「🏆 绩效」tab**:`dashboard.people()` 全员绩效排行(产出 / 质量 / 退回率 / 7 日趋势)。进屏经 `client.me()` 解析角色,仅 super_admin 自动拉全局榜单,project_admin 提示用 CLI 按项目切分,其余角色显示无权限 —— **前置判角色而非吃 403**;`me()` 不可用时降级「角色未知」,看板 tab 不受影响。

### Fixed

- TUI `on_mount` 误在 UI 线程直跑 `_load_principal`(内含 `call_from_thread`)→ 改为 thread worker,消除 `RuntimeError: call_from_thread must run in a different thread`。

## [0.15.14] - 2026-06-12

SDK 可观测面扩展:新增**批次 / 成员 / 当前主体**只读命名空间，TUI 项目详情长出「批次」「成员」子 tab。计划见 `docs/plans/2026-06-12-v0.15.14-sdk-batches-members.md`。零后端改动(端点均已存在)。

### Added

- **SDK 批次 / 成员命名空间**:`client.batches.list(project_id, status=)` / `.get(...)`(`Batch` 模型:进度 / 审核 / 退回 / `annotator` / `reviewer`)、`client.members.list(project_id)`(`Member` 模型)。新增 `UserBrief` 责任人摘要模型。端点均对项目可见者开放。
- **SDK `client.me()`**:返回当前认证主体(`GET /auth/me`,`Me` 模型含 `role`),用于凭据自检 / 角色感知。
- **CLI `aap batches list` / `aap members list` / `aap me`**:表格 + `--json`;`aap batches list` 支持 `--status` 过滤。
- **TUI 项目详情子 tab**:`ProjectDetailScreen` 从概览 / 任务 / Backends 三 tab 增至五 tab,新增「📦 批次」(进度 / 审核 / 退回 / 责任人)与「👥 成员」(用户 / 角色)。批次 / 成员端点在旧后端或无权限时降级为空表,不拖垮详情屏。

## [0.15.13] - 2026-06-12

`aap tui` / `aap export` 导出能力对齐 Web：从「固定 `aap_json`」升级为「按项目类型自适应多格式 + 选项 + 完成后就地下载」，弹窗统一为键盘 + 按钮双通道。计划见 `docs/plans/2026-06-12-v0.15.13-tui-export-alignment.md`。零后端 / 零 `client.py` 改动。

### Added

- **TUI 导出配置框**(`ExportConfigModal`):按 `project.data_type` 自适应格式目录(image / video / lidar 各一套，对齐 Web `ExportModal`)，支持多格式多选、`include_attributes` 开关、video 帧模式(keyframes / all_frames)、lidar 3D 坐标系(iso / source)、输出路径与可选「完成后自动下载」。取代此前硬编码的 `targets=["aap_json"]`。
- **TUI 导出闭环下载**:完成态的导出 job 详情屏新增「⬇ 下载到本地」按钮(就地输入路径即 `client.exports.download` 落地)，并把 `result` 裸 dict 换成结构化摘要(文件数 / 大小 / 缓存命中 / 链接有效期)。
- **CLI `aap export` 多格式与选项**:`--target` 可重复，新增 `--include-attributes/--no-include-attributes`、`--video-frame-mode`、`--axis-frame`、`--wait/--no-wait`(`--no-wait` 只创建返回 `job_id`)。

### Changed

- **悬浮框按钮化**:抽 `_ConfirmCancelModal` 基类(居中盒子 + 确认/取消按钮栏 + 键盘双通道 + 可滚动正文)，`ConfirmModal` / `ExportConfigModal` / `PathInputModal` 复用。`ConfirmModal` 此前仅键盘 `y/n/esc`，现同时可点按钮；破坏性动作(取消 job)默认聚焦「取消」。

## [0.15.12] - 2026-06-11

`aap tui` ML Backend 监控从「5s 轮询 REST」升级为「1s WebSocket 推流 + 滚动曲线」。计划见 `docs/plans/2026-06-11-v0.15.12-tui-realtime-monitoring.md`。

### Added

- **TUI ML Backend 实时详情屏**:订阅 `/ws/ml-backend-stats`(1s 推送),展示 REST `/health` 拿不到的池/预热维度 —— `loaded`(预热)、`idle_unload_seconds`(空闲卸载倒计时)、`last_request_age_seconds`、`pool` / `video_pool`;Textual `Sparkline` 渲染 GPU 利用率 / 显存 / 缓存命中率最近 60 点滚动曲线。进屏订阅(触发后端 beat 实拉)、离屏断开(订阅者计数 -1 停采);WS 不可用时降级展示 REST 快照,不崩。
- **SDK 异步 WS 消费器**(`ai_annotation.tui.ml_stats_ws`):`[tui]` extra 加 `websockets` 依赖;`MLBackendStatsSnapshot` 模型;同步 `Client` / `_http` 不动。

### Changed

- **WS `/ws/ml-backend-stats` 鉴权**:除 JWT 外也接受 `ak_` api_key(SDK/TUI 用),role 校验(super_admin / project_admin)不变;只动这一个 WS 端点。

## [0.15.11] - 2026-06-11

API Key 完善:从「phase 1 仅记录 scope」推进到真正强制 + 过期 + 轮换/编辑 + full-access。计划见 `docs/plans/2026-06-11-v0.15.11-apikey-hardening.md`。

### Added

- **过期时间(`expires_at`)**:创建 key 可选 `expires_in_days`(后端换算为绝对时间);`resolve_token` 在认证入口校验,过期 key 一律 401。迁移 `0104`。
- **Scope 真正强制**:新增 `require_scopes(...)` 依赖工厂,挂到已定义 scope 的读写路由(`annotations:read/write`、`datasets:read`、`predictions:read`)。JWT / 密码登录 principal 视为 full-access 不受约束;api_key 缺 scope → 403。其余路由本版不挂,行为不变。
- **`full-access` 通配 scope(`"*"`)**:含 `"*"` 的 key 绕过 scope 校验,等同全权。
- **轮换 / 编辑端点**:`POST /me/api-keys/{id}/rotate`(换新明文,旧的立即失效)、`PATCH /me/api-keys/{id}`(改 name / scopes / 有效期)。SDK 同步新增 `client.api_keys.rotate()` / `update()`,`ApiKey` 模型加 `expires_at`。
- **前端创建界面美化**:创建表单加「完全访问」开关(选中禁用细分 scope)+ 有效期下拉(30/90/365 天 / 永不 / 自定义);列表加「有效期」列(永不 / 到期日 / 已过期徽标)与「编辑」「轮换」操作。

### Changed

- 删除前端「v0.9.3 phase 1 仅记录 scope,未在路由层强制拦截」提示,scope 现已真实生效。

## [0.15.10] - 2026-06-11

`aap tui` 仿 WebUI 交互:行下钻进专属详情子路由 + 每个 tab 动作按钮栏。维持「只读为主 + 导出/取消 2 动作」红线,纯呈现层,不动 `client.py`、不新增网络调用 / 写能力。计划见 `docs/plans/2026-06-11-v0.15.10-tui-drilldown-routing.md`。

### Added

- **下钻子路由(Screen 栈)**:行选中 / `o` / 「打开」按钮 push 专属详情子页,屏顶面包屑 + 「◀ 返回」按钮,`esc` 返回。**项目详情**内嵌 概览 / 本项目任务(全局 jobs 客户端按 `project_id` 过滤)/ 本项目 Backend 三个 scoped 子 tab,任务 / Backend 行可再下钻;**任务详情**带「✖ 取消」按钮(仅 pending/running);Backend / 数据集详情只读展开。行内详情面板由详情子页取代。
- **动作按钮栏**:每个主 tab 顶部一条可点按钮栏(刷新 / 打开 / 导出 / 取消,变体着色),与键盘等价;导出 / 取消复用既有二次确认路径。

### Changed

- 主屏新增 `o`(打开)绑定;进入详情子页后主屏动作键(`r`/`o`/`e`/`c`)从子页 Footer 隐藏且不触发,避免误操作。

## [0.15.9] - 2026-06-11

SDK 呈现层打磨:`aap tui` 从「能用」深度优化到「好用 + 好看」,`aap` CLI 帮助系统细化。纯呈现层改动,不动 `client.py`、不新增网络调用。计划见 `docs/plans/2026-06-11-v0.15.9-sdk-tui-cli-polish.md`。

### Added

- **TUI 标准 Header / Footer**:顶部 Header(标题 + 时钟),底部 Footer 标准化展示按键;手写按键串从状态栏移除,状态栏改为承载平台地址 / 轮询间隔 / **上次刷新时刻**与瞬态提示。
- **TUI 上下文感知按键**:`e`(导出)仅在 Projects tab、`c`(取消)仅在 Jobs tab 可用,切 tab 时 Footer 实时重算并隐藏不适用的键(`check_action`)。
- **TUI 视觉优化**:表格圆角边框 + 标题 + **实时行数计数**(如 `异步任务 · 3`)、斑马纹、聚焦高亮;详情面板带边框标题;tab 标签加图标;`ConfirmModal` 加标题与半透明遮罩;内置 **nord** 主题;job 完成翻转额外弹一次通知。
- **CLI 帮助细化**:所有命令支持 `-h`(等价 `--help`);顶层命令按 配置与交互 / 资源管理 / 标注流水线 / 监控 四组分栏;启用 rich 帮助渲染;每个子命令补可复制示例 epilog;顶层补 env 变量与快速上手说明。

## [0.15.8] - 2026-06-11

SDK / CLI / TUI 功能补完:`aap tui` 从只读监控扩展出轻量动作与 ML Backend 健康监控。SDK 新增只读 `client.ml_backends` 资源与 `client.jobs.cancel()`,CLI 对齐补 `aap ml-backends` / `aap jobs cancel`。计划见 `docs/plans/2026-06-11-v0.15.8-sdk-tui-actions.md`。

### Added

- **SDK ML Backend 只读监控**:新增 `client.ml_backends.list(project_id)` / `get(project_id, backend_id)` 与 `MLBackend` / `HealthMeta` / `GpuInfo` / `HostInfo` / `CacheStats` 模型(顶层导出);暴露 backend `state`(connected/error)与 `/health` 缓存的 GPU / cache / model_version 指标。
- **SDK 取消 job**:`client.jobs.cancel(job_id)` 软取消(协作式,worker 下一条边界落 cancelled);仅 pending/running 且可取消 kind 有效。
- **CLI**:`aap ml-backends list --project <id>` / `get <id> --project <id>`(只读表格 + `--json`);`aap jobs cancel <id>`。
- **TUI**:新增 **ML Backends** tab(遍历项目聚合,project-scoped;仅激活时 5s 轮询,state 着色 + health_meta 详情);Projects tab `e` 发起导出、Jobs tab `c` 软取消,均经二次确认弹窗(`y`/`n`·esc),终态 job 的取消键禁用。
- **前端「API 密钥」自助入口**:个人设置页(`/settings`)新增「API 密钥」分区,所有登录用户可自助创建 / 吊销个人 key(此前入口仅在管理员可见的「用户与权限」页)。`ApiKeysModal` 主体抽成 `ApiKeysPanel` 由弹窗与设置页共用。

## [0.15.7] - 2026-06-11

项目级工作台规范与性能档位。Project `rendering_config` 从图片渲染覆盖扩展到跨模态工作台行为;用户偏好新增通用性能档位,标准档保持旧硬编码性能参数。计划见 `docs/plans/2026-06-11-v0.15.7-project-level-settings-and-perf-tiers.md`。

### Added

- **项目级工作台规范**:项目设置「渲染配置」改为「工作台规范」,新增 3D 新框默认尺寸、关键帧复制覆盖策略和 AI 传播默认模型;项目值优先于个人记忆 / 个人偏好。
- **性能档位**:`workbench.common.performanceTier` 新增轻量 / 标准 / 激进三档,控制视频帧预览缓存、`ImageBitmap` / WebCodecs 缓存、预取窗口和点云抽稀上限;标准档等于旧默认值。

### Changed

- 3D 点云点击放置新框时优先使用项目 `box3dDefaultSize`,未配置时回退 `4.0 / 1.8 / 1.6` 米。
- 视频关键帧复制对话框在项目配置 `propagateOverwrite` 时锁定覆盖选项,且不把项目锁定值写回用户粘性记忆。
- AI 传播默认模型解析顺序调整为:项目默认模型(在可用列表内) → 用户上次选择 → 项目已绑定真实 ML backend 时首个非 mock 模型 → `mock_bbox`。

## [0.15.6] - 2026-06-11

点云工作台设置补完。`workbench.pointcloud.*` 填充点大小、点掩膜模式、网格/坐标轴显隐和相机阻尼;`workbench.common.crossFrameOverlayK` 收编邻帧叠加 K。计划见 `docs/plans/2026-06-11-v0.15.6-pointcloud-workbench-settings.md`。

### Added

- **点云设置字段**:工作台设置抽屉与个人设置页新增点大小、3D 视角持久化、相机上色、上色对比度 / 亮度 / Gamma、深度提示、点选模式、显示地面网格、显示坐标轴、相机灵敏度;默认值全部等于旧硬编码行为。
- **图片自动适应设置**:`workbench.image.autoFitOnResize` 控制图片画布在边栏开合 / 容器尺寸变化后是否自动重新 fit,默认开启。
- **旧 localStorage 收编**:首次加载时把 `workbench.pointMaskSelectMode` / `workbench.crossFrameOverlayK` 迁入账号级 preferences,并用 `workbench.{userId}.pcd.migrated` 标记避免重复 seed。
- **3D 视角快照**:`workbench.layout.pointcloudCamera` 保存点云主视图 `position/target/up/mode`,由 `persistCameraView` 开关控制是否写入 / 恢复。

### Changed

- 3D 工具条中的点大小滑块、点掩膜模式下拉、相机上色 / 深度提示和邻帧叠加档位改为读写同一份 preferences;抽屉、个人设置页与工具条实时同步。
- `PointCloudScene` 增加网格、坐标轴、OrbitControls 阻尼 setter 和相机快照读写接口,设置变化无需重建 Three.js 场景。
- 点云 2D 相机面板拖拽从默认贴边位开始时先冻结当前位置,避免轻拖跳出画布;「重置相机布局」只清空 2D 相机面板布局,不重置 3D 主视角。

## [0.15.5] - 2026-06-11

视频工作台设置切片。`workbench.video.*` 增加默认播放速率和大步进帧数;关键帧传播与 AI Tracker 传播对话框按用户记住上次选择;WebCodecs 实验开关进入视频任务的工作台设置抽屉。计划见 `docs/plans/2026-06-11-v0.15.5-video-workbench-settings.md`。

### Added

- **视频设置字段**:工作台设置抽屉与个人设置页新增默认播放速率、大步进帧数;默认值保持 1x 和 10 帧。
- **传播对话框粘性记忆**:关键帧传播记住数量 / 方向 / 覆盖选项;AI Tracker 传播记住范围 / 方向 / 模型 / SAM 尺寸,取消或提交失败不回写。
- **WebCodecs 设置入口**:视频任务抽屉新增「实验特性」分组,直接读写既有 `video.experimental.webcodecs` localStorage 开关,刷新后生效。

### Changed

- 时间轴聚焦时 `Shift+←/→` 的大步进支持 5 / 10 / 30 帧或采样网格;`grid` 模式在采样开启时跳一个采样单元,否则回退 10 帧。

## [0.15.4] - 2026-06-11

图片工作台设置切片。`workbench.image.*` 增加画框后行为、吸附阈值、缩放步长、淡化/标签/Mask 覆盖显示偏好;`workbench.common.*` 增加删除确认和最近类别数量。计划见 `docs/plans/2026-06-11-v0.15.4-image-workbench-settings.md`。

### Added

- **图片设置字段**:工作台设置抽屉与个人设置页新增画框后行为、吸附阈值、滚轮缩放步长、淡化透明度、框标签显隐和 Mask 覆盖透明度;默认值全部等于旧硬编码行为。
- **通用设置首批**:新增删除确认策略和最近类别数量;`multi_only` 仅多选删除前确认,`always` 单删/多删都确认。
- **SAM 输出形态记忆**:文本 / Exemplar 输出形态按账号写入本地记忆;项目级默认仍优先。

### Changed

- `afterBoxCreate=reuse_active` 时,手画 bbox 会沿用当前类别直接落库;没有当前类别时仍回退到类别选择器。
- 最近类别列表按配置上限读取和写回,缩小上限无需迁移旧 localStorage。

## [0.15.3] - 2026-06-11

工作台设置体系地基(epic v0.15.3-0.15.7 第一版)。`WorkbenchPreferences` 从平铺字段重构为 **通用/图片/视频/点云** 四子树,工作台内立起「设置抽屉」(齿轮菜单入口、改动实时预览),Settings 页「标注偏好」同步改为注册表驱动的分组渲染。**本版不新增任何用户可感知设置项**,只做结构 + 归位,所有默认值与原硬编码一致。计划见 `docs/plans/2026-06-11-v0.15.3-preferences-schema-and-settings-shell.md`。

### Added

- **工作台设置抽屉**:齿轮菜单 →「工作台设置」,按「通用 + 当前模态」分组,改动本地立即生效(画布实时预览)+ 300ms 防抖 PATCH;被项目锁定的字段禁用 + 「项目锁定」badge。
- **字段注册表** `workbenchSettingsFields.ts`:设置 UI 单一来源(key/分类/控件/可锁定),抽屉与 Settings 页共用 `SettingsFieldControl` 渲染;后续版本新增设置项 = 注册表加一行。

### Changed

- **偏好四分树**:`workbench.{smoothImage,cssImageFilter,controlPointsSize,snapToGrid}` → `workbench.image.*`;`longTaskSampleRate` → `workbench.common.*`;`layout` 保持顶层。存量 JSONB 由迁移 0103 就地改写(up/down 可逆、幂等);`ProjectRenderingConfig` 保持平铺,合并逻辑映射到 `image.*` 子树。
- Settings 页「标注偏好」改为注册表驱动的四分组(空分组不渲染),与抽屉读写同一份数据。

### Notes

- 部署窗口期:已打开的旧前端 tab PATCH 平铺键会被服务端 legacy 提升器接住(v0.16 移除);旧 tab GET 到新形态后渲染默认值,刷新即愈。

## [0.15.2] - 2026-06-11

Python SDK / CLI / TUI + ML Backend starter 教程。把平台已有 OpenAPI、API key、ML Backend 协议产品化为外部集成入口;ML Backend starter 模板判定为时过早,降级为「教程 + 现有示例打磨」。计划见 `docs/plans/2026-06-07-v0.15.2-sdk-cli-and-ml-backend-starter.md`。

### Added

- **Python SDK `ai-annotation-sdk`**(`packages/python-sdk/`,beta,版本随平台 minor):`from ai_annotation import Client`,覆盖 8 个稳定工作流——`projects.list/create/get`、`datasets.create/upload_files/upload_zip/link_project`、`tasks.list/get/next`、`annotations.list/create/update/delete`、`predictions.import_file`、`jobs.list/get/wait`、`exports.create/wait/download`、`api_keys.list/create/revoke`。核心仅依赖 httpx + pydantic;模型 `extra="allow"` 前向兼容;统一异常层级(`APIStatusError` 按状态码细分 + `JobFailedError`/`JobTimeoutError`);幂等 GET 对 429/5xx 指数退避重试。
- **CLI `aap`**(`[cli]` extra,Typer + Rich):`login`(连通验证后写 `~/.config/ai-annotation/config.toml`,chmod 0600)、`projects list/create`、`datasets create/upload/link`、`predictions import`、`jobs wait`、`export project`;rich 表格/进度条,**所有命令提供 `--json` 可脚本化契约**(裸 JSON、无装饰,CI/脚本只依赖它);env `AAP_BASE_URL`/`AAP_API_KEY` 覆盖配置。
- **TUI 面板 `aap tui`**(`[tui]` extra,Textual):Projects / Datasets / Jobs 三 tab 只读监控;jobs 默认 3s 轮询,progress 文本进度条 + 状态着色,running→completed 翻转高亮;`r` 刷新、回车看详情(导出 job 显式给出 download_url)、`q` 退出。同步 Client 全部走 thread worker,事件循环零阻塞。
- **ML Backend starter 教程**:`docs-site/dev/ml-backend/starter.md`——「从 echo 示例出发接入一个真实模型」tutorial(贯穿 OCR backend 改造示例),进阶指向 mock-v2 与 `aap_protocol_v2`;独立 starter 模板按计划判定暂不立项(协议尚在快速收敛期)。
- **示例升级 + contract test 保活**:echo 示例升级为协议 v2.1 最小合规骨架(protocol_version/compat/models[] 目录/运行时观测字段);mock-v2 补齐 v0.14.13–0.14.15 字段(default_variants、`POST /warmup`、`context.model_variants`、422 `variant_not_supported` / 503 `model_unavailable` 演示);两示例各配 contract tests 并接入 CI(`examples-pytest` job),防示例与协议脱节。

### Notes

- 生成策略调整:OpenAPI 快照 3.5 万行,全量 codegen 维护成本与「生成层泄漏」风险均高——首版改为**手写 typed 层 + OpenAPI 快照 contract test**(断言 SDK 使用的全部 24 个 method+path 存在于 snapshot),公开 API 仅限 wrapper。
- 生产 backend 重复样板(presigned 下载、observability 采样,~525 行)下沉 `aap_protocol_v2` 留待后续择机,不阻塞本版。
- SDK / CLI / TUI 测试(respx mock + CliRunner + Textual Pilot)接入 CI `python-sdk-pytest` job。

## [0.15.1] - 2026-06-10

跨帧插值 + 多目标批量 propagate。在 v0.15.0 的 ego 地基上,把 v0.14.1 的「`Shift+→` 逐帧手搬框」升级成「ego 运动补偿 + 关键帧插值 + 批量」,减少长 scene 的逐帧重复劳动。计划见 `docs/plans/2026-06-06-v0.15.1-crossframe-interpolation-and-batch-propagate.md`。

### Added

- **运动补偿 propagate**:`Shift+→`/`Alt+→` 跨帧延续 box_3d 时,若源/目标帧均有 ego pose,由「世界位置不变」反算目标帧 PSR——静止物在下一帧自动套住目标;无 pose 的 scene 退化为 v0.14.1 原样复制(零回归),响应带 `motion_compensated` 标记,前端轻提示一次。几何核心 `services/ego_transform.py` 纯函数(euler 与前端 three.js 锁步)+ 重点单测。
- **多目标批量 propagate**:`POST /tasks/{id}/annotations/propagate-batch`(annotation_ids=null → 全部 active box_3d),整批一个事务;3D 工作台 `Ctrl+Shift+→/←` 或「跨帧工具」面板触发。
- **关键帧区间插值**:`POST /tasks/{id}/annotations/interpolate-range`(body `{group_id, to_task_id}`)——同 group 链两端框之间,中间帧自动生成插值框(世界系线性内插中心 + slerp 朝向 + 线性尺寸);生成框 `source="interpolated"` 便于审核过滤;已有同 group 的中间帧幂等跳过;中间帧锁态整批拒。前端「跨帧工具」面板提供「延续到帧(建链)→ 微调 → 插值填充」工作流。
- **邻帧 overlay ego 对齐**:`GET /scenes/{id}/trajectory` 进前端(`useSceneTrajectory` + `egoAlign.ts`),邻帧参考框先变换到当前帧 ego 系再叠加——静止物历史/未来框与当前帧重合,偏移即目标真实运动。

### Notes

- `point_mask_3d` 跨帧明确不做(点索引跨帧无意义);Kalman / 非线性运动模型留后续。
- 真实数据验证:scene-0061(39 帧)首尾两帧静止物插值 37 帧,世界中心偏差 < 1e-15 m。

## [0.15.0] - 2026-06-10

ego_pose / 时间戳数据地基。给 scene 加"车体随时间的位姿轨迹 + 逐帧时间戳"(nuScenes `ego_pose` / `sample_data.timestamp` 的平台等价物),本版只立地基、回填、透出,不做跨帧 UX(消费留 v0.15.1)。计划见 `docs/plans/2026-06-06-v0.15.0-ego-pose-temporal-foundation.md`。

### Added

- **`scene_frame_poses` 表**(迁移 0102):grain = `(scene_id, frame_index)` 一帧一行,存 ego→global 的 `ego_translation [x,y,z]` / `ego_rotation [w,x,y,z]` + LIDAR_TOP 微秒时间戳;FK CASCADE + 复合唯一约束。历史 scene / 非 nuScenes 来源无行,消费方按"无轨迹"降级。
- **trajectory API**:`GET /api/v1/scenes/{id}/trajectory` 返回按 `frame_index` 升序的逐帧位姿;无位姿 scene → 200 + `poses: []`。
- **manifest 透出**:`GET /tasks/{id}/point-cloud/manifest` 新增 `ego_pose` 字段(本帧 translation / rotation / timestamp_us,无则 null);本版前端仅调试可见,不消费。
- **importer 回填**:`import_nuscenes_scene.py` 落 scene 后逐帧 upsert ego pose + 时间戳(读 `ego_pose.json` + `sample_data.timestamp`,幂等)。
- **backfill 脚本**:`scripts/backfill_frame_poses.py --dataset-id <uuid|display_id> --nuscenes-root <root>` 给 v0.15.0 之前导入的 nuScenes dataset 补 pose 行,按 `scene.source_metadata.scene_token` 反查原元数据,可重跑。
