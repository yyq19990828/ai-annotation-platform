"""CUDA 显存释放 / 快照 (pytorch backend 共性叶子函数)。

torch 故意惰性 import 在 try 内: onnx / 纯 CPU 环境无 torch 时降级为 no-op / 返回 {}。
"""

from __future__ import annotations

import gc
from typing import Any


def free_gpu_memory() -> None:
    """显式释放 CUDA caching allocator 持有的显存, 让 nvidia-smi 立刻可见下降。

    以 sam3 / grounded-sam2 的完整版为准 (gc.collect + empty_cache + ipc_collect 容错);
    torch 不可用时仅跑 gc.collect。
    """
    gc.collect()
    try:
        import torch  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        return
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        try:
            torch.cuda.ipc_collect()
        except Exception:  # noqa: BLE001
            pass


def gpu_info_snapshot() -> dict[str, Any]:
    """torch CUDA context 视角的显存快照 (used/total/free MB 等)。

    无 torch / 无 GPU / 读取失败均返回 ``{}``。注意这是当前 CUDA 上下文的 free/total
    (多进程共享同卡会系统性低报已用显存); 各 backend 的 /health 若需整卡全局视角 (pynvml)
    或叠加 util/温度/功耗, 仍由其 observability 自行覆盖, 不消费本快照。
    """
    try:
        import torch  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        return {}
    if not torch.cuda.is_available():
        return {}
    try:
        free_b, total_b = torch.cuda.mem_get_info()
        total_mb = int(total_b / 1024**2)
        free_mb = int(free_b / 1024**2)
        return {
            "device_name": torch.cuda.get_device_name(0),
            "device_index": torch.cuda.current_device(),
            "memory_used_mb": total_mb - free_mb,
            "memory_total_mb": total_mb,
            "memory_free_mb": free_mb,
            "process_memory_mb": int(torch.cuda.memory_reserved() / 1024**2),
        }
    except Exception:  # noqa: BLE001
        return {}
