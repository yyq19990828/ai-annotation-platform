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
import threading

logger = logging.getLogger("aap_backend_runtime.device")

# 已探测确定的有效推理设备 (None=未探测)。一旦退回 CPU 便 latch, 不再试 CUDA。
_effective_device_cache: str | None = None
_state_lock = threading.Lock()
_probe_lock = threading.Lock()


class DeviceUnavailableError(RuntimeError):
    """配置的 GPU 不可用，且当前 backend 不支持 CPU fallback。"""


def is_device_error(exc: BaseException) -> bool:
    """判断异常是否表明 CUDA / 驱动 / 运行时不可用。

    OOM 是容量问题，不能用永久 CPU latch 掩盖；文件、配置、权重等错误
    也不应污染进程级设备状态。检查 cause/context 链，兼容上层 wrapper 重包装异常。
    """
    parts: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        parts.append(f"{type(current).__name__}: {current}".lower())
        current = current.__cause__ or current.__context__
    message = " ".join(parts)
    if "outofmemory" in message or "out of memory" in message:
        return False
    # 这些错误通常由输入、索引或算子参数触发；即使 CUDA context 随后被污染，也不能
    # 把业务 bug 永久伪装成“设备不可用”并切到 CPU。
    non_device_markers = (
        "device-side assert",
        "illegal memory access",
        "misaligned address",
        "cudnn_status_bad_param",
        "cublas_status_invalid_value",
        "cusolver_status_invalid_value",
    )
    if any(marker in message for marker in non_device_markers):
        return False
    markers = (
        "cuda error: unknown error",
        "cuda unknown error",
        "no cuda gpus are available",
        "cuda error: initialization error",
        "cuda error: system not yet initialized",
        "cuda is not available",
        "cuda driver",
        "cuda runtime",
        "cuda initialization",
        "cuda-capable device",
        "invalid device ordinal",
        "driver shutting down",
        "found no nvidia driver",
        "not compiled with cuda",
        "no kernel image is available",
        "cudnn_status_not_initialized",
        "cudnn_status_internal_error",
        "cudnn_status_execution_failed",
        "cublas_status_not_initialized",
        "cublas_status_arch_mismatch",
        "cublas_status_execution_failed",
        "cusolver_status_not_initialized",
    )
    return any(marker in message for marker in markers)


def _probe_device(configured: str) -> str:
    if configured.strip().lower() == "cpu":
        return "cpu"
    try:
        import torch  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        logger.warning("torch 不可用; 退回 CPU 推理")
        return "cpu"
    try:
        available = torch.cuda.is_available()
    except Exception as exc:  # noqa: BLE001
        if not is_device_error(exc):
            raise
        logger.warning("CUDA 可用性检查失败 (%s): %s; 退回 CPU 推理", configured, exc)
        return "cpu"
    if not available:
        return "cpu"
    try:
        # .item() 强制同步，避免异步 CUDA 错误在 probe 返回后才暴露。
        torch.zeros(1, device=configured).item()
    except Exception as exc:  # noqa: BLE001
        if not is_device_error(exc):
            raise
        logger.warning("CUDA 探测失败 (%s): %s; 退回 CPU 推理", configured, exc)
        return "cpu"
    return configured


def effective_device(configured: str) -> str:
    """真实可用的推理设备, 缓存 (latch)。

    首次调用: 若 configured 非 cpu 且 torch.cuda 可用, 用 ``torch.zeros(1, device=)``
    真分配一块显存探测; 探测失败即 latch 为 cpu。后续调用直接返回缓存值。
    """
    global _effective_device_cache
    with _state_lock:
        if _effective_device_cache is not None:
            return _effective_device_cache

    # 真实 CUDA 操作不占 _state_lock：即使驱动调用卡住，health/latch
    # 仍能读写状态。_probe_lock 只保证首次探测最多执行一次。
    with _probe_lock:
        with _state_lock:
            if _effective_device_cache is not None:
                return _effective_device_cache
        probed = _probe_device(configured)
        with _state_lock:
            # CAS 式提交：探测期间若并发 latch 了 CPU，绝不用旧 CUDA
            # 探测结果覆盖。
            if _effective_device_cache is None:
                _effective_device_cache = probed
            return _effective_device_cache


def latch_cpu(reason: str) -> bool:
    """把有效设备单调 latch 到 CPU，返回本次是否发生状态迁移。"""
    global _effective_device_cache
    with _state_lock:
        changed = _effective_device_cache != "cpu"
        _effective_device_cache = "cpu"
    if changed:
        logger.warning("推理设备退回 CPU: %s", reason)
    return changed


def effective_device_value() -> str | None:
    """读当前缓存的设备原值, 供 ``/health`` 暴露。``None``=尚未加载/探测。"""
    with _state_lock:
        return _effective_device_cache


def require_gpu_device(configured: str = "cuda") -> str:
    """返回可用 CUDA 设备；探测落到 CPU 时明确拒绝 GPU-only backend。"""
    device = effective_device(configured)
    if not device.strip().lower().startswith("cuda"):
        raise DeviceUnavailableError(
            f"configured GPU device {configured!r} is unavailable; CPU fallback is not supported"
        )
    return device
