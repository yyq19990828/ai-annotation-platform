"""公开 pydantic 模型。

只声明 SDK 用户关心的稳定字段; extra="allow" 容忍服务端新增字段 (前向兼容),
未声明字段仍可通过属性访问。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Generic, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class _AAPModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class Page(_AAPModel, Generic[T]):
    """limit/offset 分页响应 (datasets 等)。"""

    items: list[T]
    total: int
    limit: int
    offset: int


class Project(_AAPModel):
    id: UUID
    display_id: str
    name: str
    type_key: str
    data_type: str = "image"
    status: str
    created_at: datetime | None = None


class Dataset(_AAPModel):
    id: UUID
    display_id: str
    name: str
    description: str = ""
    data_type: str = "image"
    is_temporal: bool = False
    file_count: int = 0
    total_size: int = 0
    created_at: datetime | None = None


class UploadedItem(_AAPModel):
    """upload_files 单文件三步流的结果 (file_name 由 SDK 补充)。"""

    item_id: UUID
    file_name: str
    status: str = "ok"
    linked_tasks: Any = None


class ZipUploadResult(_AAPModel):
    added: int = 0
    deduped: int = 0
    skipped: int = 0
    errors: list[Any] = Field(default_factory=list)
    total_in_zip: int = 0
    linked_tasks: Any = None
    scene_inference_notes: list[str] = Field(default_factory=list)


class LinkResult(_AAPModel):
    """status="linking" 时建 task 走异步, 用 async_job_id 配合 jobs.wait。"""

    status: str
    dataset_id: UUID
    project_id: UUID
    async_job_id: UUID | None = None
    created_tasks: int | None = None


class Task(_AAPModel):
    id: UUID
    project_id: UUID
    display_id: str
    file_name: str
    file_type: str
    status: str
    file_url: str | None = None
    assignee_id: UUID | None = None
    batch_id: UUID | None = None
    sequence_order: int | None = None
    created_at: datetime | None = None


class TaskPage(_AAPModel):
    """tasks.list 响应; cursor 翻页时 total 为 None (复用首页值)。"""

    items: list[Task]
    total: int | None = None
    limit: int = 50
    offset: int = 0
    next_cursor: str | None = None


class Annotation(_AAPModel):
    id: UUID
    task_id: UUID
    source: str
    annotation_type: str
    tool_unit_id: str = "bbox"
    class_name: str
    geometry: dict[str, Any]
    confidence: float | None = None
    group_id: int | None = None
    is_active: bool = True
    version: int = 1
    created_at: datetime | None = None


class ImportResult(_AAPModel):
    """predictions.import_file 响应 (后端 AAPImportResult)。"""

    imported: int = 0
    skipped: int = 0
    errors: list[dict[str, Any]] = Field(default_factory=list)
    dry_run: bool = False


class Job(_AAPModel):
    id: UUID
    kind: str
    status: str
    project_id: UUID | None = None
    user_id: UUID | None = None
    progress_pct: int = 0
    payload: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class JobPage(_AAPModel):
    items: list[Job]
    total: int


class GpuInfo(_AAPModel):
    """ML Backend `/health` 缓存的 GPU 指标 (字段缺失 = backend 未上报)。"""

    device_name: str | None = None
    memory_used_mb: int | None = None
    memory_total_mb: int | None = None
    memory_free_mb: int | None = None
    gpu_utilization_percent: int | None = None
    gpu_temperature_celsius: int | None = None
    gpu_power_watts: float | None = None


class HostInfo(_AAPModel):
    container_cpu_percent: float | None = None
    container_memory_percent: float | None = None


class CacheStats(_AAPModel):
    hits: int | None = None
    misses: int | None = None
    size: int | None = None
    capacity: int | None = None
    hit_rate: float | None = None


class HealthMeta(_AAPModel):
    """backend `/health` 深度指标缓存; capabilities 等未声明字段经 extra="allow" 仍可访问。"""

    gpu_info: GpuInfo | None = None
    host: HostInfo | None = None
    cache: CacheStats | None = None
    model_version: str | None = None


class MLBackend(_AAPModel):
    """项目挂载的 ML Backend (只读监控)。state: connected / error。"""

    id: UUID
    project_id: UUID
    name: str
    url: str
    state: str
    health_meta: HealthMeta | None = None
    error_message: str | None = None
    last_checked_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MLBackendStatsSnapshot(_AAPModel):
    """v0.15.12 · `/ws/ml-backend-stats` 每 1s 推送的单个 backend 实时快照。

    `loaded` / `idle_unload_seconds` / `last_request_age_seconds` / `pool` / `video_pool`
    是 REST `/health` 拿不到、仅 WS 推送的池/预热维度。
    """

    backend_id: UUID | None = None
    backend_name: str | None = None
    physical_key: str | None = None
    url_host: str | None = None
    state: str
    gpu_info: GpuInfo | None = None
    host: HostInfo | None = None
    cache: CacheStats | None = None
    model_version: str | None = None
    loaded: bool | None = None
    idle_unload_seconds: float | None = None
    last_request_age_seconds: float | None = None
    pool: dict | None = None
    video_pool: dict | None = None
    timestamp: datetime | None = None


class ApiKey(_AAPModel):
    id: UUID
    name: str
    key_prefix: str
    scopes: list[str] = Field(default_factory=list)
    expires_at: datetime | None = None
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime | None = None


class ApiKeyCreated(ApiKey):
    """创建响应附带一次性 plaintext, 之后无法再次查看。"""

    plaintext: str
