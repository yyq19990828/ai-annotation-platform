from __future__ import annotations

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


class DataManagerMetricOut(BaseModel):
    key: str
    label: str
    group: str


class DataManagerToolUnitOut(BaseModel):
    id: str
    classes: list[str] = Field(default_factory=list)


class DataManagerSchemaResponse(BaseModel):
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
