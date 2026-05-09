from app.schemas._jsonb_types import BboxGeometry, PolygonGeometry
from pydantic import BaseModel
from typing import Any, Union
from uuid import UUID
from datetime import datetime


# v0.9.11 · PredictionShape — DB 存 LabelStudio 标准 {type, value, score};
# read 路径 to_internal_shape 转 {type, class_name, geometry, confidence} 后由 PredictionOut 暴露.
# 前端 codegen 据此派生 (替代 src/types/index.ts 手写). 复用 _jsonb_types.{Bbox,Polygon}Geometry,
# 保持与 AnnotationResponse.geometry 类型一致 (frontend 的 Geometry alias 同时覆盖 annotation + prediction).
# Union 含 dict fallback 兼容未知 LS 类型 (e.g. keypoints) 的 to_internal_shape 空 geometry.
class PredictionShape(BaseModel):
    type: str  # LabelStudio 类型: rectanglelabels | polygonlabels | ...
    class_name: str
    geometry: Union[BboxGeometry, PolygonGeometry, dict[str, Any]]
    confidence: float


class PredictionOut(BaseModel):
    id: UUID
    task_id: UUID
    project_id: UUID
    ml_backend_id: UUID | None = None
    model_version: str | None = None
    score: float | None = None
    result: list[PredictionShape]
    cluster: int | None = None
    created_at: datetime
    # v0.9.5 · 工作台 AIInspectorPanel 单条费用 / 推理时间透传（PredictionMeta join）
    inference_time_ms: int | None = None
    total_cost: float | None = None

    class Config:
        from_attributes = True


class PredictionMetaOut(BaseModel):
    inference_time_ms: int | None = None
    total_tokens: int | None = None
    total_cost: float | None = None

    class Config:
        from_attributes = True
