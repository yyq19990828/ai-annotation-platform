"""3D Scene 轨迹拆分 / 合并合同。"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class TrackOperationRequest(BaseModel):
    operation: Literal["split", "merge"]
    primary_track_id: str = Field(min_length=1, max_length=64)
    secondary_track_id: str | None = Field(default=None, min_length=1, max_length=64)
    split_after_frame: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_operation_fields(self):
        if self.operation == "split":
            if self.split_after_frame is None:
                raise ValueError("split_after_frame is required for split")
            if self.secondary_track_id is not None:
                raise ValueError("secondary_track_id is not accepted for split")
        else:
            if self.secondary_track_id is None:
                raise ValueError("secondary_track_id is required for merge")
            if self.secondary_track_id == self.primary_track_id:
                raise ValueError("merge requires two different tracks")
            if self.split_after_frame is not None:
                raise ValueError("split_after_frame is not accepted for merge")
        return self


class TrackOperationExecuteRequest(TrackOperationRequest):
    snapshot_token: str = Field(pattern=r"^[0-9a-f]{64}$")


class TrackSummary(BaseModel):
    track_id: str
    class_name: str
    member_count: int
    first_frame: int
    last_frame: int


class TrackOperationCandidatesResponse(BaseModel):
    contract_version: Literal[1] = 1
    primary: TrackSummary
    candidates: list[TrackSummary] = Field(default_factory=list)
    truncated: bool = False


class TrackOperationPreviewResponse(BaseModel):
    contract_version: Literal[1] = 1
    operation: Literal["split", "merge"]
    scene_id: UUID
    scene_name: str | None = None
    primary: TrackSummary
    secondary: TrackSummary | None = None
    survivor_track_id: str
    affected_member_count: int
    rewritten_member_count: int
    snapshot_token: str


class TrackOperationResult(TrackOperationPreviewResponse):
    created_track_id: str | None = None
    updated_member_count: int
