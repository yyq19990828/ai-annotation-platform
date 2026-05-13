from pydantic import BaseModel, field_validator
from uuid import UUID
from datetime import datetime
from typing import Literal

from app.schemas._jsonb_types import (
    AnnotationAttributes,
    Geometry,
    normalize_legacy_geometry,
)


class AnnotationCreate(BaseModel):
    annotation_type: str = "bbox"
    class_name: str
    geometry: Geometry
    confidence: float | None = None
    parent_prediction_id: UUID | None = None
    lead_time: float | None = None
    attributes: AnnotationAttributes | None = None

    @field_validator("geometry", mode="before")
    @classmethod
    def _normalize_legacy(cls, v):
        return normalize_legacy_geometry(v)


class AnnotationUpdate(BaseModel):
    geometry: Geometry | None = None
    class_name: str | None = None
    confidence: float | None = None
    attributes: AnnotationAttributes | None = None

    @field_validator("geometry", mode="before")
    @classmethod
    def _normalize_legacy(cls, v):
        return normalize_legacy_geometry(v) if v is not None else v


class AnnotationListPage(BaseModel):
    """v0.7.6 · keyset cursor 分页响应。next_cursor=None 表示已是末页。"""

    items: list["AnnotationOut"]
    next_cursor: str | None = None


class VideoTrackConvertToBboxesRequest(BaseModel):
    operation: Literal["copy", "split"] = "copy"
    scope: Literal["frame", "track"] = "frame"
    frame_index: int | None = None
    frame_mode: Literal["keyframes", "all_frames"] = "keyframes"


class VideoTrackConvertToBboxesResponse(BaseModel):
    source_annotation: "AnnotationOut | None"
    created_annotations: list["AnnotationOut"]
    deleted_source: bool
    removed_frame_indexes: list[int] = []


class VideoTrackCompositionRequest(BaseModel):
    operation: Literal["aggregate_bboxes", "split_track", "merge_tracks"]
    annotation_ids: list[UUID] = []
    frame_index: int | None = None
    delete_sources: bool = True


class VideoTrackCompositionResponse(BaseModel):
    operation: Literal["aggregate_bboxes", "split_track", "merge_tracks"]
    updated_annotations: list["AnnotationOut"] = []
    created_annotations: list["AnnotationOut"] = []
    deleted_annotation_ids: list[UUID] = []


class AnnotationOut(BaseModel):
    id: UUID
    task_id: UUID
    project_id: UUID | None = None
    user_id: UUID | None = None
    source: str
    annotation_type: str
    class_name: str
    geometry: Geometry
    confidence: float | None = None
    parent_prediction_id: UUID | None = None
    parent_annotation_id: UUID | None = None
    lead_time: float | None = None
    is_active: bool
    ground_truth: bool = False
    attributes: AnnotationAttributes = {}
    version: int = 1
    created_at: datetime
    updated_at: datetime | None = None

    @field_validator("geometry", mode="before")
    @classmethod
    def _normalize_legacy(cls, v):
        return normalize_legacy_geometry(v)

    class Config:
        from_attributes = True


AnnotationListPage.model_rebuild()
VideoTrackConvertToBboxesResponse.model_rebuild()
VideoTrackCompositionResponse.model_rebuild()
