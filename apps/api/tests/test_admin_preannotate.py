"""v0.9.6 · /admin/preannotate-queue 端到端测试."""

from __future__ import annotations

import pytest

from tests.factory import create_batch, create_project


@pytest.mark.asyncio
async def test_preannotate_queue_empty(httpx_client, super_admin):
    _, token = super_admin
    res = await httpx_client.get(
        "/api/v1/admin/preannotate-queue",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json() == {"items": []}


@pytest.mark.asyncio
async def test_preannotate_queue_requires_admin(httpx_client, annotator):
    _, token = annotator
    res = await httpx_client.get(
        "/api/v1/admin/preannotate-queue",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_preannotate_queue_returns_pre_annotated_batches(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    proj = await create_project(db_session, owner_id=user.id, name="Q1")

    await create_batch(
        db_session, project_id=proj.id, name="batch-pre", status="pre_annotated"
    )
    await create_batch(
        db_session, project_id=proj.id, name="batch-active", status="active"
    )

    res = await httpx_client.get(
        "/api/v1/admin/preannotate-queue",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    items = res.json()["items"]
    # 仅 pre_annotated 的 batch 入队列, active 的不入
    assert len(items) == 1
    item = items[0]
    assert item["batch_name"] == "batch-pre"
    assert item["batch_status"] == "pre_annotated"
    assert item["project_name"] == "Q1"
    assert item["prediction_count"] == 0
    assert item["failed_count"] == 0
    assert item["can_retry"] is False
