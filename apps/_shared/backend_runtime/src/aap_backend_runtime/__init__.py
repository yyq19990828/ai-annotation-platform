"""ML backend 运行时共享无状态叶子函数。"""

from aap_backend_runtime.gpu import free_gpu_memory, gpu_info_snapshot
from aap_backend_runtime.image import fetch_image
from aap_backend_runtime.versions import versions_payload

__all__ = [
    "fetch_image",
    "free_gpu_memory",
    "gpu_info_snapshot",
    "versions_payload",
]
