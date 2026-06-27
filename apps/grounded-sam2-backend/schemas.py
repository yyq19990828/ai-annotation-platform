"""Request / response Pydantic schemas, aligned with docs-site/dev/ml-backend-protocol.md §2.

v0.14.12 · 通用部分 (TaskItem / PredictionResult / BatchPredictResponse) 抽到
`apps/_shared/protocol_v2/` 共享包, 单一来源避免与 sam3-backend / yolo-backend 之间
漂移. 本仓继续维护 grounded-sam2 特有的 Context + AnnotationValue + 请求壳.
"""

from __future__ import annotations

from typing import Any, Literal

from aap_protocol_v2 import (
    BatchPredictResponse,
    PredictionResult,
    TaskItem,
    WarmupResponse,
)
from pydantic import BaseModel, Field

__all__ = [
    "AnnotationResult",
    "AnnotationValue",
    "BatchPredictRequest",
    "BatchPredictResponse",
    "Context",
    "InteractiveRequest",
    "PredictionResult",
    "TaskItem",
    "WarmupRequest",
    "WarmupResponse",
]


class Context(BaseModel):
    # v0.18.17 · "bbox" 改名 "interactive_box" (单框单 mask), 统一双 backend 命名;
    # gsam2 行为不变, 仅协议名换. "bbox" 已退出交互 prompt 命名空间.
    type: Literal["point", "interactive_box", "polygon", "text"]
    points: list[list[float]] | None = None
    labels: list[int] | None = None
    bbox: list[float] | None = None
    text: str | None = None
    # v0.18.17 · point / interactive_box 单点歧义时出 3 候选 (按 SAM iou 降序); 缺省单 mask.
    multimask_output: bool = False
    # v0.9.4 phase 2 · text 模式输出形态选择 (老前端不传时仍走 mask 兼容旧行为)
    # box: 仅 DINO 出框, 跳过 SAM image embedding + mask 推理 + cv2/shapely 简化, 速度最快
    # mask: DINO → SAM mask → polygon (当前默认行为)
    # both: 同 instance 配对返回 rectanglelabels + polygonlabels
    # point/interactive_box 类型下此字段无意义 (始终走 SAM mask → polygon 路径)
    output: Literal["box", "mask", "both"] = "mask"
    # v0.9.2 项目级 DINO 阈值注入 (text 路径生效). claude[bot] P2 · [0,1] 范围守卫。
    box_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    text_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    # v0.9.4 phase 3: shapely.simplify tolerance 像素级覆盖 (None 走 predictor.DEFAULT_SIMPLIFY_TOLERANCE).
    # 仅 mask/both 路径有意义 (box 路径不简化); 大物体可调高 (2-3) 减顶点, 精细物体调低 (0.3-0.5).
    simplify_tolerance: float | None = None


class InteractiveRequest(BaseModel):
    task: TaskItem
    context: Context


class BatchPredictRequest(BaseModel):
    tasks: list[TaskItem]
    context: Context | None = None  # 批量带文本 prompt 时附带


class WarmupRequest(BaseModel):
    """v0.14.14 协议 §4.4 · /warmup 请求体.

    gsam2 同时预热 SAM + DINO 两个权重; task 字段 (detection/segmentation/
    interactive_seg/tracker) 决定 variants 必填项: detection 只需 dino_variant,
    interactive_seg/tracker 只需 sam_variant, segmentation 两个都需要.
    实际加载逻辑用 ModelPool, 缺失字段回退 backend env 默认.
    """

    task: Literal["detection", "segmentation", "interactive_seg", "tracker"] | None = None
    variants: dict[str, str] = {}


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
