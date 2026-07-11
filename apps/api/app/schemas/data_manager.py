from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


DataManagerValueType = Literal[
    "text",
    "number",
    "boolean",
    "select",
    "multiselect",
    "datetime",
]
DataManagerEntityScope = Literal["tasks", "objects", "tracks"]


class DataManagerProjectKindOut(BaseModel):
    data_type: str
    type_key: str
    scene_mode: bool


class DataManagerOptionOut(BaseModel):
    value: str
    label: str


class DataManagerFilterFieldOut(BaseModel):
    key: str
    label: str
    group: str
    value_type: DataManagerValueType
    operators: list[str]
    options: list[DataManagerOptionOut] = Field(default_factory=list)
    expensive: bool = False
    tool_unit_id: str | None = None
    attribute_key: str | None = None


class DataManagerColumnOut(BaseModel):
    key: str
    label: str
    group: str
    default: bool = False
    expensive: bool = False
    sortable: bool = False
    sort_field: str | None = None


class DataManagerMetricOut(BaseModel):
    key: str
    label: str
    group: str


class DataManagerToolUnitOut(BaseModel):
    id: str
    classes: list[str] = Field(default_factory=list)


class DataManagerSchemaResponse(BaseModel):
    entity_scope: DataManagerEntityScope = "tasks"
    available_entity_scopes: list[DataManagerEntityScope] = Field(
        default_factory=lambda: ["tasks", "objects"]
    )
    project_kind: DataManagerProjectKindOut
    tool_units: list[DataManagerToolUnitOut] = Field(default_factory=list)
    filter_fields: list[DataManagerFilterFieldOut] = Field(default_factory=list)
    columns: list[DataManagerColumnOut] = Field(default_factory=list)
    default_columns: list[str] = Field(default_factory=list)
    sort_fields: list[DataManagerOptionOut] = Field(default_factory=list)
    metrics: list[DataManagerMetricOut] = Field(default_factory=list)
    builtin_views: list[str] = Field(default_factory=list)


class DataManagerSummaryRequest(BaseModel):
    filter_json: dict[str, Any] = Field(default_factory=dict)
    dimensions: list[str] = Field(default_factory=list)


class DataManagerScopeSummary(BaseModel):
    visible_task_total: int = 0
    matched_task_total: int = 0


class DataManagerAnnotationSummary(BaseModel):
    total: int = 0
    single_frame: int = 0
    tracked: int = 0
    distinct_tracks: int = 0
    imported: int = 0
    by_source: dict[str, int] = Field(default_factory=dict)
    by_class: dict[str, int] = Field(default_factory=dict)
    by_tool_unit: dict[str, int] = Field(default_factory=dict)
    by_type: dict[str, int] = Field(default_factory=dict)


class DataManagerAiReviewSummary(BaseModel):
    prediction_shapes: int = 0
    tracker_jobs: int = 0


class DataManagerAttributeSummary(BaseModel):
    tool_unit_id: str
    key: str
    label: str
    eligible: int = 0
    present: int = 0
    missing: int = 0
    values: dict[str, int] = Field(default_factory=dict)


class DataManagerSummaryResponse(BaseModel):
    scope: DataManagerScopeSummary
    task_status: dict[str, int] = Field(default_factory=dict)
    annotations: DataManagerAnnotationSummary
    ai_review: DataManagerAiReviewSummary
    unresolved_feedback: int = 0
    attributes: list[DataManagerAttributeSummary] = Field(default_factory=list)
    kind_metrics: dict[str, int | float | None] = Field(default_factory=dict)


class DataManagerMatchesRequest(BaseModel):
    filter_json: dict[str, Any] = Field(default_factory=dict)
    limit: int = Field(default=100, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class DataManagerMatchItem(BaseModel):
    entity_kind: Literal["annotation", "prediction_shape", "tracker_job"]
    id: UUID
    shape_index: int | None = None
    track_id: str | None = None
    class_name: str | None = None
    tool_unit_id: str | None = None
    annotation_type: str | None = None
    source: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    frame_index: int | None = None


class DataManagerMatchesResponse(BaseModel):
    task_id: UUID
    items: list[DataManagerMatchItem] = Field(default_factory=list)
    total: int = 0
    limit: int
    offset: int


class DataManagerEntityQueryRequest(BaseModel):
    filter_json: dict[str, Any] = Field(default_factory=dict)
    sort_json: list[dict[str, Any]] = Field(default_factory=list)
    columns_json: list[str] = Field(default_factory=list)
    limit: int = Field(default=50, ge=1, le=200)
    cursor: str | None = Field(default=None, max_length=2048)


class DataManagerEntityLocation(BaseModel):
    project_id: UUID
    task_id: UUID
    task_display_id: str
    batch_id: UUID | None = None
    dataset_item_id: UUID | None = None
    data_type: str
    focus_kind: Literal["annotation", "track"]
    annotation_id: UUID | None = None
    track_id: str | None = None
    scene_id: UUID | None = None
    scene_name: str | None = None
    scene_frame_index: int | None = None
    video_frame_index: int | None = None


class DataManagerObjectOut(BaseModel):
    entity_key: str
    annotation_id: UUID
    task_id: UUID
    task_display_id: str
    file_name: str | None = None
    batch_id: UUID | None = None
    class_name: str
    tool_unit_id: str
    annotation_type: str
    source: str
    imported: bool = False
    confidence: float | None = None
    track_id: str | None = None
    parent_prediction_id: UUID | None = None
    parent_annotation_id: UUID | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    attribute_origins: dict[str, str] = Field(default_factory=dict)
    created_by_id: UUID | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    unresolved_feedback_count: int = 0
    location: DataManagerEntityLocation


class DataManagerEntityFacets(BaseModel):
    matched_total: int = 0
    task_total: int = 0
    by_class: dict[str, int] = Field(default_factory=dict)
    by_source: dict[str, int] = Field(default_factory=dict)
    by_tool_unit: dict[str, int] = Field(default_factory=dict)
    by_type: dict[str, int] = Field(default_factory=dict)
    by_quality: dict[str, int] = Field(default_factory=dict)


class DataManagerObjectQueryResponse(BaseModel):
    items: list[DataManagerObjectOut] = Field(default_factory=list)
    total: int
    limit: int
    next_cursor: str | None = None
    facets: DataManagerEntityFacets = Field(default_factory=DataManagerEntityFacets)


class DataManagerObjectDetailResponse(BaseModel):
    item: DataManagerObjectOut


class DataManagerTrackSourceSummary(BaseModel):
    annotation_sources: dict[str, int] = Field(default_factory=dict)
    keyframe_sources: dict[str, int] = Field(default_factory=dict)


class DataManagerTrackOut(BaseModel):
    entity_key: str
    track_ref: str
    track_kind: Literal["compact_video", "scene"]
    track_id: str
    compact_annotation_id: UUID | None = None
    class_name: str | None = None
    tool_unit_id: str | None = None
    annotation_type: str | None = None
    start_frame: int | None = None
    end_frame: int | None = None
    span: int | None = None
    occurrence_count: int = 0
    distinct_task_count: int = 0
    distinct_frame_count: int = 0
    missing_frame_count: int = 0
    duplicate_frame_count: int = 0
    keyframe_count: int = 0
    outside_range_count: int = 0
    occluded_count: int = 0
    sources: DataManagerTrackSourceSummary = Field(
        default_factory=DataManagerTrackSourceSummary
    )
    attributes: dict[str, Any] = Field(default_factory=dict)
    attribute_origins: dict[str, str] = Field(default_factory=dict)
    quality_issues: list[str] = Field(default_factory=list)
    location: DataManagerEntityLocation


class DataManagerTrackQueryResponse(BaseModel):
    items: list[DataManagerTrackOut] = Field(default_factory=list)
    total: int
    limit: int
    next_cursor: str | None = None
    facets: DataManagerEntityFacets = Field(default_factory=DataManagerEntityFacets)


class DataManagerTrackMemberOut(BaseModel):
    annotation_id: UUID
    task_id: UUID
    task_display_id: str
    class_name: str
    source: str
    frame_index: int | None = None
    keyframe_source: str | None = None
    occluded: bool = False
    outside: bool = False
    attributes: dict[str, Any] = Field(default_factory=dict)
    attribute_origins: dict[str, str] = Field(default_factory=dict)
    location: DataManagerEntityLocation


class DataManagerTrackDetailResponse(BaseModel):
    track: DataManagerTrackOut
    members: list[DataManagerTrackMemberOut] = Field(default_factory=list)
