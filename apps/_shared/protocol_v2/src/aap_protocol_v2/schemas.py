"""ML backend 协议 v2 跨 backend 共用的请求 / 响应 Pydantic 模型。

来源：sam3-backend / grounded-sam2-backend 现有 schemas.py 的公共部分（v0.10.x ~ v0.14.x）。
单一来源后, 协议层字段命名 / 类型扩展只改这一处。

每个 backend 自己的 `Context`（prompt 字段集差异巨大）不放在这里, 由各 backend 本地定义。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class TaskItem(BaseModel):
    """`/predict` 入参里的单个 task. `id` 透传回响应, `file_path` 是图像 URL 或绝对路径."""

    id: str | int
    file_path: str


class PredictionResult(BaseModel):
    """单 task 的预测结果壳. `result` 数组里的元素结构由具体 result.type 决定
    (rectanglelabels / polygonlabels / keypointlabels 等), 在协议文档 §3 详述."""

    task: str | int | None = None
    result: list[dict[str, Any]] = Field(default_factory=list)
    score: float | None = None
    model_version: str | None = None
    inference_time_ms: int | None = None


class BatchPredictResponse(BaseModel):
    """`/predict` 顶层响应. 即便单 task 也包成 results 数组, 统一交互式 + 批量路径."""

    results: list[PredictionResult]
