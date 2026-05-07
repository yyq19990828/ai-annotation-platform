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
