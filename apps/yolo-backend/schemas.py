"""yolo-backend 特有的请求 Pydantic schema.

通用部分 (TaskItem / PredictionResult / BatchPredictResponse / WarmupResponse) 从
`aap_protocol_v2` 共享包引入 (apps/_shared/protocol_v2). 这里只放 yolo 的
Context: 与 sam3/gsam2 的 prompt 驱动不同, yolo 走纯批量 + variants 驱动.
"""

from __future__ import annotations

import logging
from typing import Literal

from aap_protocol_v2 import (
    BatchPredictResponse,
    PredictionResult,
    TaskItem,
    WarmupResponse,
    log_deprecated_model_variant_fields,
    normalize_context_model_variants,
)
from pydantic import BaseModel, Field, model_validator

__all__ = [
    "BatchPredictRequest",
    "BatchPredictResponse",
    "Context",
    "InteractiveRequest",
    "PredictParams",
    "PredictionResult",
    "TaskItem",
    "Variants",
    "WarmupRequest",
    "WarmupResponse",
]

logger = logging.getLogger("yolo-backend.schemas")


class Variants(BaseModel):
    """协议 v2 多轴 variants. yolo 用 series × size 两轴."""

    series: Literal[
        "yolov8", "yolov9", "yolov10", "yolo11", "yolo12", "yolo26", "rtdetr"
    ]
    size: Literal["n", "t", "s", "m", "b", "c", "l", "e", "x"]


class PredictParams(BaseModel):
    """`/setup.params` 暴露的运行期可调超参. 与 ultralytics predict() 参数同义."""

    conf: float = Field(default=0.25, ge=0.0, le=1.0)
    iou: float = Field(default=0.70, ge=0.0, le=1.0)
    max_det: int = Field(default=300, ge=1, le=1000)


class Context(BaseModel):
    """yolo 的 prompt = none (纯批量). `type` 决定走哪条 task 分支."""

    type: Literal["detection", "segmentation", "keypoint", "obb"]
    model_variants: dict[str, str] | None = None
    variants: Variants
    params: PredictParams = Field(default_factory=PredictParams)

    @model_validator(mode="before")
    @classmethod
    def _normalize_model_variants(cls, data):
        if not isinstance(data, dict):
            return data
        normalized, deprecated = normalize_context_model_variants(data)
        log_deprecated_model_variant_fields(logger, deprecated)
        if "variants" not in normalized and "model_variants" in normalized:
            normalized["variants"] = normalized["model_variants"]
        return normalized

    @model_validator(mode="after")
    def _validate_combination(self) -> "Context":
        # 真实组合是否在 MODEL_MATRIX 内, 留到 main /predict 处理;
        # schema 层只防住 enum 之外的 series/size 字符串拼写错误.
        return self


class InteractiveRequest(BaseModel):
    """yolo 不做交互式, 保留 schema 名仅为与 sam3/gsam2 协议形态对齐 (单 task /predict 路径).

    实际 yolo 没有交互式分支, main 收到也走批量 predictor."""

    task: TaskItem
    context: Context


class BatchPredictRequest(BaseModel):
    tasks: list[TaskItem]
    context: Context


class WarmupRequest(BaseModel):
    """v0.14.14 协议 §4.4 `/warmup` 请求体. 与 predict context 结构相近, 但不带图像."""

    task: Literal["detection", "segmentation", "keypoint", "obb"]
    variants: Variants
