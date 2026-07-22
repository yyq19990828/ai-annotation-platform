from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.annotation import AnnotationOut


ConversionTarget = Literal["mask", "polygon", "bbox"]
ConversionOperation = Literal["copy", "replace"]
ConversionScope = Literal["image", "current_frame", "keyframes"]


class AnnotationConversionDryRunRequest(BaseModel):
    annotation_ids: list[UUID] = Field(min_length=1, max_length=100)
    target: ConversionTarget
    operation: ConversionOperation = "copy"
    scope: ConversionScope
    frame_index: int | None = Field(default=None, ge=0)
    materialize_held: bool = False

    model_config = ConfigDict(extra="forbid")

    @field_validator("annotation_ids")
    @classmethod
    def _unique_annotation_ids(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("annotation_ids must be unique")
        return value

    @model_validator(mode="after")
    def _validate_scope(self):
        if self.scope == "image":
            if self.frame_index is not None or self.materialize_held:
                raise ValueError(
                    "image scope must not include frame_index or materialize_held"
                )
            return self
        if self.scope == "current_frame" and self.frame_index is None:
            raise ValueError("current_frame scope requires frame_index")
        if self.scope == "keyframes" and self.frame_index is not None:
            raise ValueError("keyframes scope must not include frame_index")
        if self.scope == "keyframes" and self.materialize_held:
            raise ValueError("keyframes scope does not materialize held frames")
        return self


class AnnotationConversionItemReport(BaseModel):
    source_annotation_id: UUID
    source_type: str
    target_type: str
    source_version: int = Field(ge=1)
    frame_indexes: list[int] = Field(default_factory=list)
    result_count: int = Field(ge=1)
    source_area_pixels: int = Field(ge=0)
    target_area_pixels: int = Field(ge=0)
    changed_pixels: int = Field(ge=0)
    source_components: int = Field(ge=0)
    target_components: int = Field(ge=0)
    source_holes: int = Field(ge=0)
    target_holes: int = Field(ge=0)
    source_vertices: int = Field(ge=0)
    target_vertices: int = Field(ge=0)
    materialized_held_frames: int = Field(ge=0)
    lossy: bool
    reasons: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class AnnotationConversionSummary(BaseModel):
    source_count: int = Field(ge=1)
    result_count: int = Field(ge=1)
    materialized_held_frames: int = Field(ge=0)
    lossy_count: int = Field(ge=0)

    model_config = ConfigDict(extra="forbid")


class AnnotationConversionDryRunResponse(BaseModel):
    plan_token: str
    expires_at: datetime
    target: ConversionTarget
    operation: ConversionOperation
    scope: ConversionScope
    items: list[AnnotationConversionItemReport]
    summary: AnnotationConversionSummary

    model_config = ConfigDict(extra="forbid")


class AnnotationConversionExecuteRequest(BaseModel):
    plan_token: str = Field(
        min_length=32,
        max_length=128,
        pattern=r"^cvp_[A-Za-z0-9_-]+$",
    )
    idempotency_key: str = Field(
        min_length=16,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    confirm_replace: bool = False
    confirm_lossy: bool = False

    model_config = ConfigDict(extra="forbid")


class AnnotationConversionLineageOut(BaseModel):
    source_annotation_id: UUID | None = None
    result_annotation_id: UUID | None = None
    source_version: int | None = None
    result_version: int | None = None
    frame_index: int | None = None


class AnnotationConversionExecuteResponse(BaseModel):
    operation_id: UUID
    updated_annotations: list[AnnotationOut] = Field(default_factory=list)
    created_annotations: list[AnnotationOut] = Field(default_factory=list)
    deleted_annotation_ids: list[UUID] = Field(default_factory=list)
    lineage_edges: list[AnnotationConversionLineageOut] = Field(default_factory=list)
    report: AnnotationConversionSummary
    idempotent_replay: bool = False

    model_config = ConfigDict(extra="forbid")
