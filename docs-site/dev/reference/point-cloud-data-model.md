# 点云联合标注 · 后端数据模型

> v0.13.0 落地的后端数据地基。本切片纯新增、无前端可见变化，为后续「LiDAR 点云 + 相机图像联合标注工作台」（Epic v0.13.x）打底。
>
> 设计依据：调研 `docs/research/14-point-cloud-image-fusion.md` §14.8.3（仓库源码文档，非本站页面）。

## 概览

支持点云 + 图像联合标注需要四个后端原语，v0.13.0 一次落地：

| 缺口 | 落地物 | 位置 |
|---|---|---|
| G1 任务-数据项 1:N 关联 | `TaskDatasetItemLink` 中间表 | `app/db/models/task_dataset_item_link.py` |
| G3 3D 几何 | `Box3DGeometry` / `PointMaskGeometry` | `app/schemas/_jsonb_types.py` |
| G4 工具单位 / file_type | `lidar_box_3d`（启用）/ `point_mask_3d`（新增）；点云扩展名 | `_jsonb_types.py` / `services/dataset.py` |
| G6 跨模态 ID 约定 | 复用 `Annotation.group_id`（不改模型） | 见下文「跨模态身份」 |

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

## G3 · 3D 几何类型

加入 `Geometry` discriminated union（`Field(discriminator="type")`），零迁移（几何存 `annotations.geometry` JSONB）：

| `type` | 类 | 字段 | 备注 |
|---|---|---|---|
| `box_3d` | `Box3DGeometry` | `center[3]` / `size[3]` / `rotation[3]` | 米 / 长宽高 / 绕各轴弧度；`extra="allow"` 容纳扩展 |
| `point_mask_3d` | `PointMaskGeometry` | `point_indices: list[int]` | 指向点云的非负整数索引；`extra="forbid"` |

旧 2D 几何（bbox / polygon / …）不受影响。前端强类型由 OpenAPI codegen 落到 `apps/web/src/api/generated/`；手写业务 union（`apps/web/src/types/index.ts`）暂不并入，待 v0.13.2 前端引入 3D 工作台时再加（避免逼迫现有 2D 窄化逻辑处理 3D 分支）。

## G4 · 工具单位 + file_type

- **工具单位**（`ToolUnitId` / `TOOL_UNIT_IDS`）：`lidar_box_3d` 从「留位」转为后端可用；新增 `point_mask_3d`。
- **file_type**：`services/dataset.py` 的 `_infer_file_type_from_ext` 放开点云扩展名 `.pcd` / `.bin` / `.las` / `.ply` → `file_type = "point_cloud"`（对应 `DatasetDataType.POINT_CLOUD`）。

## G6 · 跨模态身份：复用 `Annotation.group_id`

**不新增任何模型**。同一物理物体的「3D 框 + 各相机 2D 框」共享同一 `Annotation.group_id`，聚为一个逻辑对象（等价 xtreme1 的 trackId / SUSTechPOINTS 的 obj_id）。

约定：

- 在 3D 工作台新建一个物体时，先分配一个 `group_id`（沿用现有 `POST /annotations/group` 的 `next_group_seq` 自增机制）。
- 该物体的 3D `box_3d` 标注与投影到各相机视图后生成 / 校正的 2D 标注，全部写入**同一** `group_id`。
- 跨模态联动（选中 3D 框高亮各 2D 框、批量改类别）按 `group_id` 聚合查询，无需新表或新外键。

> 投影本身（标定驱动 3D→2D）是 v0.13.4 前端工作；v0.13.0 仅约定身份字段，不预存投影结果。
