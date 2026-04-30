from pydantic import BaseModel, field_validator
from uuid import UUID
from datetime import datetime


def _validate_geometry(g: dict) -> dict:
    """v0.5.3 起 geometry 形如 {type: 'bbox'|'polygon', ...} 的 discriminated union。

    - bbox: {type:'bbox', x, y, w, h}（归一化坐标）
    - polygon: {type:'polygon', points: [[x,y], ...]}（≥3 顶点，归一化坐标）

    兼容旧客户端：未带 type 时按 bbox 处理（与 0011 migration 同口径），自动补 type。
    """
    if not isinstance(g, dict):
        raise ValueError("geometry 必须是对象")
    gtype = g.get("type")
    if gtype is None and {"x", "y", "w", "h"}.issubset(g.keys()):
        gtype = "bbox"
        g = {**g, "type": "bbox"}
    if gtype == "bbox":
        for k in ("x", "y", "w", "h"):
            if k not in g:
                raise ValueError(f"bbox geometry 缺少字段 '{k}'")
            v = g[k]
            if not isinstance(v, (int, float)):
                raise ValueError(f"bbox.{k} 应为数字")
        return g
    if gtype == "polygon":
        pts = g.get("points")
        if not isinstance(pts, list) or len(pts) < 3:
            raise ValueError("polygon 至少 3 个顶点")
        for i, pt in enumerate(pts):
            if not (isinstance(pt, (list, tuple)) and len(pt) == 2):
                raise ValueError(f"polygon.points[{i}] 必须是 [x, y]")
            if not all(isinstance(v, (int, float)) for v in pt):
                raise ValueError(f"polygon.points[{i}] 必须是数字 [x, y]")
        return g
    raise ValueError(f"不支持的 geometry.type: {gtype!r}")


class AnnotationCreate(BaseModel):
    annotation_type: str = "bbox"
    class_name: str
    geometry: dict
    confidence: float | None = None
    parent_prediction_id: UUID | None = None
    lead_time: float | None = None

    @field_validator("geometry")
    @classmethod
    def _check_geometry(cls, v: dict) -> dict:
        return _validate_geometry(v)


class AnnotationUpdate(BaseModel):
    geometry: dict | None = None
    class_name: str | None = None
    confidence: float | None = None

    @field_validator("geometry")
    @classmethod
    def _check_geometry(cls, v: dict | None) -> dict | None:
        return _validate_geometry(v) if v is not None else v


class AnnotationOut(BaseModel):
    id: UUID
    task_id: UUID
    project_id: UUID | None = None
    user_id: UUID | None = None
    source: str
    annotation_type: str
    class_name: str
    geometry: dict
    confidence: float | None = None
    parent_prediction_id: UUID | None = None
    parent_annotation_id: UUID | None = None
    lead_time: float | None = None
    is_active: bool
    ground_truth: bool = False
    created_at: datetime
    updated_at: datetime | None = None

    class Config:
        from_attributes = True
