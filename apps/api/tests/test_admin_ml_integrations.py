"""v0.9.3 · /admin/ml-integrations/overview 端到端测试。"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from tests.factory import create_project


@pytest.mark.asyncio
async def test_overview_super_admin_only(httpx_client, super_admin, annotator):
    _, admin_token = super_admin
    _, anno_token = annotator

    fake_summary = {
        "name": "test-bucket",
        "status": "ok",
        "object_count": 0,
        "total_size_bytes": 0,
    }
    with patch("app.api.v1.admin_ml_integrations.storage_service") as mock_storage:
        mock_storage.bucket = "annotations"
        mock_storage.datasets_bucket = "datasets"
        mock_storage.summarize_bucket.return_value = fake_summary

        # super_admin 200
        res = await httpx_client.get(
            "/api/v1/admin/ml-integrations/overview",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 200
        body = res.json()
        assert "storage" in body
        assert "projects" in body
        assert body["total_backends"] == 0

        # annotator 403
        res = await httpx_client.get(
            "/api/v1/admin/ml-integrations/overview",
            headers={"Authorization": f"Bearer {anno_token}"},
        )
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_overview_groups_backends_by_project(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    proj = await create_project(db_session, owner_id=user.id, name="P1")

    from app.db.models.ml_backend import MLBackend

    db_session.add(
        MLBackend(
            project_id=proj.id,
            name="b1",
            url="http://x:9000",
            state="connected",
        )
    )
    db_session.add(
        MLBackend(
            project_id=proj.id,
            name="b2",
            url="http://y:9000",
            state="disconnected",
        )
    )
    await db_session.flush()

    with patch("app.api.v1.admin_ml_integrations.storage_service") as mock_storage:
        mock_storage.bucket = "annotations"
        mock_storage.datasets_bucket = "datasets"
        mock_storage.summarize_bucket.return_value = {
            "name": "annotations",
            "status": "ok",
            "object_count": 0,
            "total_size_bytes": 0,
        }

        res = await httpx_client.get(
            "/api/v1/admin/ml-integrations/overview",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["total_backends"] == 2
        assert body["connected_backends"] == 1
        assert len(body["projects"]) == 1
        assert body["projects"][0]["project_name"] == "P1"
        assert len(body["projects"][0]["backends"]) == 2
