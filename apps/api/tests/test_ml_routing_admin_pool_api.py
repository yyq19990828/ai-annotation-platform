"""v0.23.3 ADR-0050 §12.1 · Super Admin service-pool / member management API tests."""

from __future__ import annotations

import uuid

import pytest

from tests.conftest import create_registry_with_pool


def _caps(model_id: str = "sam3") -> dict:
    return {"capabilities": {"model_ids": [model_id], "supported_trackers": ["sam3_video"]}}


@pytest.mark.asyncio
async def test_create_pool_returns_disabled_empty(httpx_client, db_session, super_admin) -> None:
    _, token = super_admin
    resp = await httpx_client.post(
        "/api/v1/admin/ml-integrations/service-pools",
        json={"name": "new-pool"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "new-pool"
    assert body["enabled"] is False
    assert body["members"] == []
    assert body["legacy_instance_id"] is None


@pytest.mark.asyncio
async def test_add_member_seeds_fingerprint_and_legacy(httpx_client, db_session, super_admin) -> None:
    """First member seeds pool capability_fingerprint + legacy_instance_id (§7.3)."""
    _, token = super_admin
    # Bare registry WITHOUT a singleton pool (admin pool member mgmt starts from scratch).
    from app.db.models.ml_backend_registry import MLBackendRegistry

    backend = MLBackendRegistry(
        name="bk", url=f"http://bk-{uuid.uuid4().hex[:6]}:9", state="connected",
        health_meta=_caps(), source="manual",
    )
    db_session.add(backend)
    await db_session.flush()

    # Create empty pool.
    resp = await httpx_client.post(
        "/api/v1/admin/ml-integrations/service-pools",
        json={"name": "sam3-pool"},
        headers={"Authorization": f"Bearer {token}"},
    )
    pool_id = resp.json()["id"]

    # Add member.
    resp = await httpx_client.put(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{backend.id}",
        json={"weight": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["members"]) == 1
    assert body["members"][0]["registry_id"] == str(backend.id)
    assert body["legacy_instance_id"] == str(backend.id)
    assert body["capability_fingerprint"] is not None


@pytest.mark.asyncio
async def test_add_member_capability_mismatch_409(httpx_client, db_session, super_admin) -> None:
    """Adding a member with a divergent fingerprint → 409 capability_mismatch (D3)."""
    _, token = super_admin
    # Two registries with DIFFERENT capabilities.
    from app.db.models.ml_backend_registry import MLBackendRegistry

    b1 = MLBackendRegistry(
        name="sam3-a", url=f"http://s3a-{uuid.uuid4().hex[:6]}:9", state="connected",
        health_meta=_caps("sam3"), source="manual",
    )
    b2 = MLBackendRegistry(
        name="yolo-b", url=f"http://ylb-{uuid.uuid4().hex[:6]}:9", state="connected",
        health_meta={"capabilities": {"model_ids": ["yolo"], "task": "detect"}}, source="manual",
    )
    db_session.add_all([b1, b2])
    await db_session.flush()

    # Pool seeded with sam3.
    resp = await httpx_client.post(
        "/api/v1/admin/ml-integrations/service-pools",
        json={"name": "sam3-pool"},
        headers={"Authorization": f"Bearer {token}"},
    )
    pool_id = resp.json()["id"]
    await httpx_client.put(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{b1.id}",
        json={"weight": 1}, headers={"Authorization": f"Bearer {token}"},
    )

    # Add yolo (different fingerprint) → 409.
    resp = await httpx_client.put(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{b2.id}",
        json={"weight": 1}, headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "ml_backend_pool_capability_mismatch"


@pytest.mark.asyncio
async def test_drain_then_resume_member(httpx_client, db_session, super_admin) -> None:
    """drain → traffic_state=draining; resume → back to active (§10.3)."""
    _, token = super_admin
    from app.db.models.ml_backend_registry import MLBackendRegistry

    backend = MLBackendRegistry(
        name="bk", url=f"http://bk-{uuid.uuid4().hex[:6]}:9", state="connected",
        health_meta=_caps(), source="manual",
    )
    db_session.add(backend)
    await db_session.flush()

    resp = await httpx_client.post(
        "/api/v1/admin/ml-integrations/service-pools",
        json={"name": "p"}, headers={"Authorization": f"Bearer {token}"},
    )
    pool_id = resp.json()["id"]
    await httpx_client.put(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{backend.id}",
        json={"weight": 1}, headers={"Authorization": f"Bearer {token}"},
    )
    # Drain.
    resp = await httpx_client.post(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{backend.id}/drain",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["members"][0]["traffic_state"] == "draining"
    # Resume.
    resp = await httpx_client.post(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{backend.id}/resume",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["members"][0]["traffic_state"] == "active"


@pytest.mark.asyncio
async def test_enable_pool_without_legacy_rejected(httpx_client, db_session, super_admin) -> None:
    """PATCH enabled=true on an empty pool (no legacy) → 409 (D15)."""
    _, token = super_admin
    resp = await httpx_client.post(
        "/api/v1/admin/ml-integrations/service-pools",
        json={"name": "empty"}, headers={"Authorization": f"Bearer {token}"},
    )
    pool_id = resp.json()["id"]
    resp = await httpx_client.patch(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}",
        json={"enabled": True}, headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_list_service_pools(httpx_client, db_session, super_admin) -> None:
    _, token = super_admin
    await create_registry_with_pool(db_session, name="bk1")
    await create_registry_with_pool(db_session, name="bk2")
    await db_session.flush()
    resp = await httpx_client.get(
        "/api/v1/admin/ml-integrations/service-pools",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    items = resp.json()
    names = {it["name"] for it in items}
    assert "bk1" in names and "bk2" in names


@pytest.mark.asyncio
async def test_non_admin_forbidden(httpx_client, db_session, annotator) -> None:
    """Non-super-admin gets 403 on pool management."""
    _, token = annotator
    resp = await httpx_client.get(
        "/api/v1/admin/ml-integrations/service-pools",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
