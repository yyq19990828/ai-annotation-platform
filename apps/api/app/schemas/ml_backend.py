from datetime import datetime
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}


def _validate_ml_backend_url(v: str) -> str:
    """v0.9.8 · 拒绝 loopback host. 容器内无法访问宿主机 localhost,
    跑预标会直接 connection refused. 提示用 docker bridge IP / service DNS.

    与 v0.9.6 前端 placeholder (runtime-hints.ml_backend_default_url) 配套.
    """
    parsed = urlparse(v)
    host = (parsed.hostname or "").lower()
    if host in _LOOPBACK_HOSTS:
        raise ValueError(
            "URL 不能用 loopback host (localhost / 127.0.0.1); "
            "容器内访问宿主机请用 docker bridge IP (如 172.17.0.1) 或 service DNS. "
            "默认值参考 GET /runtime-hints.ml_backend_default_url"
        )
    return v


class MLBackendCreate(BaseModel):
    name: str
    url: str
    is_interactive: bool = False
    auth_method: str = "none"
    auth_token: str | None = None
    extra_params: dict = {}

    @field_validator("url")
    @classmethod
    def _no_loopback(cls, v: str) -> str:
        return _validate_ml_backend_url(v)


class MLBackendUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    is_interactive: bool | None = None
    auth_method: str | None = None
    auth_token: str | None = None
    extra_params: dict | None = None

    @field_validator("url")
    @classmethod
    def _no_loopback(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return _validate_ml_backend_url(v)


# v0.9.11 PerfHud · health_meta 子结构 (Pydantic 模型 → 前端 codegen 派生类型)
class GpuInfo(BaseModel):
    device_name: str | None = None
    memory_used_mb: int | None = None
    memory_total_mb: int | None = None
    memory_free_mb: int | None = None
    gpu_utilization_percent: int | None = None
    gpu_temperature_celsius: int | None = None
    gpu_power_watts: float | None = None


class HostInfo(BaseModel):
    container_cpu_percent: float | None = None
    container_memory_percent: float | None = None


class CacheStats(BaseModel):
    hits: int | None = None
    misses: int | None = None
    size: int | None = None
    capacity: int | None = None
    hit_rate: float | None = None

    class Config:
        extra = "allow"  # backend 可能扩展指标, 不强约束


class HealthMeta(BaseModel):
    """v0.9.11 · backend `/health` 深度指标缓存. 由 services/ml_backend.check_health 写入,
    `/admin/ml-integrations/overview` + PerfHud WS 消费."""

    gpu_info: GpuInfo | None = None
    host: HostInfo | None = None
    cache: CacheStats | None = None
    model_version: str | None = None

    class Config:
        extra = "allow"


class MLBackendOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    url: str
    state: str
    is_interactive: bool
    auth_method: str
    extra_params: dict
    # v0.9.6 · 缓存的 backend `/health` 深度指标 (gpu_info / cache / model_version);
    # 由 services/ml_backend.check_health 写入, /admin/ml-integrations/overview 直接消费.
    # v0.9.11 · 类型从 dict 收紧到 HealthMeta (含 host PerfHud 字段), 前端 codegen 派生.
    health_meta: HealthMeta | None = None
    error_message: str | None
    last_checked_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# v0.9.11 PerfHud · WS /ws/ml-backend-stats 推送的单次快照
class MLBackendStatsSnapshot(BaseModel):
    backend_id: UUID
    backend_name: str | None = None
    state: str
    gpu_info: GpuInfo | None = None
    host: HostInfo | None = None
    cache: CacheStats | None = None
    model_version: str | None = None
    timestamp: datetime


class MLBackendHealthResponse(BaseModel):
    status: str
    backend_id: UUID
    backend_name: str


class InteractiveRequest(BaseModel):
    """工作台「AI 助手」单次推理请求。`context` 透传至 backend，平台不做 schema 校验。

    `context.type` 协商枚举（详见 `docs-site/dev/ml-backend-protocol.md` §2.2）：
    - ``point``：``{"type":"point","points":[[x,y],...],"labels":[1,0,...]}``
    - ``bbox``：``{"type":"bbox","bbox":[x1,y1,x2,y2]}``
    - ``polygon``：``{"type":"polygon","points":[[x,y],...]}``
    - ``text``：``{"type":"text","text":"ripe apples"}``（v0.9.x Grounded-SAM-2）
    - ``exemplar``：留给 v0.10.x SAM 3。
    """

    task_id: UUID
    context: dict = Field(
        default_factory=dict,
        description="开放 dict；type 字段见 schema docstring 与协议文档 §2.2。",
    )
