from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


MaskRepairKind = Literal[
    "delete_small_islands",
    "fill_small_holes",
    "resolve_same_class_overlap",
    "rerun_local_sam",
    "rerun_tracker",
]


class MaskRepairAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issue_id: UUID
    kind: MaskRepairKind
    backend_id: UUID | None = None
    model_id: str | None = Field(default=None, min_length=1, max_length=160)
    model_key: str | None = Field(default=None, min_length=1, max_length=80)
    from_frame: int | None = Field(default=None, ge=0)
    to_frame: int | None = Field(default=None, ge=0)
    direction: Literal["forward", "backward", "bidirectional"] | None = None
    segment_id: UUID | None = None
    allow_bbox_fallback: bool = False
    text: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _kind_options(self) -> "MaskRepairAction":
        ai_options = (
            any(
                value is not None
                for value in (
                    self.backend_id,
                    self.model_id,
                    self.model_key,
                    self.from_frame,
                    self.to_frame,
                    self.direction,
                    self.segment_id,
                    self.text,
                )
            )
            or self.allow_bbox_fallback
        )
        if self.kind == "rerun_local_sam":
            if self.backend_id is None:
                raise ValueError("rerun_local_sam requires backend_id")
            if (
                any(
                    value is not None
                    for value in (
                        self.model_key,
                        self.from_frame,
                        self.to_frame,
                        self.direction,
                        self.segment_id,
                        self.text,
                    )
                )
                or self.allow_bbox_fallback
            ):
                raise ValueError("rerun_local_sam received tracker-only options")
        elif self.kind == "rerun_tracker":
            required = (
                self.backend_id,
                self.model_id,
                self.model_key,
                self.from_frame,
                self.to_frame,
                self.direction,
            )
            if any(value is None for value in required):
                raise ValueError("rerun_tracker requires backend/model/window options")
            if self.from_frame is not None and self.to_frame is not None:
                if self.from_frame > self.to_frame:
                    raise ValueError("from_frame must be <= to_frame")
        elif ai_options:
            raise ValueError("deterministic repairs do not accept backend options")
        return self


class MaskRepairDryRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actions: list[MaskRepairAction] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def _unique_issue_actions(self) -> "MaskRepairDryRunRequest":
        ids = [action.issue_id for action in self.actions]
        if len(ids) != len(set(ids)):
            raise ValueError("an issue may only appear once in a repair plan")
        return self


class MaskRepairPlanItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issue_id: UUID
    task_id: UUID | None = None
    annotation_ids: list[UUID] = Field(default_factory=list)
    kind: MaskRepairKind
    frame_index: int | None = Field(default=None, ge=0)
    source_versions: dict[str, int] = Field(default_factory=dict)
    changed_pixels: int = Field(default=0, ge=0)
    mutation_count: int = Field(default=0, ge=0)
    candidate_count: int = Field(default=0, ge=0)
    scope_fingerprint: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    skip_code: str | None = None
    skip_detail: str | None = None


class MaskRepairPlanSummary(BaseModel):
    action_count: int = Field(ge=0)
    executable_count: int = Field(ge=0)
    skipped_count: int = Field(ge=0)
    mutation_count: int = Field(ge=0)
    candidate_count: int = Field(ge=0)
    changed_pixels: int = Field(ge=0)
    shard_count: int = Field(ge=0)


class MaskRepairDryRunResponse(BaseModel):
    receipt: str
    plan_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    expires_at: datetime
    items: list[MaskRepairPlanItem]
    summary: MaskRepairPlanSummary


class MaskRepairExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    receipt: str = Field(
        min_length=32,
        max_length=128,
        pattern=r"^mrp_[A-Za-z0-9_-]+$",
    )
    plan_digest: str = Field(pattern=r"^[0-9a-f]{64}$")


class MaskRepairBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    async_job_id: UUID | None
    rollback_async_job_id: UUID | None
    status: str
    plan_digest: str
    plan: dict[str, Any]
    result: dict[str, Any]
    result_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    receipt_expires_at: datetime
    rollback_expires_at: datetime | None
    created_at: datetime
    completed_at: datetime | None
    rolled_back_at: datetime | None


class MaskRepairRollbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_result_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
