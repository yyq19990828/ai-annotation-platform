from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Coordinate = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
SlicePoint = tuple[Coordinate, Coordinate]
IdempotencyKey = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{16,128}$")]
SliceVersion = Annotated[int, Field(ge=1, strict=True)]


class PolygonSliceCommitRequest(BaseModel):
    annotation_id: UUID
    expected_version: SliceVersion
    idempotency_key: IdempotencyKey
    cut_path: list[SlicePoint] = Field(min_length=2, max_length=256)

    model_config = ConfigDict(extra="forbid")


class AnnotationSliceRestoreRequest(BaseModel):
    target: Literal["before", "after"]
    expected_versions: dict[UUID, SliceVersion] = Field(min_length=2, max_length=2)
    idempotency_key: IdempotencyKey

    model_config = ConfigDict(extra="forbid")


class AnnotationSliceResponse(BaseModel):
    operation_id: UUID
    slice_operation_id: UUID
    source_annotation_id: UUID
    created_annotation_id: UUID
    result_versions: dict[str, int]
    active_annotation_ids: list[UUID]
    target: Literal["before", "after"]
    restore_expires_at: datetime
    idempotent_replay: bool = False
    no_op: bool = False

    model_config = ConfigDict(extra="forbid")
