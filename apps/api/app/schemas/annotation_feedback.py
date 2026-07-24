"""I18 · AnnotationFeedback 统一反馈表 schema."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

FeedbackKind = Literal["issue", "comment", "reject", "bug"]
FeedbackAnchorType = Literal["project", "task", "annotation", "pixel"]
FeedbackStatus = Literal["open", "resolved", "wont_fix"]
FeedbackSeverity = Literal["info", "warn", "blocker"]


class MaskFeedbackCompareLocator(BaseModel):
    model_config = ConfigDict(extra="forbid")

    baseline_kind: Literal[
        "previous_version",
        "tracker_candidate",
        "ai_candidate",
        "neighbor_keyframe",
    ]
    mode: Literal["overlay", "boundary", "xor", "added", "removed"]
    current_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    baseline_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    candidate_job_id: UUID | None = None
    candidate_job_revision: int | None = Field(default=None, ge=1)
    candidate_digest: str | None = None
    candidate_instance_id: str | None = None

    @model_validator(mode="after")
    def _validate_tracker_locator(self):
        tracker_values = (
            self.candidate_job_id,
            self.candidate_job_revision,
            self.candidate_digest,
        )
        if self.baseline_kind == "tracker_candidate" and any(
            value is None for value in tracker_values
        ):
            raise ValueError("tracker locator requires job, revision and digest")
        return self


class FeedbackAnchorPosition(BaseModel):
    """pixel anchor 携带的坐标 (相对 0-1 与 geometry 同语义); frame 视频时可选."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    frame: int | None = Field(default=None, ge=0)
    region_bbox: tuple[float, float, float, float] | None = None
    region_digest: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    boundary_digest: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    mask_qc_issue_id: UUID | None = None
    compare_locator: MaskFeedbackCompareLocator | None = None

    @model_validator(mode="after")
    def _validate_region_anchor(self):
        if self.region_bbox is not None:
            x0, y0, x1, y1 = self.region_bbox
            if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
                raise ValueError(
                    "region_bbox must be a normalized non-empty half-open box"
                )
        if self.boundary_digest is not None and self.region_digest is None:
            raise ValueError("boundary_digest requires region_digest")
        if self.compare_locator is not None and self.mask_qc_issue_id is None:
            raise ValueError("compare_locator requires mask_qc_issue_id")
        return self


class AnnotationFeedbackCreate(BaseModel):
    kind: FeedbackKind
    anchor_type: FeedbackAnchorType
    project_id: UUID
    task_id: UUID | None = None
    annotation_id: UUID | None = None
    anchor_position: FeedbackAnchorPosition | None = None
    severity: FeedbackSeverity | None = None
    title: str | None = Field(default=None, max_length=500)
    body: str
    attachments: list[dict[str, Any]] = []
    thread_parent_id: UUID | None = None

    @model_validator(mode="after")
    def _validate_anchor(self):
        # 同 DB CHECK 约束逻辑, 但提前到 pydantic 层给出更友好错误.
        if self.anchor_type == "project":
            if self.task_id or self.annotation_id or self.anchor_position:
                raise ValueError(
                    "project anchor must not carry task_id/annotation_id/anchor_position"
                )
        elif self.anchor_type == "task":
            if not self.task_id:
                raise ValueError("task anchor requires task_id")
            if self.annotation_id or self.anchor_position:
                raise ValueError(
                    "task anchor must not carry annotation_id/anchor_position"
                )
        elif self.anchor_type == "annotation":
            if not (self.task_id and self.annotation_id):
                raise ValueError(
                    "annotation anchor requires both task_id and annotation_id"
                )
            if self.anchor_position:
                raise ValueError("annotation anchor must not carry anchor_position")
        elif self.anchor_type == "pixel":
            if not (self.task_id and self.anchor_position):
                raise ValueError("pixel anchor requires task_id and anchor_position")
        return self


class AnnotationFeedbackPatch(BaseModel):
    status: FeedbackStatus | None = None
    severity: FeedbackSeverity | None = None
    title: str | None = Field(default=None, max_length=500)
    body: str | None = None


class AnnotationFeedbackReply(BaseModel):
    body: str
    attachments: list[dict[str, Any]] = []


class AnnotationFeedbackOut(BaseModel):
    id: UUID
    kind: FeedbackKind
    anchor_type: FeedbackAnchorType
    project_id: UUID
    task_id: UUID | None = None
    annotation_id: UUID | None = None
    anchor_position: dict[str, Any] | None = None
    status: FeedbackStatus
    severity: FeedbackSeverity | None = None
    title: str | None = None
    body: str
    author_id: UUID
    author_name: str | None = None
    attachments: list[dict[str, Any]] = []
    thread_parent_id: UUID | None = None
    is_active: bool
    resolved_at: datetime | None = None
    resolved_by_id: UUID | None = None
    created_at: datetime
    updated_at: datetime | None = None

    @field_validator("anchor_position", mode="before")
    @classmethod
    def _passthrough(cls, v):
        return v

    class Config:
        from_attributes = True


class AnnotationFeedbackListPage(BaseModel):
    items: list[AnnotationFeedbackOut]
    next_cursor: str | None = None
