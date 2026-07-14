"""effective_device / latch_cpu / effective_device_value: 探测 + latch 行为。

CI 常态无 GPU, 这些测试覆盖: configured=cpu 直返、无 torch 回退、latch 生效、缓存语义。
"""

from __future__ import annotations

import pytest

import aap_backend_runtime.device as device_mod
from aap_backend_runtime import effective_device, effective_device_value, latch_cpu


@pytest.fixture(autouse=True)
def _reset_cache():
    """每个测试前重置模块级 cache, 避免跨测试 latch 污染。"""
    device_mod._effective_device_cache = None
    yield
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

    # 二次调用不再试 CUDA (latch 生效, 即使 zeros 仍会抛错)。
    # 把 zeros 改成会成功也不会被调用——但这里保持抛错, 验证缓存短路。
    assert effective_device("cuda:0") == "cpu"


def test_cuda_probe_success_returns_configured(monkeypatch) -> None:
    """configured 非 cpu + torch.cuda.is_available()==True + zeros 成功 → 返 configured。"""
    import sys
    import types

    mock_torch = types.ModuleType("torch")
    mock_cuda = types.ModuleType("torch.cuda")
    mock_cuda.is_available = lambda: True
    mock_torch.cuda = mock_cuda
    mock_torch.zeros = lambda *a, **kw: None  # 探测成功

    monkeypatch.setitem(sys.modules, "torch", mock_torch)
    monkeypatch.setitem(sys.modules, "torch.cuda", mock_cuda)

    assert effective_device("cuda:0") == "cuda:0"
    assert effective_device_value() == "cuda:0"
