---
title: Python SDK 参考
audience: [dev]
type: reference
since: v0.15.2
status: beta
last_reviewed: 2026-06-11
---

# Python SDK 参考

包名 `ai-annotation-sdk`,导入名 `ai_annotation`。同步 Client,底层 httpx + pydantic v2。

> **兼容承诺范围**:公开 API 仅限本页所列(`Client` + 资源命名空间方法 + `ai_annotation` 顶层导出的模型与异常)。内部传输层 `ai_annotation._http` 不在兼容承诺内,外部代码不要直接依赖。

## Client 构造

```python
from ai_annotation import Client

client = Client(
    base_url="http://localhost:8000",   # 平台地址(不含 /api/v1 前缀)
    api_key="ak_...",                    # ak_ API key 或 JWT, SDK 不区分
    timeout=30.0,                        # httpx 超时(秒)
)
```

`base_url` / `api_key` 缺省时按以下优先级解析(任一项独立回落):

1. 显式构造参数
2. 环境变量 `AAP_BASE_URL` / `AAP_API_KEY`
3. 配置文件 `~/.config/ai-annotation/config.toml`(由 `aap login` 写入)

三处都拿不到 `base_url` 时构造抛 `AAPError`。`api_key` 允许为空(此时请求不带 Authorization 头,通常会得到 401)。

`Client` 支持上下文管理器,也可手动 `client.close()`:

```python
with Client() as client:
    ...
```

所有接受 ID 的参数类型为 `IdLike = str | UUID`,传字符串或 `uuid.UUID` 均可。

### 传输层行为

- 认证:`Authorization: Bearer <api_key>`。
- 幂等重试:**仅 GET** 请求在 429 / 502 / 503 / 504 时做最多 3 次指数退避重试;POST / PATCH / DELETE 不重试。
- 预签名 URL(上传 PUT、绝对地址下载)走无 auth 的裸 client。

## 资源命名空间

### client.projects

| 方法 | 签名 | 返回 |
|---|---|---|
| `list` | `list(status: str \| None = None, search: str \| None = None)` | `list[Project]` |
| `create` | `create(name: str, type_key: str \| None = None, data_type: str \| None = None, **kwargs)` | `Project` |
| `get` | `get(project_id)` | `Project` |
| `stats` | `stats()` | `ProjectStats` |

`create` 说明:后端 `type_label` 必填,未通过 `kwargs` 显式给出时 SDK 按 `type_key` → `data_type` → `name` 顺序兜底填充。

`stats()` 返回可见项目聚合(`total_data` / `completed` / `ai_rate` / `pending_review`)+ 最近 12 周时间序列(`*_series`),任意已认证用户可达。

### client.datasets

| 方法 | 签名 | 返回 |
|---|---|---|
| `list` | `list(search: str \| None = None, data_type: str \| None = None, limit: int = 50, offset: int = 0)` | `Page[Dataset]` |
| `create` | `create(name: str, data_type: str = "image", **kwargs)` | `Dataset` |
| `get` | `get(dataset_id)` | `Dataset` |
| `upload_files` | `upload_files(dataset_id, paths: Sequence[str \| Path], on_progress: Callable[[int, int, str], None] \| None = None)` | `list[UploadedItem]` |
| `upload_zip` | `upload_zip(dataset_id, zip_path: str \| Path)` | `ZipUploadResult` |
| `link_project` | `link_project(dataset_id, project_id)` | `LinkResult` |

- `upload_files`:逐文件三步流(upload-init → PUT 预签名 URL → upload-complete)。`on_progress(done, total, file_name)` 在每个文件完成后回调。
- `upload_zip`:multipart 上传单个 ZIP 包,后端解压入库(≤200MB / ≤5000 文件)。
- `link_project`:返回的 `LinkResult.status == "linking"` 时建任务走异步,用 `async_job_id` 配合 `client.jobs.wait` 等待。

### client.tasks

| 方法 | 签名 | 返回 |
|---|---|---|
| `list` | `list(project_id, status: str \| None = None, limit: int = 50, offset: int = 0, cursor: str \| None = None)` | `TaskPage` |
| `get` | `get(task_id)` | `Task` |
| `next` | `next(project_id, batch_id=None)` | `Task \| None` |

- `list`:cursor 翻页时响应 `total` 为 `None`(复用首页值),下一页游标在 `TaskPage.next_cursor`。
- `next`:领取下一个可标注 task;**无可领任务时返回 `None`**(不抛异常)。

### client.annotations

| 方法 | 签名 | 返回 |
|---|---|---|
| `list` | `list(task_id)` | `list[Annotation]` |
| `create` | `create(task_id, annotation_type: str, geometry: dict, class_name: str \| None = None, **kwargs)` | `Annotation` |
| `update` | `update(task_id, annotation_id, **fields)` | `Annotation` |
| `delete` | `delete(task_id, annotation_id)` | `None` |

### client.predictions

| 方法 | 签名 | 返回 |
|---|---|---|
| `import_file` | `import_file(project_id, file_path, format: str = "aap_json", yolo_variant: str \| None = None, model_version: str \| None = None, dry_run: bool = False, overwrite_existing: bool = False)` | `ImportResult` |

导入外部预测结果,`format` 支持 `aap_json` / `coco` / `yolo`(yolo 时可配 `yolo_variant`)。文件格式细节见[预测导入与导出](/user-guide/datasets/prediction-import-export)。

> **注意**:后端 `overwrite_existing` 缺省为 `True`,SDK 显式发送且缺省 `False`(更保守)。要覆盖已有预测必须显式传 `overwrite_existing=True`。

### client.jobs

| 方法 | 签名 | 返回 |
|---|---|---|
| `list` | `list(status: str \| Sequence[str] \| None = None, kind: str \| Sequence[str] \| None = None, project_id=None, limit: int = 50, offset: int = 0)` | `JobPage` |
| `get` | `get(job_id)` | `Job` |
| `cancel` | `cancel(job_id)` | `None` |
| `wait` | `wait(job_id, timeout: float = 600.0, poll_interval: float = 2.0, on_progress: Callable[[Job], None] \| None = None)` | `Job` |

`cancel` 请求**软取消**:协作式——后端写取消标记,worker 在下一条任务边界落 `cancelled` 终态,返回不代表已终止。仅可取消的 kind 且 `status ∈ {pending, running}` 时有效,否则抛 `APIStatusError`(400/409)。

**`wait` 轮询语义**:每 `poll_interval` 秒 GET 一次 job,每轮先调用 `on_progress(job)`(若提供),然后判定:

- `status == "completed"` → 返回该 `Job`;
- `status in {"failed", "cancelled"}` → 抛 `JobFailedError`(异常的 `.job` 属性带完整 Job);
- 超过 `timeout` 秒仍未到终态 → 抛 `JobTimeoutError`。

### client.exports

| 方法 | 签名 | 返回 |
|---|---|---|
| `create` | `create(project_id, targets: list[str], include_attributes: bool \| None = None, **kwargs)` | `str`(job_id) |
| `wait` | 同 `jobs.wait`(纯转发) | `Job` |
| `download` | `download(job_or_id: Job \| IdLike, dest_path: str \| Path)` | `Path` |

- `create`:发起异步导出(HTTP 202),返回 job_id;参数走 query string(与后端端点一致)。导出格式清单见[导出格式参考](/user-guide/reference/export-formats)。
- `download`:从 `job.result["download_url"]` 流式下载导出包;传 job_id 时会先 GET 一次 job。job 无 `result.download_url`(如尚未完成)时抛 `AAPError`。

### client.ml_backends

只读监控某项目挂载的 ML Backend(健康状态 + GPU / cache 指标)。

| 方法 | 签名 | 返回 |
|---|---|---|
| `list` | `list(project_id)` | `list[MLBackend]` |
| `get` | `get(project_id, backend_id)` | `MLBackend` |

`MLBackend.state` 为 `connected` / `error`;`health_meta`(`HealthMeta`)含 `gpu_info` / `host` / `cache` / `model_version`,由后端 `/health` 缓存,`last_checked_at` 反映最近探测时间。

### client.batches

只读查询某项目的批次(进度 / 责任人 / 退回数)。

| 方法 | 签名 | 返回 |
|---|---|---|
| `list` | `list(project_id, status: str \| None = None)` | `list[Batch]` |
| `get` | `get(project_id, batch_id)` | `Batch` |

`Batch.progress_pct` 为 0–100 浮点;`annotator` / `reviewer` 为 `UserBrief \| None`(责任人摘要)。端点对项目可见者开放。

### client.members

| 方法 | 签名 | 返回 |
|---|---|---|
| `list` | `list(project_id)` | `list[Member]` |

`Member` 含 `user_name` / `user_email` / `role` / `assigned_at`。端点对项目可见者开放。

### client.me()

`client.me() -> Me`:返回当前认证主体(`GET /auth/me`),`Me.role` 用于角色感知 / 凭据自检。

### client.dashboard

看板 / 绩效只读查询。多数端点有角色门控,无权限抛 `PermissionDeniedError`(403)。

| 方法 | 签名 | 返回 | 角色 |
|---|---|---|---|
| `admin` | `admin()` | `DashboardStats` | super_admin |
| `reviewer` | `reviewer()` | `DashboardStats` | super_admin / project_admin / reviewer |
| `annotator` | `annotator()` | `DashboardStats` | annotator+ |
| `people` | `people(role=None, project=None, period=None, sort=None, q=None)` | `list[PersonStat]` | super_admin / project_admin |
| `me_performance` | `me_performance(period=None)` | `MyPerformance` | 任意已认证(self) |

`people()`:全员绩效卡片;**project_admin 须传 `project`** 指定其管理范围,super_admin 可全局或任意项目。`admin/reviewer/annotator` 字段随角色而异,经 `DashboardStats`(`extra="allow"`)透传。

### client.api_keys

| 方法 | 签名 | 返回 |
|---|---|---|
| `list` | `list()` | `list[ApiKey]` |
| `create` | `create(name: str, scopes: Sequence[str] \| None = None)` | `ApiKeyCreated` |
| `revoke` | `revoke(key_id)` | `None` |

`ApiKeyCreated.plaintext` 是**一次性**的完整 key,创建响应之后无法再次查看,请立即妥善保存。

## 异常层级

全部从 `ai_annotation` 顶层导入:

```text
AAPError                      # 所有 SDK 异常的基类
├── APIStatusError            # HTTP 4xx/5xx 统一异常 (.status_code / .detail)
│   ├── AuthenticationError   # 401
│   ├── PermissionDeniedError # 403
│   ├── NotFoundError         # 404
│   ├── ConflictError         # 409 (如上传内容重复)
│   └── ValidationError       # 422 请求体/参数校验失败
├── JobFailedError            # async job 以 failed/cancelled 终态结束 (.job)
└── JobTimeoutError           # jobs.wait 超时仍未到终态
```

其他状态码(如 500)抛 `APIStatusError` 本身。`.detail` 取自后端错误体 `{"detail": str | dict}`,解析失败时回落原始响应文本。

```python
from ai_annotation import Client, NotFoundError, JobFailedError

with Client() as client:
    try:
        project = client.projects.get("...")
    except NotFoundError as e:
        print(e.status_code, e.detail)
```

## 响应模型与前向兼容

顶层导出的 pydantic 模型:`Project` / `Dataset` / `Task` / `TaskPage` / `Annotation` / `Job` / `JobPage` / `Page` / `UploadedItem` / `ZipUploadResult` / `LinkResult` / `ImportResult` / `ApiKey` / `ApiKeyCreated` / `Batch` / `Member` / `Me` / `UserBrief` / `ProjectStats` / `PersonStat` / `MyPerformance` / `DashboardStats`。

所有模型 `extra="allow"`:只声明 SDK 用户关心的稳定字段,**容忍服务端新增字段**——未声明字段不会导致校验失败,且仍可通过属性访问(如 `project.total_tasks`,服务端附加字段,可能缺失,建议 `getattr(p, "total_tasks", None)` 取用)。
