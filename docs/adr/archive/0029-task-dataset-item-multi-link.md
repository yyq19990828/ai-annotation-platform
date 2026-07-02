# 0029 — 点云任务-数据项多文件关联用中间表（保留 2D 1:1）

- **Status:** Accepted
- **Date:** 2026-06-02
- **Deciders:** core team
- **Supersedes:** —

## Context

平台原模型里一个 `Task` 通过 `task.dataset_item_id` 关联**唯一**一个数据项（1:1），契合 2D 单图 / 单视频任务。

LiDAR 点云 + 相机图像联合标注要求一个任务（一帧 scene）同时挂**多个**数据项：一份主点云 + N 路相机图像，且每个关联要带「这是什么传感器」的语义（主点云 / 前视相机 / …）。1:1 的 `dataset_item_id` 无法表达。

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **方案 A：新增 `TaskDatasetItemLink` 中间表** | 1:N 干净建模，带 `role`/`sensor_name`；2D 路径零改动 | 多一张表；查询/导出需区分 1:1 与 1:N |
| 方案 B：`task.dataset_item_ids` 改 JSONB 数组 | 不加表 | 丢外键完整性；role 语义塞数组里难查询；破坏现有 1:1 列 |
| 方案 C：`dataset_items` 加 `task_id` 反向列 | 不加表 | 一个 item 只能属一个 task，无法跨任务复用；语义反了 |

## Decision

采用**方案 A**：新增中间表 `task_dataset_item_links`，与现有 1:1 路径**并存**。

表结构（迁移 `0094_task_dataset_item_links.py`）：

```
task_dataset_item_links(
  id, task_id FK→tasks(CASCADE), dataset_item_id FK→dataset_items(CASCADE),
  role str not null, sensor_name str null, created_at,
  UNIQUE(task_id, role)
)
```

关键落地约束：

1. **共存分流**：2D 单文件 task 继续用 `task.dataset_item_id`（1:1，不动）；3D 多文件 task 用 link 表。service 层按 `project.data_type` 选路径。
2. **`role` 约定**：`primary_lidar` 或 `camera_<name>`。校验在 **service 层**（`task_dataset_link.py:_validate_role`），**不加 DB CheckConstraint** —— `camera_<name>` 开放后缀不可枚举。
3. **`UNIQUE(task_id, role)`**：一个 task 每个传感器槽位仅一个 item（DB 层兜底）。
4. service 接口：`link_items(session, task_id, [(item_id, role, sensor_name)])` / `get_linked_items(session, task_id)`。

## Consequences

正向：

- 1:N 关联干净、带语义，外键完整性 + 级联删除（`apps/api/app/db/models/task_dataset_item_link.py`）。
- 现有 2D 图像/视频流程**零改动**，`task.dataset_item_id` 1:1 路径完整保留。
- 为 v0.13.1 统一资产导入（一套 scene 目录建 link）与 v0.13.4 跨模态投影联动铺好地基。

负向：

- 消费方（查询 / 导出 / 调度）若假设「task 必有单一 dataset_item」，需排查并兼容多 item；本切片只建表 + service 接口，消费方改造随 v0.13.1 导入落地时验证。
- 同一物体跨模态身份不靠本表，而复用 `Annotation.group_id`（见 `docs-site/dev/reference/point-cloud-data-model.md` G6）。

## Notes

- 实现代码：`apps/api/app/db/models/task_dataset_item_link.py`、`apps/api/app/services/task_dataset_link.py`
- 迁移：`apps/api/alembic/versions/0094_task_dataset_item_links.py`
- 相关：调研 `docs/research/14-point-cloud-image-fusion.md` §14.8.3 第 1 层；Epic `docs/plans/2026-06-02-v0.13.x-point-cloud-workbench-epic.md`；数据模型参考 `docs-site/dev/reference/point-cloud-data-model.md`
- 后续：标定存储约定（G2，`SensorCalibration` 进 `DatasetItem.metadata_`）与双画布前端架构将各补一条 ADR（v0.13.1 / v0.13.2）。
