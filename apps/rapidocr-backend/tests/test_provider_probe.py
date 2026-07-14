"""RapidOCR 实际 ORT session provider 观测回归测试。"""

from __future__ import annotations

import sys
import threading
import types
from collections import OrderedDict
from types import SimpleNamespace


fake_rapidocr = types.ModuleType("rapidocr")


class _OCRVersion:
    PPOCRV5 = "PP-OCRv5"

    def __new__(cls, value):
        return value


fake_rapidocr.OCRVersion = _OCRVersion
fake_rapidocr.RapidOCR = object
sys.modules.setdefault("rapidocr", fake_rapidocr)

import main as backend_main  # noqa: E402
import predictor as predictor_module  # noqa: E402


class _FakeSession:
    def __init__(self, providers):
        self.providers = list(providers)

    def get_providers(self):
        return list(self.providers)


def _install_ort(monkeypatch, *, actual):
    module = types.ModuleType("onnxruntime")
    module.get_available_providers = lambda: [
        "CUDAExecutionProvider",
        "CPUExecutionProvider",
    ]
    calls = []

    def inference_session(path, providers):
        calls.append((path, providers))
        return _FakeSession(actual)

    module.InferenceSession = inference_session
    monkeypatch.setitem(sys.modules, "onnxruntime", module)
    return calls


def _predictor_with_engines(*engines):
    predictor = object.__new__(predictor_module.RapidOCRPredictor)
    predictor._configured_cuda = True
    predictor.use_cuda = True
    predictor._lock = threading.Lock()
    predictor._pool = OrderedDict(
        (f"engine-{index}", engine) for index, engine in enumerate(engines)
    )
    return predictor


def _engine(det, cls=None, rec=None):
    cls = det if cls is None else cls
    rec = det if rec is None else rec

    def component(session):
        return SimpleNamespace(session=SimpleNamespace(session=session))

    return SimpleNamespace(
        text_det=component(det),
        text_cls=component(cls),
        text_rec=component(rec),
    )


def test_probe_rejects_silent_cpu_fallback(monkeypatch):
    monkeypatch.setattr(predictor_module.os.path, "exists", lambda _path: True)
    monkeypatch.setattr(
        predictor_module.catalog_mod,
        "resolve",
        lambda *_args: SimpleNamespace(det_path="det.onnx"),
    )
    calls = _install_ort(monkeypatch, actual=["CPUExecutionProvider"])

    assert predictor_module._probe_ort_cuda_use() is False
    assert len(calls) == 1


def test_probe_accepts_actual_cuda_session(monkeypatch):
    monkeypatch.setattr(predictor_module.os.path, "exists", lambda _path: True)
    monkeypatch.setattr(
        predictor_module.catalog_mod,
        "resolve",
        lambda *_args: SimpleNamespace(det_path="det.onnx"),
    )
    _install_ort(
        monkeypatch,
        actual=["CUDAExecutionProvider", "CPUExecutionProvider"],
    )

    assert predictor_module._probe_ort_cuda_use() is True


def test_effective_provider_is_unknown_for_empty_pool():
    assert _predictor_with_engines().effective_provider() is None


def test_effective_provider_reads_live_cpu_sessions_even_when_cuda_requested():
    session = _FakeSession(["CPUExecutionProvider"])
    predictor = _predictor_with_engines(_engine(session))

    assert predictor.use_cuda is True
    assert predictor.effective_provider() == "CPUExecutionProvider"

    session.providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    assert predictor.effective_provider() == "CUDAExecutionProvider"


def test_effective_provider_is_unknown_for_mixed_or_missing_sessions():
    cuda = _FakeSession(["CUDAExecutionProvider"])
    cpu = _FakeSession(["CPUExecutionProvider"])
    predictor = _predictor_with_engines(_engine(cuda, cpu, cpu))
    assert predictor.effective_provider() is None

    broken_engine = _engine(cuda)
    broken_engine.text_rec = SimpleNamespace()
    predictor = _predictor_with_engines(broken_engine)
    assert predictor.effective_provider() is None


def test_health_uses_live_provider_and_declares_fallback_support(monkeypatch):
    predictor = _predictor_with_engines(
        _engine(_FakeSession(["CPUExecutionProvider"]))
    )
    predictor.pool_snapshot = lambda: {}
    monkeypatch.setattr(backend_main, "_predictor", predictor)

    assert backend_main.health()["compute"] == {
        "configured_device": "cuda",
        "effective_provider": "CPUExecutionProvider",
        "cpu_fallback_supported": True,
    }
