"""Request / response Pydantic schemas, aligned with docs-site/dev/reference/ml-backend-protocol.md §2.

v0.10.0 起 `Context.type` 在 grounded-sam2 的 point/bbox/polygon/text 基础上新增
`"exemplar"`: 取图中已有一个 bbox 作为视觉示例, 由 SAM 3 PCS 一步出全图相似实例的 masks.

`exemplar` 复用 `bbox` 字段承载 [x1, y1, x2, y2] (归一化 [0,1]), 语义靠 `type` 区分,
避免协议字段爆炸; apps/api 仅在项目挂了 sam3-backend 时才允许前端发起 exemplar 请求.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class TaskItem(BaseModel):
    id: str | int
    file_path: str


class Context(BaseModel):
    type: Literal["point", "bbox", "polygon", "text", "exemplar"]
    points: list[list[float]] | None = None
    labels: list[int] | None = None
    # bbox: type=bbox 时是 prompt 框; type=exemplar 时是视觉示例框 (语义靠 type 区分)
    bbox: list[float] | None = None
    text: str | None = None
    # v0.9.4 phase 2 (与 grounded-sam2 协议一致): text 路径输出形态
    output: Literal["box", "mask", "both"] = "mask"
    # v0.9.4 phase 3: shapely.simplify 像素级覆盖 (mask/both/exemplar 路径生效)
    simplify_tolerance: float | None = None
    # v0.10.0 · SAM 3 PCS exemplar / text 路径可选 score 阈值;
    # 缺省走 backend env SAM3_SCORE_THRESHOLD (默认 0.5).
    score_threshold: float | None = None

    @model_validator(mode="after")
    def _validate_required_fields(self) -> Context:
        if self.type == "exemplar":
            if self.bbox is None or len(self.bbox) != 4:
                raise ValueError("context.bbox=[x1,y1,x2,y2] required for type=exemplar")
        return self


class InteractiveRequest(BaseModel):
    task: TaskItem
    context: Context


class BatchPredictRequest(BaseModel):
    tasks: list[TaskItem]
    context: Context | None = None


class AnnotationResult(BaseModel):
    type: Literal["polygonlabels", "rectanglelabels"]
    value: dict[str, Any]
    score: float | None = None


class PredictionResult(BaseModel):
    task: str | int | None = None
    result: list[dict[str, Any]] = Field(default_factory=list)
    score: float | None = None
    model_version: str | None = None
    inference_time_ms: int | None = None


class BatchPredictResponse(BaseModel):
    results: list[PredictionResult]
