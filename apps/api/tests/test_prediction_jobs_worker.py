"""v0.9.8 · prediction_jobs 表 + worker 写入单测.

覆盖：
1. PredictionJob ORM 基础 round-trip（insert running → update completed）
2. CHECK constraint 拒绝非法 status
3. celery_task_id 反查 query 用于 _BatchPredictTask.on_failure
4. _mark_job_failed 把 running 行翻成 failed + 写 error_message
5. _mark_job_failed 跳过已 completed 行不覆盖
6. _BatchPredictTask.on_failure 调用 _mark_job_failed (mock 验证 dispatch 路径)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.ml_backend import MLBackend
from app.db.models.prediction_job import PredictionJob, PredictionJobStatus
from app.db.models.project import Project


async def _seed_project_and_backend(
    db: AsyncSession, owner_id: uuid.UUID
) -> tuple[Project, MLBackend]:
    suffix = uuid.uuid4().hex[:8]
    proj = Project(
        id=uuid.uuid4(),
        display_id=f"P-{suffix}",
        name=f"job-{suffix}",
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
        url="http://test/",
        is_interactive=True,
        state="connected",
    )
    db.add(backend)
    await db.flush()
    return proj, backend


@pytest.mark.asyncio
async def test_prediction_job_round_trip(db_session: AsyncSession, super_admin):
    user, _ = super_admin
    proj, backend = await _seed_project_and_backend(db_session, user.id)

    job = PredictionJob(
        project_id=proj.id,
        ml_backend_id=backend.id,
        prompt="ripe apples",
        output_mode="box",
        status=PredictionJobStatus.RUNNING.value,
        total_tasks=10,
        celery_task_id="celery-1",
    )
    db_session.add(job)
    await db_session.flush()
    job_id = job.id

    # 翻成 completed
    job.status = PredictionJobStatus.COMPLETED.value
    job.completed_at = datetime.now(timezone.utc)
    job.duration_ms = 1234
    job.success_count = 9
    job.failed_count = 1
    await db_session.flush()

    fresh = await db_session.get(PredictionJob, job_id)
    assert fresh is not None
    assert fresh.status == "completed"
    assert fresh.duration_ms == 1234
    assert fresh.success_count == 9
    assert fresh.failed_count == 1
    assert fresh.prompt == "ripe apples"
    assert fresh.output_mode == "box"
    assert fresh.celery_task_id == "celery-1"


@pytest.mark.asyncio
async def test_prediction_job_check_constraint_rejects_bad_status(
    db_session: AsyncSession, super_admin
):
    user, _ = super_admin
    proj, backend = await _seed_project_and_backend(db_session, user.id)

    job = PredictionJob(
        project_id=proj.id,
        ml_backend_id=backend.id,
        status="weird",  # 违反 CHECK
        prompt="",
    )
    db_session.add(job)
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_celery_task_id_lookup_query(
    db_session: AsyncSession, super_admin
):
    user, _ = super_admin
    proj, backend = await _seed_project_and_backend(db_session, user.id)

    target_task_id = "celery-target"
    job = PredictionJob(
        project_id=proj.id,
        ml_backend_id=backend.id,
        prompt="x",
        celery_task_id=target_task_id,
        status=PredictionJobStatus.RUNNING.value,
    )
    other = PredictionJob(
        project_id=proj.id,
        ml_backend_id=backend.id,
        prompt="y",
        celery_task_id="other-celery",
        status=PredictionJobStatus.RUNNING.value,
    )
    db_session.add_all([job, other])
    await db_session.flush()

    res = await db_session.execute(
        select(PredictionJob).where(
            PredictionJob.celery_task_id == target_task_id,
            PredictionJob.status == PredictionJobStatus.RUNNING.value,
        )
    )
    found = res.scalar_one_or_none()
    assert found is not None
    assert found.id == job.id


@pytest.mark.asyncio
async def test_mark_job_failed_updates_running_row(
    db_session: AsyncSession, monkeypatch, super_admin
):
    """直接 monkeypatch worker 内部 create_async_engine + async_sessionmaker
    让 _mark_job_failed 复用 db_session 所在 engine, 避免开新 engine 对 SAVEPOINT 不可见."""
    user, _ = super_admin
    proj, backend = await _seed_project_and_backend(db_session, user.id)

    job = PredictionJob(
        project_id=proj.id,
        ml_backend_id=backend.id,
        prompt="hello",
        celery_task_id="celery-fail",
        status=PredictionJobStatus.RUNNING.value,
    )
    db_session.add(job)
    await db_session.flush()
    job_id = job.id

    # 让 worker 用同一 db_session
    from app.workers import tasks as worker_tasks

    class _PassThroughEngine:
        async def dispose(self):
            pass

    def _fake_engine(*_a, **_kw):
        return _PassThroughEngine()

    class _PassThroughSessionFactory:
        def __init__(self, *_a, **_kw):
            pass

        def __call__(self):
            class _Ctx:
                async def __aenter__(self_inner):
                    return db_session

                async def __aexit__(self_inner, *args):
                    return False

            return _Ctx()

    monkeypatch.setattr(worker_tasks, "create_async_engine", _fake_engine, raising=False)
    monkeypatch.setattr(
        worker_tasks,
        "async_sessionmaker",
        _PassThroughSessionFactory,
        raising=False,
    )

    # 因为 _mark_job_failed 内部 `from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker`
    # 是函数体内 import, monkeypatch module 属性不会生效. 改用 sqlalchemy.ext.asyncio module-level patch.
    import sqlalchemy.ext.asyncio as sa_async

    monkeypatch.setattr(sa_async, "create_async_engine", _fake_engine)
    monkeypatch.setattr(sa_async, "async_sessionmaker", _PassThroughSessionFactory)

    await worker_tasks._mark_job_failed("celery-fail", "kaboom: boom")

    await db_session.refresh(job)
    fresh = await db_session.get(PredictionJob, job_id)
    assert fresh is not None
    assert fresh.status == "failed"
    assert fresh.error_message == "kaboom: boom"
    assert fresh.completed_at is not None
    assert fresh.duration_ms is not None and fresh.duration_ms >= 0


@pytest.mark.asyncio
async def test_mark_job_failed_skips_already_completed(
    db_session: AsyncSession, monkeypatch, super_admin
):
    user, _ = super_admin
    proj, backend = await _seed_project_and_backend(db_session, user.id)

    job = PredictionJob(
        project_id=proj.id,
        ml_backend_id=backend.id,
        prompt="hello",
        celery_task_id="celery-already",
        status=PredictionJobStatus.COMPLETED.value,
        completed_at=datetime.now(timezone.utc),
        duration_ms=100,
    )
    db_session.add(job)
    await db_session.flush()
    job_id = job.id

    from app.workers import tasks as worker_tasks

    class _PassThroughEngine:
        async def dispose(self):
            pass

    def _fake_engine(*_a, **_kw):
        return _PassThroughEngine()

    class _PassThroughSessionFactory:
        def __init__(self, *_a, **_kw):
            pass

        def __call__(self):
            class _Ctx:
                async def __aenter__(self_inner):
                    return db_session

                async def __aexit__(self_inner, *args):
                    return False

            return _Ctx()

    import sqlalchemy.ext.asyncio as sa_async

    monkeypatch.setattr(sa_async, "create_async_engine", _fake_engine)
    monkeypatch.setattr(sa_async, "async_sessionmaker", _PassThroughSessionFactory)

    await worker_tasks._mark_job_failed("celery-already", "should be ignored")

    fresh = await db_session.get(PredictionJob, job_id)
    assert fresh is not None
    assert fresh.status == "completed"  # 不被覆盖
    assert fresh.error_message is None


def test_batch_predict_task_on_failure_dispatches_mark_helper(monkeypatch):
    """_BatchPredictTask.on_failure 同步调用 _mark_job_failed (asyncio.run 包裹)."""
    from app.workers import tasks as worker_tasks

    captured: dict = {}

    async def _stub_mark(celery_task_id: str, error_message: str):
        captured["celery_task_id"] = celery_task_id
        captured["error_message"] = error_message

    monkeypatch.setattr(worker_tasks, "_mark_job_failed", _stub_mark)
    monkeypatch.setattr(
        worker_tasks, "_publish_progress", lambda *a, **kw: None
    )

    task = worker_tasks._BatchPredictTask()
    task.on_failure(
        ValueError("oops"),
        "celery-task-id-xyz",
        ("project-uuid",),
        {},
        None,
    )

    assert captured.get("celery_task_id") == "celery-task-id-xyz"
    assert "ValueError" in captured.get("error_message", "")
    assert "oops" in captured.get("error_message", "")
