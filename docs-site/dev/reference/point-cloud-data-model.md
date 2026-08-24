---
title: 点云联合标注数据模型
audience: [developer]
type: reference
status: stable
last_reviewed: 2026-07-11
---

# 点云联合标注 · 后端数据模型

> v0.13.0 落地的后端数据地基。本切片纯新增、无前端可见变化，为后续「LiDAR 点云 + 相机图像联合标注工作台」（Epic v0.13.x）打底。
>
> 设计依据：调研 `docs/research/14-point-cloud-image-fusion.md` §14.8.3（仓库源码文档，非本站页面）。

## 概览

支持点云 + 图像联合标注需要四个后端原语，v0.13.0 一次落地：

| 缺口                    | 落地物                                                      | 位置                                                |
| ----------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| G1 任务-数据项 1:N 关联 | `TaskDatasetItemLink` 中间表                                | `app/db/models/task_dataset_item_link.py`           |
| G2 标定存储（v0.13.1）  | `SensorCalibration` 进 `DatasetItem.metadata_`              | `_jsonb_types.py` / `services/pointcloud_import.py` |
| G3 3D 几何              | `Box3DGeometry` / `PointMaskGeometry`                       | `app/schemas/_jsonb_types.py`                       |
| G4 工具单位 / file_type | `lidar_box_3d`（启用）/ `point_mask_3d`（新增）；点云扩展名 | `_jsonb_types.py` / `services/dataset.py`           |
| G6 跨模态 ID 约定       | 复用 `Annotation.track_id`（不改模型）                      | 见下文「跨模态身份」                                |

> v0.13.0 落 G1/G3/G4/G6 静态地基；v0.13.1 补 **G2 标定存储** + **scene 导入管线**（见下文「scene 导入数据流」）。

## G1 · 多文件关联：`TaskDatasetItemLink`

一个 3D 标注任务（一帧 scene）同时关联多个数据项：一份主点云 + N 路相机图像。这与 2D 单文件任务的 1:1 关联（`task.dataset_item_id`）并存。

```
task_dataset_item_links
  id              uuid  PK
  task_id         uuid  FK→tasks.id            (ON DELETE CASCADE, indexed)
  dataset_item_id uuid  FK→dataset_items.id    (ON DELETE CASCADE, indexed)
  role            str   not null               # primary_lidar | camera_<name>
  sensor_name     str   nullable               # 传感器物理名（可选）
  created_at      timestamptz
  UNIQUE (task_id, role)                        # 一个 task 每个 role 槽位仅一个 item
```

- **`role` 约定值**：`primary_lidar`（主点云）或 `camera_<name>`（如 `camera_front`、`camera_rear_left`）。
- **校验在 service 层**（`services/task_dataset_link.py` 的 `_validate_role`）：`role == "primary_lidar"` 或 `role.startswith("camera_")`，否则 `raise ValueError`。**不加 DB CheckConstraint** —— `camera_<name>` 是开放后缀，枚举不可穷举，约束放应用层更自然。
- **共存策略**：2D 单文件 task 继续用 `task.dataset_item_id`（1:1）；3D 多文件 task 用 link 表。两条路径在 service 层按 `project.data_type` 分流，互不影响。`task.dataset_item_id` 1:1 路径完全保留。

service 接口（`app/services/task_dataset_link.py`）：

```python
await link_items(session, task_id, [(item_id, "primary_lidar", None),
                                     (item_id2, "camera_front", "cam0")])
links = await get_linked_items(session, task_id)
```

## G2 · 标定存储：`SensorCalibration` 进 `metadata_`（v0.13.1）

相机标定按相机一份(对该相机所有帧通用),存进相机 `DatasetItem.metadata_` 的约定 key `"calibration"`，**不加列、零迁移**(决策见 ADR-0030)。

```python
class SensorCalibration(BaseModel):
    extrinsic: list[float]   # len 16, row-major 4x4 外参
    intrinsic: list[float]   # len 9,  row-major 3x3 内参
    rect: list[float] | None # len 16, KITTI 可选矫正矩阵

class DatasetItemMetadata(BaseModel):   # extra="allow" 保留其它 metadata key
    calibration: SensorCalibration | None = None
```

`DatasetItemOut.metadata` 用 `DatasetItemMetadata` 出强类型(codegen 流到前端)。投影(v0.13.4)按 `task → camera link → DatasetItem.metadata_["calibration"]` 取标定:`extrinsic·[x,y,z,1] → 取 xyz → intrinsic·xyz → 透视除法 → 像素`。

## scene 导入数据流（v0.13.1）

复用既有「文件入库 → 关联项目 → 建任务」管线,只在 `build_tasks_for_link` 内按 `project.data_type == "lidar"` 分流到 `services/pointcloud_import.py`:

```
scene 目录入库(upload-zip / import-from-connection):
  <ds>/lidar/<frame>.pcd            → DatasetItem(file_type=point_cloud)
  <ds>/camera/<cam>/<frame>.jpg     → DatasetItem(file_type=image)
  <ds>/calib/camera/<cam>.json      → DatasetItem(file_type=other)

POST /datasets/{id}/link  (project.data_type=="lidar"):
  build_tasks_for_link 分流 →
    attach_calibration         : 读 calib JSON → 经 SensorCalibration 归一化(剥未建模杂键 + 全字段校验)→ 写各相机帧 DatasetItem.metadata_["calibration"]
    build_pointcloud_tasks_for_link:
      group_frames             : 按 file_path 段名(lidar/camera/calib)分组,取最后一次出现
      每个 lidar 帧 → 1 Task(dataset_item_id=lidar item, file_type=point_cloud)
      link_items               : primary_lidar + 各 camera_<cam>
      缺相机的帧 → 只 link primary_lidar(warning,不报错)
      帧级 NOT EXISTS 去重 / 分块 commit / job 进度上报
```

- **`task.dataset_item_id` 指向主点云 item**:让假设单 item 的现存消费方(导出 / 列表 / 缩略图)不炸,link-aware 消费方走 link 表取全部。
- **标定降级**:无 calib 文件 → 跳过写入,scene 退化为 3D-only,不阻断。

## G3 · 3D 几何类型

加入 `Geometry` discriminated union（`Field(discriminator="type")`），零迁移（几何存 `annotations.geometry` JSONB）：

| `type`          | 类                  | 字段                                    | 备注                                               |
| --------------- | ------------------- | --------------------------------------- | -------------------------------------------------- |
| `box_3d`        | `Box3DGeometry`     | `center[3]` / `size[3]` / `rotation[3]` | 米 / 长宽高 / 绕各轴弧度；`extra="allow"` 容纳扩展 |
| `point_mask_3d` | `PointMaskGeometry` | `point_indices: list[int]`              | 指向点云的非负整数索引；`extra="forbid"`           |

旧 2D 几何（bbox / polygon / …）不受影响。前端强类型由 OpenAPI codegen 落到 `apps/web/src/api/generated/`；手写业务 union（`apps/web/src/types/index.ts`）暂不并入，待 v0.13.2 前端引入 3D 工作台时再加（避免逼迫现有 2D 窄化逻辑处理 3D 分支）。

## G4 · 工具单位 + file_type

- **工具单位**（`ToolUnitId` / `TOOL_UNIT_IDS`）：`lidar_box_3d` 从「留位」转为后端可用；新增 `point_mask_3d`。
- **file_type**：`services/dataset.py` 的 `_infer_file_type_from_ext` 放开点云扩展名 `.pcd` / `.bin` / `.las` / `.ply` → `file_type = "point_cloud"`（对应 `DatasetDataType.POINT_CLOUD`）。

## G6 · 跨模态身份：复用 `Annotation.track_id`

<!-- since v0.21.2 · ADR-0045：跨模态身份从 group_id 迁到独立 track_id 列，group_id 列 / group 端点已下线 -->

**不新增任何模型**。同一物理物体的「3D 框 + 各相机 2D 框」共享同一 `Annotation.track_id`，聚为一个逻辑对象（等价 xtreme1 的 trackId / SUSTechPOINTS 的 obj_id）。

约定：

- 在 3D 工作台新建一个物体时，先分配一个 `track_id`（`_new_track_id()` 产出 `trk_<uuid.hex>`）。
- 该物体的 3D `box_3d` 标注与投影到各相机视图后生成 / 校正的 2D 标注，全部写入**同一** `track_id`。
- 跨模态联动（选中 3D 框高亮各 2D 框、批量改类别）按 `track_id` 聚合查询，无需新表或新外键。

> 投影本身（标定驱动 3D→2D）是 v0.13.4 前端工作；v0.13.0 仅约定身份字段，不预存投影结果。

## 点云查看器 manifest API + 前端模块（v0.13.2）

前端 3D 舞台经一个 manifest 端点拿渲染所需的一切：

```
GET /tasks/{id}/point-cloud/manifest   (project.data_type=="lidar"，否则 409)
  → { point_cloud_url,                 # 主点云 presigned URL（datasets bucket）
      point_cloud_format: "pcd",
      cameras: [{ name, role, image_url, calibration: SensorCalibration | null }],
      expires_in }
```

实现：`api/v1/tasks/video.py` 用 `get_linked_items` 取 link → 主点云（无 `primary_lidar` link 时回退 `task.file_path`）+ 各相机 presign + `metadata_["calibration"]`（非法降级 None）。

### 可信 KITTI 导出合同

点云 KITTI 不直接把平台 ISO 框当成 camera frame。导出按每个 task 的主点云 Dataset 读取 `axis_convention`，先用 `R_normᵀ` 把 ISO 角点映射回数据源 LiDAR 轴，再依次应用用户显式选择的 camera role 对应 `extrinsic`、可选 `rect` 与 `intrinsic`。`label_2` 的二维框来自近裁剪面裁剪后的 8 角点 / 12 边投影；`location` 使用相机坐标下的底面中心，完全不可见对象进入 `export_report.json`。

项目和批次导出在创建 `AsyncJob` 前共用严格预检，worker 在查缓存和打包前重复检查。缺主点云、未声明或不可信的轴约定、缺所选相机帧、非法标定、缺图像宽高都会返回稳定 issue code；不得用 identity matrix、`.unverified` 文件或负数 bbox 代替失败。nuScenes 目标在真实 scene / timestamp / ego pose 合同完成前返回 `nuscenes_export_not_trusted`。

前端(双画布架构,ADR-0031):`project.type_key === "lidar"` → `WorkbenchStageHost` 的 `3d` 分支 → lazy `ThreeDWorkbench`(独立 `vendor-three` chunk,不进主 bundle)。裸 Three.js 封装 `PointCloudScene`，由持久 Worker 解析 PCD、归一化轴向、抽稀并生成高度色；主视图负责 OrbitControls、框图层和资源生命周期。默认使用 Legacy WebGL2，设置中的本地实验开关可让主视图与三视图共同使用异步 WebGPU renderer、实例化点精灵和相机纹理直采样；切帧时旧实例立即归零，场景级实例缓冲与固定六路相机采样 TSL 拓扑继续复用，只更新点属性、纹理和标定 uniform。实验路径只生成 GPU 需要的 depth-only 遮挡栅格，并在 8 MiB / 8-key LRU 中与相邻帧预取合并，Legacy 和 WebGL2 fallback 不触发该预取。初始化失败或 device lost 会回退 Legacy。模块在 `apps/web/src/pages/Workbench/stages/three-d/`,与 Konva `stage/` 隔离。

开发 seed 的 nuScenes 导入器把每点五个 float 的 `.pcd.bin` 转为只保留 XYZ 的 little-endian binary PCD，并在 dataset source metadata 中记录 `pcd_encoding=binary_xyz_f32`。对缺少该标记的既有 scene 再次执行 seed 时，导入器会按 `frame_index` 原位覆盖点云对象、同步大小与内容哈希，但不会重建 task 或 annotation。Scene 时间轴在点击帧后先等待该目标帧的 PCD、相机位图及实验路径深度资源预取完成，再开始任务导航；预取失败会被吞掉并继续导航，不改变可用性。

渲染链在 geometry 与相机颜色跨过实际绘制边界后写入 `aap:pointcloud:geometry-ready` 和
`aap:pointcloud:camera-color-ready` Performance mark，便于在 DevTools trace 中区分 PCD/geometry
等待与相机上色等待。开发环境可用 `pointcloud:renderer-bench` 对同一 nuScenes Scene 分别刷新
Legacy 与实验 renderer；必须同时提供 `POINTCLOUD_BENCH_PROJECT_ID` 和
`POINTCLOUD_BENCH_TASK_ID`。报告中的 `runValidity` 只说明样本可信，只有 `promotionGate.passed`
才表示本机样本达到推广门；实验开关仍需跨 OS/GPU 资格后才能转为默认功能。

> 只读;3D 框标注(v0.13.3)与标定驱动投影联动(v0.13.4)后续。

## 3D 框标注链路(v0.13.3)

把只读查看器升级为**可标注**:在 3D 工作台画 / 选 / 编辑 `box_3d` 框,经现有标注 CRUD 持久化。**后端零改动、零新端点、零迁移**(链路在 v0.13.0 已备好),全部是前端 + 一处设置解禁。交互形态决策见 ADR-0032。

### 持久化 payload(复用既有标注 API)

```jsonc
POST /tasks/{id}/annotations            // 创建; PATCH .../{aid} 更新, DELETE 软删
{ "annotation_type": "box_3d",
  "tool_unit_id": "lidar_box_3d",        // 类别 / 属性绑定挂在此 unit 下
  "class_name": "car",
  "geometry": { "type": "box_3d",
    "center": [x, y, z],                 // 米, 点云 Z-up
    "size":   [长, 宽, 高],
    "rotation": [0, 0, yaw] } }          // 7-DoF: 仅 rotation[2]=yaw(绕 Z)可编辑
```

- **类别校验**:service 层 `_validate_class_name` 按 `lookup_classes_for_tool_unit(tool_bindings, "lidar_box_3d")` 校验,非集合内类别 422;空 `tool_bindings` 放行(向后兼容)。与 2D 同一条路径,无 3D 专用分支。测试:`apps/api/tests/test_pointcloud_box3d_annotation.py`(创建命中 / 422 / 空放行),几何判别联合分发由 `test_jsonb_strong_types.py::test_geometry_union_dispatches_3d_types` 锁。
- **设置解禁**:`lidar` 项目在建项目向导 / 项目设置可启用 `lidar_box_3d` 并配类别(`toolUnits.ts` 映射 `data_type==="lidar" → ["lidar_box_3d"]`,向导按 `available` 过滤,v0.13.3 起 `available=true`)。

### 编辑交互(主视图 gizmo + 数值面板,ADR-0032 方案 A)

- **渲染 + 选中**:`PointCloudScene` 框图层每框一个 Group(线框 + 半透拾取 Mesh,`depthTest:false` 始终画在点云之上),`Raycaster` 拾取选中。PSR 用 Group 的 position/quaternion/scale 表示(让 `TransformControls` 直接驱动)。
- **编辑**:选中后官方 `TransformControls`(W 平移 / E 绕 Z 转 / R 缩放)+ 右上 PSR 数值面板,两者经选中框 PSR 单一真值双向同步;缩放 gizmo 翻转出的负尺寸取绝对值兜底(下限 0.05m),避免框翻转 / 卡住面板 `size>0` 提交校验。
- **放置**:「放置框 (B)」切换 → 点地面射线打 `z=groundZ` 水平面(`groundZ` 由 z 直方图低分位估计,避免默认框悬浮)→ 默认尺寸框 → 持久化 → 自动选中精修。透视拖拽不准,故落点 + 默认尺寸 + 数值面板精修,不做拖画足迹。
- **只读**:锁定 task / viewer(`readOnly`,壳层透传)不放置 / 不挂 gizmo / 面板禁用,仅可选中查看数值。

### PSR↔角点纯函数(为 v0.13.4 投影预留)

`three-d/geometry/box3d.ts`(移植 SUSTechPOINTS 矩阵,无框架依赖,带单测):`boxToMatrix4` / `psrToCorners` 算 8 角点与朝向。v0.13.4 标定驱动 3D→2D 投影复用同一套约定(欧拉角顺序 `XYZ`、yaw=`rotation[2]`),约定一旦漂移投影必偏。

## 投影联动:3D 框 → 相机视图(v0.13.4)

把 3D 框经相机标定**实时**投影到各相机图上画线框,标注员对照图像确认 / 校正 3D 框。**后端零改动、零新端点、零迁移、不预存投影**:标定已在 `DatasetItem.metadata_`(G2)、manifest 的 `cameras[].calibration` 直出;前端每次按标定现算。前端为主,详见 ADR-0033。

### 投影链(纯函数 `three-d/geometry/projection.ts`)

世界点 `p=[x,y,z]`(lidar 系、米)→ 相机像素,与 SUSTechPOINTS `image.js#points3d_homo_to_image2d` + `util.js#matmul` **逐字对齐**:

```
p_cam   = extrinsic · [x, y, z, 1]ᵀ      // extrinsic: 行主序 4x4 lidar→camera 外参
p_cam   = rect · p_cam   (KITTI 有 rect)  // 可选矫正, 行主序 4x4
[u,v,w] = intrinsic · p_cam.xyz          // intrinsic: 行主序 3x3 内参
pixel   = [u/w, v/w]                       // 透视除法; 像素原点左上(u 右、v 下)
visible = w > 0                            // 相机前方; w<=0(后方)剔除该角点
```

- `projectPoints(points, calib) → { pixels, visible }`:接受 `THREE.Vector3[]` 或 `[x,y,z][]`。**手写行主序矩阵·向量**(`THREE.Matrix4.elements` 是列主序,直接喂行主序标定会被转置而出错)。
- `BOX_EDGES`:12 条边索引表(底面环 / 顶面环 / 4 竖棱),基于 `box3d.ts` 角点顺序;overlay 据此连线。
- **坐标约定锁死(漂移即偏)**:extrinsic 方向 lidar→cam、`rect` 在 extrinsic 之后、像素原点左上、欧拉顺序 `XYZ`。
- **欧拉顺序差异**:SUSTech 默认 `ZYX` 与 box3d.ts 的 `XYZ` 仅在 pitch/roll 非零时不同;7-DoF 只编辑 yaw(rx=ry=0)时退化为同一 `Rz`,角点一致。投影链本身与欧拉顺序无关。
- **对拍验证**:`projection.test.ts` 用 `third-party/SUSTechPOINTS/data/example/calib/camera/front.json` 真实标定 + 同 scene yaw-only 框,`psrToCorners`→`projectPoints` 与移植的 SUSTech oracle 逐角点像素一致(epic 验证策略)。

### overlay 渲染 + 缩放(`CameraProjectionView.tsx`)

- 相机图 `<img>` 上叠等尺寸 `<canvas>`,消费**同一份** `annotations`(经 `boxes`)+ `highlightedIds`;3D 框改 PSR / 改类 / 选中变化即重绘(`useUpdateAnnotation` **乐观更新**会即时写缓存,故面板 / gizmo / 列表改框后 overlay 立即跟随)。
- **缩放**:`intrinsic` 基于图像**原始分辨率**,投影像素是原图坐标;overlay 按 `clientWidth/naturalWidth` 比例缩放绘制,`ResizeObserver` + `onLoad` 重算。`devicePixelRatio` 适配高清屏。
- **可见性**:全角点在相机后方 / 全不可见 → 该相机不画此框;部分可见 → 只连两端都可见的边(MVP 不做画面裁剪)。无 `calibration` 的相机降级不画、不报错(承 ADR-0030)。

### 选中联动 + 跨模态身份

- **3D→2D**:选中 3D 框 → 各相机投影框高亮(白描边加粗 + 淡填充),承共享 `selectedId`。
- **2D→3D 反选**:点相机里的投影框 → 命中测试(投影包围盒含点、取最小面积框)→ `onSelectBox` 选中对应 3D 框。
- **最佳相机提示**:选中框按可见角点数统计被几个相机看到,状态条显示「投影可见于 N 相机 · 正对 X」,最正对相机 figcaption 标「· 正对」。
- **`track_id` 聚合高亮**:overlay 高亮集合 = 选中框 + 同 `track_id` 成员(G6)。本切片只打通身份可视化:相机视图上**独立绘制 / 编辑 2D 框成员**留后续。新建 3D 框即由 `_new_track_id()` 分配一个 `track_id`(不再需要「≥2 个成员才能成组」的旧编组端点);`track_id` 为空的孤立框退化为仅高亮自身,待 2D 成员落地再聚合。<!-- since v0.21.2 · ADR-0045：原按 group_id + /annotations/group 端点，编组下线后统一到 track_id -->

## Scene 跨帧传播任务

长区间的 `box_3d` 传播使用统一 `AsyncJob` 持久化，`kind=point_cloud_cross_frame`。作业 payload 保存 Scene、源 task、源 annotation 的 `id + version` 快照、显式 scope / direction / 闭区间和目标帧快照；result 按帧记录 success / skipped / failed / stale / cancelled 及新建标注数。

每个目标 task 是独立提交边界。写入前会重新检查用户权限、task 可编辑性与源标注版本；已有同 `track_id` 活跃框的目标帧使用 `skip_existing` 跳过。源版本发生外部变化时，当前与后续未执行帧进入 stale，不再继续读取新几何。取消是协作式的：已提交帧保留，剩余帧终结为 cancelled。

`point_mask_3d` 不能复用跨帧点索引，因此不进入该传播合同；registration 和轨迹拆分 / 合并也保持为独立后续能力。
