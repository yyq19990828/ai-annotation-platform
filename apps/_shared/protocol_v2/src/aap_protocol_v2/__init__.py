"""ML backend 协议 v2 共享 schema + 受控词表常量。"""

from aap_protocol_v2.schemas import (
    BatchPredictResponse,
    PredictionResult,
    TaskItem,
)
from aap_protocol_v2.vocab import (
    GEOMETRY_VALUES,
    INFRA_VALUES,
    PROMPT_VALUES,
    TASK_VALUES,
)

__all__ = [
    "BatchPredictResponse",
    "GEOMETRY_VALUES",
    "INFRA_VALUES",
    "PROMPT_VALUES",
    "PredictionResult",
    "TASK_VALUES",
    "TaskItem",
]
