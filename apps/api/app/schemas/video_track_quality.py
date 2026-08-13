from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


PairDecision = Literal["same_track", "different_track"]


class VideoTrackPairDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    left_annotation_id: UUID
    right_annotation_id: UUID
    decision: PairDecision


class VideoTrackQualityAcceptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    pairs: list[VideoTrackPairDecision] = Field(max_length=1000)


class VideoTrackQualityRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    left_segment_id: UUID
    right_segment_id: UUID


class VideoTrackQualityIssueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    left_annotation_id: UUID | None
    right_annotation_id: UUID | None
    code: str
    frame_start: int
    frame_end: int
    metric: dict


class VideoTrackQualityRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    task_id: UUID
    left_segment_id: UUID
    right_segment_id: UUID
    async_job_id: UUID | None
    status: str
    progress_pct: int
    input_digest: str
    sampling_digest: str
    fragments: list[dict] = Field(
        default_factory=list, validation_alias="input_snapshot"
    )
    metrics: dict
    pairs: list[dict]
    error_message: str | None
    accepted_by_id: UUID | None
    accepted_at: datetime | None
    stale_at: datetime | None
    created_at: datetime
    issues: list[VideoTrackQualityIssueOut] = Field(default_factory=list)
