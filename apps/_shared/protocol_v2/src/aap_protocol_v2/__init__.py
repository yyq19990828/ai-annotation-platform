"""ML backend 协议 v2 共享 schema + 受控词表常量。"""

from aap_protocol_v2.schemas import (
    BatchPredictResponse,
    EvictRecord,
    LoadedKey,
    PoolStateSnapshot,
    PoolStatus,
    PredictionResult,
    TaskItem,
    WarmupResponse,
)
from aap_protocol_v2.vocab import (
    GEOMETRY_VALUES,
    INFRA_VALUES,
    PROMPT_VALUES,
    TASK_VALUES,
)

__all__ = [
    "BatchPredictResponse",
    "EvictRecord",
    "GEOMETRY_VALUES",
    "INFRA_VALUES",
    "LoadedKey",
    "PoolStateSnapshot",
    "PoolStatus",
    "PROMPT_VALUES",
    "PredictionResult",
    "TASK_VALUES",
    "TaskItem",
    "WarmupResponse",
]
