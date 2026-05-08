"""Request / response Pydantic schemas, aligned with docs-site/dev/ml-backend-protocol.md §2."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class TaskItem(BaseModel):
    id: str | int
    file_path: str


class Context(BaseModel):
    type: Literal["point", "bbox", "polygon", "text"]
    points: list[list[float]] | None = None
    labels: list[int] | None = None
    bbox: list[float] | None = None
    text: str | None = None
    # v0.9.4 phase 2 · text 模式输出形态选择 (老前端不传时仍走 mask 兼容旧行为)
    # box: 仅 DINO 出框, 跳过 SAM image embedding + mask 推理 + cv2/shapely 简化, 速度最快
    # mask: DINO → SAM mask → polygon (当前默认行为)
    # both: 同 instance 配对返回 rectanglelabels + polygonlabels
    # point/bbox 类型下此字段无意义 (始终走 SAM mask → polygon 路径)
    output: Literal["box", "mask", "both"] = "mask"
    # v0.9.2 项目级 DINO 阈值注入 (text 路径生效)
    box_threshold: float | None = None
    text_threshold: float | None = None
    # v0.9.4 phase 3: shapely.simplify tolerance 像素级覆盖 (None 走 predictor.DEFAULT_SIMPLIFY_TOLERANCE).
    # 仅 mask/both 路径有意义 (box 路径不简化); 大物体可调高 (2-3) 减顶点, 精细物体调低 (0.3-0.5).
    simplify_tolerance: float | None = None


class InteractiveRequest(BaseModel):
    task: TaskItem
    context: Context


class BatchPredictRequest(BaseModel):
    tasks: list[TaskItem]
    context: Context | None = None  # 批量带文本 prompt 时附带


class AnnotationValue(BaseModel):
    points: list[list[float]] | None = None
    polygonlabels: list[str] | None = None
    x: float | None = None
    y: float | None = None
    width: float | None = None
    height: float | None = None
    rectanglelabels: list[str] | None = None


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
