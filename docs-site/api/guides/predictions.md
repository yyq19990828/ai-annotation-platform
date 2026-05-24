---
audience: [dev]
type: reference
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
---

# Predictions / Prediction Jobs

两张表，两个用途：

| 表 | 用途 | 端点前缀 |
|---|---|---|
| `predictions` | 当前可采纳的候选框（按 task） | `/tasks/:id/predictions` |
| `prediction_jobs` | AI 跑过哪几次、状态、谁触发（v0.9.8） | `/admin/preannotate-jobs` |

## 触发预标

```http
POST /api/v1/admin/projects/:id/preannotate
{
  "batch_id": 5,
  "prompt": "person . car . bicycle",
  "output_mode": "both",        // box / mask / both
  "ml_backend_id": 3,
  "alias_filter": ["person", "car"]   // v0.9.10 B-10
}
```

返回 `202` + `job_id`。任务进 Celery，状态机见 [预标注流水线](../../dev/concepts/prediction-pipeline)。

## 查询 jobs

```http
GET /api/v1/admin/preannotate-jobs?cursor=&status=&search=
```

cursor 翻页，列字段：`id`, `project_id`, `batch_id`, `status`, `created_at`, `started_at`, `finished_at`, `succeeded_count`, `failed_count`, `error`, `prompt`, `output_mode`。

```http
GET /api/v1/admin/preannotate-jobs/:job_id    # 详情
```

## 查询当前快照

```http
GET /api/v1/admin/preannotate-queue?project_id=&status=
```

只看当前 `pre_annotated=true` 的批次（与 jobs 历史区分）。

## 查询任务预测

```http
GET /api/v1/tasks/:task_id/predictions?model_version=&min_confidence=&limit=&offset=
```

返回 `PredictionOut[]`。每条 prediction 的 `source` 表示候选来源：

| source | 含义 |
|---|---|
| `ml_backend` | 平台内 ML backend 生成的预标 |
| `external_import` | 通过预测导入端点写入的外部预测 |

Workbench 会用该字段显示来源标识，并支持按来源隐藏 / 恢复候选框。

## 重置批次

```http
POST /api/v1/admin/batches/:id/reset
```

清掉该批次所有 `predictions`，但 `prediction_jobs` 历史保留（审计需要）。重置后可重新跑预标。

## 接受 / 驳回

详见 [任务与标注](./tasks-and-annotations#采纳预测)。

## WebSocket 进度

| 通道 | 何时订阅 |
|---|---|
| `project:{id}:preannotate` | 工作台 / `/ai-pre` 该项目页 |
| `global:prediction-jobs` | 任何 admin（Topbar 进度徽章） |

消息体：

```json
{ "job_id": "...", "type": "progress", "i": 3, "n": 10, "ts": ... }
{ "job_id": "...", "type": "error", "message": "..." }
{ "job_id": "...", "type": "done", "succeeded": 9, "failed": 1 }
```

## Schema 边界

- DB 写入：LabelStudio 标准（保持导出兼容）
- API 读出：经 `to_internal_shape` 转内部 schema
- 前端只接受内部 schema

详见 [API Schema 边界](../../dev/concepts/api-schema-boundary) 与 [Schema 适配器陷阱](../../dev/troubleshooting/schema-adapter-pitfalls)。
