"""v0.14.14 端点契约: POST /warmup + /health.pool 统一 PoolStatus 格式.

stub torch + ultralytics, 用 FastAPI TestClient 直接打 app, mock predictor 与 pool 的
回调点验证响应 body 形状.
"""

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


@pytest.fixture(scope="module")
def client():
    """启动 FastAPI TestClient. lifespan 内会建一个真实 ModelPool, 但 build_model 是
    mock (sys.modules ultralytics MagicMock), 不会真的拉权重."""
    # CHECKPOINTS_DIR 默认 /app/checkpoints, 在测试机上不可写; 改指向 tmp.
    tmp = tempfile.mkdtemp(prefix="yolo-test-")
    os.environ["YOLO_CHECKPOINTS_DIR"] = tmp
    # main 已被其他测试 import 过, 用 importlib.reload 让 env 重新生效.
    import importlib
    import main
    main = importlib.reload(main)
    from fastapi.testclient import TestClient
    with TestClient(main.app) as c:
        yield c


def test_warmup_first_call_cache_miss(client) -> None:
    resp = client.post(
        "/warmup",
        json={"task": "detection", "variants": {"series": "yolo11", "size": "s"}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["cache_hit"] is False
    assert body["model_load_ms"] is not None
    assert body["evicted"] is None


def test_warmup_second_call_cache_hit(client) -> None:
    client.post(
        "/warmup",
        json={"task": "detection", "variants": {"series": "yolo11", "size": "m"}},
    )
    resp = client.post(
        "/warmup",
        json={"task": "detection", "variants": {"series": "yolo11", "size": "m"}},
    )
    body = resp.json()
    assert body["cache_hit"] is True
    assert body["model_load_ms"] is None


def test_warmup_invalid_variant_returns_422(client) -> None:
    """yolov9 在 detection 没有 size=n 组合, 应返回 422 variant_not_supported."""
    resp = client.post(
        "/warmup",
        json={"task": "detection", "variants": {"series": "yolov9", "size": "n"}},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["error_code"] == "variant_not_supported"
    assert detail["axis"] == "size"


def test_health_pool_uses_pool_status_format(client) -> None:
    """v0.14.14: /health.pool 必须用统一 PoolStatus 格式 (cap/current_size/loaded_keys/last_evict)."""
    # 先 warmup 一个让 pool 有内容
    client.post(
        "/warmup",
        json={"task": "detection", "variants": {"series": "yolo11", "size": "s"}},
    )
    resp = client.get("/health")
    pool = resp.json()["pool"]
    assert set(pool.keys()) >= {"cap", "current_size", "loaded_keys", "last_evict"}
    assert isinstance(pool["loaded_keys"], list)
    for entry in pool["loaded_keys"]:
        assert set(entry.keys()) >= {"key", "loaded_at", "last_used_at", "hit_count"}
        # key 是 opaque 字符串 series/size/task
        assert "/" in entry["key"]


def test_health_pool_loaded_key_string_uses_series_size_task(client) -> None:
    client.post(
        "/warmup",
        json={"task": "detection", "variants": {"series": "yolo11", "size": "s"}},
    )
    pool = client.get("/health").json()["pool"]
    keys = [e["key"] for e in pool["loaded_keys"]]
    assert "yolo11/s/detection" in keys
