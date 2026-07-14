"""VehicleAttributePredictor 懒加载 / 卸载 / 原子接线单测（用 fake 工厂,不依赖 onnxtools）。

predictor 模块刻意不 import onnxtools——三个句柄经零参工厂注入,故可用 fake 隔离测：
- 懒加载:工厂仅首次访问时调用一次并缓存;
- loaded_count / unload:句柄计数与释放;
- detect_one:走独立 detector + class_names(dict)映射,不绕 pipeline;
- classify_one:走独立 va_classifier。
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

import predictor as pred
from predictor import VehicleAttributePredictor


class _DetResult:
    def __init__(self) -> None:
        self.boxes = [[10.0, 20.0, 110.0, 220.0]]
        self.class_ids = [2]
        self.scores = [0.91]

    def __len__(self) -> int:
        return 1


class _FakeDetector:
    def __init__(self) -> None:
        # BaseORT.class_names 是 {int: str} dict。
        self.class_names = {0: "person", 2: "car"}

    def __call__(self, img: np.ndarray) -> _DetResult:
        return _DetResult()


class _VAResult:
    labels = ["school_bus", "blue"]
    confidences = [0.93, 0.88]


class _FakeVA:
    def __call__(self, img: np.ndarray) -> _VAResult:
        return _VAResult()


class _FakePipeline:
    def __call__(self, img: np.ndarray) -> list[dict]:
        return [{"type": "car", "box2d": [10.0, 20.0, 110.0, 220.0], "score": 0.9,
                 "vehicle_type": "school_bus", "color": "blue"}]


def _counting_factory(obj):
    calls = {"n": 0}

    def factory():
        calls["n"] += 1
        return obj

    return factory, calls


@pytest.fixture
def fake_image(monkeypatch):
    """monkeypatch load_image_bgr → 固定 100x200 BGR 图,免去真实解码。"""
    img = np.zeros((200, 100, 3), dtype=np.uint8)
    monkeypatch.setattr(pred, "load_image_bgr", lambda *a, **k: img)
    return img


def _make(det=None, va=None, pipe=None):
    df, dc = _counting_factory(det or _FakeDetector())
    vf, vc = _counting_factory(va or _FakeVA())
    pf, pc = _counting_factory(pipe or _FakePipeline())
    p = VehicleAttributePredictor(detector_factory=df, va_factory=vf, pipeline_factory=pf)
    return p, dc, vc, pc


def test_no_factory_called_at_construction():
    p, dc, vc, pc = _make()
    assert (dc["n"], vc["n"], pc["n"]) == (0, 0, 0)
    assert p.loaded_count() == 0


def test_detect_only_loads_only_detector(fake_image):
    p, dc, vc, pc = _make()
    p.detect_one("x")
    # 只构造 detector,va / pipeline 不加载(detect-only 轻量性)。
    assert (dc["n"], vc["n"], pc["n"]) == (1, 0, 0)
    assert p.loaded_count() == 1


def test_classify_only_loads_only_va(fake_image):
    p, dc, vc, pc = _make()
    p.classify_one("x")
    assert (dc["n"], vc["n"], pc["n"]) == (0, 1, 0)


def test_factory_cached_across_calls(fake_image):
    p, dc, _, _ = _make()
    p.detect_one("x")
    p.detect_one("x")
    assert dc["n"] == 1  # 懒加载缓存:工厂只调一次


def test_detect_one_maps_class_name_from_dict(fake_image):
    p, *_ = _make()
    items, _ms = p.detect_one("x")
    assert len(items) == 1
    # class_id=2 → "car"(dict class_names),纯 bbox 无 attributes。
    assert items[0]["value"]["rectanglelabels"] == ["car"]
    assert "attributes" not in items[0]


def test_classify_one_emits_attributes(fake_image):
    p, *_ = _make()
    items, _ms = p.classify_one("x")
    assert items[0]["attributes"] == {"vehicle_type": "school_bus", "color": "blue"}


def test_unload_releases_all_and_counts(fake_image):
    p, dc, vc, pc = _make()
    p.detect_one("x")
    p.classify_one("x")
    assert p.loaded_count() == 2
    assert p.unload() == 2
    assert p.loaded_count() == 0
    # 卸载后再用 → 工厂重新构造。
    p.detect_one("x")
    assert dc["n"] == 2


def test_warm_default_loads_pipeline():
    """v0.18.20 · warm(None) 默认预热一锅端 pipeline; 首次 cache_hit=False。"""
    p, dc, vc, pc = _make()
    assert p.warm(None) is False  # 首次新增 → 非命中
    assert (dc["n"], vc["n"], pc["n"]) == (0, 0, 1)
    assert p.warm(None) is True  # 再次 → 已加载, 命中
    assert pc["n"] == 1  # 工厂不重复调


def test_warm_by_model_id_selects_handle():
    """v0.18.20 · warm(model_id) 选择性预热对应句柄。"""
    p, dc, vc, pc = _make()
    p.warm("vehicle-detect")
    assert (dc["n"], vc["n"], pc["n"]) == (1, 0, 0)
    p.warm("vehicle-attr-classify")
    assert (dc["n"], vc["n"], pc["n"]) == (1, 1, 0)


def test_loaded_handles_names(fake_image):
    """v0.18.20 · loaded_handles 报已加载句柄名 (供 /health.pool.loaded_keys)。"""
    p, *_ = _make()
    assert p.loaded_handles() == []
    p.detect_one("x")
    p.classify_one("x")
    assert set(p.loaded_handles()) == {"detector", "va"}


def test_class_name_of_fallbacks():
    assert pred._class_name_of({0: "a"}, 0) == "a"
    assert pred._class_name_of({0: "a"}, 9) == "unknown"
    assert pred._class_name_of(["a", "b"], 1) == "b"
    assert pred._class_name_of(["a"], 5) == "unknown"
    assert pred._class_name_of(None, 0) == "unknown"


class _FakeSession:
    def __init__(self, providers):
        self.providers = list(providers)

    def get_providers(self):
        return list(self.providers)


def test_effective_provider_is_unknown_for_lazy_empty_predictor():
    p, *_ = _make()
    assert p.effective_provider() is None


def test_effective_provider_reads_loaded_atomic_session_live():
    p, *_ = _make()
    session = _FakeSession(["CUDAExecutionProvider", "CPUExecutionProvider"])
    p._detector = SimpleNamespace(_onnx_session=session)

    assert p.effective_provider() == "CUDAExecutionProvider"

    session.providers = ["CPUExecutionProvider"]
    assert p.effective_provider() == "CPUExecutionProvider"


def test_effective_provider_requires_all_composite_sessions_to_match():
    p, *_ = _make()
    p._pipeline = SimpleNamespace(
        detector=SimpleNamespace(
            _onnx_session=_FakeSession(["CUDAExecutionProvider"])
        ),
        va_classifier=SimpleNamespace(
            _onnx_session=_FakeSession(["CPUExecutionProvider"])
        ),
    )

    assert p.effective_provider() is None


def test_effective_provider_is_unknown_when_private_session_is_missing():
    p, *_ = _make()
    p._pipeline = SimpleNamespace(
        detector=SimpleNamespace(
            _onnx_session=_FakeSession(["CUDAExecutionProvider"])
        ),
        va_classifier=SimpleNamespace(),
    )

    assert p.effective_provider() is None


def test_effective_provider_returns_unknown_after_unload():
    p, *_ = _make()
    p._va_classifier = SimpleNamespace(
        _onnx_session=_FakeSession(["CPUExecutionProvider"])
    )
    assert p.effective_provider() == "CPUExecutionProvider"

    p.unload()
    assert p.effective_provider() is None
