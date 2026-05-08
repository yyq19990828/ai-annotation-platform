# 导出

标注数据导出为下游训练可用格式。导出走 Celery 异步，跑完通过 WebSocket 推下载链接。

## 触发导出

```http
POST /api/v1/projects/:id/export
{
  "format": "labelstudio",        // labelstudio / coco / yolo / cvat
  "scope": "completed",           // all / completed / batch / range
  "batch_id": 5,                  // scope=batch 必填
  "incremental_since": "2026-05-01T00:00:00Z"  // 可选，增量
}
```

返回：

```json
{ "job_id": "exp_abc123", "status": "queued" }
```

## 查询状态

```http
GET /api/v1/projects/:id/exports                       # 历史列表
GET /api/v1/projects/:id/exports/:job_id               # 详情
```

状态机：`queued → running → succeeded | failed`，与 prediction_jobs 类似。

## 拿下载链接

跑完后服务端通过 WS `user:{uid}:notify` 推：

```json
{
  "type": "export.ready",
  "job_id": "exp_abc123",
  "download_url": "https://minio.../exports/exp_abc123.zip?X-Amz-...",
  "expires_at": "..."
}
```

URL 是 MinIO presigned，默认 1h 有效。也可主动拉：

```http
GET /api/v1/projects/:id/exports/:job_id/download
```

后端会重新生成 presigned URL 并 302 重定向。

## 格式说明

| 格式 | 适用 |
|---|---|
| **labelstudio** | LabelStudio 标准 JSON，最完整（含 prediction、attribute、history） |
| **coco** | COCO `instances_*.json`，目标检测标杆 |
| **yolo** | YOLO txt 格式 + classes.txt，每图一文件 |
| **cvat** | CVAT 1.1 XML |

每种格式都会同时打包**原图引用**（默认仅 URL，可选嵌入 / 压缩）。

## 增量导出

`incremental_since` 参数让本次只导出该时间后**修改过**的标注（基于 `annotations.updated_at`）。配合训练流水线做 delta 训练。

## 取消

```http
DELETE /api/v1/projects/:id/exports/:job_id
```

仅在 `queued/running` 状态可取消，`succeeded` 后产物保留可重复下载。

## 清理

导出包默认 30 天后由 lifecycle 规则清理（详见 [部署拓扑 - 数据卷](../../dev/architecture/deployment-topology#数据卷与持久化)）。

## 权限

| 角色 | 能否导出 |
|---|---|
| viewer | ❌ |
| annotator | ❌ |
| reviewer | ❌ |
| project_admin | ✅（自己的项目） |
| super_admin | ✅（任何项目） |
