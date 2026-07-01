"""rapidocr-backend 请求模型。

复用共享 ``TaskItem``；``context`` 宽松接收，按 ``model_id`` + ``model_variants``
（version/size/lang）路由到 det/rec/e2e 三能力 + 具体权重档（见 catalog.resolve）。
"""

from __future__ import annotations

from typing import Any

from aap_protocol_v2 import TaskItem
from pydantic import BaseModel


class BatchPredictRequest(BaseModel):
    """协议 v2 批量预测请求。"""

    tasks: list[TaskItem] = []
    context: dict[str, Any] = {}
