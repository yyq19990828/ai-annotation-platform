from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


class MLBackendCreate(BaseModel):
    name: str
    url: str
    is_interactive: bool = False
    auth_method: str = "none"
    auth_token: str | None = None
    extra_params: dict = {}


class MLBackendUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    is_interactive: bool | None = None
    auth_method: str | None = None
    auth_token: str | None = None
    extra_params: dict | None = None


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
    health_meta: dict | None = None
    error_message: str | None
    last_checked_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


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
