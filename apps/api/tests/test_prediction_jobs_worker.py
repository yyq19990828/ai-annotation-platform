"""v0.10.49 · batch_predict worker 写入单测（async_jobs 单一真值）.

v0.10.49 收敛后 prediction_jobs 专表已删，worker 直接以 async_jobs 为工作状态。
覆盖：
1. _mark_job_failed 把 running async_job 翻成 failed + 写 error_message
2. _mark_job_failed 跳过已 completed async_job 不覆盖
3. _run_batch 把每条 PredictionResult.meta.total_cost 累加进 async_job.result
4. _run_batch 把请求 params 合并进 /predict context
5. _BatchPredictTask.on_failure 调用 _mark_job_failed (mock 验证 dispatch 路径)

AsyncJob ORM / celery_task_id 反查由 test_async_jobs.py 覆盖，本文件不重复。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.async_job import AsyncJob, AsyncJobStatus
from app.db.models.ml_backend import MLBackend
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


def _passthrough_engine_and_factory(db_session: AsyncSession):
    """让 worker 内部 create_async_engine / async_sessionmaker 复用 db_session,
    避免开新 engine 对测试 SAVEPOINT 不可见。"""

    class _PassThroughEngine:
        async def dispose(self):
            pass

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

    return (lambda *_a, **_kw: _PassThroughEngine()), _PassThroughSessionFactory


@pytest.mark.asyncio
async def test_mark_job_failed_updates_running_row(
    db_session: AsyncSession, monkeypatch, super_admin
):
    user, _ = super_admin
    proj, _backend = await _seed_project_and_backend(db_session, user.id)

    job = AsyncJob(
        kind="batch_predict",
        project_id=proj.id,
        user_id=user.id,
        celery_task_id="celery-fail",
        status=AsyncJobStatus.RUNNING.value,
        started_at=datetime.now(timezone.utc),
        payload={"prompt": "hello"},
    )
    db_session.add(job)
    await db_session.flush()
    job_id = job.id

    from app.workers import tasks as worker_tasks  # noqa: F401

    fake_engine, fake_factory = _passthrough_engine_and_factory(db_session)
    import sqlalchemy.ext.asyncio as sa_async

    monkeypatch.setattr(sa_async, "create_async_engine", fake_engine)
    monkeypatch.setattr(sa_async, "async_sessionmaker", fake_factory)

    await worker_tasks._mark_job_failed("celery-fail", "kaboom: boom")

    fresh = await db_session.get(AsyncJob, job_id)
    assert fresh is not None
    assert fresh.status == "failed"
    assert fresh.error_message == "kaboom: boom"
    assert fresh.completed_at is not None


@pytest.mark.asyncio
async def test_mark_job_failed_skips_already_completed(
    db_session: AsyncSession, monkeypatch, super_admin
):
    user, _ = super_admin
    proj, _backend = await _seed_project_and_backend(db_session, user.id)

    job = AsyncJob(
        kind="batch_predict",
        project_id=proj.id,
        user_id=user.id,
        celery_task_id="celery-already",
        status=AsyncJobStatus.COMPLETED.value,
        completed_at=datetime.now(timezone.utc),
        payload={"prompt": "hello"},
    )
    db_session.add(job)
    await db_session.flush()
    job_id = job.id

    from app.workers import tasks as worker_tasks

    fake_engine, fake_factory = _passthrough_engine_and_factory(db_session)
    import sqlalchemy.ext.asyncio as sa_async

    monkeypatch.setattr(sa_async, "create_async_engine", fake_engine)
    monkeypatch.setattr(sa_async, "async_sessionmaker", fake_factory)

    await worker_tasks._mark_job_failed("celery-already", "should be ignored")

    fresh = await db_session.get(AsyncJob, job_id)
    assert fresh is not None
    assert fresh.status == "completed"  # 不被覆盖
    assert fresh.error_message is None


@pytest.mark.asyncio
async def test_run_batch_accumulates_total_cost(
    db_session: AsyncSession, monkeypatch, super_admin
):
    """v0.10.49 · _run_batch 把每条 PredictionResult.meta.total_cost 累加进 async_job.result."""
    from app.db.models.task import Task
    from app.services.ml_client import PredictionResult
    from app.workers import tasks as worker_tasks

    user, _ = super_admin
    proj, backend = await _seed_project_and_backend(db_session, user.id)

    t1 = Task(
        id=uuid.uuid4(),
        project_id=proj.id,
        display_id="T-1",
        file_name="a.jpg",
        file_path="http://x/a.jpg",
        file_type="image",
        status="pending",
    )
    t2 = Task(
        id=uuid.uuid4(),
        project_id=proj.id,
        display_id="T-2",
        file_name="b.jpg",
        file_path="http://x/b.jpg",
        file_type="image",
        status="pending",
    )
    db_session.add_all([t1, t2])
    await db_session.flush()

    class _StubClient:
        def __init__(self, _backend):
            self._backend = _backend

        async def predict(self, tasks_payload, context=None):
            return [
                PredictionResult(
                    task_id=tasks_payload[0]["id"],
                    result=[],
                    score=0.9,
                    model_version="stub-v1",
                    inference_time_ms=10,
                    meta={"total_cost": 0.0012},
                )
            ]

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient", _StubClient, raising=True
    )

    fake_engine, fake_factory = _passthrough_engine_and_factory(db_session)
    import sqlalchemy.ext.asyncio as sa_async

    monkeypatch.setattr(sa_async, "create_async_engine", fake_engine)
    monkeypatch.setattr(sa_async, "async_sessionmaker", fake_factory)

    await worker_tasks._run_batch(
        project_id=str(proj.id),
        ml_backend_id=str(backend.id),
        task_ids=[str(t1.id), str(t2.id)],
        prompt="x",
    )

    res = await db_session.execute(
        select(AsyncJob).where(
            AsyncJob.kind == "batch_predict", AsyncJob.project_id == proj.id
        )
    )
    job = res.scalar_one()
    assert job.status == "completed"
    assert job.result["success_count"] == 2
    # 0.0012 × 2 = 0.0024 (格式化到 4 位)
    assert job.result["total_cost"] == "0.0024"


@pytest.mark.asyncio
async def test_run_batch_merges_params_into_context(
    db_session: AsyncSession, monkeypatch, super_admin
):
    """v0.10.38 · _run_batch 把请求 params 合并进 /predict context, 覆盖项目级阈值兜底."""
    from app.db.models.task import Task
    from app.services.ml_client import PredictionResult
    from app.workers import tasks as worker_tasks

    user, _ = super_admin
    proj, backend = await _seed_project_and_backend(db_session, user.id)
    proj.box_threshold = 0.35
    proj.text_threshold = 0.25
    t1 = Task(
        id=uuid.uuid4(),
        project_id=proj.id,
        display_id="T-P1",
        file_name="a.jpg",
        file_path="http://x/a.jpg",
        file_type="image",
        status="pending",
    )
    db_session.add(t1)
    await db_session.flush()

    captured: dict = {}

    class _StubClient:
        def __init__(self, _backend):
            self._backend = _backend

        async def predict(self, tasks_payload, context=None):
            captured["context"] = context
            return [
                PredictionResult(
                    task_id=tasks_payload[0]["id"],
                    result=[],
                    score=0.9,
                    model_version="stub-v1",
                    inference_time_ms=10,
                    meta={},
                )
            ]

    monkeypatch.setattr(
        "app.services.ml_client.MLBackendClient", _StubClient, raising=True
    )

    fake_engine, fake_factory = _passthrough_engine_and_factory(db_session)
    import sqlalchemy.ext.asyncio as sa_async

    monkeypatch.setattr(sa_async, "create_async_engine", fake_engine)
    monkeypatch.setattr(sa_async, "async_sessionmaker", fake_factory)

    await worker_tasks._run_batch(
        project_id=str(proj.id),
        ml_backend_id=str(backend.id),
        task_ids=[str(t1.id)],
        prompt="cars",
        params={"box_threshold": 0.7, "sam_variant": "large", "ignored": None},
    )

    ctx = captured["context"]
    assert ctx["box_threshold"] == 0.7  # params 覆盖项目级 0.35
    assert ctx["text_threshold"] == 0.25  # 未被 params 覆盖, 保留项目级兜底
    assert ctx["sam_variant"] == "large"  # params 透传
    assert "ignored" not in ctx  # None 值被过滤


@pytest.mark.asyncio
async def test_delete_backend_blocked_by_running_batch_predict(
    db_session: AsyncSession, super_admin
):
    """v0.10.49 · MLBackendService.delete 改读 async_jobs(payload.ml_backend_id)
    判断是否有 running batch_predict，有则拒删。"""
    from app.services.ml_backend import MLBackendDeleteBlocked, MLBackendService

    user, _ = super_admin
    proj, backend = await _seed_project_and_backend(db_session, user.id)

    job = AsyncJob(
        kind="batch_predict",
        project_id=proj.id,
        user_id=user.id,
        status=AsyncJobStatus.RUNNING.value,
        payload={"ml_backend_id": str(backend.id)},
    )
    db_session.add(job)
    await db_session.flush()

    with pytest.raises(MLBackendDeleteBlocked):
        await MLBackendService(db_session).delete(backend.id)

    # 把 job 翻成终态后可删
    job.status = AsyncJobStatus.COMPLETED.value
    await db_session.flush()
    assert await MLBackendService(db_session).delete(backend.id) is True


def test_batch_predict_task_on_failure_dispatches_mark_helper(monkeypatch):
    """_BatchPredictTask.on_failure 同步调用 _mark_job_failed (asyncio.run 包裹)."""
    from app.workers import tasks as worker_tasks

    captured: dict = {}

    async def _stub_mark(celery_task_id: str, error_message: str):
        captured["celery_task_id"] = celery_task_id
        captured["error_message"] = error_message

    monkeypatch.setattr(worker_tasks, "_mark_job_failed", _stub_mark)
    monkeypatch.setattr(worker_tasks, "_publish_progress", lambda *a, **kw: None)

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
