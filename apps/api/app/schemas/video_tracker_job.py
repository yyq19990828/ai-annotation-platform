from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


TrackerDirection = Literal["forward", "backward", "bidirectional"]
TrackerJobStatus = Literal[
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
    # v0.21.28 · 候选/接受流。
    "pending_review",
    "accepted",
    "discarded",
]


class TrackerExemplar(BaseModel):
    """v0.21.19 · text-driven 追踪 (sam3_video) 的单个视觉示例框。

    bbox: 归一化 xyxy [x1, y1, x2, y2]; label: True=正框(扩召回) / False=负框(排误检)。
    复用 sam3 图片侧 `Exemplar` 形状 (sam3-backend/schemas.py), 沿用归一化坐标红线。
    """

    bbox: list[float]
    label: bool = True

    @model_validator(mode="after")
    def _validate_bbox(self) -> "TrackerExemplar":
        if len(self.bbox) != 4:
            raise ValueError("exemplar.bbox=[x1,y1,x2,y2] required (length 4)")
        if any(not math.isfinite(v) for v in self.bbox):
            raise ValueError("exemplar.bbox must be finite (no NaN/Inf)")
        x1, y1, x2, y2 = self.bbox
        if not (0.0 <= x1 < x2 <= 1.0 and 0.0 <= y1 < y2 <= 1.0):
            raise ValueError(
                "exemplar.bbox must be normalized [x1,y1,x2,y2] with 0≤x1<x2≤1 and 0≤y1<y2≤1"
            )
        return self


class VideoTrackerPropagateRequest(BaseModel):
    from_frame: int = Field(ge=0)
    to_frame: int = Field(ge=0)
    model_key: str = Field(default="mock_bbox", min_length=1, max_length=80)
    direction: TrackerDirection = "forward"
    segment_id: UUID | None = None
    prompt: dict[str, Any] = Field(default_factory=dict)
    sam_variant: str | None = (
        None  # v0.10.36 · 透传到 adapter context (缺省后端回退 tiny)
    )
    # v0.21.19 · text-driven 追踪 (sam3_video): 文本 query + 可选视觉示例框。显式字段,
    # 由 create_tracker_job 写进 prompt JSONB、adapter 透传到 backend /predict context。
    text: str | None = Field(default=None, max_length=500)
    exemplars: list[TrackerExemplar] | None = None

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
