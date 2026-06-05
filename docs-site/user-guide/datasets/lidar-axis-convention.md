---
audience: [admin, superadmin]
type: how-to
since: v0.13.11
status: stable
last_reviewed: 2026-06-05
---

# 点云数据集的 lidar 坐标系约定

如果你打开 3D 工作台后发现 **BEV 俯视下车头不朝屏幕上方**、或者**画框出来的 yaw=0 朝向与车身长轴完全错位**,绝大多数情况下不是平台或标定的 bug,而是数据集的 **lidar/world 坐标系约定** 与平台内部约定不一致。

## 平台内部约定

平台所有 3D 几何代码均假设 **ISO 8855 / SAE J670** 标准:

| 轴 | 方向 |
|---|---|
| +X | 车头(前) |
| +Y | 车左 |
| +Z | 天 |

右手坐标系。Autoware / nuScenes / Waymo / ROS REP-103 默认即此。

## 业界常见的非 ISO 约定

| 来源 | 约定 |
|---|---|
| KITTI camera-as-world | +X 右 / +Y 下 / +Z 前 |
| Apollo | +X 右 / +Y 前 / +Z 上 |
| Velodyne SDK 原始系 | +X 右 / +Y 前 / +Z 上 |
| SUSTechPOINTS 示例数据 | +X 车左 / +Y 车后 / +Z 天 |
| OpenCV 相机系 | +X 右 / +Y 下 / +Z 前 |

只要数据集不是 ISO 8855,直接上传后 3D 工作台的 BEV 一定会"歪"。

## 处理方式

平台采用**加载侧归一化**:你声明数据集来自哪种约定,前端在打开 3D 工作台时**自动**把点云与相机外参旋转到 ISO 8855。原始文件(PCD / calib JSON)不会被改写。

### 创建数据集时声明

`POST /datasets` 接口现支持 `axis_convention` 字段:

```json
{
  "name": "scene-001",
  "data_type": "lidar",
  "axis_convention": "sustechpoints_demo"
}
```

可选值:

- `iso_8855` (默认) / `ros_rep103` — 标准约定,identity
- `kitti_camera` / `opencv_camera` — KITTI / OpenCV 相机系
- `apollo` / `y_forward` — +Y 朝前
- `sustechpoints_demo` — SUSTechPOINTS 自带示例数据
- `raw` — 不归一化,平台不为该数据集承诺 ISO(用于无法归一化的特殊情况)

### 已上传数据集的修改

`PUT /datasets/{id}` 也支持 `axis_convention` 字段。无 UI 入口前可直接走 API,或在 dev 环境用 SQL:

```sql
UPDATE datasets
SET metadata = jsonb_set(metadata, '{axis_convention}', '"sustechpoints_demo"')
WHERE name = 'scene-001';
```

修改后**刷新 3D 工作台**即可看到正确朝向的 BEV。

### 如何判断该选哪个约定

如果数据集里有 front 相机 (named "front" 或类似):

1. 找到 `calib/camera/front.json`,看 `extrinsic` 的第 3 行前两个数(row-major):
   ```
   [e0, e1, e2, e3,
    e4, e5, e6, e7,
    e8, e9, e10, e11,    ← (e8, e9) = front 相机光轴在 world 系的水平投影
    0, 0, 0, 1]
   ```
2. 该向量代表"车头方向"在 lidar 世界系下的指向:
   - `(1, 0)` → 车头朝 +X → **`iso_8855`** ✓
   - `(0, 1)` → 车头朝 +Y → **`apollo`** / `y_forward`
   - `(0, -1)` → 车头朝 -Y → **`sustechpoints_demo`**
   - 其它 → 看上述「业界常见」表对照

未来版本会加上**自动嗅探**(`POST /datasets/{id}/sniff-axis-convention`)与**数据集设置 UI**,届时无需手算。

## 影响范围

声明 `axis_convention` 后:

- ✓ BEV 俯视(`俯视` 按钮)车头朝屏幕正上方
- ✓ 框选画框生成的初始 PSR(`yaw=0`) 沿车身长轴对齐
- ✓ 三视图 (Top / Side / Front) 视角与车身真实长 / 宽 / 高对齐
- ✓ 相机投影联动方向正确

### 历史标注

v0.13.11 之前已经标注的 3D 框,**当时是按 ISO 假设画的**(几何代码一直锁死 ISO),所以它们存的 PSR 对应的就是"用户当时屏幕上看到的"。给数据集设定新 convention 后,旧框会被按新 convention 重投影显示——若你确认旧框已经匹配点云(说明数据集本来就是 ISO),保持 `axis_convention=iso_8855` 即可,旧框不动。若新 convention 把旧框带歪,需要重新审标或在数据集设置回 `iso_8855`。

未来版本会在切换 convention 时提示该警告并提供"按新 convention 重投影旧框"工具。

## 相关

- 架构决策: [`docs/adr/0034-lidar-axis-convention.md`](../../adr/0034-lidar-axis-convention.md)
- 实现计划: [`docs/plans/2026-06-05-v0.13.11-lidar-axis-convention.md`](../../plans/2026-06-05-v0.13.11-lidar-axis-convention.md)
