from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


TemporalRole = Literal["keyframe", "derived", "sample"]
SceneTrackCommandKind = Literal[
    "split", "merge", "mark_absent", "resume", "terminate", "revert"
]


class SceneTrackIntervalOut(BaseModel):
    id: UUID
    start_frame: int
    end_frame: int | None = None
    source: Literal["legacy_envelope", "manual", "imported", "derived"]
    version: int

    model_config = {"from_attributes": True}


class SceneTrackMemberSummary(BaseModel):
    total: int
    by_temporal_role: dict[str, int] = Field(default_factory=dict)
    by_source: dict[str, int] = Field(default_factory=dict)
    keyframe_frames: list[int] = Field(default_factory=list)
    derived_frames: list[int] = Field(default_factory=list)
    sample_frames: list[int] = Field(default_factory=list)


class SceneTrackDetailOut(BaseModel):
    contract_version: Literal[1] = 1
    id: UUID
    project_id: UUID
    scene_id: UUID
    scene_name: str | None = None
    track_id: str
    class_name: str
    presence_mode: Literal["inferred", "explicit"]
    attributes: dict = Field(default_factory=dict)
    attributes_meta: dict = Field(default_factory=dict)
    revision: int
    retired_at: datetime | None = None
    current_frame: int
    intervals: list[SceneTrackIntervalOut] = Field(default_factory=list)
    members: SceneTrackMemberSummary
    available_commands: list[SceneTrackCommandKind] = Field(default_factory=list)


class SceneTrackDiagnosticIssueOut(BaseModel):
    code: str
    track_id: str | None = None
    annotation_id: UUID | None = None
    frame_index: int | None = None


class SceneTrackDiagnosticReportOut(BaseModel):
    contract_version: Literal[1] = 1
    scene_id: UUID
    track_count: int
    linked_member_count: int
    issue_counts: dict[str, int] = Field(default_factory=dict)
    issues: list[SceneTrackDiagnosticIssueOut] = Field(default_factory=list)
    truncated: bool = False


class SceneTrackCommandRequest(BaseModel):
    kind: Literal["split", "merge", "mark_absent", "resume", "terminate"]
    track_id: str = Field(min_length=1, max_length=64)
    secondary_track_id: str | None = Field(default=None, min_length=1, max_length=64)
    frame_index: int | None = Field(default=None, ge=0)
    resume_frame: int | None = Field(default=None, ge=0)
    source_annotation_id: UUID | None = None
    confirm_member_deactivation: bool = False

    @model_validator(mode="after")
    def validate_kind_fields(self):
        if self.kind == "merge":
            if self.secondary_track_id is None:
                raise ValueError("secondary_track_id is required for merge")
            if self.secondary_track_id == self.track_id:
                raise ValueError("merge requires two different tracks")
        elif self.secondary_track_id is not None:
            raise ValueError("secondary_track_id is accepted only for merge")

        if self.kind in {"split", "mark_absent", "terminate"}:
            if self.frame_index is None:
                raise ValueError("frame_index is required for this command")
        elif self.kind == "resume":
            if self.resume_frame is None:
                raise ValueError("resume_frame is required for resume")
            if self.source_annotation_id is None:
                raise ValueError("source_annotation_id is required for resume")
        return self


class SceneTrackCommandExecuteRequest(SceneTrackCommandRequest):
    snapshot_token: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotency_key: str = Field(min_length=8, max_length=128)


class SceneTrackCommandMemberImpact(BaseModel):
    total: int = 0
    by_temporal_role: dict[str, int] = Field(default_factory=dict)
    frames: list[int] = Field(default_factory=list)
    requires_confirmation: bool = False


class SceneTrackCommandPreviewOut(BaseModel):
    contract_version: Literal[1] = 1
    kind: SceneTrackCommandKind
    scene_id: UUID
    scene_name: str | None = None
    track_id: str
    secondary_track_id: str | None = None
    frame_index: int | None = None
    resume_frame: int | None = None
    source_revisions: dict[str, int] = Field(default_factory=dict)
    before_intervals: dict[str, list[SceneTrackIntervalOut]] = Field(
        default_factory=dict
    )
    after_intervals: dict[str, list[SceneTrackIntervalOut]] = Field(
        default_factory=dict
    )
    affected_members: SceneTrackCommandMemberImpact
    snapshot_token: str


class SceneTrackCommandResultOut(SceneTrackCommandPreviewOut):
    operation_id: UUID
    status: Literal["committed", "reverted"] = "committed"
    created_track_id: str | None = None
    result_revisions: dict[str, int] = Field(default_factory=dict)


class SceneTrackOperationListItemOut(BaseModel):
    id: UUID
    kind: SceneTrackCommandKind
    status: Literal["committed", "reverted"]
    created_at: datetime
    completed_at: datetime
    response: SceneTrackCommandResultOut


class SceneTrackOperationListOut(BaseModel):
    contract_version: Literal[1] = 1
    operations: list[SceneTrackOperationListItemOut] = Field(default_factory=list)


class SceneTrackRevertRequest(BaseModel):
    idempotency_key: str = Field(min_length=8, max_length=128)
