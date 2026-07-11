---
audience: [project_admin, reviewer]
type: how-to
since: v0.14.8
status: stable
last_reviewed: 2026-07-11
---

# Data Manager

Data Manager 是项目内的只读任务运营表。它把任务状态、预测、反馈、scene 帧号和计数列放到一个表格里，适合项目管理员或审核员每天固定查看问题任务。当前页面提供过滤条件、列显隐和保存视图；不提供表格内排序或批量写操作。

## 进入

![整体布局（视图列表 + 过滤条件栏 + 任务表格）](../images/projects/data-manager-overview.png)

在项目设置页点击 **Data Manager**。也可以直接访问：

```text
/projects/<project_id>/data-manager
```

页面左侧是视图列表，右侧是过滤条件、列显隐和任务表。

## 内置视图

系统内置 5 个只读视图：

| 视图 | 用途 |
|---|---|
| 全部任务 | 项目内所有任务 |
| 待标注 | `task.status in ["pending"]` |
| 待审核 | `task.status in ["review"]` |
| 有未解决反馈 | `feedback.unresolved_count > 0` |
| 有预测候选 | `prediction.prediction_count > 0` |

内置视图不会写入数据库。修改内置视图后点击 **保存视图** 会创建一个私有副本。

## 保存视图

保存视图会记录：

- 名称
- 当前过滤条件
- 列显隐列表

从页面新建的视图为私有视图，只有创建者可见。已有的项目共享视图对项目成员可见，只有项目负责人或超级管理员能更新或删除它。删除视图只删除保存的视图配置，不删除任务、标注、预测或反馈。

## 过滤字段

![过滤条件行编辑器字段选择器展开](../images/projects/data-manager-filter-rules.png)

过滤条件使用受控条件行，多个条件按 AND 组合。后端会拒绝未知字段、未知操作符和错误类型；当前页面不提供原始 JSON 编辑器或 OR 条件组。

当前页面可选字段（字段名含命名空间前缀）：

| 字段族 | 完整字段名 |
|---|---|
| task | `task.status`、`task.assignee`、`task.reviewer`、`task.batch_id` |
| annotation | `annotation.annotation_count`、`annotation.class_name` |
| prediction | `prediction.prediction_count`、`prediction.model_version`、`prediction.avg_confidence`、`prediction.source` |
| feedback | `feedback.unresolved_count`、`feedback.kind`、`feedback.severity` |
| scene | `scene.scene_name`、`scene.frame_index` |

常见例子：

```json
{
  "op": "and",
  "rules": [
    { "field": "feedback.unresolved_count", "op": "gt", "value": 0 },
    { "field": "prediction.model_version", "op": "eq", "value": "sam3-v1" }
  ]
}
```

页面一次显示 50 条任务；服务端 API 的单次查询上限为 200 条。

**硬限制**：
- `in` 操作符值列表最多 **200** 项。
- 保存视图名称长度 **1–120** 字符。

## 列

任务表可显示：

- `annotation_count`
- `prediction_count`
- `avg_prediction_confidence`
- `unresolved_feedback_count`
- `model_versions`
- `scene_name`
- `frame_index`
- `last_activity_at`
- 标注员 / 审核员

这些列来自后端聚合查询，不会逐行拉取标注或预测明细。

## 边界

本版不支持批量写操作，包括批量指派、批量导出、重跑预标、清理预测或跨页 select all。需要执行流程动作时，仍使用批次管理、AI 预标注或导出入口。
