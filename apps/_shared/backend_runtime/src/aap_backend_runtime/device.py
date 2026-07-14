"""真实设备探测 + 失败 latch CPU (pytorch backend 共性叶子函数)。

``torch.cuda.is_available()`` 只查驱动可见性, GPU 上下文损坏 (如笔记本挂起/恢复后的
``CUDA error: unknown error``) 时它仍返回 True, 但任何 CUDA 算子会抛错。这里用一次
**真实显存分配**探测, 探测失败即退回 CPU (推理变慢但不再硬 500)。一旦退回不再回探 CUDA。

torch 故意惰性 import 在 try 内: onnx / 纯 CPU 环境无 torch 时 ``effective_device``
对非 ``"cpu"`` 配置一律回退 ``"cpu"`` (与 ``gpu.py`` 的 ``free_gpu_memory`` 一致——
torch 刻意不在本包依赖里, 避免 editable 安装覆盖 base image 预装 torch)。
"""

from __future__ import annotations

import logging

logger = logging.getLogger("aap_backend_runtime.device")

# 已探测确定的有效推理设备 (None=未探测)。一旦退回 CPU 便 latch, 不再试 CUDA。
_effective_device_cache: str | None = None


def effective_device(configured: str) -> str:
    """真实可用的推理设备, 缓存 (latch)。

    首次调用: 若 configured 非 cpu 且 torch.cuda 可用, 用 ``torch.zeros(1, device=)``
    真分配一块显存探测; 探测失败即 latch 为 cpu。后续调用直接返回缓存值。
    """
    global _effective_device_cache
    if _effective_device_cache is not None:
        return _effective_device_cache
    dev = "cpu"
    if configured != "cpu":
        try:
            import torch  # noqa: PLC0415
        except Exception:  # noqa: BLE001
            logger.warning("torch 不可用; 退回 CPU 推理")
            dev = "cpu"
        else:
            if torch.cuda.is_available():
                try:
                    torch.zeros(1, device=configured)
                    dev = configured
                except Exception as exc:  # noqa: BLE001
                    logger.warning("CUDA 探测失败 (%s): %s; 退回 CPU 推理", configured, exc)
                    dev = "cpu"
    _effective_device_cache = dev
    return dev


def latch_cpu(reason: str) -> None:
    """把有效设备 latch 到 CPU (GPU 中途失效时调用), 后续加载/推理不再试 CUDA。"""
    global _effective_device_cache
    if _effective_device_cache != "cpu":
        logger.warning("推理设备退回 CPU: %s", reason)
    _effective_device_cache = "cpu"


def effective_device_value() -> str | None:
    """读当前缓存的设备原值, 供 ``/health`` 暴露。``None``=尚未加载/探测。"""
    return _effective_device_cache
