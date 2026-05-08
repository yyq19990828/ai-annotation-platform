from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from app.schemas._jsonb_types import AttributeSchema, ClassesConfig


class ProjectCreate(BaseModel):
    name: str
    type_label: str
    type_key: str
    classes: list[str] = []
    classes_config: ClassesConfig | None = None
    attribute_schema: AttributeSchema | None = None
    ai_enabled: bool = False
    ai_model: str | None = None
    # v0.8.6 F3 · 真实绑定 MLBackend；为 None 表示未绑定（ai_model 仍可作为 display hint）
    ml_backend_id: UUID | None = None
    # v0.9.7 · 从 wizard step 4 选一个全局已注册 backend, 后端复制 row 入新项目.
    # 与 ml_backend_id 互斥: 直接给 ml_backend_id 表示已存在本项目下的 backend (罕见);
    # 给 ml_backend_source_id 表示"从其它项目复用一份配置".
    ml_backend_source_id: UUID | None = None
    due_date: date | None = None
    box_threshold: Annotated[float, Field(ge=0.0, le=1.0)] | None = None
    text_threshold: Annotated[float, Field(ge=0.0, le=1.0)] | None = None
    text_output_default: Literal["box", "mask", "both"] | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    type_label: str | None = None
    type_key: str | None = None
    status: str | None = None
    classes: list[str] | None = None
    classes_config: ClassesConfig | None = None
    attribute_schema: AttributeSchema | None = None
    ai_enabled: bool | None = None
    ai_model: str | None = None
    # v0.8.6 F3 · 显式 None 表示解绑（与 ProjectOut 序列化对齐；handler 区分 unset vs None）
    ml_backend_id: UUID | None = None
    due_date: date | None = None
    sampling: str | None = None
    maximum_annotations: int | None = None
    show_overlap_first: bool | None = None
    iou_dedup_threshold: Annotated[float, Field(ge=0.3, le=0.95)] | None = None
    # v0.9.2 · DINO 阈值项目级 override
    box_threshold: Annotated[float, Field(ge=0.0, le=1.0)] | None = None
    text_threshold: Annotated[float, Field(ge=0.0, le=1.0)] | None = None
    # v0.9.5 · 工作台 SamTextPanel 默认输出形态（None 走 type_key 智能默认）
    text_output_default: Literal["box", "mask", "both"] | None = None


class ProjectBatchSummary(BaseModel):
    total: int = 0
    assigned: int = 0
    in_review: int = 0


class ProjectOut(BaseModel):
    id: UUID
    organization_id: UUID | None = None
    display_id: str
    name: str
    type_label: str
    type_key: str
    owner_id: UUID
    owner_name: str | None = None
    member_count: int = 0
    status: str
    ai_enabled: bool
    ai_model: str | None
    ml_backend_id: UUID | None = None
    classes: list[str] = []
    classes_config: ClassesConfig = {}
    attribute_schema: AttributeSchema = AttributeSchema()
    label_config: dict = {}
    sampling: str = "sequence"
    maximum_annotations: int = 1
    show_overlap_first: bool = False
    iou_dedup_threshold: float = 0.7
    box_threshold: float = 0.35
    text_threshold: float = 0.25
    text_output_default: str | None = None
    model_version: str | None = None
    task_lock_ttl_seconds: int = 300
    total_tasks: int
    completed_tasks: int
    review_tasks: int
    in_progress_tasks: int = 0
    ai_completed_tasks: int = 0
    batch_summary: ProjectBatchSummary = ProjectBatchSummary()
    due_date: date | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProjectStats(BaseModel):
    total_data: int
    completed: int
    ai_rate: float
    pending_review: int
    total_annotations: int = 0
    ai_derived_annotations: int = 0


class ProjectMemberOut(BaseModel):
    id: UUID
    user_id: UUID
    user_name: str
    user_email: str
    role: str
    assigned_at: datetime

    class Config:
        from_attributes = True


class ProjectMemberCreate(BaseModel):
    user_id: UUID
    role: Literal["annotator", "reviewer"]


class ProjectTransferRequest(BaseModel):
    new_owner_id: UUID
