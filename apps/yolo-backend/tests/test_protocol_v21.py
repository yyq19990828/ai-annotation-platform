"""v0.14.15 protocol v2.1 request and error contract tests."""

from __future__ import annotations

import os
import sys
import tempfile
from unittest.mock import MagicMock

import pytest


@pytest.fixture(scope="module", autouse=True)
def _stub_modules() -> None:
    sys.modules.setdefault(
        "torch", MagicMock(cuda=MagicMock(is_available=MagicMock(return_value=False)))
    )
    sys.modules.setdefault("ultralytics", MagicMock())


@pytest.fixture()
def app_client():
    tmp = tempfile.mkdtemp(prefix="yolo-protocol-v21-")
    os.environ["YOLO_CHECKPOINTS_DIR"] = tmp
    import importlib
    import main

    main = importlib.reload(main)
    from fastapi.testclient import TestClient

    with TestClient(main.app) as client:
        yield main, client


class _PredictorOk:
    async def predict_one(self, file_path, ctx):
        return [], True, None, 1


class _PredictorMissingWeight:
    async def predict_one(self, file_path, ctx):
        raise FileNotFoundError("missing yolo11s.pt")


def test_predict_accepts_model_variants(app_client, monkeypatch) -> None:
    main, client = app_client
    monkeypatch.setattr(main, "_predictor", _PredictorOk())
    resp = client.post(
        "/predict",
        json={
            "tasks": [{"id": "t1", "file_path": "unused.jpg"}],
            "context": {
                "type": "detection",
                "model_variants": {"series": "yolo11", "size": "s"},
            },
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["results"][0]["model_version"] == "yolo11s"


def test_predict_accepts_legacy_variants_with_deprecation_warning(
    app_client, monkeypatch, caplog
) -> None:
    main, client = app_client
    monkeypatch.setattr(main, "_predictor", _PredictorOk())
    caplog.set_level("WARNING")
    resp = client.post(
        "/predict",
        json={
            "tasks": [{"id": "t1", "file_path": "unused.jpg"}],
            "context": {
                "type": "detection",
                "variants": {"series": "yolo11", "size": "s"},
            },
        },
    )
    assert resp.status_code == 200, resp.text
    assert "context.variants -> context.model_variants" in caplog.text


def test_predict_invalid_combo_returns_standard_422(app_client, monkeypatch) -> None:
    main, client = app_client
    monkeypatch.setattr(main, "_predictor", _PredictorOk())
    resp = client.post(
        "/predict",
        json={
            "tasks": [{"id": "t1", "file_path": "unused.jpg"}],
            "context": {
                "type": "detection",
                "model_variants": {"series": "yolov9", "size": "n"},
            },
        },
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == {
        "error_code": "variant_not_supported",
        "axis": "size",
        "value": "n",
        "allowed": ["t", "s", "m", "c", "e"],
    }


def test_predict_missing_weight_returns_503_retry_after(app_client, monkeypatch) -> None:
    main, client = app_client
    monkeypatch.setattr(main, "_predictor", _PredictorMissingWeight())
    resp = client.post(
        "/predict",
        json={
            "tasks": [{"id": "t1", "file_path": "unused.jpg"}],
            "context": {
                "type": "detection",
                "model_variants": {"series": "yolo11", "size": "s"},
            },
        },
    )
    assert resp.status_code == 503
    assert resp.headers["Retry-After"] == "30"
    assert resp.json()["detail"]["error_code"] == "model_unavailable"
