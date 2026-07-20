"""v0.23.3 ADR-0050 §12.1 · Super Admin service-pool / member management API tests."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.config import settings
from app.db.models.ml_backend_pool import MLBackendPoolMember
from app.services.ml_backend import MLBackendService
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
async def test_add_member_without_capability_cannot_join_seeded_pool(
    httpx_client, db_session, super_admin
) -> None:
    from app.db.models.ml_backend_registry import MLBackendRegistry

    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}
    seeded = MLBackendRegistry(
        name="seeded",
        url=f"http://seeded-{uuid.uuid4().hex[:6]}:9",
        state="connected",
        health_meta=_caps(),
        source="manual",
    )
    unknown = MLBackendRegistry(
        name="unknown",
        url=f"http://unknown-{uuid.uuid4().hex[:6]}:9",
        state="connected",
        health_meta=None,
        source="manual",
    )
    db_session.add_all([seeded, unknown])
    await db_session.flush()
    created = await httpx_client.post(
        "/api/v1/admin/ml-integrations/service-pools",
        json={"name": "capability-required"},
        headers=headers,
    )
    pool_id = created.json()["id"]
    await httpx_client.put(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{seeded.id}",
        json={"weight": 1},
        headers=headers,
    )

    response = await httpx_client.put(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{unknown.id}",
        json={"weight": 1},
        headers=headers,
    )
    assert response.status_code == 409
    assert (
        response.json()["detail"]["error_code"]
        == "ml_backend_pool_capability_mismatch"
    )


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


@pytest.mark.asyncio
async def test_put_member_is_idempotent_upsert_and_preserves_traffic_state(
    httpx_client, db_session, super_admin
) -> None:
    from app.db.models.ml_backend_registry import MLBackendRegistry

    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}
    backend = MLBackendRegistry(
        name="upsert-member",
        url=f"http://upsert-{uuid.uuid4().hex[:6]}:9",
        state="connected",
        health_meta=_caps(),
        source="manual",
    )
    db_session.add(backend)
    await db_session.flush()
    created = await httpx_client.post(
        "/api/v1/admin/ml-integrations/service-pools",
        json={"name": "upsert-pool"},
        headers=headers,
    )
    pool_id = uuid.UUID(created.json()["id"])
    first = await httpx_client.put(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{backend.id}",
        json={"weight": 1},
        headers=headers,
    )
    first_generation = first.json()["routing_generation"]
    member = await db_session.scalar(
        select(MLBackendPoolMember).where(
            MLBackendPoolMember.pool_id == pool_id,
            MLBackendPoolMember.registry_id == backend.id,
        )
    )
    member_id = member.id

    await httpx_client.post(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{backend.id}/drain",
        headers=headers,
    )
    updated = await httpx_client.put(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{backend.id}",
        json={"weight": 7},
        headers=headers,
    )
    body = updated.json()
    assert body["members"][0]["weight"] == 7
    assert body["members"][0]["traffic_state"] == "draining"
    assert body["routing_generation"] == first_generation + 2
    await db_session.refresh(member)
    assert member.id == member_id

    repeated = await httpx_client.put(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_id}/members/{backend.id}",
        json={"weight": 7},
        headers=headers,
    )
    assert repeated.json()["routing_generation"] == body["routing_generation"]


@pytest.mark.asyncio
async def test_member_cannot_be_owned_by_two_pools(
    httpx_client, db_session, super_admin
) -> None:
    from app.db.models.ml_backend_registry import MLBackendRegistry

    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}
    backend = MLBackendRegistry(
        name="single-owner",
        url=f"http://single-owner-{uuid.uuid4().hex[:6]}:9",
        state="connected",
        health_meta=_caps(),
        source="manual",
    )
    db_session.add(backend)
    await db_session.flush()
    pool_ids = []
    for name in ("owner-a", "owner-b"):
        response = await httpx_client.post(
            "/api/v1/admin/ml-integrations/service-pools",
            json={"name": name},
            headers=headers,
        )
        pool_ids.append(response.json()["id"])
    await httpx_client.put(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_ids[0]}/members/{backend.id}",
        json={"weight": 1},
        headers=headers,
    )

    response = await httpx_client.put(
        f"/api/v1/admin/ml-integrations/service-pools/{pool_ids[1]}/members/{backend.id}",
        json={"weight": 1},
        headers=headers,
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error_code"] == "ml_backend_pool_member_conflict"
    assert response.json()["detail"]["current_pool_id"] == pool_ids[0]


@pytest.mark.asyncio
async def test_create_pool_rejects_unowned_legacy_instance_id(
    httpx_client, db_session, super_admin
) -> None:
    _, token = super_admin
    response = await httpx_client.post(
        "/api/v1/admin/ml-integrations/service-pools",
        json={"name": "invalid-legacy", "legacy_instance_id": str(uuid.uuid4())},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_singleton_capability_is_seeded_then_drift_disables_legacy(
    db_session,
) -> None:
    svc = MLBackendService(db_session)
    backend = await svc.create_registry(
        "capability-seed",
        f"http://capability-seed-{uuid.uuid4().hex[:6]}:9",
    )
    pool = await svc._pool_for_registry(backend.id)
    assert pool.capability_fingerprint is None

    await svc._reconcile_pool_capability(
        backend.id,
        {"models": [{"id": "sam3", "task": "segment", "modalities": ["image"]}]},
    )
    await db_session.flush()
    assert pool.capability_fingerprint is not None
    pool.enabled = True

    await svc._reconcile_pool_capability(
        backend.id,
        {"models": [{"id": "yolo", "task": "detect", "modalities": ["image"]}]},
    )
    member = await db_session.scalar(
        select(MLBackendPoolMember).where(
            MLBackendPoolMember.registry_id == backend.id
        )
    )
    assert member.traffic_state == "disabled"
    assert pool.enabled is False


@pytest.mark.asyncio
async def test_remove_managed_member_requires_real_drain(
    httpx_client, db_session, super_admin, monkeypatch
) -> None:
    _, token = super_admin
    backend, pool = await create_registry_with_pool(
        db_session,
        name="remove-guard",
        state="connected",
        health_meta=_caps(),
    )
    await db_session.commit()
    monkeypatch.setattr(settings, "ml_backend_router_mode", "enforce")

    response = await httpx_client.delete(
        f"/api/v1/admin/ml-integrations/service-pools/{pool.id}/members/{backend.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error_code"] == "ml_backend_member_draining"


@pytest.mark.asyncio
async def test_remove_fails_closed_when_router_ledger_is_unavailable(
    httpx_client, db_session, super_admin, monkeypatch
) -> None:
    from app.services.ml_routing import safety

    class UnavailableLedger:
        async def healthcheck(self) -> None:
            raise ConnectionError("redis unavailable")

        async def aclose(self) -> None:
            return None

    _, token = super_admin
    backend, pool = await create_registry_with_pool(
        db_session,
        name="remove-ledger-guard",
        state="connected",
        health_meta=_caps(),
    )
    member = await db_session.scalar(
        select(MLBackendPoolMember).where(
            MLBackendPoolMember.registry_id == backend.id
        )
    )
    member.traffic_state = "draining"
    await db_session.commit()
    monkeypatch.setattr(settings, "ml_backend_router_mode", "enforce")
    monkeypatch.setattr(safety, "make_ledger_from_settings", UnavailableLedger)

    response = await httpx_client.delete(
        f"/api/v1/admin/ml-integrations/service-pools/{pool.id}/members/{backend.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 503
    assert response.json()["detail"]["error_code"] == "ml_backend_router_unavailable"
