"""v0.8.3 · _test_seed router 烟测：reset + login 端点契约。"""

from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


async def test_seed_reset_returns_fixture_payload(httpx_client):
    res = await httpx_client.post("/api/v1/__test/seed/reset")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["admin_email"] == "admin@e2e.test"
    assert body["annotator_email"] == "anno@e2e.test"
    assert body["reviewer_email"] == "rev@e2e.test"
    assert isinstance(body["task_ids"], list)
    assert len(body["task_ids"]) == 5


async def test_seed_login_after_reset_returns_jwt(httpx_client):
    await httpx_client.post("/api/v1/__test/seed/reset")
    res = await httpx_client.post(
        "/api/v1/__test/seed/login",
        json={"email": "admin@e2e.test"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == "admin@e2e.test"


async def test_seed_login_unknown_email_404(httpx_client):
    await httpx_client.post("/api/v1/__test/seed/reset")
    res = await httpx_client.post(
        "/api/v1/__test/seed/login",
        json={"email": "no-such@nowhere"},
    )
    assert res.status_code == 404
