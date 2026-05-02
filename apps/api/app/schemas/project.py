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
    ai_enabled: bool = False
    ai_model: str | None = None
    due_date: date | None = None


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
    due_date: date | None = None
    sampling: str | None = None
    maximum_annotations: int | None = None
    show_overlap_first: bool | None = None
    iou_dedup_threshold: Annotated[float, Field(ge=0.3, le=0.95)] | None = None


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
    classes: list[str] = []
    classes_config: ClassesConfig = {}
    attribute_schema: AttributeSchema = AttributeSchema()
    label_config: dict = {}
    sampling: str = "sequence"
    maximum_annotations: int = 1
    show_overlap_first: bool = False
    iou_dedup_threshold: float = 0.7
    model_version: str | None = None
    task_lock_ttl_seconds: int = 300
    total_tasks: int
    completed_tasks: int
    review_tasks: int
    in_progress_tasks: int = 0
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
