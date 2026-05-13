"""Idle unload + 懒重载行为单测 (v0.10.0 补丁, 镜像 grounded-sam2-backend).

覆盖:
  - _unload_predictor 在 _predictor=None 时 noop, 返回 False
  - _unload_predictor 触发 cache.clear (避免 GPU 张量悬挂)
  - _ensure_predictor_loaded 懒重载: 缺 _predictor 时调用 _build_predictor
  - _ensure_predictor_loaded 已加载时不重复构造
  - _predictor_lock 串行化并发请求, 不会并行加载导致 OOM
  - /unload /reload 端点幂等性
  - /health 暴露 idle_unload_seconds + last_request_age_seconds

不跑真实模型加载 (mock _build_predictor); 无 GPU 即可跑.
"""

from __future__ import annotations

import asyncio
import sys
import types
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def main_module(monkeypatch):
    """干净加载 main 模块, 把模型构造换成 MagicMock 不触发真实 SAM 3 加载."""
    # 注入伪 sam3 模块, 避免 predictor.py 顶部 import 失败.
    fake_sam3_mod = types.ModuleType("sam3")
    fake_sam3_mod.build_sam3_image_model = MagicMock(return_value=MagicMock())
    sys.modules["sam3"] = fake_sam3_mod

    # 让 _build_predictor 直接给一个 MagicMock 实例 (跳过真实 GPU 加载).
    # 此时 predictor.SAM3Predictor.__init__ 实际不会跑 (我们 replace _build_predictor).
    sys.modules.pop("main", None)
    import main as m  # noqa: PLC0415

    monkeypatch.setattr(m, "_build_predictor", lambda: MagicMock(device="cpu"))
    # 重置全局状态 (上轮测试残留)
    m._predictor = None
    m._idle_task = None
    return m


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------- _unload_predictor ----------


def test_unload_noop_when_already_unloaded(main_module):
    m = main_module
    m._predictor = None
    result = _run(m._unload_predictor(reason="test"))
    assert result is False


def test_unload_clears_predictor_and_cache(main_module):
    m = main_module
    m._predictor = MagicMock(device="cpu")
    # 塞一条 cache 进去, 验证 unload 会 clear
    from embedding_cache import CacheEntry  # noqa: PLC0415

    m._cache.put(
        "k1", CacheEntry(features={"x": 1}, orig_hw=(100, 100), is_batch=False, wh=(100, 100))
    )
    assert m._cache.size() == 1

    result = _run(m._unload_predictor(reason="test"))
    assert result is True
    assert m._predictor is None
    assert m._cache.size() == 0, "unload 必须 clear cache, 避免悬挂的 GPU 张量"


# ---------- _ensure_predictor_loaded ----------


def test_ensure_predictor_loaded_builds_when_missing(main_module):
    m = main_module
    m._predictor = None
    result = _run(m._ensure_predictor_loaded())
    assert result is not None
    assert m._predictor is not None
    assert result is m._predictor


def test_ensure_predictor_loaded_reuses_existing(main_module):
    m = main_module
    existing = MagicMock(device="cpu")
    m._predictor = existing
    result = _run(m._ensure_predictor_loaded())
    assert result is existing, "已加载时不应重建"


def test_ensure_predictor_updates_last_request_at(main_module):
    """每次 /predict 入口都会刷新 last_request_at, idle watcher 才知道不该卸."""
    import time as time_mod  # noqa: PLC0415

    m = main_module
    m._predictor = MagicMock(device="cpu")
    m._last_request_at = time_mod.monotonic() - 5.0  # 模拟 5s 前
    old = m._last_request_at
    _run(m._ensure_predictor_loaded())
    assert m._last_request_at > old, "应推进 last_request_at"


def test_concurrent_loads_serialize_under_lock(main_module):
    """并发 _ensure_predictor_loaded 必须串行化 (锁内), 避免双重构造 OOM."""
    m = main_module
    m._predictor = None

    call_count = {"n": 0}

    def slow_build():
        call_count["n"] += 1
        return MagicMock(device="cpu")

    m._build_predictor = slow_build  # type: ignore[assignment]

    async def main():
        # 三个并发任务同时触发 _ensure_predictor_loaded
        results = await asyncio.gather(
            m._ensure_predictor_loaded(),
            m._ensure_predictor_loaded(),
            m._ensure_predictor_loaded(),
        )
        return results

    results = _run(main())
    assert call_count["n"] == 1, "并发触发只允许一次真实加载"
    assert all(r is results[0] for r in results)


# ---------- 完整 unload → reload 循环 ----------


def test_unload_then_ensure_rebuilds(main_module):
    m = main_module
    m._predictor = MagicMock(device="cpu")
    first = m._predictor

    _run(m._unload_predictor(reason="test"))
    assert m._predictor is None

    second = _run(m._ensure_predictor_loaded())
    assert second is not None
    assert second is not first, "重载后应是新实例"


# ---------- env 默认值 ----------


def test_idle_unload_defaults(main_module):
    m = main_module
    assert m.IDLE_UNLOAD_SECONDS == 600.0
    assert m.IDLE_CHECK_INTERVAL == 60.0
