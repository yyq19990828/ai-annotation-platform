"""v0.10.26 · MLBackendClient reload 变体 body 透传 + health_meta 保留 pool 键。

不连真实 backend, 用 httpx.MockTransport 捕获请求 body / 注入 /health 响应。
"""

from __future__ import annotations

import json
from unittest.mock import patch

import httpx
import pytest

from app.db.models.ml_backend import MLBackend
from app.services.ml_client import MLBackendClient


def _backend(url="http://fake:9090"):
    b = MLBackend()
    b.id = "00000000-0000-0000-0000-0000000000aa"
    b.url = url
    b.auth_method = "none"
    b.auth_token = None
    b.extra_params = {}
    return b


def _patched(transport):
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real(*args, **kwargs)

    return patch("app.services.ml_client.httpx.AsyncClient", side_effect=factory)


@pytest.mark.asyncio
async def test_reload_with_variant_posts_body():
    captured: dict = {}

    def handler(request):
        captured["body"] = json.loads(request.content) if request.content else None
        return httpx.Response(200, json={"ok": True, "loaded": True, "reloaded": True})

    client = MLBackendClient(_backend())
    with _patched(httpx.MockTransport(handler)):
        await client.reload(sam_variant="small", dino_variant="B")

    assert captured["body"] == {"sam_variant": "small", "dino_variant": "B"}


@pytest.mark.asyncio
async def test_reload_without_variant_sends_no_body():
    captured: dict = {}

    def handler(request):
        captured["raw"] = request.content
        return httpx.Response(200, json={"ok": True, "loaded": True, "reloaded": False})

    client = MLBackendClient(_backend())
    with _patched(httpx.MockTransport(handler)):
        await client.reload()

    # body 留空 → 不发 JSON (backend 用默认变体)。
    assert captured["raw"] in (b"", b"null")


@pytest.mark.asyncio
async def test_health_meta_keeps_pool():
    pool = {
        "cap": 2,
        "loaded_variants": [{"sam_variant": "small", "dino_variant": "B"}],
        "evict_count": 0,
        "per_variant_lru_ts": {"small/B": 1.0},
    }

    def handler(request):
        return httpx.Response(
            200,
            json={
                "ok": True,
                "gpu_info": {"memory_used_mb": 1},
                "cache": {"hit_rate": 0.5, "buckets": {"small/B": {"hit_rate": 0.5}}},
                "model_version": "grounded-sam2-dinoB-sam2.1small",
                "pool": pool,
            },
        )

    client = MLBackendClient(_backend())
    with _patched(httpx.MockTransport(handler)):
        ok, meta = await client.health_meta()

    assert ok is True
    assert meta is not None
    assert meta["pool"] == pool
    assert "buckets" in meta["cache"]
