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


class DatasetItem(_AAPModel):
    id: UUID
    dataset_id: UUID
    file_name: str
    file_path: str
    file_type: str
    file_size: int | None = None
    content_hash: str | None = None
    width: int | None = None
    height: int | None = None
    metadata: Any = Field(default_factory=dict)
    file_url: str | None = None
    thumbnail_url: str | None = None
    blurhash: str | None = None
    created_at: datetime | None = None


class DatasetUnlinkPreview(_AAPModel):
    will_delete_tasks: int = 0
    will_delete_annotations: int = 0
    will_delete_batches: int = 0


class DatasetUnlinkResult(_AAPModel):
    deleted_tasks: int = 0
    deleted_annotations: int = 0
    deleted_batches: int = 0
    deleted_batch_ids: list[UUID] = Field(default_factory=list)


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
    """ML Backend (只读监控)。state: connected / error。

    v0.19.1 · 全局注册表 (ADR-0044): `id` 是全局 registry id, 一物理 backend 全局
    一份; 同一 backend 被多个项目启用时, 各项目作用域端点返回的是**同一 id**。旧版
    per-project 的 backend id 已在 0.19.0 迁移中被 registry id 取代——脚本里硬编码
    的旧 id 需更新。项目作用域端点 (`MLBackends.list/get`) 会回填 `project_id`;
    全局 / admin 场景该字段为 None。
    """

    id: UUID
    project_id: UUID | None = None
    name: str
    url: str
    state: str
    health_meta: HealthMeta | None = None
    error_message: str | None = None
    last_checked_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MLBackendHealth(_AAPModel):
    status: str
    backend_id: UUID
    backend_name: str


class MLBackendUnloadResult(_AAPModel):
    ok: bool | None = None
    unloaded: bool | int | None = None
    residency: Any = None


class ProjectMLBackend(_AAPModel):
    backend: MLBackend
    enabled: bool = False
    default_variants: dict[str, Any] | None = None


class ServicePoolSummary(_AAPModel):
    id: UUID
    name: str
    enabled: bool = False
    legacy_instance_id: UUID | None = None
    member_count: int = 0
    routing_generation: int = 1


class ProjectServicePool(_AAPModel):
    pool: ServicePoolSummary
    enabled: bool = False
    default_variants: dict[str, Any] | None = None


class ServicePoolMember(_AAPModel):
    registry_id: UUID
    registry_name: str
    traffic_state: str
    weight: int = 1


class ServicePool(_AAPModel):
    id: UUID
    name: str
    enabled: bool
    routing_policy: str
    legacy_instance_id: UUID | None = None
    routing_generation: int
    capability_fingerprint: str | None = None
    members: list[ServicePoolMember] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CapabilityDrift(_AAPModel):
    pool_id: UUID
    registry_id: UUID
    member_state: str
    pool_enabled: bool
    pool_fingerprint: str | None = None
    candidate_fingerprint: str | None = None
    differing_fields: list[str] = Field(default_factory=list)
    has_drift: bool
    can_accept: bool
    blocking_members: list[UUID] = Field(default_factory=list)


class ServicePoolTopology(_AAPModel):
    schema_version: str
    generated_at: datetime
    router_mode: str
    pools: list[dict[str, Any]] = Field(default_factory=list)


class ServicePoolRuntimeSnapshot(_AAPModel):
    schema_version: str
    observed_at: datetime
    router_mode: str
    partial: bool = False
    partial_reason: str | None = None
    sources: list[dict[str, Any]] = Field(default_factory=list)
    pools: list[dict[str, Any]] = Field(default_factory=list)


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


class UserBrief(_AAPModel):
    """责任人 inline 摘要 (batch annotator / reviewer 等)。"""

    id: UUID
    name: str
    email: str | None = None
    role: str | None = None
    avatar_initial: str | None = None


class Batch(_AAPModel):
    """项目批次。progress_pct 为 0-100 浮点; annotator/reviewer 为责任人摘要。"""

    id: UUID
    project_id: UUID
    display_id: str
    name: str
    status: str
    total_tasks: int = 0
    completed_tasks: int = 0
    review_tasks: int = 0
    approved_tasks: int = 0
    rejected_tasks: int = 0
    progress_pct: float = 0.0
    annotator: UserBrief | None = None
    reviewer: UserBrief | None = None
    created_at: datetime | None = None


class BatchDistributeResult(_AAPModel):
    distributed_batches: int
    annotator_per_batch: dict[str, str | None] = Field(default_factory=dict)
    reviewer_per_batch: dict[str, str | None] = Field(default_factory=dict)


class BulkBatchActionItem(_AAPModel):
    batch_id: UUID
    reason: str


class BulkBatchActionResult(_AAPModel):
    succeeded: list[UUID] = Field(default_factory=list)
    skipped: list[BulkBatchActionItem] = Field(default_factory=list)
    failed: list[BulkBatchActionItem] = Field(default_factory=list)


class Member(_AAPModel):
    """项目成员。"""

    id: UUID
    user_id: UUID
    user_name: str
    user_email: str
    role: str
    assigned_at: datetime | None = None


class Me(_AAPModel):
    """当前认证主体 (GET /auth/me)。role 用于 TUI/CLI 角色感知; 其余字段经 extra 透传。"""

    id: UUID
    email: str
    name: str
    role: str


class TaskActionResult(_AAPModel):
    status: str
    task_id: UUID


class ReviewClaim(_AAPModel):
    task_id: UUID
    reviewer_id: UUID
    reviewer_claimed_at: datetime
    is_self: bool


class AnnotationBulkUpdateResult(_AAPModel):
    updated_ids: list[UUID] = Field(default_factory=list)
    updated_count: int = 0


class JobRetryResult(_AAPModel):
    status: str
    job_id: UUID
    queued: int
    skipped: int


class ProjectStats(_AAPModel):
    """可见项目聚合统计 (GET /projects/stats)。*_series 为最近 12 周时间序列。"""

    total_data: int = 0
    completed: int = 0
    ai_rate: float = 0.0
    pending_review: int = 0
    total_annotations: int = 0
    ai_derived_annotations: int = 0
    total_data_series: list[int] = Field(default_factory=list)
    completed_series: list[int] = Field(default_factory=list)
    ai_rate_series: list[float] = Field(default_factory=list)
    pending_review_series: list[int] = Field(default_factory=list)


class PersonStat(_AAPModel):
    """全员绩效卡片项 (GET /dashboard/admin/people 的 items)。"""

    user_id: str
    name: str
    email: str | None = None
    role: str
    main_metric: int = 0
    main_metric_label: str | None = None
    throughput_score: int = 0
    quality_score: int = 0
    activity_score: int = 0
    rejected_rate: float | None = None
    sparkline_7d: list[int] = Field(default_factory=list)
    weekly_compare_pct: float | None = None
    alerts: list[str] = Field(default_factory=list)


class MyPerformance(_AAPModel):
    """标注员自助绩效 (GET /dashboard/me/performance)。自身 4 周趋势 + 团队均线对标。"""

    user_id: str
    name: str
    period: str | None = None
    throughput: int = 0
    quality_score: int = 0
    weekly_compare_pct: float | None = None
    trend_throughput: list[int] = Field(default_factory=list)
    trend_quality: list[int] = Field(default_factory=list)
    team_trend_throughput: list[float] = Field(default_factory=list)
    p50_duration_ms: int | None = None
    p95_duration_ms: int | None = None
    first_pass_yield: float | None = None


class DashboardStats(_AAPModel):
    """admin / reviewer / annotator 仪表盘原始数据 (字段随角色而异, 全经 extra 透传)。"""


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
