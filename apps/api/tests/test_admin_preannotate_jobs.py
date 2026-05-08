"""v0.9.8 · /admin/preannotate-jobs 端到端测试 (7 case)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.ml_backend import MLBackend
from app.db.models.prediction_job import PredictionJob, PredictionJobStatus
from app.db.models.project import Project


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed_project(
    db: AsyncSession, owner_id: uuid.UUID, name: str
) -> tuple[Project, MLBackend]:
    suffix = uuid.uuid4().hex[:6]
    proj = Project(
        id=uuid.uuid4(),
        display_id=f"P-{suffix}",
        name=name,
        type_label="image-det",
        type_key="image-det",
        owner_id=owner_id,
    )
    db.add(proj)
    await db.flush()

    backend = MLBackend(
        id=uuid.uuid4(),
        project_id=proj.id,
        name="g-sam2",
        url=f"http://test-{suffix}/",
        is_interactive=True,
        state="connected",
    )
    db.add(backend)
    await db.flush()
    return proj, backend


async def _seed_job(
    db: AsyncSession,
    proj: Project,
    backend: MLBackend,
    *,
    prompt: str = "",
    status: str = PredictionJobStatus.COMPLETED.value,
    started_at: datetime | None = None,
) -> PredictionJob:
    job = PredictionJob(
        project_id=proj.id,
        ml_backend_id=backend.id,
        prompt=prompt,
        output_mode="box",
        status=status,
        total_tasks=10,
        success_count=8,
        failed_count=2,
        duration_ms=5000,
    )
    if started_at is not None:
        job.started_at = started_at
    db.add(job)
    await db.flush()
    return job


@pytest.mark.asyncio
async def test_preannotate_jobs_empty(httpx_client, super_admin):
    _, token = super_admin
    res = await httpx_client.get(
        "/api/v1/admin/preannotate-jobs",
        headers=_bearer(token),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["items"] == []
    assert body["next_cursor"] is None


@pytest.mark.asyncio
async def test_preannotate_jobs_requires_admin(httpx_client, annotator):
    _, token = annotator
    res = await httpx_client.get(
        "/api/v1/admin/preannotate-jobs",
        headers=_bearer(token),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_preannotate_jobs_basic_listing_and_project_meta(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    proj, backend = await _seed_project(db_session, user.id, "Listing-1")
    await _seed_job(db_session, proj, backend, prompt="apples")
    await _seed_job(db_session, proj, backend, prompt="oranges")
    await db_session.commit()

    res = await httpx_client_bound.get(
        "/api/v1/admin/preannotate-jobs",
        headers=_bearer(token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["items"]) == 2
    assert body["items"][0]["project_name"] == "Listing-1"
    # 字段完整 + 浮点 cost null
    item = body["items"][0]
    for f in [
        "id",
        "prompt",
        "status",
        "started_at",
        "duration_ms",
        "total_tasks",
        "success_count",
        "failed_count",
    ]:
        assert f in item
    assert item["total_cost"] is None


@pytest.mark.asyncio
async def test_preannotate_jobs_filter_by_project_and_status(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    proj_a, backend_a = await _seed_project(db_session, user.id, "A")
    proj_b, backend_b = await _seed_project(db_session, user.id, "B")
    await _seed_job(
        db_session,
        proj_a,
        backend_a,
        prompt="a-running",
        status=PredictionJobStatus.RUNNING.value,
    )
    await _seed_job(
        db_session,
        proj_a,
        backend_a,
        prompt="a-completed",
        status=PredictionJobStatus.COMPLETED.value,
    )
    await _seed_job(
        db_session,
        proj_b,
        backend_b,
        prompt="b-failed",
        status=PredictionJobStatus.FAILED.value,
    )
    await db_session.commit()

    # filter project_id
    res = await httpx_client_bound.get(
        f"/api/v1/admin/preannotate-jobs?project_id={proj_a.id}",
        headers=_bearer(token),
    )
    items = res.json()["items"]
    assert len(items) == 2
    assert all(i["project_id"] == str(proj_a.id) for i in items)

    # filter status=running 在 project A
    res = await httpx_client_bound.get(
        f"/api/v1/admin/preannotate-jobs?project_id={proj_a.id}&status=running",
        headers=_bearer(token),
    )
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["prompt"] == "a-running"

    # filter status=failed 全局
    res = await httpx_client_bound.get(
        "/api/v1/admin/preannotate-jobs?status=failed",
        headers=_bearer(token),
    )
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["prompt"] == "b-failed"


@pytest.mark.asyncio
async def test_preannotate_jobs_search_prompt_substring(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    proj, backend = await _seed_project(db_session, user.id, "Search-1")
    await _seed_job(db_session, proj, backend, prompt="ripe red apples")
    await _seed_job(db_session, proj, backend, prompt="green peppers")
    await _seed_job(db_session, proj, backend, prompt="apples and oranges")
    await db_session.commit()

    res = await httpx_client_bound.get(
        "/api/v1/admin/preannotate-jobs?search=apples",
        headers=_bearer(token),
    )
    items = res.json()["items"]
    assert len(items) == 2
    assert all("apple" in i["prompt"].lower() for i in items)


@pytest.mark.asyncio
async def test_preannotate_jobs_filter_by_date_range(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    proj, backend = await _seed_project(db_session, user.id, "Date-1")
    base = datetime.now(timezone.utc).replace(microsecond=0)
    await _seed_job(
        db_session, proj, backend, prompt="old", started_at=base - timedelta(days=5)
    )
    await _seed_job(
        db_session, proj, backend, prompt="mid", started_at=base - timedelta(days=2)
    )
    await _seed_job(db_session, proj, backend, prompt="new", started_at=base)
    await db_session.commit()

    from_ = (base - timedelta(days=3)).isoformat()
    res = await httpx_client_bound.get(
        "/api/v1/admin/preannotate-jobs",
        params={"from": from_},
        headers=_bearer(token),
    )
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    prompts = sorted(i["prompt"] for i in items)
    assert prompts == ["mid", "new"]


@pytest.mark.asyncio
async def test_preannotate_jobs_cursor_pagination(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    proj, backend = await _seed_project(db_session, user.id, "Page-1")
    base = datetime.now(timezone.utc).replace(microsecond=0)
    for i in range(5):
        await _seed_job(
            db_session,
            proj,
            backend,
            prompt=f"p-{i}",
            started_at=base - timedelta(seconds=i),
        )
    await db_session.commit()

    # 第一页 limit=2
    res = await httpx_client_bound.get(
        "/api/v1/admin/preannotate-jobs?limit=2",
        headers=_bearer(token),
    )
    body = res.json()
    assert len(body["items"]) == 2
    cursor = body["next_cursor"]
    assert cursor is not None
    page1_prompts = [i["prompt"] for i in body["items"]]

    # 第二页
    res2 = await httpx_client_bound.get(
        f"/api/v1/admin/preannotate-jobs?limit=2&cursor={cursor}",
        headers=_bearer(token),
    )
    body2 = res2.json()
    assert len(body2["items"]) == 2
    page2_prompts = [i["prompt"] for i in body2["items"]]
    # 不与第一页重复
    assert set(page1_prompts).isdisjoint(set(page2_prompts))

    # 第三页 (剩 1)
    res3 = await httpx_client_bound.get(
        f"/api/v1/admin/preannotate-jobs?limit=2&cursor={body2['next_cursor']}",
        headers=_bearer(token),
    )
    body3 = res3.json()
    assert len(body3["items"]) == 1
    assert body3["next_cursor"] is None


@pytest.mark.asyncio
async def test_preannotate_jobs_invalid_status_rejected(httpx_client, super_admin):
    _, token = super_admin
    res = await httpx_client.get(
        "/api/v1/admin/preannotate-jobs?status=weird",
        headers=_bearer(token),
    )
    assert res.status_code == 422
