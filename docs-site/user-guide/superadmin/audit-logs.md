# 审计日志

`audit_logs` 表是平台关键操作的不可改追踪流水。超管可在前端审计页查询，开发者可直接 SQL。

## 入口

`/admin/audit-logs`（仅 super_admin）

## 表结构要点

| 字段 | 含义 |
|---|---|
| `actor_id` | 触发动作的用户；`ON DELETE SET NULL` 保留历史 |
| `action` | 命名空间动作，如 `project.created` / `ml_backend.deleted` |
| `target_type` / `target_id` | 操作对象 |
| `metadata` | JSONB，存上下文（旧值、IP、UA） |
| `created_at` | timestamptz |

`audit_logs` 受 trigger 守护——**任何 UPDATE/DELETE 默认被拒**（"audit_logs rows are immutable"）。例外：seed/reset 流程通过 `SET LOCAL "app.allow_audit_update" = 'true'` 临时豁免（详见 [Dev 数据保护](../../dev/troubleshooting/dev-data-preservation)）。

## 已覆盖动作

按命名空间组织。前端 `auditLabels` 提供翻译。

### 用户与权限
- `user.created` / `user.role_changed` / `user.disabled`

### 项目
- `project.created` / `project.updated` / `project.archived`
- `project.classes_renamed`（v0.9.10 B-13）

### 数据
- `batch.uploaded` / `batch.activated` / `batch.reset`

### AI（v0.9.9 B-5）
- `ai.preannotate.triggered` — 触发预标，metadata 含 prompt / job_id
- `ml_backend.created` / `ml_backend.updated` / `ml_backend.deleted`

### 标注
- `annotation.submitted` / `annotation.reviewed`
- `annotation.prediction_accepted` / `annotation.prediction_rejected`

### 审核
- `task.review_passed` / `task.review_returned`

## 查询界面

- 顶部时间范围选择器（默认最近 7 天）
- actor / action / target_type 多 facet 过滤
- 行内点击展开 metadata JSON
- 支持导出 CSV（异步任务，跑完 WS 推下载链接）

## 直接 SQL 查询示例

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT created_at, actor_id, action, target_type, target_id
   FROM audit_logs
   WHERE created_at > NOW() - INTERVAL '1 day'
     AND action LIKE 'ml_backend.%'
   ORDER BY created_at DESC LIMIT 50;"
```

## 分区策略

`audit_logs` 按月分区（[ADR 0007](../../dev/adr/0007-audit-log-partitioning)）。运维上每月初由 cron 创建下月分区，旧分区可按合规策略归档/删除（默认保留 12 个月）。

## 写入侧约定

新功能要写审计：

1. 在 `apps/api/app/services/audit.py` 调 `audit(action, target_type, target_id, metadata)`
2. 前端 `auditLabels` 加翻译
3. 新动作进 changelog

不要绕过 service 直接 INSERT——trigger 不区分来源，但 service 层负责字段统一。
