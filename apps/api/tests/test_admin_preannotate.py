"""v0.9.6 · /admin/preannotate-queue 端到端测试.

v0.9.12 · 加 bulk-clear (B-16) + preannotate-summary (B-17) 测试覆盖.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

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


# ── v0.9.12 · bulk-clear (B-16) ───────────────────────────────────────────────


async def _seed_batch_with_predictions(
    db, project_id, *, status: str = "pre_annotated"
):
    from app.db.models.ml_backend import MLBackend
    from app.db.models.prediction import Prediction
    from app.db.models.prediction_job import PredictionJob

    batch = await create_batch(db, project_id=project_id, status=status)
    task = await _create_task(db, project_id=project_id, batch_id=batch.id)
    backend = MLBackend(
        id=uuid.uuid4(), project_id=project_id, name="bk", url="http://x/"
    )
    db.add(backend)
    await db.flush()
    db.add(
        Prediction(
            task_id=task.id,
            project_id=project_id,
            ml_backend_id=backend.id,
            result={"shapes": []},
        )
    )
    db.add(
        PredictionJob(
            project_id=project_id,
            batch_id=batch.id,
            ml_backend_id=backend.id,
            prompt="x",
            output_mode="mask",
            status="completed",
            total_tasks=1,
            success_count=1,
        )
    )
    await db.flush()
    return batch, backend


async def _create_task(db, *, project_id, batch_id):
    import secrets
    from app.db.models.task import Task

    suffix = secrets.token_hex(3)
    task = Task(
        project_id=project_id,
        batch_id=batch_id,
        display_id=f"T-{suffix}",
        status="pending",
        file_name=f"{suffix}.jpg",
        file_path=f"/{suffix}.jpg",
        file_type="image",
    )
    db.add(task)
    await db.flush()
    return task


@pytest.mark.asyncio
async def test_bulk_clear_predictions_only_resets_to_active(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    proj = await create_project(db_session, owner_id=user.id, name="bulk-clear-test")
    b1, _ = await _seed_batch_with_predictions(db_session, proj.id)
    b2, _ = await _seed_batch_with_predictions(db_session, proj.id)
    await db_session.commit()

    res = await httpx_client.post(
        "/api/v1/admin/preannotate-queue/bulk-clear",
        json={
            "batch_ids": [str(b1.id), str(b2.id)],
            "mode": "predictions_only",
            "reason": "B-16 bulk clear test",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["succeeded"]) == 2
    assert body["skipped"] == []
    assert body["failed"] == []

    # batch 状态从 pre_annotated 回 active
    from app.db.models.task_batch import TaskBatch

    batches = (
        (
            await db_session.execute(
                select(TaskBatch).where(TaskBatch.id.in_([b1.id, b2.id]))
            )
        )
        .scalars()
        .all()
    )
    assert all(b.status == "active" for b in batches)

    # predictions / prediction_jobs 全清
    from app.db.models.prediction import Prediction
    from app.db.models.prediction_job import PredictionJob

    preds = (await db_session.execute(select(Prediction))).scalars().all()
    jobs = (await db_session.execute(select(PredictionJob))).scalars().all()
    assert preds == []
    assert jobs == []


@pytest.mark.asyncio
async def test_bulk_clear_skips_other_owners_batches_for_project_admin(
    httpx_client, db_session, super_admin, project_admin
):
    """project_admin 越权清别人项目的 batch → skipped[reason=forbidden]."""
    super_user, _ = super_admin
    pa_user, pa_token = project_admin

    # super_admin 持有的项目, project_admin 想清里面的 batch
    proj = await create_project(db_session, owner_id=super_user.id, name="other-owned")
    b1, _ = await _seed_batch_with_predictions(db_session, proj.id)
    await db_session.commit()

    res = await httpx_client.post(
        "/api/v1/admin/preannotate-queue/bulk-clear",
        json={
            "batch_ids": [str(b1.id)],
            "mode": "predictions_only",
            "reason": "尝试越权清理 - 验证 forbidden",
        },
        headers={"Authorization": f"Bearer {pa_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["succeeded"] == []
    assert len(body["skipped"]) == 1
    assert body["skipped"][0]["reason"] == "forbidden"


# ── v0.9.12 · /admin/preannotate-summary (B-17) ──────────────────────────────


@pytest.mark.asyncio
async def test_preannotate_summary_filters_to_projects_with_ml_backend(
    httpx_client, db_session, super_admin
):
    user, token = super_admin
    p_with_bk = await create_project(db_session, owner_id=user.id, name="with-ml")
    p_without = await create_project(db_session, owner_id=user.id, name="no-ml")
    # p_with_bk 加 backend + 1 个 PRE_ANNOTATED batch
    await _seed_batch_with_predictions(db_session, p_with_bk.id, status="pre_annotated")
    # p_without 仅有 batch, 无 backend
    await create_batch(db_session, project_id=p_without.id, status="active")
    await db_session.commit()

    res = await httpx_client.get(
        "/api/v1/admin/preannotate-summary",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    names = [it["project_name"] for it in items]
    assert "with-ml" in names
    assert "no-ml" not in names
    item = next(it for it in items if it["project_name"] == "with-ml")
    assert item["ready_batches"] == 1
    assert item["ml_backend_state"] in ("disconnected", "ready", "mismatch")
    assert (
        item["ml_backend_max_concurrency"] is None
    )  # 未配 extra_params.max_concurrency
