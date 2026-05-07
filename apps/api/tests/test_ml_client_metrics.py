"""v0.8.7 F2 · MLBackendClient 计时 + Histogram observe + wall-clock fallback。"""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from app.db.models.ml_backend import MLBackend
from app.services.ml_client import MLBackendClient


def _backend(url="http://fake:9090"):
    b = MLBackend()
    b.id = "00000000-0000-0000-0000-000000000099"
    b.url = url
    b.auth_method = "none"
    b.auth_token = None
    return b


@pytest.mark.asyncio
async def test_predict_observes_success_histogram():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={
                "results": [
                    {"task": "t1", "result": [], "score": 0.9, "model_version": "m"}
                ]
            },
        )
    )
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real(*args, **kwargs)

    from app.observability.metrics import ML_BACKEND_REQUEST_DURATION

    before = sum(
        s.value
        for m in ML_BACKEND_REQUEST_DURATION.collect()
        for s in m.samples
        if s.name.endswith("_count") and s.labels.get("outcome") == "success"
    )

    client = MLBackendClient(_backend())
    with patch("app.services.ml_client.httpx.AsyncClient", side_effect=factory):
        results = await client.predict([{"id": "t1"}])

    assert len(results) == 1
    # 没带 inference_time_ms 时 wall-clock 兜底 → 应是非负 int
    assert results[0].inference_time_ms is not None
    assert results[0].inference_time_ms >= 0

    after = sum(
        s.value
        for m in ML_BACKEND_REQUEST_DURATION.collect()
        for s in m.samples
        if s.name.endswith("_count") and s.labels.get("outcome") == "success"
    )
    assert after - before >= 1  # 一次 success observe


@pytest.mark.asyncio
async def test_predict_observes_error_histogram_and_reraises():
    def boom(request):
        raise httpx.ConnectError("boom")

    transport = httpx.MockTransport(boom)
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real(*args, **kwargs)

    from app.observability.metrics import ML_BACKEND_REQUEST_DURATION

    before = sum(
        s.value
        for m in ML_BACKEND_REQUEST_DURATION.collect()
        for s in m.samples
        if s.name.endswith("_count") and s.labels.get("outcome") == "error"
    )

    client = MLBackendClient(_backend())
    with patch("app.services.ml_client.httpx.AsyncClient", side_effect=factory):
        with pytest.raises(httpx.ConnectError):
            await client.predict([{"id": "t1"}])

    after = sum(
        s.value
        for m in ML_BACKEND_REQUEST_DURATION.collect()
        for s in m.samples
        if s.name.endswith("_count") and s.labels.get("outcome") == "error"
    )
    assert after - before >= 1


@pytest.mark.asyncio
async def test_predict_uses_backend_reported_time_when_present():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={
                "results": [
                    {
                        "task": "t1",
                        "result": [],
                        "inference_time_ms": 42,  # backend 自报
                    }
                ]
            },
        )
    )
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real(*args, **kwargs)

    client = MLBackendClient(_backend())
    with patch("app.services.ml_client.httpx.AsyncClient", side_effect=factory):
        results = await client.predict([{"id": "t1"}])
    # backend 自报值优先
    assert results[0].inference_time_ms == 42
