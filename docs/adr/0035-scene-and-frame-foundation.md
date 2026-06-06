# 0035 — Scene + frame_index 作为跨 task 时序帧序列地基

- **Status:** Accepted
- **Date:** 回填日期 2026-06-06（实际决策发生于 v0.14.0 阶段）
- **Deciders:** core team
- **Supersedes:** —

## Context

平台原本只有"单 task = 单数据项"的扁平视角：2D 单图、单视频、单帧点云各自独立成 task，task 之间没有"它们其实是同一段录像的连续帧"这层语义。

v0.14 要支撑的时序工作流要求把"一段被切成多个 task 的录像"显式建模：

- **3D 点云逐帧**：一段行车 scene 切成 N 帧，每帧一个 task；
- **2D 抽帧图像序列**：从视频/采集抽出的有序帧；
- **多段 mp4 拼接的长录像**。

这些场景共同需要三件事，而旧模型都给不了：

1. 跨 task 取"相邻帧"（工作台叠加/导航、`GET /tasks/{id}/neighbors`）；
2. 跨 task 把标注"传播到下一帧"（`propagate-to-task`）；
3. 派题时"同一段录像的下一帧优先派给同一人"（scene 连续派题）。

注意已有的 `VideoFrameIndex`（`apps/api/app/db/models/dataset.py:135`）只描述**单个视频文件内部**的帧（pts/keyframe/byte_offset），粒度是"一个 item 的帧索引"，无法表达"跨多个 task / 多个文件的帧序列身份"。

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **方案 A：新增 `Scene` 表 + `dataset_items.scene_id`/`frame_index`** | 显式时序身份；跨 task 帧查询 O(index)；2D/3D/多段录像共用一套抽象；DB 唯一性约束兜底 | 加一张表 + 两列 + 索引；导入器需正确写 scene/frame |
| 方案 B：靠文件名排序约定推断帧序 | 零 schema 改动 | 多 scene 同号帧文件名撞键、无显式 scene 边界、排序脆弱、跨 task 查询需全表扫 + 运行时解析 |
| 方案 C：复用 `VideoFrameIndex` | 不加表 | 粒度是"单 item 内视频帧"，无法表达跨 task / 跨文件的帧序列 |

## Decision

采用**方案 A**：新增 `Scene` 表作为"录像"抽象，`DatasetItem` 增 `scene_id` + `frame_index` 把每个数据项挂到某 scene 的某一帧。

核心 schema（迁移 `0096_scenes_and_frame_index.py`）：

```
scenes(
  id, display_id UNIQUE, dataset_id FK→datasets(CASCADE) index,
  name, source_format, source_metadata jsonb, created_by, created_at, updated_at,
  UNIQUE(dataset_id, name)            -- scene 名在数据集内唯一
)

dataset_items + scene_id FK→scenes(ON DELETE SET NULL), frame_index int null
  INDEX idx_dataset_items_scene_frame (scene_id, frame_index)
```

关键落地约束：

1. **`scene_id` 可空 + `SET NULL`**：历史数据零回归（旧 item `scene_id=NULL`），scene 删除不连带删 item。
2. **`(scene_id, frame_index)` 复合索引**：邻帧查询 / scene 连续派题 / `by_scene` 切分排序都走它。
3. **帧键全局唯一**：多 scene 数据集导入时，帧文件名 stem 必须全局唯一（加 scene 前缀），否则同号帧撞键漏建 task —— 这正是方案 B 的劣势在导入器里的具象（见 `apps/api/app/services/scene.py` 的 `group_frames`）。
4. **scene_mode 与数据集一致**：项目 `scene_mode` 需与数据集 `is_temporal`/`has_scenes` 一致，由 `apps/api/app/services/project_kind.py` 校验（迁移 `0098_scene_mode_and_is_temporal.py`）。

此地基之上的能力分别落在各模块（v0.14.1~v0.14.4）：

- 邻帧/传播：`task-module`（`/neighbors`、`propagate-to-task`）
- scene 连续派题：`scheduler-and-task-dispatch`（`prefer_same_scene_continuation` + `scene_continuation_window_min`，迁移 `0097`）
- by_scene 切分：`batch-module`（task `sequence_order` 来自 frame_index 顺序）

## Consequences

正向：

- 时序身份显式、可索引，邻帧/传播/连续派题/by_scene 切分都建立在同一抽象上，不再各自靠文件名约定。
- 2D 抽帧、3D 点云、多段录像三种形态共用一套 scene/frame 模型。
- `SET NULL` + 可空列让既有 2D/视频项目零回归。

负向：

- 导入器（`apps/api/app/services/scene.py`、数据集导入向导）必须正确建 scene 并写 `frame_index`、保证帧键全局唯一，否则静默漏帧。
- 消费方若假设"item 必属某 scene"会在历史数据上踩空 —— `scene_id` 可空是必须显式处理的分支。
- `VideoFrameIndex` 与 `Scene/frame_index` 两套帧概念并存，需注意语义区分（前者单 item 内，后者跨 task）。

## Alternatives Considered（详）

**方案 B（文件名排序）**：实现成本最低，但多 scene 数据集里不同 scene 的同号帧（如各自的 `0001.jpg`）会在按 stem 分组时撞键，导致漏建 task；且"哪些帧属同一段录像"没有显式边界，全靠隐式命名约定，脆弱且不可查询。这条限制在多 scene nuScenes 实测中直接暴露，不可接受。

**方案 C（复用 VideoFrameIndex）**：该表语义是"单个视频文件解码出的帧"（pts_ms / is_keyframe / byte_offset），绑定到单个 `dataset_item`。跨 task、跨文件的帧序列无法用它表达——它解决的是"视频内部寻帧"，不是"录像被切成多 task 后的帧序身份"。

## Notes

- 实现代码：`apps/api/app/db/models/dataset.py:51`（Scene）、`:113`（scene_id）、`:118`（frame_index）；`apps/api/app/services/scene.py`、`apps/api/app/services/scene_inference.py`、`apps/api/app/services/project_kind.py`
- 迁移：`0096_scenes_and_frame_index.py`、`0097_project_prefer_scene_and_group_seq.py`、`0098_scene_mode_and_is_temporal.py`
- 概念文档：`docs-site/dev/concepts/scene-and-frame-index.md`
- 相关 ADR：ADR-0029（task-dataset-item 多关联）、ADR-0030（标定进 metadata）、ADR-0018（视频帧服务边界）
- 相关计划：`docs/plans/2026-06-05-v0.14.0-scene-and-frame-index-foundation.md`、`docs/plans/2026-06-06-v0.15-temporal-fusion-roadmap.md`
- 后续：v0.15 时序融合（ego-pose、跨帧插值/批量传播）将在此地基上演进。
