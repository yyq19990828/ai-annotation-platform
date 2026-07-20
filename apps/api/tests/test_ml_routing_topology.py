"""v0.23.3 ADR-0050 §12.3 · topology + runtime-snapshot endpoint tests."""

from __future__ import annotations

import pytest

from tests.conftest import create_registry_with_pool


@pytest.mark.asyncio
async def test_topology_super_admin_sees_full_detail(httpx_client, db_session, super_admin) -> None:
    """Super Admin topology includes health / GPU / state per member."""
    _, token = super_admin
    backend, pool = await create_registry_with_pool(db_session, name="bk")
    await db_session.flush()
    resp = await httpx_client.get(
        "/api/v1/admin/ml-integrations/topology",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert any(p["name"] == "bk" for p in body["pools"])
    pool_entry = next(p for p in body["pools"] if p["name"] == "bk")
    assert pool_entry["member_count"] == 1
    member = pool_entry["members"][0]
    # Super Admin sees health + GPU fields.
    assert "state" in member
    assert "gpu_resource_id" in member
    assert "last_checked_at" in member


@pytest.mark.asyncio
async def test_topology_project_admin_trimmed(httpx_client, db_session, project_admin) -> None:
    """Project Admin topology omits health/GPU internals (role-scoped)."""
    _, token = project_admin
    resp = await httpx_client.get(
        "/api/v1/admin/ml-integrations/topology",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    if body["pools"]:
        member = body["pools"][0]["members"][0] if body["pools"][0]["members"] else {}
        # Project Admin should NOT see GPU/health internals.
        assert "gpu_resource_id" not in member
        assert "state" not in member


@pytest.mark.asyncio
async def test_runtime_snapshot_super_admin_only(httpx_client, db_session, super_admin, project_admin) -> None:
    """runtime-snapshot: Super Admin 200, Project Admin 403."""
    await create_registry_with_pool(db_session, name="bk")
    await db_session.flush()
    # Super Admin OK.
    _, sa_token = super_admin
    resp = await httpx_client.get(
        "/api/v1/admin/ml-integrations/runtime-snapshot",
        headers={"Authorization": f"Bearer {sa_token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "router_mode" in body
    assert "pools" in body
    # Project Admin forbidden.
    _, pa_token = project_admin
    resp = await httpx_client.get(
        "/api/v1/admin/ml-integrations/runtime-snapshot",
        headers={"Authorization": f"Bearer {pa_token}"},
    )
    assert resp.status_code == 403
