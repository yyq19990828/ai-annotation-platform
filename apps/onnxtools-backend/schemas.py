"""onnxtools-backend 请求模型。

复用共享 ``TaskItem``；``context`` 宽松接收 —— 本 backend 是单一固定 pipeline，无
variant / prompt，平台发来的 context 字段一律容忍并忽略（仅保留扩展余地）。
"""

from __future__ import annotations

from typing import Any

from aap_protocol_v2 import TaskItem
from pydantic import BaseModel


class BatchPredictRequest(BaseModel):
    """协议 v2 批量预测请求。"""

    tasks: list[TaskItem] = []
    context: dict[str, Any] = {}
