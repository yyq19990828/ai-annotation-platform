from pydantic import BaseModel, field_validator
from uuid import UUID
from datetime import datetime
from typing import Literal

from app.schemas._jsonb_types import (
    AnnotationAttributes,
    Geometry,
    ToolUnitId,
    normalize_legacy_geometry,
)


class AnnotationCreate(BaseModel):
    annotation_type: str = "bbox"
    # v0.10.17 · 工具单位; service 层据此校验 class_name ∈ project.tool_bindings[unit].
    # 旧调用方不传时默认 "bbox" 兼容向后.
    tool_unit_id: ToolUnitId = "bbox"
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
    # v0.10.5 M4-β · shape 状态位（I15）
    z_order: int | None = None
    is_locked: bool | None = None
    is_hidden: bool | None = None
    is_occluded: bool | None = None

    @field_validator("geometry", mode="before")
    @classmethod
    def _normalize_legacy(cls, v):
        return normalize_legacy_geometry(v) if v is not None else v


class AnnotationListPage(BaseModel):
    """v0.7.6 · keyset cursor 分页响应。next_cursor=None 表示已是末页。"""

    items: list["AnnotationOut"]
    next_cursor: str | None = None


class AnnotationBulkPatch(BaseModel):
    """I12 · 批量更新的字段子集.

    不允许 bulk 改 geometry (语义模糊;同一 geometry 应用到 N 个不同 shape 无意义),
    也不允许 bulk 改 tool_unit_id (会导致 class_name 校验失败).
    group_id=None 表示从原 group 移除.
    """

    class_name: str | None = None
    attributes: AnnotationAttributes | None = None
    z_order: int | None = None
    is_locked: bool | None = None
    is_hidden: bool | None = None
    is_occluded: bool | None = None
    group_id: int | None = None
    # group_id 特殊语义: explicit_clear=True 时把 group_id 置 null;
    # 单 None 字段 pydantic 无法区分"未提供"与"显式 null".
    group_id_explicit_clear: bool = False


class AnnotationBulkUpdateRequest(BaseModel):
    ids: list[UUID]
    patch: AnnotationBulkPatch


class AnnotationBulkUpdateResponse(BaseModel):
    updated_ids: list[UUID]
    updated_count: int


class AnnotationGroupRequest(BaseModel):
    """I12 · 创建/合入分组. ids 必须属于同一 task."""

    ids: list[UUID]
    task_id: UUID


class AnnotationGroupResponse(BaseModel):
    group_id: int
    affected_ids: list[UUID]


class AnnotationUngroupRequest(BaseModel):
    ids: list[UUID]


class AnnotationUngroupResponse(BaseModel):
    cleared_ids: list[UUID]
    # 若 group 仅剩 1 个成员, 该 orphan 也会被自动 ungroup; 这里列出.
    auto_cleared_orphans: list[UUID] = []


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
    operation: Literal[
        "aggregate_bboxes", "split_track", "merge_tracks", "join_tracks"
    ]
    annotation_ids: list[UUID] = []
    frame_index: int | None = None
    delete_sources: bool = True
    # v0.10.30 · D-2.5 join_tracks gap 填充模式; 仅 join_tracks 使用.
    # "interpolate": gap 端点间靠现有线性插值连接, 不写 gap outside;
    # "outside": 把 gap 区间标 outside 后合并 (与 merge_tracks 默认一致).
    gap_mode: Literal["interpolate", "outside"] = "interpolate"


class VideoTrackCompositionResponse(BaseModel):
    operation: Literal[
        "aggregate_bboxes", "split_track", "merge_tracks", "join_tracks"
    ]
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
    # v0.10.17 · 旧记录回落默认值 "bbox" (migration 已 backfill).
    tool_unit_id: ToolUnitId = "bbox"
    class_name: str
    geometry: Geometry
    confidence: float | None = None
    parent_prediction_id: UUID | None = None
    parent_annotation_id: UUID | None = None
    # I12 · 同 task 内分组序号; 与 parent_annotation_id 正交.
    group_id: int | None = None
    lead_time: float | None = None
    is_active: bool
    ground_truth: bool = False
    attributes: AnnotationAttributes = {}
    # v0.10.5 M4-β · shape 状态位（I15）；旧记录回落默认值。
    z_order: int = 0
    is_locked: bool = False
    is_hidden: bool = False
    is_occluded: bool = False
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
