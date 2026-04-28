# 用户管理 / 数据存储 / 协同（生产级必备）

> 拆分自《AI标注平台深度调研报告》§4

## 4.1 多租户:Org > Workspace > Project > Task

| 平台 | 层级 |
|---|---|
| LS | **Organization** → Project → Task |
| CVAT | **Organization** → Project → Task → Job |
| 你 v0.2.0 | （无 Org）→ Project → Task |

**建议**:加一层 `Organization`,即便单租户部署也保留（以后做 SaaS 不用迁移）。

```sql
organizations (id, name, contact_info, created_by, ...)
organization_members (org_id, user_id, role, joined_at, deleted_at)
projects.organization_id  (FK)
```

## 4.2 RBAC:角色不要写死在中文字符串里

你 v0.2.0:`role = "标注员"` / `"质检员"` / `"项目管理员"` —— **强烈建议改成枚举 + i18n**。

```python
class UserRole(str, Enum):
    SUPER_ADMIN = 'super_admin'
    ORG_ADMIN = 'org_admin'
    PROJECT_ADMIN = 'project_admin'
    REVIEWER = 'reviewer'
    ANNOTATOR = 'annotator'
    VIEWER = 'viewer'

# i18n 在前端:
const ROLE_LABELS = {
  super_admin: { 'zh-CN': '超级管理员', 'en': 'Super Admin' }
}
```

## 4.3 数据存储:Presigned URL 必须做

你 v0.2.0 把 `tasks.file_path` 存的是 MinIO 内部路径,但前端展示时怎么拿到图?**生产环境必须签发临时 URL**:

```python
@router.get("/tasks/{id}/file_url")
async def get_file_url(id, current_user, db):
    task = await db.get(Task, id)
    # 校验权限
    url = minio_client.get_presigned_url("GET", "annotations", task.file_path, expires=timedelta(hours=1))
    return {"url": url, "expires_in": 3600}
```

**LS / CVAT 的设计**（更彻底）:
- LS 有 `io_storages` app,定义 `S3ImportStorage` / `GCSImportStorage` / `AzureBlobStorage` 等多种**存储源**
- CVAT 有 `cloud_provider.py` + `CloudStorage` 模型,用户绑定 AK/SK,平台代为生成 URL
- 都支持"双向同步":导入时拉数据下来 / 导出时把标注推回去

**给你的建议**（分阶段）:
- v0.3:实现单一 MinIO 的 presigned upload + presigned download
- v0.5:抽象 `Storage` 表,支持 S3 / OSS / 本地 NFS

## 4.4 文件上传:大文件直传不要走 API

```
错误做法:前端 POST 文件 → API → MinIO  (吃 API 内存,带宽 *2)
正确做法:
  前端 POST /api/tasks/upload-init { filename, size }
        → 后端创建 task (status=uploading)
          + minio.get_presigned_url("PUT", expires=15min)
        → 返回 { task_id, upload_url }
  前端 PUT {upload_url} 直接上传到 MinIO(不经过 API)
        → 上传完 POST /api/tasks/{id}/upload-complete
        → 后端校验 ETag,创建 Task 记录,更新 status=pending
```

**LS / CVAT 都是这么做的**。

## 4.5 协同标注:TaskLock

你 v0.2.0 没有锁机制。两人同时打开同一个 task → 两份冲突标注。

```python
class TaskLock:
    task_id: UUID
    user_id: UUID
    expire_at: datetime  # 通常 5 分钟,前端有心跳续约
    unique_id: UUID

    class Meta:
        unique_together = ('task_id', 'user_id')
```

LS 的实现（`tasks/models.py`）:锁过期机制,前端每 60s 续一次,关页面/切换任务自动释放。

## 4.6 审计日志

LS 有 `users/models.py:UserLastActivity` 等多张表,但更彻底的是 `webhooks` app:每个关键操作发 webhook,客户可以接到自己的审计系统。

**给你的建议**:加两张表:

```python
class AuditLog:
    id, user_id, org_id, action_type, target_type, target_id,
    payload (JSONB), ip_address, user_agent, created_at

class WebhookEndpoint:
    id, org_id, url, secret, events (JSONB), is_active

# 关键事件触发(用 SQLAlchemy event 或 FastAPI middleware):
- annotation.created / updated / deleted
- task.assigned / submitted / approved / rejected
- ml_backend.predicted / failed
- user.login / logout / role_changed
```

## 4.7 数据导出

你 v0.2.0 写了"待实现 COCO/VOC/YOLO"。CVAT 有专门的 `dataset_manager` app,LS 有 `data_export`。

**最简实现**:

```python
# app/services/exporters/
class COCOExporter:
    def export(self, project) -> dict:
        coco = {"images": [], "annotations": [], "categories": [...]}
        for task in project.tasks.iterator():
            coco["images"].append({"id": task.id, "file_name": task.file_name, ...})
            for anno in task.annotations.filter(is_active=True):
                coco["annotations"].append({
                    "image_id": task.id,
                    "category_id": class_to_id[anno.class_name],
                    "bbox": [anno.geometry["x"], ...],
                    "iscrowd": 0
                })
        return coco

# COCOExporter / VOCExporter / YOLOExporter 走同一个抽象基类
# 触发:POST /projects/{id}/export → 异步 Celery → 完成后存 MinIO + 邮件通知
```

**别忘了"导出过滤"**:导出时通常要选状态（只导已审核通过的）、按时间、按数据组等。
