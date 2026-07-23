# 点云 + 图像联合标注:多模态融合方案调研

> 补充调研。面向自动驾驶 / 机器人 / AR 场景下「LiDAR 点云 + 相机图像」联合标注的需求,梳理技术原理,**对三个开源工具(SUSTechPOINTS / xtreme1 / CVAT)做了源码级拆解**,并对本平台落地做 gap 分析与改动评估。
>
> 调研者:Claude · 调研日期:2026-06-02
>
> 源码副本拉取到 `third-party/`(已 gitignore,浅克隆当前 HEAD)。下文行号以本地副本为准,供查阅;上游版本演进后可能漂移。

---

## 14.1 为什么要联合标注

单一模态各有硬伤,联合标注的本质是「用图像的语义判别力 + 点云的几何精度,产出同一物体在 2D 与 3D 之间一一对应的标签」。这是训练多模态融合模型(BEVFusion / TransFusion / DeepInteraction 等)的刚需。

| 模态            | 优势                                           | 短板                                         |
| --------------- | ---------------------------------------------- | -------------------------------------------- |
| 图像 (2D)       | 纹理 / 颜色 / 语义丰富,远处目标可见,标注成本低 | 无深度,受光照与遮挡影响,无法直接定位三维位置 |
| 点云 (3D LiDAR) | 精确的几何 / 距离 / 尺寸,不受光照影响          | 稀疏(远处尤甚)、无颜色纹理、小目标难辨       |

联合标注区别于「分别标两次」的核心价值:**跨模态 ID 一致** —— 同一物体在 3D 框和各相机 2D 框上是同一个对象,共享 track_id 与属性。

---

## 14.2 技术前提:标定与坐标系

联合标注能成立,依赖三件事,缺一不可:

```
内参 Intrinsics K   相机焦距 / 主点 / 畸变系数      —— 3D 相机坐标 → 2D 像素
外参 Extrinsics R|t LiDAR 坐标系 → 相机坐标系的刚体变换 —— 把点云搬到相机视角
时间同步 Sync       LiDAR 一帧(~10Hz)与相机曝光时刻对齐 —— 否则运动物体错位
```

任意 LiDAR 点 `P_lidar` 投影到像素的链路:

```
P_cam   = R · P_lidar + t          # 外参:换坐标系
p_pixel = K · P_cam (归一化 + 畸变校正)  # 内参:投影到像面
```

这套变换是所有「3D 框自动映射成 2D 框」「点云着色」「2D 框抬升成 3D」功能的数学地基。**没有标定数据,联合标注退化成两套互不相关的标注**(CVAT 就停在这一步,详见 §14.7.3)。

---

## 14.3 标注对象类型

| 类型               | 几何表达                            | 典型场景                         |
| ------------------ | ----------------------------------- | -------------------------------- |
| 3D 检测框          | 7-DoF 立方体:`x,y,z + 长宽高 + yaw` | 车辆 / 行人 / 骑行者检测(最常见) |
| 3D 语义 / 实例分割 | 逐点类别标签 (point-wise)           | 可行驶区域 / 地面 / 植被         |
| 3D 跟踪            | 跨帧同一 `track_id` 的框序列        | 多目标跟踪、轨迹预测             |
| 2D-3D 联合关键点   | 3D 关键点 + 拓扑                    | 人体姿态、车辆朝向标定           |

> 3D 框最常用,通常假设物体只绕竖直轴旋转(仅 yaw),即 7-DoF;少数场景用全 9-DoF(含 pitch/roll)。三个被调研工具都保留了完整的 3 个旋转分量(见 §14.7),退化成 7-DoF 只是把 pitch/roll 置零。

---

## 14.4 三种工作流范式(由弱到强)

**(a) 投影辅助标注(主流)**

- 主标注在点云里画 3D 框,系统用外参把 8 个角点投影到各相机,自动生成 2D 框 / 朝向。
- 标注员只在图像上微调,2D-3D ID 天然一致。SUSTechPOINTS、xtreme1 都是这条路。

**(b) 点云着色 / 深度反投影**

- 把图像 RGB「喷」到点云上,帮标注员在 3D 里靠颜色辨认物体;反之可把点云深度叠到图像做提示。

**(c) 多视角联动校验**

- 一个物体同时在 LiDAR + 多相机(nuScenes 6 相机、Waymo 5 相机)可见,任一视图调整,其它实时同步。

辅助技巧:**多帧聚合(densification)** —— 用 ego-pose 把连续多帧点云拼到统一时刻,让静态物体点更密,便于精确画框;运动物体则需 **motion compensation** 去畸变。SUSTechPOINTS 通过 batch 模式 + Kalman/线性插值实现跨帧标注(§14.7.1)。

---

## 14.5 关键难点

1. **标定误差累积** —— 外参不准则投影框偏移,标注员对着错的辅助框标。需提供投影微调 / 标定可视化校验。
2. **时间不同步** —— 高速物体在 LiDAR 与图像间错位,需基于 ego-pose 做运动补偿。
3. **遮挡与截断** —— 物体仅在部分模态可见,需 `visible / occluded / truncated` 属性字段。
4. **稀疏远处目标** —— LiDAR 点太少难定框,需借图像先画 2D 框再抬升到 3D(frustum 约束)。
5. **跨模态 ID 一致性** —— 这是数据模型必须强约束的点,否则联合标注名存实亡。

---

## 14.6 数据集格式(可直接参考其 schema)

| 数据集         | 格式特点                                                               | 标定与关联                                          |
| -------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| **KITTI**      | 经典入门。`label_2` 把 2D + 3D 标签合一(含 `alpha` 观测角),点云 `.bin` | `calib` 文件存 P0-P3 / Tr_velo_to_cam               |
| **nuScenes**   | 关系型 schema,联合标注的黄金参考                                       | `calibrated_sensor` + `ego_pose` 显式建模每个传感器 |
| **Waymo Open** | protobuf,2D-3D 关联做得最细                                            | 每相机独立标定 + 逐帧位姿                           |

nuScenes 的 schema 拆分思路:

```
sample            一个时间切片(关键帧)
  ├─ sample_data       某传感器在该时刻的一份数据(一张图 / 一帧点云)
  │     └─ calibrated_sensor  该传感器的内外参快照
  │     └─ ego_pose           该时刻车体在全局坐标的位姿
  └─ sample_annotation 一个 3D 标注(跨传感器共享,挂 instance_token 做跨帧 ID)
```

关键洞察:**标定与位姿是「数据」而非「标注」**,应随数据项走;annotation 跨传感器共享、靠 instance/track token 串联。xtreme1 的 `SCENE → SINGLE_DATA` 层级(§14.7.2)正是这套思路的工程化实现。

---

## 14.7 开源工具源码级拆解

三个工具恰好构成一条由弱到强的谱系:**CVAT(只关联不投影)→ SUSTechPOINTS(轻量但完整投影)→ xtreme1(工程化最完整)**。

### 14.7.1 SUSTechPOINTS — 轻量标定投影参考实现

> `third-party/SUSTechPOINTS`(naurril/SUSTechPOINTS)。CherryPy 后端 + 原生 JS 前端,~55MB,代码聚焦,**投影数学是教科书级的最小实现,可直接移植**。

**目录约定**(一个 scene 一个目录):

```
scene_name/
├── lidar/        000950.pcd ...            # 每帧一个点云
├── camera/<cam>/ 000950.jpg ...            # front/left/right 多相机,各一子目录
├── calib/camera/<cam>.json                 # 每相机一份标定
└── label/        000950.json ...           # 每帧一个标注文件
```

**标定格式**(`calib/camera/front.json`)—— 极简,只有内外参:

```json
{
  "extrinsic": [16 个浮点],   // 4x4 LiDAR→Camera 变换,行主序
  "intrinsic": [9 个浮点]     // 3x3 相机内参 [fx 0 cx; 0 fy cy; 0 0 1]
}
```

外参由 `calibpy/pnp.py` 用 OpenCV `solvePnPRansac` 从点对求解后 `flatten().tolist()` 落盘。

**3D 框结构**(`label/<frame>.json`,数组,每元素一个框):

```json
{
  "psr": {
    "position": { "x": 4.14, "y": -49.72, "z": 1.83 }, // 世界坐标中心(米)
    "scale": { "x": 4.5, "y": 1.68, "z": 1.66 }, // 长宽高(米)
    "rotation": { "x": -0.05, "y": 0.003, "z": 1.45 } // 欧拉角(弧度),z 即 yaw
  },
  "obj_type": "Car",
  "obj_id": "8" // 场景内唯一,跨帧一致
}
```

**3D→2D 投影**(`public/js/image.js` `points3d_homo_to_image2d`,`util.js` 矩阵原语)—— 纯矩阵乘,无依赖:

```
psr_to_xyz(psr)          # 框 → 8 个角点(局部 → 世界,经欧拉角旋转矩阵)
→ matmul(extrinsic, pts) # 世界/LiDAR → 相机坐标
→ vector4to3 + matmul(intrinsic) # 投影到像面
→ vector3_normalize      # 透视除法 x/z, y/z → 像素
```

选中框时 `updateFocusedImageContext()` 自动投影到最佳相机,出界则不绘制。

**跨帧 / 跨模态 ID**:`obj_id` 场景内唯一,所有帧共享 → 天然的 track。batch 模式(默认 20 帧)支持线性插值(`trajectory.py interpolate`)与 Kalman 预测(`annotator="K"`),并可一键同步同 id 物体的类型/属性。

**借鉴点**:标定 JSON 结构与投影算法可几乎原样移植到我们前端(纯计算,无框架绑定);PSR 表示法直观易做几何变换。

### 14.7.2 xtreme1 — 工程化数据模型参考

> `third-party/xtreme1`(basicai/xtreme1)。Spring Boot + MyBatis-Plus + MySQL + MinIO 后端,Vue3 + TypeScript + **Three.js** 前端(`pc-tool` 含融合标注)。数据模型最完整,**直接回答我们「1 task ↔ N 数据项」该怎么建模**。

**多模态层级**(解决多文件关联的核心):

```
dataset (type=LIDAR_FUSION)
  └─ data (type=SCENE, parent_id=0)            # 一个场景
       └─ data (type=SINGLE_DATA, parent_id=scene)   # 每帧
            └─ content: JSON 文件树(FileNodeBO)        # 一帧内的「1 点云 + N 相机图 + 标定」
                 ├─ lidar_point_cloud/*.pcd
                 ├─ camera_image_0/*.jpg ...
                 └─ camera_config/*.json
```

- 一帧(SINGLE_DATA)通过 `data.content` 这棵 JSON 文件树,把点云、多相机图像、标定挂在一起 —— 不是加列,而是用结构化 JSON 表达「一个标注单元 = 多个文件」。
- `file` 表用 `relation` 枚举区分文件角色(`BINARY` / `BINARY_COMPRESSED` / `POINT_CLOUD_RENDER_IMAGE` / 各级缩略图)。
- 参考:`backend/.../entity/DataInfoBO.java`(FileNodeBO,~127-154)、`deploy/mysql/migration/V1__Create_tables.sql`。

**相机标定**(前端运行时结构,`pc-editor/type.ts` `IImgViewConfig`):

```typescript
cameraInternal: { fx, fy, cx, cy }   // 内参(拆成 4 标量)
cameraExternal: number[]             // 4x4 外参,16 元素行主序
imgSize: [w, h]; name: string        // 每相机一份
```

**3D 标注结构**(`pc-editor/type.ts` `IObjectV2.contour`,后端序列化进 `data_annotation_object.contour` JSON):

```typescript
contour: {
  center3D:  Vector3,   // [x,y,z]
  size3D:    Vector3,   // [长,宽,高]
  rotation3D:Vector3,   // 欧拉角
  viewIndex?: number,   // 属于哪个相机视图(2D 结果用)
  points?:   Vector2[]  // 2D 投影/框点
}
trackId, trackName, classId, classValues, modelConfidence
```

**投影**:前端用 Three.js,`Image2DRenderView` 维护 `matrixInternal`(K)、`matrixExternal`([R|t])、合成 `matrix = K·[R|t]`,`isBoxInImage()` 把 8 顶点 `applyMatrix4` 后判断是否落在图像内。**投影实时算,不预存结果。**

**跨模态/跨帧 ID**:`trackId`(全局唯一)+ `trackName`(如 "car_01")在应用层(`TrackManager`)管理,DB 仅存储;同物体跨帧、跨相机视图共享同一 `trackId`。

**导出**:`LidarFusionDataExportBO` = `{lidarPointClouds[], cameraImages[], cameraConfig}`,把点云 + 图像 + 标定 + 结果打成一包;另支持 COCO 转换。

**借鉴点**:`SCENE / SINGLE_DATA / content 文件树` 三级结构 = nuScenes schema 的轻量工程化版,是我们 G1(多文件关联)最值得抄的范式;`contour{center3D,size3D,rotation3D}` + `trackId` 是 3D 几何 + 跨模态 ID 的成熟落地。

### 14.7.3 CVAT — 多文件关联完整,但**不做几何投影**(反面参照)

> `third-party/cvat`(cvat-ai/cvat)。结论先行:**CVAT 的 3D「联合」是逻辑参考图关联,不是标定投影**。这点对我们做差异化很关键。

**3D 任务建模**:`DimensionType` 枚举 `1d/2d/3d`(`engine/models.py:51-61`),Task 带 `dimension="3d"` + `media_type="point_cloud"`(`models.py:951-955`)。

**多文件关联**(这块做得完整):

```python
class Image(models.Model):        # 一帧点云也存为 Image 记录
    data = FK(Data); path; frame
class RelatedFile(models.Model):  # 关联的上下文图像
    data = FK(Data); path
    images = ManyToManyField(Image)   # 点云帧 ↔ N 张参考图
```

导入时按目录结构 / 文件名推断关联(`utils/dataset_manifest/utils.py:156-260` `_find_related_images_3D`),支持 KITTI Raw、Supervisely(`pointcloud/` + `related_images/`)、自定义布局;`.bin` 自动转 `.pcd`。关联关系落在 manifest 的 `meta.related_images`。

**3D cuboid 结构**(`dataset_manager/bindings.py:2469`):

```python
points = (*position, *rotation, *scale, 0,0,0,0,0,0,0)  # 3+3+3 + 7 填充
```

注意区分:`ShapeType.CUBOID` 是 2D 投影的 8 点(16 坐标);`cuboid_3d` 才是上面的 10 参数 3D 表示。

**关键结论 — 无标定、无投影**(三重证据):

1. **数据库无任何标定字段** —— 没有内参/外参/CameraCalibration 模型,导入不接受 calib 文件。
2. **related_images 是纯路径关联** —— ManyToMany + manifest 路径列表,无 3D→2D 映射计算。
3. **前端 `cvat-canvas3d`(Three.js)无投影代码** —— 点云与参考图在各自画布并排显示,标注员在两边**手动分别标**,无自动对齐;代码中无内外参矩阵乘。

**借鉴点**:多文件关联的 `RelatedFile + ManyToMany` 是一种比 JSON 文件树更「关系型」的建模(可作我们 G1 的方案对照);目录约定 + manifest 的导入推断值得参考。**反面教训**:它停在「并排参考」,没有标定投影 —— 这恰是我们可以做出差异化价值的地方。

### 14.7.4 三者横向对比

| 维度           | SUSTechPOINTS                                | xtreme1                                       | CVAT                        |
| -------------- | -------------------------------------------- | --------------------------------------------- | --------------------------- |
| 技术栈         | CherryPy + 原生 JS                           | Spring Boot + MySQL + Vue3/Three.js           | Django + React/Three.js     |
| 多文件关联     | 目录约定(隐式)                               | ✅ SCENE/SINGLE_DATA + content 文件树         | ✅ RelatedFile + ManyToMany |
| 标定存储       | ✅ calib JSON `{extrinsic[16],intrinsic[9]}` | ✅ `cameraInternal{fx,fy,cx,cy}+External[16]` | ❌ 无                       |
| 3D↔2D 投影     | ✅ 纯矩阵乘,自动联动                         | ✅ Three.js Matrix4,实时                      | ❌ 不做(并排参考)           |
| 3D 框表示      | PSR(pos/scale/rot 欧拉角)                    | center3D/size3D/rotation3D                    | (pos[3],rot[3],scale[3])    |
| 跨帧/跨模态 ID | obj_id(场景唯一)                             | trackId + trackName                           | track(2D 体系为主)          |
| 多帧聚合/插值  | ✅ 线性 + Kalman                             | ✅ TrackManager                               | ✅ 2D track 插值            |
| 工程完成度     | 原型级                                       | 生产级                                        | 生产级                      |
| 对我们的价值   | 投影算法可移植                               | 数据模型可借鉴                                | 关联建模对照 + 反面教训     |

---

## 14.8 对本平台的现状梳理与改动评估

> 「评估要支持联合标注需改哪些地方」的核心。先看已就位的地基,再列缺口,改动建议接入 §14.7 的真实参考。

### 14.8.1 已就位的地基(架构早有预留)

| 能力                    | 现状                                                | 位置                                       |
| ----------------------- | --------------------------------------------------- | ------------------------------------------ |
| 媒体类型枚举含点云      | ✅ `DatasetDataType.POINT_CLOUD` 已定义             | `apps/api/app/db/enums.py`                 |
| 3D 框工具单位留位       | ✅ `ToolUnitId` 含 `lidar_box_3d`(前端未实现)       | `apps/api/app/schemas/_jsonb_types.py:169` |
| 项目类型含点云          | ✅ `ProjectTypeKey` 含 `"lidar"`                    | `apps/web/src/types/index.ts:31`           |
| 几何类型可扩展          | ✅ Geometry 用 discriminated union,加类型零迁移     | `_jsonb_types.py:328+`                     |
| 工具维度类别 / 属性绑定 | ✅ `tool_bindings` 按工具单位嵌套类别 + 属性 schema | `_jsonb_types.py:269`                      |

**结论:媒体维度 + 工具维度 + 几何 union 三层骨架都已为点云预留,联合标注不需要推倒重来。**

### 14.8.2 关键缺口(❌ = 当前不支持)

| #   | 缺口                       | 现状                                                 | 参考解法                                                                          |
| --- | -------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| G1  | **单任务单数据项**         | `Task ↔ DatasetItem` 是 1:1 (`task.dataset_item_id`) | xtreme1 的 SCENE/SINGLE_DATA + content 文件树;或 CVAT 的 RelatedFile M2M          |
| G2  | **无标定 / 位姿存储**      | `DatasetItem.metadata_` 自由 JSONB,无内外参          | SUSTechPOINTS `{extrinsic[16],intrinsic[9]}` 或 xtreme1 `cameraInternal/External` |
| G3  | **无 3D 几何类型**         | Geometry union 仅 2D                                 | 三者一致:中心 + 尺寸 + 旋转,统一成 `box_3d`                                       |
| G4  | **file_type 不含点云**     | `Task.file_type` 取值 `image`/`video`                | 放开 `.pcd/.bin/.las/.ply`;`.bin` 可仿 CVAT 转 `.pcd`                             |
| G5  | **前端无 3D 渲染 / 联动**  | 工作台只有 2D canvas                                 | SUSTechPOINTS 投影算法(纯矩阵)可移植;或 xtreme1 Three.js 路线                     |
| G6  | **跨模态 ID 一致性无约束** | annotation 挂单个 task                               | trackId/obj_id + 复用已有 `group_id` 字段                                         |

### 14.8.3 改动建议(分层,按依赖排序)

**第 1 层 · 数据关联(解 G1 / G6)** —— 最关键的结构决策

两种范式(对应 §14.7 两个工具),建议 A:

```python
# 方案 A(推荐,仿 xtreme1 content 文件树):一个 task 关联一组带角色的数据项
#   在 Task 或新中间表上挂:
class TaskDatasetItemLink(Base):
    task_id: UUID          # → tasks.id
    dataset_item_id: UUID  # → dataset_items.id
    role: str              # "primary_lidar" | "camera_front" | "camera_left" ...
    sensor_name: str       # 与标定的传感器名对齐

# 方案 B(仿 CVAT,更关系型):点云帧 ↔ N 参考图 的 ManyToMany
```

> 用 Annotation 已有的 `group_id` 把「一个物体的 3D 框 + 多相机 2D 框」聚成一个逻辑对象,天然解 G6 —— 等价于 xtreme1 的 `trackId`、SUSTechPOINTS 的 `obj_id`。

**第 2 层 · 标定与位姿(解 G2)** —— 结构化 DatasetItem 元数据

直接采用 SUSTechPOINTS / xtreme1 验证过的最小结构:

```python
class SensorCalibration(BaseModel):
    intrinsics: list[float]          # 9 (3x3 K) 或拆成 fx,fy,cx,cy(xtreme1 风格)
    extrinsics: list[float]          # 16 (4x4 LiDAR→cam),行主序
    distortion: list[float] | None
    ego_pose: list[float] | None     # 16 (4x4 车体→全局),多帧聚合用
```

存于 `DatasetItem.metadata_` 的约定 key 下(无需加列,但加 Pydantic 校验)。**这是 CVAT 缺失、而我们能做出差异化的地方。**

**第 3 层 · 几何类型(解 G3)** —— 往 union 加成员,零迁移

```python
class Box3DGeometry(BaseModel):
    type: Literal["box_3d"] = "box_3d"
    center: tuple[float, float, float]      # x, y, z
    size: tuple[float, float, float]        # 长, 宽, 高
    rotation: tuple[float, float, float]    # 欧拉角(7-DoF 时仅 yaw 非零)
    model_config = ConfigDict(extra="allow")

class PointMaskGeometry(BaseModel):
    type: Literal["point_mask_3d"] = "point_mask_3d"
    point_indices: list[int]
```

三个工具的 3D 框本质同构(中心+尺寸+旋转),此结构可与它们的导入导出互转。前端 `Geometry` union 同步加 TS 类型(codegen 自动产出)。

**第 4 层 · 工具单位(解 G4 / 启用 G3)**

- `Task.file_type` 放开点云扩展名;`lidar_box_3d` 从「留位」转可用,新增 `point_mask_3d`。
- 视情况新增 `ProjectTypeKey`:`"lidar-det"` / `"mm-lidar-rgb"`。

**第 5 层 · 前端(解 G5)** —— 工作量最大,独立专题

- 起步可直接移植 SUSTechPOINTS 的投影链(`psr_to_xyz → matmul(extrinsic) → matmul(intrinsic) → 透视除法`,纯计算无框架绑定),用第 2 层的标定实时投影。
- 进阶走 xtreme1 的 Three.js 路线:3D 主视图 + N 相机 2D 视图 + `K·[R|t]` 矩阵联动。
- 不要走 CVAT 的「并排手标」老路 —— 那等于没做联合。

### 14.8.4 工作量与风险评估

| 层         | 工作量 | 风险 | 说明                                       |
| ---------- | ------ | ---- | ------------------------------------------ |
| 1 数据关联 | 中     | 中   | 结构决策,影响导入/查询/导出,需先定方案 A/B |
| 2 标定位姿 | 中     | 低   | 加 Pydantic 子 schema,不动表结构           |
| 3 几何类型 | 低     | 低   | union 加成员,向后兼容                      |
| 4 工具单位 | 低     | 低   | 放开枚举 + 启用留位                        |
| 5 前端 3D  | **高** | 中   | 全新查看器 + 投影联动,占整体绝大部分       |

> 后端(层 1-4)整体中低风险,因架构已预留;**真正的重头在前端 3D 工作台**。建议先做后端骨架 + 移植 SUSTechPOINTS 式最小投影打通联动,再迭代分割 / 跟踪。

---

## 14.9 小结

1. 联合标注 = 标定地基 + 跨模态 ID 一致 + 多视图联动,三者缺一不可。
2. 源码调研给出清晰谱系:**CVAT 只关联不投影(反面)→ SUSTechPOINTS 轻量完整投影(算法可移植)→ xtreme1 工程化最完整(数据模型可借鉴)**。
3. 本平台三层骨架已为点云预留,后端改动以**新增**为主、几乎无破坏性迁移。
4. 最大缺口是 **任务-数据项 1:N 关联**(G1,抄 xtreme1)与 **标定存储 + 投影**(G2/G5,抄 SUSTechPOINTS) —— 后者正是 CVAT 没做、我们能做出差异化的点。
5. 前端 3D 查看器是真正的工作量大头,建议独立立项分期推进。

> 后续若推进,可在 [10-roadmap.md](./10-roadmap.md) 增列「多模态 / 3D」阶段,并在 [08-comparison-matrix.md](./08-comparison-matrix.md) 的「3D 点云」行更新本平台支持度。相关上游源码已留在 `third-party/`(gitignore),可随时复查。

---

## 14.10 技术选型:面向生产级的借鉴决策

> 本节是 §14.7 源码拆解 + §14.8 gap 分析的决策收口 —— 回答「要落地一个**生产级**平台,技术栈该借鉴谁」,直接驱动 v0.13.x 版本计划(见 `docs/plans/`)。

### 14.10.1 本平台技术栈现状(已确认)

| 层   | 栈                                                                                 |
| ---- | ---------------------------------------------------------------------------------- |
| 后端 | FastAPI + SQLAlchemy 2.0(async)+ Pydantic 2 + Alembic + Celery + PostgreSQL(JSONB) |
| 前端 | React 18 + TypeScript + Vite + Zustand + **Konva / react-konva**                   |

**硬约束**:Konva 是**纯 2D canvas 库,无 WebGL,渲染不了点云**。这一条决定一切 —— 3D 点云必须**新增 Three.js** 这一栈,Konva 撑不住。所以问题不是「整体抄谁」,而是分三层各取所长。

### 14.10.2 三层借鉴决策

| 层                  | 最该借鉴                        | 为什么                                                                                                                                                                                                                                    | 注意                                         |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **后端数据模型**    | **xtreme1**(设计)+ CVAT(可直译) | xtreme1 的 `SCENE/SINGLE_DATA/content 文件树 + trackId` 是三者里最生产级、最完整的多模态模型(直接答 G1);它是 Java,抄设计不抄代码。CVAT 是 **Django(同为 Python)**,`RelatedFile`/`DimensionType`/`cuboid_3d` 编码能较直接翻译成 SQLAlchemy | xtreme1 模型成熟;CVAT 同语言但**缺标定**     |
| **前端工程外壳**    | **CVAT**                        | 三者中**唯一 React + Three.js**(`cvat-canvas3d`),与本平台 React 栈契合度最高,任务/job/质检体系是生产级 React 标注平台范本                                                                                                                 | **CVAT 的 3D 不做投影**(只并排参考),这块不抄 |
| **标定 + 投影内核** | **SUSTechPOINTS**               | 投影是纯矩阵运算(`extrinsic[16] → intrinsic[9] → 透视除法`),**语言/框架无关,可直接移植**,是 CVAT 缺失、决定差异化的核心                                                                                                                   | 原型级工程,只取算法不取架构                  |

### 14.10.3 综合结论

**以 xtreme1 的数据模型为骨架,以 CVAT 的 React + Three.js 工程为前端外壳,以 SUSTechPOINTS 的标定投影为算法内核。** 没有任何一个能整体照搬:

- **xtreme1** 功能最全但技术栈完全不同(Java/Spring/Vue)→ 学架构,代码重写。
- **CVAT** 技术栈最契合(Python 后端 + React 前端)但 3D 是残缺品(无标定、无投影)→ 做整体工程参照,3D 部分要补。
- **SUSTechPOINTS** 算法最纯但非生产级 → 只移植投影那几百行。

### 14.10.4 两个要落地的前端选型

1. **裸 Three.js + 自包一层 React,不用 react-three-fiber。** 标注编辑器要精细控制相机、射线拾取、8 角点拖拽手柄、多视图同步,这类命令式交互用 r3f 的声明式反而别扭 —— CVAT(`cvat-canvas3d`)与 xtreme1(`pc-render`)**都用命令式裸 Three.js**,这是成熟选择的信号。
2. **两套画布并存,不强行统一。** 保留 Konva 做 2D 图像标注,新增 Three.js 做 3D 点云 —— 正如 xtreme1 把 `image-tool`(2D)与 `pc-tool`(3D)拆成两个独立 package。让 Konva 兼顾 3D 是死路。
