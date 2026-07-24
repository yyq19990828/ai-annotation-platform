"""effective_device / latch_cpu / effective_device_value: 探测 + latch 行为。

CI 常态无 GPU, 这些测试覆盖: configured=cpu 直返、无 torch 回退、latch 生效、缓存语义。
"""

from __future__ import annotations

import threading

import pytest

import aap_backend_runtime.device as device_mod
from aap_backend_runtime import (
    DeviceUnavailableError,
    effective_device,
    effective_device_value,
    latch_cpu,
    require_gpu_device,
)
from aap_backend_runtime.device import is_device_error


@pytest.fixture(autouse=True)
def _reset_cache():
    """每个测试前重置模块级 cache, 避免跨测试 latch 污染。"""
    with device_mod._state_lock:
        device_mod._effective_device_cache = None
    yield
    with device_mod._state_lock:
        device_mod._effective_device_cache = None


def test_configured_cpu_short_circuits() -> None:
    """configured='cpu' 直接返回 cpu, 不触发 torch import / 探测。"""
    assert effective_device("cpu") == "cpu"


def test_latch_then_effective_returns_cpu() -> None:
    """latch_cpu 后 effective_device 不再试 CUDA, 即便 configured 非 cpu。"""
    latch_cpu("test reason")
    assert effective_device("cuda:0") == "cpu"


def test_effective_device_value_none_before_probe() -> None:
    """未探测前 effective_device_value() 返回 None。"""
    assert effective_device_value() is None


def test_effective_device_value_after_cpu_config() -> None:
    """configured=cpu 探测后值为 'cpu'。"""
    effective_device("cpu")
    assert effective_device_value() == "cpu"


def test_no_torch_falls_back_to_cpu(monkeypatch) -> None:
    """configured 非 cpu 但 torch 不可用时回退 cpu。"""
    import builtins

    real_import = builtins.__import__

    def _block_torch(name, *args, **kwargs):
        if name == "torch":
            raise ModuleNotFoundError("simulated no torch")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _block_torch)
    assert effective_device("cuda:0") == "cpu"
    assert effective_device_value() == "cpu"


def test_cuda_probe_failure_latches_cpu(monkeypatch) -> None:
    """configured 非 cpu + torch.cuda.is_available()==True 但 torch.zeros 抛错 → latch cpu。"""
    import sys
    import types

    # 构造一个 mock torch 模块: is_available 返 True, zeros 抛错。
    mock_torch = types.ModuleType("torch")
    mock_cuda = types.ModuleType("torch.cuda")
    mock_cuda.is_available = lambda: True
    mock_torch.cuda = mock_cuda

    def _raise(*args, **kwargs):
        raise RuntimeError("CUDA error: unknown error")

    mock_torch.zeros = _raise
    monkeypatch.setitem(sys.modules, "torch", mock_torch)
    monkeypatch.setitem(sys.modules, "torch.cuda", mock_cuda)

    assert effective_device("cuda:0") == "cpu"
    assert effective_device_value() == "cpu"

    # 二次调用精确不再触发 probe。
    mock_torch.zeros = lambda *a, **kw: pytest.fail(
        "latched CPU must not probe CUDA again"
    )
    assert effective_device("cuda:0") == "cpu"


def test_cuda_probe_success_returns_configured(monkeypatch) -> None:
    """configured 非 cpu + torch.cuda.is_available()==True + zeros 成功 → 返 configured。"""
    import sys
    import types

    mock_torch = types.ModuleType("torch")
    mock_cuda = types.ModuleType("torch.cuda")
    mock_cuda.is_available = lambda: True
    mock_torch.cuda = mock_cuda

    class _Tensor:
        def item(self):
            return 0

    mock_torch.zeros = lambda *a, **kw: _Tensor()  # 探测成功

    monkeypatch.setitem(sys.modules, "torch", mock_torch)
    monkeypatch.setitem(sys.modules, "torch.cuda", mock_cuda)

    assert effective_device("cuda:0") == "cuda:0"
    assert effective_device_value() == "cuda:0"


def test_inflight_cuda_probe_cannot_overwrite_cpu_latch(monkeypatch) -> None:
    import sys
    import types

    entered = threading.Event()
    release = threading.Event()
    mock_torch = types.ModuleType("torch")
    mock_cuda = types.ModuleType("torch.cuda")
    mock_cuda.is_available = lambda: True
    mock_torch.cuda = mock_cuda

    class _Tensor:
        def item(self):
            entered.set()
            assert release.wait(timeout=2)
            return 0

    mock_torch.zeros = lambda *a, **kw: _Tensor()
    monkeypatch.setitem(sys.modules, "torch", mock_torch)
    monkeypatch.setitem(sys.modules, "torch.cuda", mock_cuda)

    result: list[str] = []
    thread = threading.Thread(target=lambda: result.append(effective_device("cuda:0")))
    thread.start()
    assert entered.wait(timeout=2)
    latch_cpu("concurrent CUDA failure")
    release.set()
    thread.join(timeout=2)

    assert not thread.is_alive()
    assert result == ["cpu"]
    assert effective_device_value() == "cpu"


def test_concurrent_first_probe_runs_once(monkeypatch) -> None:
    import sys
    import types

    calls = 0
    calls_lock = threading.Lock()
    mock_torch = types.ModuleType("torch")
    mock_cuda = types.ModuleType("torch.cuda")
    mock_cuda.is_available = lambda: True
    mock_torch.cuda = mock_cuda

    class _Tensor:
        def item(self):
            return 0

    def _zeros(*args, **kwargs):
        nonlocal calls
        with calls_lock:
            calls += 1
        return _Tensor()

    mock_torch.zeros = _zeros
    monkeypatch.setitem(sys.modules, "torch", mock_torch)
    monkeypatch.setitem(sys.modules, "torch.cuda", mock_cuda)

    barrier = threading.Barrier(6)
    results: list[str] = []

    def _run():
        barrier.wait()
        results.append(effective_device("cuda:0"))

    threads = [threading.Thread(target=_run) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=2)

    assert calls == 1
    assert results == ["cuda:0"] * 6


def test_non_device_probe_error_does_not_pollute_latch(monkeypatch) -> None:
    import sys
    import types

    mock_torch = types.ModuleType("torch")
    mock_cuda = types.ModuleType("torch.cuda")
    mock_cuda.is_available = lambda: True
    mock_torch.cuda = mock_cuda
    mock_torch.zeros = lambda *a, **kw: (_ for _ in ()).throw(ValueError("bad config"))
    monkeypatch.setitem(sys.modules, "torch", mock_torch)
    monkeypatch.setitem(sys.modules, "torch.cuda", mock_cuda)

    with pytest.raises(ValueError, match="bad config"):
        effective_device("cuda:0")
    assert effective_device_value() is None


@pytest.mark.parametrize(
    "message",
    [
        "CUDA error: unknown error",
        "CUDA unknown error",
        "No CUDA GPUs are available",
        "CUDA is not available",
        "CUDA error: initialization error",
        "Found no NVIDIA driver on your system",
        "CUDNN_STATUS_NOT_INITIALIZED",
    ],
)
def test_device_unavailable_errors_are_recognized(message: str) -> None:
    assert is_device_error(RuntimeError(message)) is True


@pytest.mark.parametrize(
    "message",
    [
        "CUDA error: device-side assert triggered",
        "CUDA error: an illegal memory access was encountered",
        "CUDNN_STATUS_BAD_PARAM",
        "CUBLAS_STATUS_INVALID_VALUE",
        "CUDA out of memory",
    ],
)
def test_model_or_capacity_errors_do_not_trigger_device_fallback(message: str) -> None:
    assert is_device_error(RuntimeError(message)) is False


def test_cuda_availability_failure_latches_cpu(monkeypatch) -> None:
    import sys
    import types

    mock_torch = types.ModuleType("torch")
    mock_cuda = types.ModuleType("torch.cuda")
    mock_cuda.is_available = lambda: (_ for _ in ()).throw(
        RuntimeError("No CUDA GPUs are available")
    )
    mock_torch.cuda = mock_cuda
    monkeypatch.setitem(sys.modules, "torch", mock_torch)
    monkeypatch.setitem(sys.modules, "torch.cuda", mock_cuda)

    assert effective_device("cuda") == "cpu"
    assert effective_device_value() == "cpu"


def test_non_device_availability_failure_is_not_latched(monkeypatch) -> None:
    import sys
    import types

    mock_torch = types.ModuleType("torch")
    mock_cuda = types.ModuleType("torch.cuda")
    mock_cuda.is_available = lambda: (_ for _ in ()).throw(
        ValueError("bad CUDA config")
    )
    mock_torch.cuda = mock_cuda
    monkeypatch.setitem(sys.modules, "torch", mock_torch)
    monkeypatch.setitem(sys.modules, "torch.cuda", mock_cuda)

    with pytest.raises(ValueError, match="bad CUDA config"):
        effective_device("cuda")
    assert effective_device_value() is None


def test_success_then_cpu_latch_is_monotonic(monkeypatch) -> None:
    import sys
    import types

    mock_torch = types.ModuleType("torch")
    mock_cuda = types.ModuleType("torch.cuda")
    mock_cuda.is_available = lambda: True
    mock_torch.cuda = mock_cuda

    class _Tensor:
        def item(self):
            return 0

    mock_torch.zeros = lambda *a, **kw: _Tensor()
    monkeypatch.setitem(sys.modules, "torch", mock_torch)
    monkeypatch.setitem(sys.modules, "torch.cuda", mock_cuda)

    assert effective_device("cuda") == "cuda"
    assert latch_cpu("runtime failure") is True
    assert latch_cpu("duplicate") is False
    assert effective_device("cuda") == "cpu"


def test_probe_forces_synchronization(monkeypatch) -> None:
    import sys
    import types

    sync_calls = 0
    mock_torch = types.ModuleType("torch")
    mock_cuda = types.ModuleType("torch.cuda")
    mock_cuda.is_available = lambda: True
    mock_torch.cuda = mock_cuda

    class _Tensor:
        def item(self):
            nonlocal sync_calls
            sync_calls += 1
            return 0

    mock_torch.zeros = lambda *a, **kw: _Tensor()
    monkeypatch.setitem(sys.modules, "torch", mock_torch)
    monkeypatch.setitem(sys.modules, "torch.cuda", mock_cuda)

    assert effective_device("cuda") == "cuda"
    assert sync_calls == 1


def test_require_gpu_device_rejects_cpu_selection() -> None:
    latch_cpu("test")
    with pytest.raises(DeviceUnavailableError, match="CPU fallback is not supported"):
        require_gpu_device("cuda")
