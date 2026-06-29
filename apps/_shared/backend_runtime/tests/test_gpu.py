"""free_gpu_memory / gpu_info_snapshot: 无 GPU (CI 常态) 时不抛错、返回 {}。"""

from __future__ import annotations

from aap_backend_runtime import free_gpu_memory, gpu_info_snapshot


def test_free_gpu_memory_no_raise() -> None:
    # 无 torch / 无 CUDA 时应是 no-op, 不抛异常。
    free_gpu_memory()


def test_gpu_info_snapshot_shape() -> None:
    snap = gpu_info_snapshot()
    assert isinstance(snap, dict)
    # 无 GPU 时空字典; 有 GPU 时含显存键。
    if snap:
        assert "memory_total_mb" in snap
        assert "memory_free_mb" in snap
        assert "memory_used_mb" in snap
