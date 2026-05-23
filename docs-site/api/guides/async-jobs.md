---
audience: [project_admin, super_admin, developer]
type: reference
since: v0.10.16
status: stable
last_reviewed: 2026-05-23
---

# 异步任务（async_jobs）

平台从 v0.10.16 起把所有用户可见的长任务统一进 `async_jobs` 表，做为前端任务铃铛
（Topbar `JobsBell`）和 `/ai-pre/jobs` 历史页的统一数据源。底层各类长任务（预标、视频追踪、审计归档、预测导入）
**保留各自专表**作为 domain 真值（PredictionJob / VideoTrackerJob 等），`async_jobs` 只记
最小元数据作为汇总索引。这种"双写双轨"让前端只需 polling 一个端点就能看到全部进行中的任务。

## kind 取值

| kind | 触发位 | 是否支持 cancel API |
|---|---|---|
| `batch_predict` | 项目 / 批次预标按钮（AIPreAnnotate 或 ProjectDetailPanel） | ❌（v0.10.17 计划） |
| `video_tracker` | 视频工作台 tracker 触发 | ❌（v0.10.17 计划） |
| `audit_archive` | Celery beat 每月 2 日 03:00 UTC | ✅ |
| `predictions_import` | 外部 prediction 上传（[Import guide](./import)） | ✅ |

## 端点

### `GET /api/v1/async-jobs`

按 `user_id` 过滤（super_admin 看全部）。

| Query | 类型 | 说明 |
|---|---|---|
| `status` | enum, repeatable | `pending` / `running` / `completed` / `failed` / `cancelled`；可重复传入，如 `?status=pending&status=running` |
| `kind` | string | 上表 kind 字符串 |
| `project_id` | uuid | 只看某个项目的任务 |
| `search` | string | 匹配 payload 中的 `prompt` / `batch_display_id` / `model_key` |
| `limit` | int (1-200) | 默认 50 |
| `offset` | int | 默认 0 |

响应：

```json
{
  "items": [
    {
      "id": "01JX...",
      "kind": "batch_predict",
      "project_id": "uuid",
      "user_id": "uuid",
      "project_display_id": "PROJ-1",
      "project_name": "Demo Project",
      "status": "running",
      "progress_pct": 42,
      "payload": {
        "total_tasks": 100,
        "prediction_job_id": "uuid",
        "batch_display_id": "BATCH-1",
        "output_mode": "mask"
      },
      "result": {},
      "error_message": null,
      "celery_task_id": "celery-uuid",
      "started_at": "2026-05-19T10:00:00Z",
      "completed_at": null,
      "created_at": "2026-05-19T09:59:50Z",
      "updated_at": "2026-05-19T10:00:30Z"
    }
  ],
  "total": 1
}
```

### `GET /api/v1/async-jobs/{id}`

owner-scoped；非 owner（且非 super_admin）→ `403`。

### `POST /api/v1/async-jobs/{id}/cancel`

软取消。**MVP 仅支持** `predictions_import` / `audit_archive`；其他 kind 调用返回 `400 not cancellable`。
已终态（`completed` / `failed` / `cancelled`）调用返回 `409`。

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://api.example.com/api/v1/async-jobs/01JX.../cancel
# → 200 {"status": "cancelled", "id": "01JX..."}
```

## 进度上报模型

- **service 层显式**：`batch_predict` 等长任务在 worker 内显式调 `async_job_svc.update_progress(job_id, pct)`，每 5% 步长写一次，避免每条 task 都 DB write；
- **Celery signals 兜底**：`task_failure` / `task_revoked` 信号回调按 `celery_task_id` 反查 `async_jobs` 行，翻 `failed` / `cancelled`，覆盖 worker crash / Celery revoke 等未被业务代码 except 接住的极端情况；
- **失败兜底**：所有 async_jobs 写入都包 try/except，**专表写入失败不阻断主业务流程**（仅记日志）。

## Retention

终态行（`completed` / `failed` / `cancelled`）每日 04:15 UTC 由 Celery beat 任务
`purge-old-async-jobs` 清理超过 30 天的记录。`running` / `pending` 行**永不**自动清。

## 与 `PreannotateJobsBadge` 的区别

| 维度 | PreannotateJobsBadge | JobsBell (本端点) |
|---|---|---|
| 数据通道 | Redis pub/sub（`project:{id}:preannotate` + `global:prediction-jobs`） | Polling `/api/v1/async-jobs?limit=20`（5s interval） |
| 实时性 | 秒级 | 5s |
| kind 覆盖 | 仅 `batch_predict` | 全部 4 kind |
| 历史记录 | ❌（仅 in-progress） | ✅（含最近完成） |
| 用户范围 | super_admin / project_admin | 所有登录用户（owner-scoped） |

两者**并存**，互补不冲突。

## 相关

- [ROADMAP §1.7 async_jobs MVP](../../roadmap/2026-05-18-cvat-labelstudio-inspiration)
- 模型：[`apps/api/app/db/models/async_job.py`](../../../apps/api/app/db/models/async_job.py)
- service：[`apps/api/app/services/async_job.py`](../../../apps/api/app/services/async_job.py)
- 前端铃铛：[`apps/web/src/components/shell/JobsBell.tsx`](../../../apps/web/src/components/shell/JobsBell.tsx)
