# 0014 — Prediction Jobs 历史表与 Worker 三时点写入

- **Status:** Accepted
- **Date:** 2026-05-08（v0.9.8）
- **Deciders:** core team
- **Supersedes:** —

## Context

v0.9.4 后 SAM/DINO 真接通，但前端只能从 `predictions` 表反推某批次"现在的预标注快照"，无法回答以下问题：

- 这次预标注是谁、什么时候、用哪个 ML Backend、什么 prompt 触发的？
- 任务失败了吗？错误信息是什么？
- 已重置批次的历史 job 还能不能查？

`/preannotate-queue` 端点只反映**当前 `pre_annotated` 标记位**，丢失了所有历史。Celery `task_id` 也只能从 Redis broker 短期反查，无法做长期审计与排查。

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **新表 `prediction_jobs`** | 显式状态机、跨重置可见、审计就绪 | 多一张表 + 三时点写入开销 |
| 复用 `audit_logs` | 已有表，零迁移 | audit 不可改、无法表达 running 中间态 |
| 仅 Redis 缓存 task 状态 | 不动 schema | TTL 过期即丢，无法满足"历史 job 列表" |

## Decision

新增 `prediction_jobs` 表（alembic `0052`），UUID PK，三 FK 索引（`project_id`、`batch_id`、`celery_task_id`）。

### 状态机

```
created  → running  → succeeded
                    ↘ failed
```

### Worker 三时点写入（`apps/api/app/workers/tasks.py`）

| 时点 | 写入字段 |
|---|---|
| dispatch | `id`, `project_id`, `batch_id`, `celery_task_id`, `prompt`, `ml_backend_id`, `status='created'`, `created_at` |
| 任务开始 | `status='running'`, `started_at` |
| 任务结束 | `status='succeeded'/'failed'`, `finished_at`, `succeeded_count`, `failed_count`, `error` |

### 端点与前端

- `GET /admin/preannotate-jobs` — cursor 翻页，包含已重置/失败 job
- `/preannotate-queue` — 保留，仅反映"当前 pre_annotated 快照"，与上文区分
- 前端 `/ai-pre/jobs` 子路由：10 列状态/搜索过滤 + cursor 翻页
- WS `global:prediction-jobs` 全局通道 + `/ws/prediction-jobs` admin-only 端点 + Topbar `PreannotateJobsBadge`

## Consequences

正向：

- 历史 job 跨批次重置可查（B 端审计/排查刚需）
- Celery `task_id` 长期可反查
- 多项目并发时 admin 仍能在 Topbar 看到全局进度（解决 v0.9.7 切项目失去进度的痛点）

负向：

- 三时点写入需要 SAVEPOINT 隔离（worker 失败时不能影响主任务事务），实现已落地
- `prediction_jobs` 与 `predictions` 双源——查询前端候选用后者，查询历史/状态用前者，需要文档明确（已写入 `dev/architecture/api-schema-boundary.md`）

## Notes

- 实现：`apps/api/app/db/models/prediction_job.py`、`apps/api/app/api/v1/predictions.py`
- 迁移：`apps/api/alembic/versions/0052_*.py`
- WebSocket：`apps/api/app/api/v1/ws.py`，前端 `apps/web/src/hooks/useGlobalPreannotationJobs.ts`
- 关联 commit：`d41236b` feat(v0.9.8)
