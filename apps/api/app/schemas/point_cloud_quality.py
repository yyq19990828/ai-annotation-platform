from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


POINT_CLOUD_QUALITY_RULE_CODES = frozenset(
    {
        "low_point_count",
        "size_outlier",
        "ground_clearance",
        "temporal_jump",
        "track_gap",
        "track_identity_drift",
        "duplicate_track_member",
    }
)


class PointCloudQualityThresholdConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    minimum_points: int = Field(default=5, ge=0)
    ground_sample_min: int = Field(default=24, ge=3)
    ground_margin_m: float = Field(default=0.75, ge=0, le=10)
    ground_penetration_m: float = Field(default=0.2, gt=0, le=5)
    ground_float_m: float = Field(default=0.45, gt=0, le=10)
    size_min_samples: int = Field(default=8, ge=3)
    size_mad_z: float = Field(default=4.5, gt=0, le=20)
    temporal_center_jump_m: float = Field(default=4.0, gt=0, le=100)
    temporal_size_change_ratio: float = Field(default=0.6, gt=0, le=10)
    temporal_yaw_jump_rad: float = Field(default=0.8, gt=0, le=3.142)


class PointCloudQualityConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    config_revision: int = Field(default=1, ge=1)
    enabled: bool = True
    thresholds: PointCloudQualityThresholdConfig = Field(
        default_factory=PointCloudQualityThresholdConfig
    )
    enabled_rules: list[str] = Field(
        default_factory=lambda: sorted(POINT_CLOUD_QUALITY_RULE_CODES)
    )
    severity_overrides: dict[str, Literal["info", "warning", "blocker", "off"]] = Field(
        default_factory=dict
    )

    @field_validator("enabled_rules")
    @classmethod
    def _validate_enabled_rules(cls, value: list[str]) -> list[str]:
        unknown = sorted(set(value) - POINT_CLOUD_QUALITY_RULE_CODES)
        if unknown:
            raise ValueError(f"unknown point cloud quality rule: {', '.join(unknown)}")
        return sorted(set(value))

    @field_validator("severity_overrides")
    @classmethod
    def _validate_overrides(cls, value: dict[str, str]) -> dict[str, str]:
        unknown = sorted(set(value) - POINT_CLOUD_QUALITY_RULE_CODES)
        if unknown:
            raise ValueError(f"unknown point cloud quality rule: {', '.join(unknown)}")
        return dict(sorted(value.items()))


class PointCloudQualityRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Literal["project", "scene_ids", "task_ids", "annotation_ids"]
    scene_ids: list[UUID] = Field(default_factory=list, max_length=500)
    task_ids: list[UUID] = Field(default_factory=list, max_length=2000)
    annotation_ids: list[UUID] = Field(default_factory=list, max_length=5000)
    expected_versions: dict[str, int] = Field(default_factory=dict)

    @field_validator("scene_ids", "task_ids", "annotation_ids")
    @classmethod
    def _canonical_ids(cls, value: list[UUID]) -> list[UUID]:
        return sorted(set(value), key=str)

    @field_validator("expected_versions")
    @classmethod
    def _canonical_versions(cls, value: dict[str, int]) -> dict[str, int]:
        return dict(sorted((str(UUID(key)), version) for key, version in value.items()))

    @model_validator(mode="after")
    def _validate_scope(self):
        ids = {
            "scene_ids": self.scene_ids,
            "task_ids": self.task_ids,
            "annotation_ids": self.annotation_ids,
        }
        if self.scope == "project" and any(ids.values()):
            raise ValueError("project scope cannot include ids")
        for name, values in ids.items():
            if self.scope == name and not values:
                raise ValueError(f"{name} scope requires ids")
            if self.scope != name and values:
                raise ValueError(f"{self.scope} scope cannot include {name}")
        return self


class PointCloudQualityRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    async_job_id: UUID | None
    status: str
    progress_pct: int
    scope_json: dict[str, Any]
    config_revision: int
    config_digest: str
    source_snapshot_digest: str
    summary: dict[str, Any]
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None
    reused: bool = False


class PointCloudQualityIssueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID | None
    last_seen_run_id: UUID | None
    project_id: UUID
    scene_id: UUID
    task_id: UUID | None
    annotation_id: UUID | None
    annotation_version: int | None
    scene_track_id: UUID | None
    track_revision: int | None
    related_annotation_ids: list[UUID]
    source_versions: dict[str, int]
    code: str
    rule_version: int
    severity: Literal["blocker", "warning", "info"]
    status: Literal["open", "resolved", "wont_fix", "stale"]
    frame_start: int | None
    frame_end: int | None
    metric: dict[str, Any]
    threshold: dict[str, Any]
    evidence: dict[str, Any]
    locator: dict[str, Any]
    suggested_command: str | None
    resolution_reason: str | None
    resolved_by_id: UUID | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime


class PointCloudQualityIssuePage(BaseModel):
    items: list[PointCloudQualityIssueOut]
    total: int


class PointCloudQualityIssuePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["open", "resolved", "wont_fix"]
    reason: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _require_wont_fix_reason(self):
        if self.status == "wont_fix" and not (self.reason or "").strip():
            raise ValueError("wont_fix requires a reason")
        return self
