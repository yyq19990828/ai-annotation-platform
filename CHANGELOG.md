# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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

<!-- 0.13.x 版本变更按版本段追加到本区；0.12.x 历史段待整体移到 docs/changelogs/0.12.x.md -->

## [0.13.7] - 2026-06-03

点云 + 图像联合标注工作台第八切片:**相机悬浮环绕布局**(SUSTech 式)。相机从「底部一字排 strip」改为按物理朝向悬浮在主 3D 视图四周,主视图全屏化;三视图精修栏从常驻右栏收为右下浮层。**纯前端、布局 + 交互重构,后端零改动**。计划见 `docs/plans/2026-06-03-v0.13.7-camera-surround-layout.md`。

### Added

- **相机朝向锚点推导**(`three-d/geometry/cameraAnchor.ts`,纯函数 + 单测 7 例):把每个相机推到主视图四周 9 个锚点之一(8 方位 + overflow)。**名字优先**(`front→顶 / rear→底 / left→左 / right→右`,复合 `front_left` 先于简单命中)、**外参兜底**(无可识别名字时按标准 lidar 约定 X=前 取光轴方位角)、都认不出 / 光轴近垂直 → overflow。
- **悬浮相机面板**(`FloatingCameraPanel.tsx`):相机按 `cameraAnchor` 分组贴主视图边缘(同朝向沿边堆叠),`front` 顶中 / `left` 左中 / `right` 右中。每个面板可「收起」折叠为贴边小标签,折叠态按 role 存 `localStorage`(刷新保留)。容器 `pointer-events:none` 不挡点云,子面板各自收事件。
- **相机放大浮层**:面板标题条「⛶」→ 居中大图浮层(复用 `CameraProjectionView`,图按 70vh 放大),投影 / 上色 / 深度 overlay 一致缩放;遮罩点击 / 关闭钮 / `ESC` 三途径关闭。

### Changed

- **主 3D 视图全屏化**:拆掉 `mainRow` 固定 240px 三视图右栏与底部相机 strip,viewport 铺满,gizmo 标注空间最大化且永不被压。
- **三视图精修收右下浮层**(`TriViewPanel` 容器从右栏改 `viewportWrap` 内 absolute 浮层):选中框才挂载浮出,可「收起」为小标签,未选框时零占位。
- **投影 / 上色 / 深度 / 命中零改动**:`CameraProjectionView` 已按 `clientWidth/naturalWidth` 自适应缩放,布局变更对其透明。

### Notes

- 当前示例集 `pc-scene-a` 仅 `front/left/right` 三相机(无 rear),网格自适应只渲染有相机的扇区,空朝向让主视图吃掉。外参兜底假设标准 lidar 约定(X=前);示例集前向实为 -Y(非标准),故走名字分支,回归测试锁定名字优先压过外参。
- 窄屏自适应(过窄自动折叠)未做:应用已在 <1024px 由 `MobileWorkbenchBlock` 拦截、且面板可手动折叠 + 记忆,留作 follow-up。相机面板自由拖动、6+ 相机(nuScenes)实测调优同列后续。

## [0.13.6] - 2026-06-03

点云 + 图像联合标注工作台第七切片:**点云 RGB 上色 + 深度联动**——继续吃满 0.13.4 的标定投影内核,把图像↔点云的融合做深一层。**纯前端、实时算不预存,后端零改动**。计划见 `docs/plans/2026-06-03-v0.13.6-rgb-colorize-depth-layout.md`(朝向环绕布局原 C3 已拆出顺延更下一版本)。

### Added

- **相机 RGB 上色点云**(`three-d/geometry/colorize.ts`,纯函数 + 单测 6 例):逐点投影到各标定相机像面采样像素 RGB 写回点云 `color`;落图内且在相机前方即候选,多候选取**归一化图像中心距最小**者(畸变最小、最可靠),无相机覆盖回退高度色带。控件加「相机上色」开关(默认关,仅在有标定相机时显示),一次性算不进每帧,关→还原原色。**三视图复用同一 geometry 自动跟随上色**。MVP 不做遮挡(背景点可能被前景串色)。
- **深度联动**(`three-d/geometry/depthmap.ts`,纯函数 + 单测 6 例):点云逐点投到相机像面建深度栅格(每像素格留最近点深度 + 3D 坐标 + 投影像素)。控件加「深度提示」开关 → 相机图叠**深度热力图**(近=红→远=蓝,画在框线下)+ 图上 **hover 读出最近点深度**(figcaption 显 `· X.Xm`)。栅格建一次(开关/换帧),hover 查 O(1) 且不触发重绘。

### Changed

- **`PointCloudScene` 暴露上色接口**:载帧存原色(高度色带);新增 `getPointPositions` / `getBaseColors` / `setPointColors`(原地写回 color buffer,`null` 还原原色)。
- **相机图加载为像素 buffer**:`crossOrigin="anonymous"` + offscreen canvas `getImageData`;跨域污染(SecurityError)则该相机降级跳过,不阻断其余。

### Notes

- 上色 / 深度均**默认关**:无标定相机本就降级,且省一次性投影采样开销。三个相机标定需齐备方可全覆盖(见本版前置的多相机夹具修复:重跑 `attach_calibration` 剥除陈旧 `extrinsic_ok` 杂键)。
- 性能:上色 1e6 点 × N 相机为一次性计算(不进每帧);深度栅格同。worker 化、遮挡 z-test 留迭代。

## [0.13.5] - 2026-06-03

点云 + 图像联合标注工作台第六切片:**三正交视图框精修编辑器**(ADR-0032 方案 B)。主 3D 视图右栏并排俯/侧/正三窗,框内点经 **GPU 裁切**逐窗渲染;在三视图里拖边/拖角改尺寸、拖方向线转三轴(yaw/pitch/roll),与主视图 gizmo / 数值面板 / 0.13.4 投影 overlay **四方实时同步**,松手防抖 PATCH。数值面板补齐 pitch/roll 三轴可编辑 + 朝向一键归零。**纯前端,后端零改动**。计划见 `docs/plans/2026-06-03-v0.13.5-tri-view-box-editor.md`。

### Added

- **三视图几何底座**(`three-d/geometry/triview.ts` + `box3d.ts`,纯函数 + 单测):`worldToBox` / `boxLocalClipPlanes`(box-local 6 裁剪面,含 margin)、`frameOrtho`(等比取景)、`dragEdge` / `dragCorner`(全边长口径 2D→PSR)、`dragRotation`(四元数 local 复合后分解 XYZ 欧拉,**避开多轴欧拉串轴**)、`dragHandle`(屏幕 handle→拖边/角分派)。`triview.test.ts` / `box3d.test.ts` 覆盖三视图映射 / 拖边·角数学 / 三轴旋转 round-trip / 逆变换 + 6 面方向。
- **三视图渲染基建**(`TriViewRenderer.ts`):**单** `WebGLRenderer` + 3 viewport/scissor + 3 正交相机,框内点用 GPU clipping planes 裁、**复用主视图同一份点 BufferGeometry**(零 CPU 拷贝,全程仅 2 个 WebGL context)。相机映射与 `VIEW_AXES` 同口径(右手系保证屏幕 u→右 / v→上),PSR 变只重算 6 面 + 相机。所有 WebGL 资源收口本类,点 geometry 属主场景不 dispose。
- **三视图面板 + 2D overlay**(`TriViewPanel.tsx` / `TriOrthoView.tsx`):WebGL 底 + 叠加 2D overlay 画框矩形 / handle / 方向线柄;拖边/角/方向线 → 回写选中框 PSR。拖拽期**冻结相机取景**(`setCameraRef`),裁剪面仍随实时 box,使框在屏上真实长/移/转而点云不动。
- **数值面板三轴朝向**(`ThreeDWorkbench.tsx`):PSR 编辑面板新增 pitch / roll 字段(°),与 yaw 同组可显示、可编辑;新增「**朝向归零**」按钮一键复位 `yaw/pitch/roll → [0,0,0]`(保留中心 / 尺寸)。

### Changed

- **点大小三视图联动**:三视图点大小跟随主视图点大小滑杆(`pointSize` 透传 → `setPointSize`)。
- **正交相机点大小修正**:`PointsMaterial.sizeAttenuation` 在正交相机下不生效(three.js 仅对透视相机生效),世界尺寸被当像素用 → 亚像素不可见。改为 `sizeAttenuation=false` + 每帧按本视图「米→px」比例(`sCss×dpr`)换算成真实像素,下限 1px。

### Fixed

- **拖拽不落 PATCH**(高危,顺带修好 B-2/B-3 提交):2D overlay 交互 `useEffect` 把频繁变化的 `selected` 放进依赖,拖拽中 draft 改 `selected` → effect 重跑 → cleanup 撤掉了命令式挂的 `mousemove`/`mouseup` 监听 → 松手没人处理,只剩刷新即回退的乐观 draft。改用 `propsRef` + 空依赖,监听全程稳定。
- **数值编辑抹掉 pitch/roll**:`schedulePatch` 原硬编码 `rotation: [0,0,yaw]`,三视图设好 pitch/roll 后再在面板改任一字段(如 cx)就把 pitch/roll 抹回 0。修复:补齐字段 + `rotation: [roll, pitch, yaw]`。

### Notes

- 性能:GPU clip 无 CPU 每帧重算,PSR 变只重算 6 个 `THREE.Plane` + 相机;1e6 点 ×3 viewport 顶点开销在预算内,掉帧预案为三视图相机降采样点集(本切片未触发)。
- 验证:拖拽数学纯函数单测绿(`triview.test.ts` 18 例);切任务 / 反复进出无 WebGL context lost、内存稳定。点云工作台尚无 Playwright e2e harness(0.13.x 各切片一致),三视图交互验证走纯函数单测 + 浏览器手测,e2e 待点云台整体补 harness 时统一加。
- 不做(顺延 v0.13.6+):多框批量 / 跨帧轨迹、自动拟合贴合(`fit_bottom` / `auto_shrink`)、`point_mask_3d` 3D 分割。

## [0.13.4] - 2026-06-03

点云 + 图像联合标注工作台第五切片:**联合标注 MVP 上线**——把 3D 框经相机标定**实时**投影到各相机视图。标注员对照图像确认 / 校正 3D 框,3D↔2D 双向选中联动,同物体共享 `group_id` 身份。**纯前端、实时算不预存,后端零改动、零新端点、零迁移**。计划见 `docs/plans/2026-06-03-v0.13.4-pointcloud-projection-linkage.md`,投影 overlay 架构决策见 ADR-0033。

### Added

- **3D→2D 投影内核**(`three-d/geometry/projection.ts`):`projectPoints(points, calib)` 实现 `extrinsic(行主 4x4) → 可选 rect → intrinsic(行主 3x3) → 透视除法`,`visible = w>0` 剔除相机后方角点;`BOX_EDGES` 12 边索引表。手写行主序矩阵·向量(避开 `THREE.Matrix4` 列主序陷阱)。与 SUSTechPOINTS 逐字对齐,`projection.test.ts` 用真实标定 + yaw-only 框做**像素级对拍**。
- **相机视图投影 overlay**(`CameraProjectionView.tsx`):相机图上叠等尺寸 canvas 画投影线框(类别色),消费同一份标注实时重绘;按 `clientWidth/naturalWidth` 缩放(intrinsic 基于原图分辨率),`ResizeObserver` + `onLoad` 重算,`devicePixelRatio` 适配高清屏。
- **3D↔2D 选中联动**:选中 3D 框 → 各相机投影高亮(白描边 + 淡填充);点相机投影框 → 命中测试反选对应 3D 框;状态条显示「投影可见于 N 相机 · 正对 X」,最正对相机标「· 正对」角标。
- **`group_id` 聚合高亮**:overlay 高亮集合 = 选中框 + 同 `group_id` 成员,为相机视图 2D 框成员(后续)预留跨模态身份。

### Changed

- **相机面板从只读 `<img>` 升级为图 + 投影 overlay**:相机图加大到 160px;无 `calibration` 的相机降级不画、不报错。
- **`useUpdateAnnotation` 乐观更新驱动实时性**:数值面板 / gizmo / 列表改框经乐观更新即时写缓存,overlay 立即跟随(gizmo 拖拽期间不逐帧透传,落点提交后跟随)。

### Fixed

- **3D 台按 E 键误把任务提交质检**:E 全局绑定「提交质检」(`hotkeys.ts` dispatch → submit),在 3D 工作台按 E 想切 gizmo 旋转模式却触发了全局提交。修复:`stageKind==="3d"` 时把 3D 自管的 `B/V/W/E/R` 经 `ignoredKeys` 交给 3D 本地 keydown 处理,全局 2D 热键跳过这些键(Ctrl+方向切题 / `?` / Esc 等全局键保留)。
- **Dashboard 陈旧测试**:`ViewerDashboard.test.tsx` 原用 `lidar` 项目断言「未实现工作台 → toast」,但 lidar 自 v0.13.x 已进白名单(导航进 3D 台);改用 `image-seg` 项目验证降级 toast。

### Notes

- three 仍走 `React.lazy` + 独立 `vendor-three` chunk(513KB);`ThreeDWorkbench` 懒加载块 67.75KB,konva 2D 栈隔离。
- 后端无改动:`/annotations/group` 要求 `len(ids) >= 2`,**单个 3D 框无法自分组**;本切片只做按 `group_id` 聚合高亮,孤立框退化为仅高亮自身。
- 不做:相机视图独立绘制 / 编辑 2D 框成员、投影预存生成 2D 标注、三正交视图精修(ADR-0032 方案 B)、`point_mask_3d` 分割——留 v0.13.5+。

## [0.13.3] - 2026-06-03

点云 + 图像联合标注工作台第四切片:把只读查看器升级为**可标注**——首个点云**可写**能力。在 Three.js 工作台画 / 选 / 编辑 **3D 框**(`Box3DGeometry`),类别复用 `tool_bindings["lidar_box_3d"]`,经现有标注 API 持久化。**纯前端 + 一处设置解禁,后端零改动、零新端点、零迁移**。计划见 `docs/plans/2026-06-02-v0.13.3-pointcloud-3d-box-annotation.md`,交互形态决策见 ADR-0032。

### Added

- **3D 框标注(可写)**:`ThreeDWorkbench` 支持放置 / 选中 / 编辑 / 删除 `box_3d` 框。「放置框 (B)」点地面落框(射线打 `z=groundZ` 水平面,`groundZ` 取 z 直方图低分位避免悬浮)→ 默认尺寸 → 自动选中精修。
- **PSR 编辑(主视图 gizmo + 数值面板)**:选中后官方 `TransformControls`(W 平移 / E 绕 Z 转 / R 缩放)+ 右上 PSR 数值面板,经选中框单一真值双向同步。缩放翻转出的负尺寸取绝对值兜底。
- **PSR↔角点纯函数**:`three-d/geometry/box3d.ts`(移植 SUSTechPOINTS 矩阵 + 单测,`boxToMatrix4` / `psrToCorners`),为 v0.13.4 投影复用同一套约定。
- **`lidar_box_3d` 设置解禁**:`lidar` 项目可在建项目向导 / 项目设置启用该工具单位并配类别。

### Changed

- **类别 / 属性绑定 + 持久化复用 2D 链路**:`box_3d` 创建 / 更新 / 删除直接走 `useCreateAnnotation/useUpdateAnnotation/useDeleteAnnotation`;class_name 校验复用 service 层 `_validate_class_name`(非 `lidar_box_3d` 类集合内的类别 422)。
- **只读接线**:锁定 task / viewer 角色(`readOnly`,壳层透传)不放置 / 不挂 gizmo / 面板禁用,仅可选中查看数值。

### Notes

- three 仍走 `React.lazy` + 独立 `vendor-three` chunk(`pnpm build` 核验),不进主 bundle。
- 后端加 `tests/test_pointcloud_box3d_annotation.py`(box_3d 创建命中 / 422 / 空 `tool_bindings` 放行)。
- 不做:3D→2D 投影联动、`group_id` 跨模态聚合、`point_mask_3d` 分割、三正交视图精修(ADR-0032 方案 B)——均留 v0.13.4+。

## [0.13.2] - 2026-06-02

点云 + 图像联合标注工作台第三切片：**前端点云查看器 MVP(只读)**——首个用户可见的点云能力。引入 Three.js,在工作台渲染主点云 + 各相机图,可旋转缩放、看不可标。计划见 `docs/plans/2026-06-02-v0.13.2-pointcloud-viewer-mvp.md`,架构决策见 ADR-0031。

### Added

- **点云 manifest API**:`GET /tasks/{id}/point-cloud/manifest` 返回主点云 presigned URL + 各相机图 URL + 标定(`SensorCalibration`)。非点云任务 409。
- **Three.js 点云查看器**:`project.type_key === "lidar"` 的任务在工作台进入 3D 舞台(`WorkbenchStageHost` 三路分流的 `3d` 分支)。裸 Three.js + React 薄封装(`PointCloudScene`):`PCDLoader` 加载点云、按高度上色、OrbitControls 旋转/平移/缩放、点大小调节、重置视角;大点云(>50 万点)自动抽稀。各相机图只读平铺(投影联动留 v0.13.4)。
- **dev proxy 可配**:`vite.config.ts` proxy 目标改 `API_PROXY_TARGET` 可覆盖(默认 8000),支持多 worktree 并行各连不同后端端口。

### Changed

- `DatasetItemOut`/3D 几何类型经 codegen 流到前端;three 经 `React.lazy` + 独立 `vendor-three` chunk 加载,**不进主 bundle**,不影响 2D 工作台首屏。

### Notes

- 双画布架构(Konva 2D / Three.js 3D)双栈并存、模块级隔离,2D 流程零改动(ADR-0031)。
- 本切片只读;3D 框标注(v0.13.3)与标定驱动投影联动(v0.13.4)后续。

## [0.13.1] - 2026-06-02

点云 + 图像联合标注工作台第二切片：scene 统一资产导入 + 标定存储。**仅 API、零迁移、无前端可见变化**。计划见 `docs/plans/2026-06-02-v0.13.1-pointcloud-scene-import.md`，决策见 ADR-0030。

### Added

- **标定 schema `SensorCalibration`（G2）**：`extrinsic[16]` + `intrinsic[9]`（+ KITTI 可选 `rect[16]`），存进相机 `DatasetItem.metadata_["calibration"]`，不加列。新增 `DatasetItemMetadata`（`extra="allow"`）让 `DatasetItemOut.metadata` 出强类型（codegen 流到前端），保留其它 metadata key。
- **scene 感知建任务管线**：复用既有「文件入库 → `POST /datasets/{id}/link`」管线，在 `build_tasks_for_link` 内按 `project.data_type == "lidar"` 分流到 `services/pointcloud_import.py`：按 `file_path`（`lidar/` `camera/<cam>/` `calib/camera/`）帧分组，每个 lidar 帧建一个 Task（`file_type=point_cloud`，`dataset_item_id` 指向主点云），用 `link_items` 关联 `primary_lidar` + 各 `camera_<cam>`；帧级 `NOT EXISTS` 去重、分块 commit、job 进度上报，沿用 2D 路径机制。
- **标定写入**：`attach_calibration` 导入时读 `calib/camera/<cam>.json` → 校验长度 → 写各相机帧 DatasetItem.metadata；无 calib 则跳过（标定降级为 3D-only，不阻断）；缺相机的帧只 link 主点云。

### Notes

- `task.dataset_item_id` 指向主点云，使假设单 item 的现存消费方（导出/列表/缩略图）不炸；多 item 消费走 link 表（后续切片验证）。
- 端到端测试以真实夹具 `third-party/SUSTechPOINTS/data/example`（front/left/right 三相机 + 缺相机帧 000950）对拍 link 与标定值。

## [0.13.0] - 2026-06-02

点云 + 图像联合标注工作台（Epic v0.13.x）第一切片：后端数据地基。纯新增、**无前端可见变化**，为后续 LiDAR 点云 + 相机图像联合标注打底。计划见 `docs/plans/2026-06-02-v0.13.0-pointcloud-data-foundation.md`，决策见 ADR-0029，数据模型见 `docs-site/dev/reference/point-cloud-data-model.md`。

### Added

- **多文件关联中间表 `TaskDatasetItemLink`（G1）**：一个 3D 任务（一帧 scene）经新表 `task_dataset_item_links` 关联多个数据项（主点云 + N 路相机图像），带 `role`（`primary_lidar` / `camera_<name>`）与 `sensor_name`；`UNIQUE(task_id, role)`。2D 单文件 task 的 `task.dataset_item_id` 1:1 路径完整保留，两条路径 service 层按 `project.data_type` 分流。迁移 `0094`。service 接口 `link_items` / `get_linked_items`（`app/services/task_dataset_link.py`）。
- **3D 几何类型（G3）**：`Geometry` discriminated union 新增 `Box3DGeometry`（`type=box_3d`，`center[3]`/`size[3]`/`rotation[3]`）与 `PointMaskGeometry`（`type=point_mask_3d`，`point_indices`）。零迁移（存 `annotations.geometry` JSONB）；旧 2D 几何不受影响。前端强类型由 OpenAPI codegen 产出。
- **工具单位 + file_type（G4）**：`lidar_box_3d` 工具单位从「留位」转为后端可用，新增 `point_mask_3d`；数据集 file_type 推断放开点云扩展名 `.pcd` / `.bin` / `.las` / `.ply` → `point_cloud`。
- **跨模态身份约定（G6）**：不新增模型，复用 `Annotation.group_id` 把同一物体的「3D 框 + 各相机 2D 框」聚为一个逻辑对象。约定见数据模型参考文档。

## [0.12.7] - 2026-06-03

> **离线分析页 recharts 升级 + 工时热力图(A4)。** `/admin/analytics` 三个手搓 CSS 条面板升级为 recharts(团队日吞吐折线、reject 原因分布柱状,耗时分布保留 KPI);新增第四面板**工时热力图**(星期 × 小时,基于 `task_events.started_at` 聚合 annotate 事件,颜色深浅 = 时段计数占比)。轨道 A 收官。计划见 `docs/plans/2026-06-03-v0.12.7-analytics-heatmap.md`。

### Added

- **工时热力图**:`analytics_queries.activity_heatmap(days)` 按 `dayofweek(started_at)`(0=周日..6=周六)× 小时聚合 `kind='annotate'` 事件;`/admin/analytics/activity_heatmap` 面板端点(super_admin)。前端 7×24 CSS grid 渲染,格子颜色 `--color-accent` + opacity 表达强度(token 合规)。
- **analytics 面板 recharts 化**:团队日吞吐 → `LineChart`,reject 原因分布 → 横向 `BarChart`,耗时分布保留 p50/p95/均值 KPI。recharts stroke/fill 经 `cssVar()` 运行时读 token 色值。

## [0.12.6] - 2026-06-03

> **成员绩效项目级范围(A3)+ reject/类别维度下钻。** `/admin/people` 与详情端点支持按项目切分聚合,并对 **project_admin 放行**(强制其管理的项目范围);super_admin 仍可全局或任意项目。补 A2 顺延的 reject/类别下钻:`GET /tasks` 新增 `reject_reason_type`/`class_name` 过滤,详情抽屉在项目模式下点 reject 原因 / 类别行内联展开该项目内本人匹配任务。计划见 `docs/plans/2026-06-03-v0.12.6-project-scope-drilldown.md`。

### Added

- **成员绩效项目级范围**:`GET /dashboard/admin/people` 与 `GET /dashboard/admin/people/{user_id}` 新增/启用 `project` 参数,给**每个产能/质量/活跃/耗时/归因聚合**加项目过滤(此前 `project` 仅过滤"返回哪些用户",聚合仍是跨项目全局数字 → 误导)。新增共享助手 `_resolve_people_scope` 统一解析范围 + RBAC。导出端点同步放行。
- **RBAC 放行 project_admin**:两端点角色门由 super_admin 扩到 `super_admin + project_admin`;project_admin **必须指定** 其 owner 的项目(`assert_project_visible`,越权项目 404 隐藏存在性,缺省 project → 403),super_admin 不变。前端 `permissions` 给 project_admin 加 `admin-people` 页面权限 + Sidebar 入口放开(由 `canAccessPage` 过滤);`AdminPeoplePage` 新增项目下拉(super_admin 含「全部项目」,project_admin 锁自有项目并自动选第一个)。
- **reject/类别维度下钻**:`GET /tasks` 新增 `reject_reason_type`(Task 列)与 `class_name`(annotation EXISTS 子查询)过滤;成员详情抽屉在**项目模式**下点 reject 原因 / 类别行,内联展开该项目内本人匹配任务列表(只读,display_id + 状态)。全局模式下不下钻(tasks 查询需 project_id)。

### Notes

- **timeline(审计活动流)不按项目切分**:其无可靠 project 维度,保持全局。`project_count`(成员所属项目数)同理保持全局。
- 聚合级对账测试(全局 vs 项目级数字)保证改造正确性:见 `tests/test_dashboard_people_project_scope.py`。

## [0.12.5] - 2026-06-03

> **成员绩效 CSV 导出 + 项目维度下钻(A2)。** `/admin/people` 顶部新增「导出 CSV」(带当前筛选,Excel UTF-8 BOM 防中文乱码);成员详情抽屉「项目分布」每行可点 → 跳到该项目审核队列并按本人 assignee 过滤。落地时发现路线档原设想的「reject/类别下钻复用现有 tasks query」前提不成立(tasks 端点 `project_id` 必填、无 `reject_reason_type`/`class_name` 过滤,且绩效聚合跨项目),故本版只做**项目维度**下钻,reject/类别下钻并入 A3(v0.12.6,届时聚合做成项目级、落点天然顺)。计划见 `docs/plans/2026-06-03-v0.12.5-export-drilldown.md`。

### Added

- **成员绩效 CSV 导出**:`GET /dashboard/admin/people/export`(super_admin),复用 `admin_people_list` 聚合输出 CSV(13 列:user_id/name/email/role/status/project_count/main_metric 等),Excel UTF-8 BOM。前端 `dashboardApi.exportPeople` 带 Bearer 拉 blob 触发下载,`AdminPeoplePage` 头部「导出 CSV」按钮携带当前 role/period/sort/q 筛选。
- **项目维度下钻**:`AdminPeoplePage` 成员详情抽屉「项目分布」行改为可点,跳 `/review?project=<pid>&assignee=<uid>`;`ReviewPage` 新增读 `assignee` query param 注入任务列表过滤(复用后端已有 `assignee_id`)。

### Notes

- **reject/类别维度下钻**未做:需给工作台 tasks 查询新增 `reject_reason_type`/`class_name` 过滤(触碰 B-16 可见性 + cursor 分页)并解决跨项目落点,非快赢零风险 —— 延后并入 A3 项目级聚合改造(v0.12.6)。

## [0.12.4] - 2026-06-03

> **绩效页质量归因(A1)。** 给 `/me/performance`(标注员自助)与 `/admin/people` 成员详情抽屉补三个质量归因维度:**Reject 原因细分**(本人被驳回任务按漏标/多标/类别错/位置错分布)、**类别覆盖**(本人标注按 class_name 的 top-N 占比,检测偏科/盲区)、**首过率 first-pass yield**(一次通过无 reopen / 提交总数,比 reopen 率更标准的质量 KPI)。纯增量、数据现成。对标调研见 `docs/research/15-annotator-performance.md`,路线见 `docs/plans/2026-06-03-annotator-performance-deepening.md`。

### Added

- **质量归因三维**:`GET /dashboard/me/performance` 与 `GET /dashboard/admin/people/{user_id}` 响应新增 `reject_reason_breakdown` / `class_distribution` / `first_pass_yield` 三字段(追加,向后兼容)。后端三个共享 helper:`_reject_reason_breakdown`(按 `Task.reject_reason_type` 分组)、`_class_distribution`(按 `Annotation.class_name` top-N)、`_first_pass_yield`(`reopened_count==0` 占提交比,无样本→null)。
- **前端**:`MyPerformancePage` 新增「首过率」KPI + 「Reject 原因分布」+「类别覆盖」(recharts 横向柱图);`AdminPeoplePage` 详情抽屉新增同三块(复用现有 distribution 行样式 + 首过率 KPI)。

## [0.12.3] - 2026-06-03

> **标注员自助绩效页 + 绩效/分析导航补全。** 取经合集 §4.1「Annotator Performance Dashboard」的真实缺口收口：super_admin 的成员绩效页 `/admin/people`（v0.8.4 已含今日/本周/本月、产能/质量排序、人均卡片 + 下钻趋势/直方图）此前只能从 Dashboard 卡片或直达 URL 进入，本版补 Sidebar 入口；DuckDB 离线分析页 `/admin/analytics` 同为导航孤儿，一并接入。新增**所有角色可见的 `/me/performance` 自助页**，标注员看自己 4 周产出趋势对标团队均线 + 耗时直方图，用 recharts 渲染。计划见 `docs/plans/2026-06-03-v0.12.3-annotator-performance-dashboard.md`。

### Added

- **`/me/performance` 标注员自助绩效页**：新增 `GET /dashboard/me/performance?period=`（任意已认证用户，强制 self，不接受他人 user_id），返回本人 4 周产出趋势 `trend_throughput` + 团队 annotator 群体每周均线 `team_trend_throughput` + 质量趋势 + 耗时直方图（10 桶）+ p50/p95 + 周环比。前端 `MyPerformancePage` 用 recharts LineChart（我 vs 团队均线）+ BarChart（耗时分布）+ hero KPI 卡渲染。所有角色 Sidebar 新增「我的绩效」入口（pageKey `my-performance`）。
- **绩效 / 分析导航补全**：super_admin Sidebar「管理」区新增「标注员绩效」（`/admin/people`）与「离线分析」（`/admin/analytics`）两个入口——此前二者均为导航孤儿（路由存在但 Sidebar 无链接）。

### Notes

- **依赖**：前端新增 `recharts`（图表库）。
- **project_admin 项目级绩效**暂未放开：`/admin/people` 的吞吐/质量聚合当前不按项目维度切分，直接放行会让 project_admin 看到跨项目全局数字（误导）。正确做法需为每个聚合加项目过滤，留后续版本独立做（详见 plan §范围修订）。

## [0.12.2] - 2026-06-02

> **开放注册邮箱验证。** 开放注册新增邮箱验证环节：验证开关按环境派生（production 默认开、dev/staging 默认关，可用 `REQUIRE_EMAIL_VERIFICATION` 显式覆盖）。开关打开时注册后须点邮件链接验证才能登录；邀请注册与管理员建号恒视为已验证。复用既有 SMTP 底座与 password-reset token 范式，未引入新依赖。

### Added

- **邮箱验证流程**: `User.email_verified_at` 字段 + `email_verification_tokens` 表（24 小时一次性 token，迁移 `0092`）；新增 `POST /auth/verify-email`（消费 token）与 `POST /auth/send-verification-email`（重发，防枚举恒 202）。`register-open` 在验证开关打开时不再自动登录，返回 `email_verification_required=true` 且 `access_token=null`，并发送验证邮件；`login` 对未验证账户返回 `400 {code: "email_not_verified"}` gate。→ [plan](docs/plans/2026-05-27-v0.12.0-email-verification.md)
- **前端验证 UI**: RegisterPage 注册后切到「验证邮件已发送」态（含重发按钮 + 60s 倒计时）；新增 `/verify-email` 落地页消费 token；LoginPage 识别 `email_not_verified` 后展示「重新发送验证邮件」入口。
- **环境派生配置**: 新增 `REQUIRE_EMAIL_VERIFICATION` env（留空按环境派生），经 `settings.email_verification_required` property 统一读取。存量用户迁移时回填 `email_verified_at = created_at`，避免上线即被锁。

## [0.12.1] - 2026-06-02

大数据集规模化加固第三版（B6）：把导出从「全量进内存 + 单 `BytesIO` 攒整包」改为「分块读 DB + 落盘式 ZIP + 流式上传」，使导出 worker 内存与 task 数解耦，消除十万级导出的 OOM 风险。对用户行为无变化（仍异步、仍下载链接），只是内部更省内存。计划见 `docs/plans/2026-06-02-v0.12.1-streaming-export.md`。

### Changed

- **导出 ZIP 落盘 + 流式上传（B6-2）**：`build_export_zip` / `_build_video_export_zip` 不再用 `io.BytesIO()` 把整包压缩 ZIP 攒在内存，改写 `tempfile` 落盘；worker 用 boto3 `upload_file` 多段流式上传（不把整文件读进 RAM），上传后清理临时文件。内存峰值与产物大小解耦。
- **导出 DB 读分块流式化（B6-1）**：新增 `ExportService.iter_export_chunks`，按 task 分块惰性产出 `(tasks, ann_by_task, dataset_items)`（先取轻量 task id 列表再分块水合，规避服务端游标占用连接的冲突），每块产出后 `expunge_all()` 释放 session 身份映射，避免分块加载的 ORM 行滞留内存。per-file 格式（YOLO 镜像、视频逐序列 MOT/KITTI/yolo-frames）的 ORM 对象内存与 task 数解耦。COCO/AAP JSON 是单文档格式，本质需全量物化（流式 JSON 编码不在本版范围），仍由 `ExportService` 自加载。
- **图像 manifest 流式写入**：`images_manifest.json` 改为边遍历边写 zip entry（`zf.open(...,"w")`，O(1) 内存），不再把十万条 manifest dict 攒进 RAM 再整体 `json.dumps`——这是「内存与 task 数解耦」的关键残留项。
- `build_export_zip` 返回签名由 `(bytes, file_count)` 改为 `(zip 路径, file_count, size_bytes)`；`storage_service` 新增 `upload_file` 从本地路径流式上传。
- 实测（10 万 task 项目，YOLO 全量导出）：旧 `_load_data` 仅加载即 ~426MB 峰值；新流式落盘端到端 ~134MB（剩余主要是 stdlib `zipfile` 十万条目的中央目录，小常数因子），产物 `testzip` 完好、manifest 合法。

## [0.12.0] - 2026-06-02

大数据集规模化加固第二版（B4/B5），承接 v0.11.30 的查询地基，把「关联数据集 → 建任务」搬入异步、并补未归类任务池在大表下的浏览与分包规模化。配套路线图见 `docs/plans/2026-06-02-large-dataset-scale-hardening-roadmap.md`。

### Added

- **建任务异步化（B4）**：关联数据集时，超过 `TASK_CREATE_SYNC_THRESHOLD`（默认 2000 items）的大数据集不再在同步 HTTP 单事务里一次性建 task，而是建立 link 后入队 Celery worker（`app.workers.create_tasks`）分块（每块 5000）建任务并回写 `async_jobs` 进度；小数据集仍走同步快路径保持即时体验。worker 以 `(project_id, dataset_item_id)` 去重，支持断点重跑不双建。
- **关联进度可见**：数据集关联返回 `async_job_id`，前端在数据集关联 / 建项目向导第 5 步轮询进度条，完成后提示已建任务数。
- **未归类任务池浏览**：`GET /tasks?unbatched=true` 走 cursor 分页 + 虚拟滚动列出 `batch_id IS NULL` 的未归类任务；BatchesSection 横带新增「浏览未归类」入口。
- **一键全量建包**：未归类横带新增按钮，一键把全部未归类任务注入单个批次（split `n_batches=1`），消除大数据集导入后「工作台仍空、必须先手动切批」的 UX 悬崖。
- 迁移 `0091`：部分索引 `ix_tasks_project_unbatched ON tasks (project_id, created_at, id) WHERE batch_id IS NULL`，撑未归类池分页（实测 Index Scan，无额外 Sort）。

### Changed

- **split 大表分块 UPDATE（B5）**：`BatchService._assign_tasks` 回写 `batch_id` 改为每块 5000 个 id 一条 UPDATE，避免十万级单条 `IN` 巨 UPDATE 的长事务。
- `create_tasks_for_items`（upload/zip/scan 追加路径）内部改分块 INSERT，调用方语义不变。
- `DatasetService.link_project` 返回 `LinkProjectResult(link, async_job_id, created_tasks)`，供 endpoint 在 commit 后再 enqueue。

### Config

- 新增 `TASK_CREATE_SYNC_THRESHOLD`（默认 2000）：数据集 item 数 ≤ 阈值走同步建 task，> 阈值走 Celery 异步。
