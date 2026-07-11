---
audience: [developer]
type: reference
status: stable
last_reviewed: 2026-07-11
---

# Data Manager 查询与聚合

Data Manager 是项目范围内的 task-centric 只读 read model。任务查询、保存视图计数、聚合和匹配对象明细必须从同一个 visible-task scope 派生：项目负责人和超级管理员可见整个项目；其他成员只可见其批次权限允许的任务。

## 端点

| 端点 | 用途 |
|---|---|
| `GET /projects/{id}/data-manager/schema` | 返回项目能力、字段、操作符、列、排序和指标定义 |
| `POST /projects/{id}/tasks/query` | 按 task grain 过滤、排序和分页 |
| `POST /projects/{id}/data-manager/summary` | 对同一过滤范围做项目聚合，不受分页 offset 影响 |
| `POST /projects/{id}/tasks/{task_id}/data-manager/matches` | 返回命中的 annotation、prediction shape 或 tracker job 摘要，不返回 raw geometry |
| `/projects/{id}/task-views` | 保存和共享 filter/sort/columns 配置 |

`schema` 是前端字段和操作符的唯一真值。项目 profile 由 `data_type × scene_mode × enabled tool_bindings × attribute_schema` 组成；`type_key` 只提供 preset，不应作为唯一分流依据。

## Filter DSL

过滤树由 rule 或 group 组成：

```json
{
  "op": "and",
  "rules": [
    { "field": "task.keyword", "op": "contains", "value": "frame-0042" },
    { "field": "annotation.source", "op": "eq", "value": "prediction_based" },
    { "field": "annotation.attribute.bbox.color", "op": "eq", "value": "red" }
  ]
}
```

动态属性路径格式为：

```text
annotation.attribute.<tool_unit_id>.<attribute_key>
annotation.attribute_origin.<tool_unit_id>.<attribute_key>
```

attribute key 可以包含点号；解析时只分离 tool unit，剩余字符串完整作为 key。字段必须存在于当前项目启用工具的 attribute schema 中。不同类型允许的操作符由 schema 返回，不能开放任意 JSONB key 或 raw SQL。

同一 AND group 中的 annotation rule 编译为一个 correlated `EXISTS`，确保类别、来源、轨迹和属性由同一个 active、非 cancelled annotation 满足；不能为每个 rule 分别生成 `EXISTS`，否则会产生跨对象误命中。

## 聚合口径

summary 同时返回：

- `scope.visible_task_total`：当前用户的项目可见任务总量；
- `scope.matched_task_total`：当前过滤树匹配的任务量；
- 任务状态；
- active annotation 总量及 source/class/tool unit/geometry 分布；
- single-frame、tracked annotation 与 distinct track；
- AI 检测候选待审、AI 追踪结果待审；
- 未解决 feedback；
- 项目 schema 中属性的 eligible/present/missing 与有限枚举值分布。
- capability 驱动的 image 分辨率、video 时长/帧/关键帧、lidar 相机/标定与 Scene 摘要。

属性 `eligible` 不等同于同工具单位的全部对象：服务会同时应用字段的 `applies_to` 类别范围和 `visible_if` 依赖条件，再计算 present/missing。属性字段循环受项目 schema 数量约束，不随 task 或 annotation 行数增长为应用层 N+1。

task-centric summary 聚合的是“匹配任务中的全部对象”。按匹配对象本身重新计算 facets 属于对象级探索，不应在此契约中暗中改变 grain。

## AI 待审

检测候选按 prediction 内的 shape 计算：

```text
全部 shape
- rejected_shape_indexes
- active annotation 中已接受的 (parent_prediction_id, attributes._shape_index)
```

不能使用 `Task.total_predictions`，它只是 prediction 行数。

追踪候选只统计带非空 `staged_result.results` 且状态为 `pending_review` 或可审阅 `cancelled` 的 job。非特权用户还需满足 tracker job 的 `created_by` 限制，避免列表显示其无法恢复审阅的候选。

## 轨迹标识

`Annotation.track_id` 是查询和聚合的权威列。compact video geometry 同时保留同值 `geometry.track_id`，所有创建、接受 prediction、导入、tracker 接受、拆分和合并路径必须双写。迁移会回填两种表示并创建 active project-track 索引。

- compact video：一条 track annotation 通常是一条逻辑轨迹；
- scene image/lidar：多条跨 task annotation 共享 track ID，项目轨迹数使用 `count(distinct track_id)`。

## 查询成本

显式 `columns_json` 控制任务行昂贵投影；未显示的来源、轨迹、候选、关键帧和点云标定列不会加入列表 SQL。列表使用单条分页查询，不在应用层逐 task / annotation 发起查询；summary 独立于分页，并由前端查询缓存按 filter scope 复用。新增索引前应保存 `EXPLAIN (ANALYZE, BUFFERS)` 基线，并优先使用一等列索引而不是为 geometry 增加宽泛 GIN。
