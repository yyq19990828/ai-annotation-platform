# LiDAR 可信导出与多相机派生 2D 计划草案

> Status: research-draft
>
> Implementation authorization: no
>
> Version: unassigned；本草案不占版本号，也不恢复旧 v0.24.1 编号
>
> Finalization: 实施前必须执行 [`backlog/README.md`](README.md) 的“转定稿门”

## 1. 推荐结论

推荐把 KITTI、nuScenes 和 COCO 派生 2D 定义为**严格、可预检、缺关键数据即失败**的标准导出。标准格式不得再输出看似合法的假 bbox、零 timestamp、固定 scene token 或单位 ego pose；缺失数据要在导出前列出具体 scene / frame / camera 和修复方式。

`Annotation.geometry.type=box_3d` 继续是唯一 3D 几何真值。相机 2D 框在导出时由选定 calibration 即时派生，不默认回写数据库；持久化多模态对象若以后落地，则作为额外可审计真值参与残差检查，而不是取代 3D 投影。

## 2. 当前基线快照

`apps/api/app/services/exporting/lidar.py` 仍包含明确占位：

- KITTI `label_2` 的 bbox 由 `_kitti_bbox_placeholder()` 固定输出 `-1 -1 -1 -1`，传入的 camera calibration 未被消费。
- nuScenes-style `sample.timestamp` 固定为 `0`，`scene_token` 固定为 `aap-scene`。
- `ego_pose` 固定为零平移、单位四元数，并带旧版本占位说明。
- nuScenes annotation 已按 `track_id` 构造 instance，这是可保留的正确基础；frame context 尚未携带完整 scene / pose / timestamp。

点云 manifest 已能读取 scene、frame index、ego pose、camera calibration；转定稿必须确认 export packaging 是否完整透传这些数据，不能只改 serializer 签名。

## 3. 格式决策

### 3.1 KITTI

- 用户必须显式选择一个满足标定合同的 camera；无相机、多相机未选择或标定无效时预检失败。
- 把 ISO-frame cuboid 变换到 KITTI camera frame，计算 dimensions、location、rotation_y 和 alpha。
- 由 8 角点与 12 条边对近裁剪面裁剪后投影，得到原图坐标 bbox；按图像边界裁剪并计算 truncated。
- 完全在相机后方、投影退化或无图像尺寸时按明确 policy 跳过或失败；默认严格模式失败，不输出假 bbox。

### 3.2 nuScenes

- `Scene.id` 产生稳定 scene token；每个 frame 用真实 `timestamp_us`、prev / next 和 sample token。
- `SceneFramePose` 产生真实 ego translation / rotation；缺 pose 或 timestamp 的 frame 使该 scene 预检失败。
- calibration rotation 必须由完整外参矩阵转换，不再固定单位四元数。
- `track_id` 产生 instance；孤立 annotation 可有独立 instance，但报告中必须区分无 track 数据。
- sample_data filename、sensor、calibrated_sensor、ego_pose 和 sample 的引用完整可对账。

### 3.3 COCO 派生 2D

- 对每个显式选定 camera、每帧和每个 `box_3d` 即时投影 bbox，image id 包含 scene / frame / camera 身份。
- 输出中保留来源 3D annotation id、track_id、camera role 和 calibration revision 的平台扩展字段；标准消费者可忽略扩展。
- 完全不可见对象不生成 annotation，部分可见对象裁剪并记录 truncation / visibility。

## 4. 数据流

```text
Annotation(box_3d, track_id) ─┐
Scene + frame_index ──────────┼─► Export preflight ──失败──► 可定位缺口报告
SceneFramePose(timestamp, ego) ┤          │
Camera calibration + image size┘          ▼
                                  共享投影 / 坐标纯函数
                                    │       │       │
                                    ▼       ▼       ▼
                                  KITTI  nuScenes  COCO 2D
                                    │       │       │
                                    └───────┴───────┘
                                            ▼
                                  golden validator + package
```

前后端若各自实现投影，必须共享同一组语言无关 fixture 和容差，不能只靠“看起来相近”。

## 5. 范围

- 导出 preflight：格式、scene、frame、camera、pose、timestamp、image size、track 和 visibility 的可定位报告。
- 删除 KITTI 与 nuScenes 的假数据路径，补齐真实投影、pose、timestamp 和 token 关系。
- COCO 多相机派生 2D 及平台 lineage 扩展。
- golden fixtures、标准 validator、确定性 token / 排序和大 scene 内存边界。
- ExportModal 中按格式显示要求、相机选择、失败摘要和修复入口。

## 6. 非范围

- 不在数据库持久化每次导出的 2D 投影框。
- 不修复或猜测缺失 calibration、pose、timestamp；数据修复需独立导入 / 管理流程。
- 不支持任意自定义 KITTI / nuScenes 方言；先锁一个写明的标准子集。
- 不把 point mask 转成伪 cuboid，也不承诺 radar、map、sweep 或完整官方 nuScenes 数据库复刻。
- 不为兼容旧错误输出保留同名“宽松模式”。平台原生 JSON 导出可继续承载不完整数据，但标准格式必须诚实。

## 7. 推荐实现切片（转定稿后执行）

1. **共享 preflight 与 fixture**：先暴露所有占位和缺失数据，保持旧 serializer 不变，建立失败 oracle。
2. **KITTI 严格导出**：单相机选择、真实 bbox 和官方 / 独立 validator 对拍，可单独发布。
3. **nuScenes scene / pose / time**：扩展 frame context、稳定 token 和引用完整性，删除单位 pose。
4. **COCO 多相机派生 2D**：复用投影 fixture，补 lineage 与 ExportModal 选择。
5. **旧路径收口**：移除占位 helper、更新文档与 changelog，生产样本回归。

## 8. 验收方向

- 仓库中不再存在 `_kitti_bbox_placeholder`、固定 `aap-scene`、固定零 timestamp 或“identity placeholder”标准导出路径。
- 投影 round-trip 与前端 fixture 的像素误差在冻结容差内；近裁剪、相机后方、图像外和退化框均有测试。
- 缺一个 pose、timestamp、camera calibration 或 image size 时，预检指出精确 scene / frame / camera，压缩包不生成。
- nuScenes token 引用无悬挂，prev / next 对称，timestamp 单调；KITTI 字段和坐标由独立 reader 验证。
- 同一 snapshot 重复导出除生成时间等明确元数据外字节顺序稳定。
- 大 scene 打包不一次性把全部点云和投影结果常驻内存。

## 9. 风险与回滚

- 坐标系错误比导出失败更危险。严格失败、golden fixture 和独立 reader 是发布门，不接受人工看一两个框代替。
- 删除“宽松占位”可能暴露历史数据缺口，这是预期行为；UI 必须在启动前解释，而不是导出到一半才失败。
- 若新 serializer 回归，回滚方式是临时关闭受影响标准格式入口，不得恢复假字段输出。原生平台格式保持可用。

## 10. 转定稿专项检查

- 重新审计 `exporting/lidar.py`、packaging、project export API、ExportModal、SceneFramePose、calibration schema 与当前测试；占位可能已部分消失。
- 对照当前 ADR-0034 轴约定和所有导入器，确认 pose / extrinsic 的 frame、矩阵序和四元数顺序。
- 固定至少两套可再分发或内部长期保存的 KITTI / nuScenes 小夹具，并记录预期文件树和外部 validator 版本。
- 把每个格式拆成精确文件、测试命令、文档和回滚项；不得把三种格式绑成一次不可分割发布。
