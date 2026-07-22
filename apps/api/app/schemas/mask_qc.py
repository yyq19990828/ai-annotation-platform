from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MASK_QC_RULE_CODES = frozenset(
    {
        "empty_mask",
        "near_empty_mask",
        "touches_border",
        "small_island",
        "small_hole",
        "narrow_bridge",
        "boundary_noise",
        "derived_geometry_mismatch",
        "same_class_overlap",
        "cross_class_overlap",
        "flicker",
        "drift",
    }
)
MaskQCSeverity = Literal["info", "warning", "blocker"]
MaskQCSeverityOverride = Literal["info", "warning", "blocker", "off"]


class MaskQCSingleFrameConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    near_empty_pixels: int = Field(default=16, ge=1)
    small_component_pixels: int = Field(default=32, ge=1)
    small_component_ratio: float = Field(default=0.005, ge=0, le=1)
    small_hole_pixels: int = Field(default=32, ge=1)
    narrow_bridge_width: int = Field(default=2, ge=1, le=16)
    boundary_noise_ratio: float = Field(default=0.15, ge=0, le=1)
    bbox_iou_min: float = Field(default=0.98, ge=0, le=1)
    overlap_pixels: int = Field(default=1, ge=1)


class MaskQCTemporalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sample_step: int = Field(default=1, ge=1)
    iou_drop: float = Field(default=0.35, ge=0, le=1)
    centroid_shift_diagonal: float = Field(default=0.15, ge=0, le=1)
    area_change_ratio: float = Field(default=0.50, ge=0)
    component_delta: int = Field(default=2, ge=0)
    flicker_max_frames: int = Field(default=2, ge=1)
    drift_min_consecutive: int = Field(default=3, ge=1)


class MaskQCConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    config_revision: int = Field(default=1, ge=1)
    enabled: bool = True
    blocking: bool = False
    auto_run: Literal["off", "manual", "on_review_submit"] = "on_review_submit"
    single_frame: MaskQCSingleFrameConfig = Field(
        default_factory=MaskQCSingleFrameConfig
    )
    temporal: MaskQCTemporalConfig = Field(default_factory=MaskQCTemporalConfig)
    severity_overrides: dict[str, MaskQCSeverityOverride] = Field(default_factory=dict)

    @field_validator("severity_overrides")
    @classmethod
    def _known_rule_codes(
        cls, value: dict[str, MaskQCSeverityOverride]
    ) -> dict[str, MaskQCSeverityOverride]:
        unknown = sorted(set(value) - MASK_QC_RULE_CODES)
        if unknown:
            raise ValueError(f"unknown Mask QC rule code: {', '.join(unknown)}")
        return value


class MaskQCRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Literal["project", "task_ids", "annotation_ids"]
    task_ids: list[UUID] = Field(default_factory=list, max_length=1000)
    annotation_ids: list[UUID] = Field(default_factory=list, max_length=1000)
    expected_versions: dict[str, int] = Field(default_factory=dict)

    @field_validator("task_ids", "annotation_ids")
    @classmethod
    def _canonical_ids(cls, value: list[UUID]) -> list[UUID]:
        return sorted(set(value), key=str)

    @field_validator("expected_versions")
    @classmethod
    def _valid_expected_versions(cls, value: dict[str, int]) -> dict[str, int]:
        canonical: dict[str, int] = {}
        for key, version in value.items():
            annotation_id = str(UUID(key))
            if version < 1:
                raise ValueError("expected annotation versions must be positive")
            if annotation_id in canonical and canonical[annotation_id] != version:
                raise ValueError("duplicate expected annotation version")
            canonical[annotation_id] = version
        return dict(sorted(canonical.items()))

    @model_validator(mode="after")
    def _scope_shape(self) -> "MaskQCRunRequest":
        if self.scope == "project" and (self.task_ids or self.annotation_ids):
            raise ValueError("project scope cannot include task_ids or annotation_ids")
        if self.scope == "task_ids" and (not self.task_ids or self.annotation_ids):
            raise ValueError("task_ids scope requires only task_ids")
        if self.scope == "annotation_ids" and (
            not self.annotation_ids or self.task_ids
        ):
            raise ValueError("annotation_ids scope requires only annotation_ids")
        return self


class MaskQCRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    async_job_id: UUID | None
    status: str
    progress_pct: int
    config_revision: int
    config_digest: str
    source_snapshot_digest: str
    source_versions: dict[str, int]
    summary: dict[str, Any]
    created_at: datetime
    completed_at: datetime | None
    reused: bool = False


class MaskQCIssueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID | None
    last_seen_run_id: UUID | None
    project_id: UUID
    task_id: UUID
    annotation_id: UUID
    annotation_version: int
    related_annotation_ids: list[UUID]
    source_versions: dict[str, int]
    code: str
    severity: MaskQCSeverity
    status: str
    effective_status: str
    frame_start: int | None
    frame_end: int | None
    metric: dict[str, Any]
    threshold: dict[str, Any]
    region_bbox: dict[str, Any] | None
    region_mask_ref: dict[str, Any] | None
    region_digest: str | None
    source: dict[str, Any]
    suggestion: str | None
    resolved_by_id: UUID | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MaskQCIssuePage(BaseModel):
    items: list[MaskQCIssueOut]
    next_cursor: str | None = None


class MaskQCIssuePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["open", "resolved", "wont_fix"]


class TaskMaskQCSummary(BaseModel):
    task_id: UUID
    run_id: UUID | None
    qc_digest: str | None
    source_snapshot_digest: str | None
    status: Literal[
        "not_applicable",
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "stale",
    ]
    counts: dict[str, int] = Field(default_factory=dict)
    blocking: bool = False
