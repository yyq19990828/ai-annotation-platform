from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class BatchCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    dataset_id: UUID | None = None
    priority: int = Field(50, ge=0, le=100)
    deadline: date | None = None
    assigned_user_ids: list[UUID] = []


class BatchUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    priority: int | None = Field(None, ge=0, le=100)
    deadline: date | None = None
    assigned_user_ids: list[UUID] | None = None


class BatchOut(BaseModel):
    id: UUID
    project_id: UUID
    dataset_id: UUID | None = None
    display_id: str
    name: str
    description: str = ""
    status: str
    priority: int = 50
    deadline: date | None = None
    assigned_user_ids: list[UUID] = []
    total_tasks: int = 0
    completed_tasks: int = 0
    review_tasks: int = 0
    approved_tasks: int = 0
    rejected_tasks: int = 0
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime | None = None
    progress_pct: float = 0.0
    review_feedback: str | None = None
    reviewed_at: datetime | None = None
    reviewed_by: UUID | None = None

    class Config:
        from_attributes = True


class BatchTransition(BaseModel):
    target_status: str


class BatchReject(BaseModel):
    feedback: str = Field(..., min_length=1, max_length=500)


class BatchSplitRequest(BaseModel):
    strategy: Literal["metadata", "id_range", "random"]
    # metadata 策略
    metadata_key: str | None = None
    metadata_value: str | None = None
    # id_range 策略
    item_ids: list[UUID] | None = None
    # random 策略
    n_batches: int | None = Field(None, ge=2, le=100)
    # 公共字段
    name_prefix: str = "Batch"
    priority: int = Field(50, ge=0, le=100)
    deadline: date | None = None
    assigned_user_ids: list[UUID] = []
