"""AI 标注平台官方 Python SDK。

公开 API 面: Client + pydantic 模型 + 异常。传输层 (_http) 是内部实现, 不要直接依赖。
"""

from ai_annotation.client import Client
from ai_annotation.errors import (
    AAPError,
    APIStatusError,
    AuthenticationError,
    ConflictError,
    JobFailedError,
    JobTimeoutError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from ai_annotation.models import (
    Annotation,
    ApiKey,
    ApiKeyCreated,
    CacheStats,
    Dataset,
    GpuInfo,
    HealthMeta,
    HostInfo,
    ImportResult,
    Job,
    JobPage,
    LinkResult,
    MLBackend,
    Page,
    Project,
    Task,
    TaskPage,
    UploadedItem,
    ZipUploadResult,
)

__version__ = "0.15.8"

__all__ = [
    "__version__",
    "Client",
    # 异常
    "AAPError",
    "APIStatusError",
    "AuthenticationError",
    "PermissionDeniedError",
    "NotFoundError",
    "ConflictError",
    "ValidationError",
    "JobFailedError",
    "JobTimeoutError",
    # 模型
    "Annotation",
    "ApiKey",
    "ApiKeyCreated",
    "CacheStats",
    "Dataset",
    "GpuInfo",
    "HealthMeta",
    "HostInfo",
    "ImportResult",
    "Job",
    "JobPage",
    "LinkResult",
    "MLBackend",
    "Page",
    "Project",
    "Task",
    "TaskPage",
    "UploadedItem",
    "ZipUploadResult",
]
