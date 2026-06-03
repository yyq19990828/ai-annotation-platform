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

- **多文件关联中间表 `TaskDatasetItemLink`（G1）**：一个 3D 任务（一帧 scene）经新表 `task_dataset_item_links` 关联多个数据项（主点云 + N 路相机图像），带 `role`（`primary_lidar` / `camera_<name>`）与 `sensor_name`；`UNIQUE(task_id, role)`。2D 单文件 task 的 `task.dataset_item_id` 1:1 路径完整保留，两条路径 service 层按 `project.data_type` 分流。迁移 `0092`。service 接口 `link_items` / `get_linked_items`（`app/services/task_dataset_link.py`）。
- **3D 几何类型（G3）**：`Geometry` discriminated union 新增 `Box3DGeometry`（`type=box_3d`，`center[3]`/`size[3]`/`rotation[3]`）与 `PointMaskGeometry`（`type=point_mask_3d`，`point_indices`）。零迁移（存 `annotations.geometry` JSONB）；旧 2D 几何不受影响。前端强类型由 OpenAPI codegen 产出。
- **工具单位 + file_type（G4）**：`lidar_box_3d` 工具单位从「留位」转为后端可用，新增 `point_mask_3d`；数据集 file_type 推断放开点云扩展名 `.pcd` / `.bin` / `.las` / `.ply` → `point_cloud`。
- **跨模态身份约定（G6）**：不新增模型，复用 `Annotation.group_id` 把同一物体的「3D 框 + 各相机 2D 框」聚为一个逻辑对象。约定见数据模型参考文档。
