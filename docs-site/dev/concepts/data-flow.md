---
audience: [dev]
type: explanation
since: v0.1.0
status: stable
last_reviewed: 2026-05-09
---

# 数据流

每张序列图配套关键代码路径——点 GitHub 或 IDE 跳转直达函数。

## 标注一条任务的完整链路

```mermaid
sequenceDiagram
  participant U as 标注员浏览器
  participant W as React App
  participant A as FastAPI
  participant DB as Postgres
  participant R as Redis
  participant C as Celery Worker
  participant S as MinIO

  U->>W: 进入工作台
  W->>A: GET /api/v1/tasks/next?project_id=...
  Note right of A: tasks.py:get_next_task
  A->>DB: 锁定一条 pending 任务<br/>task_lock TTL=300s
  Note right of DB: services/task_lock.py:acquire
  A->>S: 生成图像 presigned URL
  Note right of S: services/storage.py:presign_get
  A-->>W: { task, image_url, ai_predictions }
  W-->>U: 渲染画布 + 已有 AI 候选

  U->>W: 标注 + 提交 (E 键)
  W->>A: POST /api/v1/tasks/{id}/submit
  Note right of A: tasks.py:submit_task<br/>annotation.py:create_many
  A->>DB: 写 annotations + task.status='review'<br/>audit_logs(action='task.submit')
  A->>R: publish notify:{reviewer_id}
  Note right of R: services/notification.py:notify
  A-->>W: 200 + 下一条任务
  C->>R: 取队列项
  C->>DB: 写 IoU 计算结果
  Note right of C: workers/tasks.py
```

代码索引：
- 取下一题：`apps/api/app/api/v1/tasks.py` (get_next_task / next_smart 端点)
- 任务锁：`apps/api/app/services/task_lock.py:acquire/heartbeat/release`
- 提交：`apps/api/app/api/v1/tasks.py:submit_task`
- 审计：`apps/api/app/services/audit.py:AuditAction.TASK_SUBMIT`
- 通知：`apps/api/app/services/notification.py:NotificationService.notify`
- presigned URL：`apps/api/app/services/storage.py`

---

## AI 预标注

```mermaid
sequenceDiagram
  participant Admin as 项目管理员
  participant A as FastAPI
  participant R as Redis
  participant C as Celery Worker
  participant ML as ML 推理服务
  participant DB as Postgres
  participant WS as WS 频道

  Admin->>A: POST /api/v1/projects/{id}/preannotate
  Note right of A: ml_backends.py / projects.py
  A->>R: 入队 batch_predict(project_id)
  Note right of R: workers/tasks.py:batch_predict
  A-->>Admin: 202 Accepted

  loop 每 batch
    C->>R: 取队列项
    C->>ML: POST /predict { tasks: [...] }
    Note right of ML: ml_client.py:predict<br/>schema 见 ml-backend-protocol.md
    ML-->>C: { results: [...] }
    C->>DB: 写 predictions / prediction_metas<br/>错误写 failed_predictions
    C->>R: publish project:{pid}:preannotate<br/>{current, total, status}
    R->>WS: 通过 ws.py 转发到订阅者
  end
  WS-->>Admin: 进度 100%
```

代码索引：
- 触发端点：`apps/api/app/api/v1/projects.py` 或 `ml_backends.py`
- ML client：`apps/api/app/services/ml_client.py:predict` (`ml_client.py:41-62`)
- ML 协议契约：[`docs-site/dev/ml-backend-protocol.md`](../ml-backend-protocol)
- Worker：`apps/api/app/workers/tasks.py:batch_predict`
- WS 频道：`apps/api/app/api/v1/ws.py:preannotate_progress` (`ws.py:48-67`)
- WS 协议：[`docs-site/dev/ws-protocol.md`](../ws-protocol)

---

## 数据导出

```mermaid
sequenceDiagram
  participant Admin
  participant A as FastAPI
  participant R as Redis
  participant C as Celery
  participant DB
  participant S as MinIO

  Admin->>A: GET /api/v1/projects/{id}/export?format=coco
  Note right of A: projects.py:export_project<br/>audit_logs(action='project.export')
  A->>R: 入队 export_project(...)
  A-->>Admin: 202 + export_job_id
  C->>DB: 拉取所有 annotations + tasks
  C->>C: 拼装 COCO JSON / YOLO txt / VOC xml
  Note right of C: services/export/* 各 format 适配器
  C->>S: 上传 zip 到 datasets bucket
  C->>DB: 更新 export_job.status='done', file_url=...
  Admin->>A: GET /api/v1/exports/{id}
  A-->>Admin: presigned download URL
```

代码索引：
- 端点：`apps/api/app/api/v1/projects.py` (导出/列表/下载)
- 审计：v0.7.8 起所有导出写 `AuditAction.PROJECT_EXPORT` / `BATCH_EXPORT`
- Worker：`apps/api/app/workers/tasks.py`（export_project 任务）
- 格式适配：`apps/api/app/services/export/`

---

## 实时通知

```mermaid
sequenceDiagram
  participant Web as 浏览器
  participant API as FastAPI HTTP
  participant DB as Postgres
  participant Pub as Redis Pub/Sub
  participant WS as FastAPI WS

  Web->>WS: connect /ws/notifications?token=<jwt>
  Note right of WS: ws.py:notifications_socket<br/>JWT 校验 → SUBSCRIBE notify:{user_id}
  WS->>Pub: SUBSCRIBE notify:{user_id}

  Note over API,Pub: 任意业务路径触发通知
  API->>DB: INSERT notifications (持久化)
  API->>Pub: PUBLISH notify:{user_id} <NotificationOut JSON>
  Pub-->>WS: message
  WS-->>Web: send_text(<json>)

  loop 每 30s
    WS-->>Web: { "type": "ping" }
    Note right of WS: 防 LB idle 断连
  end

  Note over Web: 断线后<br/>useReconnectingWebSocket 指数退避
```

服务端 push 主要事件：

- 任务被分配 / 被回退（type=`task.assigned` / `task.review_rejected`）
- AI 预标注完成（type=`ai.preannotate_done`）
- 导出完成（type=`export.completed`）
- 评论 @ 提及（type=`comment.mention`）

代码索引：
- WS 端点：`apps/api/app/api/v1/ws.py` (`ws.py:70-114`)
- 通知服务：`apps/api/app/services/notification.py:NotificationService.notify` (`notification.py:51-94`)
- 通知模型：`apps/api/app/db/models/notification.py`
- 前端 hook：`apps/web/src/hooks/useNotificationSocket.ts`
- 重连基础：`apps/web/src/hooks/useReconnectingWebSocket.ts`
- WS 协议详细：[`docs-site/dev/ws-protocol.md`](../ws-protocol)
