"""ML backend 协议 v2 共享 schema + 受控词表常量。"""

from aap_protocol_v2.errors import ModelUnavailableError, VariantNotSupportedError
from aap_protocol_v2.predict import (
    LEGACY_CONTEXT_VARIANT_FIELDS,
    log_deprecated_model_variant_fields,
    normalize_context_model_variants,
)
from aap_protocol_v2.roles import PlatformRole
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
from aap_protocol_v2.version import COMPAT_PROTOCOL_VERSIONS, PROTOCOL_VERSION

__all__ = [
    "BatchPredictResponse",
    "COMPAT_PROTOCOL_VERSIONS",
    "EvictRecord",
    "GEOMETRY_VALUES",
    "INFRA_VALUES",
    "LEGACY_CONTEXT_VARIANT_FIELDS",
    "LoadedKey",
    "ModelUnavailableError",
    "PoolStateSnapshot",
    "PoolStatus",
    "PROMPT_VALUES",
    "PROTOCOL_VERSION",
    "PredictionResult",
    "PlatformRole",
    "TASK_VALUES",
    "TaskItem",
    "VariantNotSupportedError",
    "WarmupResponse",
    "log_deprecated_model_variant_fields",
    "normalize_context_model_variants",
]
