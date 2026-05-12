from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


TrackerDirection = Literal["forward", "backward", "bidirectional"]
TrackerJobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class VideoTrackerPropagateRequest(BaseModel):
    from_frame: int = Field(ge=0)
    to_frame: int = Field(ge=0)
    model_key: str = Field(default="mock_bbox", min_length=1, max_length=80)
    direction: TrackerDirection = "forward"
    segment_id: UUID | None = None
    prompt: dict[str, Any] = Field(default_factory=dict)

    @field_validator("prompt")
    @classmethod
    def _prompt_must_be_object(cls, value: dict[str, Any]) -> dict[str, Any]:
        return dict(value or {})


class VideoTrackerJobOut(BaseModel):
    id: UUID
    task_id: UUID
    dataset_item_id: UUID
    annotation_id: UUID
    segment_id: UUID | None = None
    created_by: UUID | None = None
    status: TrackerJobStatus
    model_key: str
    direction: TrackerDirection
    from_frame: int
    to_frame: int
    prompt: dict[str, Any] = Field(default_factory=dict)
    event_channel: str
    celery_task_id: str | None = None
    cancel_requested_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime | None = None

    class Config:
        from_attributes = True
