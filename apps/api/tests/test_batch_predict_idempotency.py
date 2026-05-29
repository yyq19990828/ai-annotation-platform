"""v0.11.24 · 批量预标幂等：跳过已预标 / 覆盖历史预标。

- endpoint 层：predict_mode 透传给 batch_predict.delay；skip_predicted 下进度条分母排除已预标 task。
- service 层：clean_task_predictions(task_ids) 删 AI 预标、保留人工标注、归零 total_predictions
  （overwrite 模式 worker 调用的清理核心；全 worker e2e 因无 ML backend mock 暂不覆盖）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import BatchStatus
from app.db.models.ml_backend import MLBackend
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.annotation import Annotation
from app.db.models.prediction import Prediction
from app.services.batch import BatchService


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed(db: AsyncSession, owner_id: uuid.UUID):
    suffix = uuid.uuid4().hex[:8]
    proj = Project(
        id=uuid.uuid4(),
        display_id=f"P-{suffix}",
        name=f"idem-{suffix}",
        type_label="image-det",
        type_key="image-det",
        owner_id=owner_id,
        ai_enabled=True,
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
    proj.ml_backend_id = backend.id

    batch = TaskBatch(
        id=uuid.uuid4(),
        project_id=proj.id,
        display_id=f"B-{suffix}",
        name="b1",
        status=BatchStatus.ACTIVE,
    )
    db.add(batch)
    await db.flush()

    tasks = []
    for i in range(3):
        t = Task(
            id=uuid.uuid4(),
            project_id=proj.id,
            batch_id=batch.id,
            display_id=f"T-{suffix}-{i}",
            file_name=f"img{i}.jpg",
            file_path=f"items/{suffix}-{i}.jpg",
            file_type="image",
            status="pending",
        )
        db.add(t)
        tasks.append(t)
    await db.commit()
    return proj, backend, batch, tasks


@pytest.fixture
def _mock_celery(monkeypatch):
    captured: dict = {}

    class _FakeJob:
        id = "fake-job-uuid"

    def _fake_delay(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return _FakeJob()

    from app.workers import tasks as worker_tasks

    monkeypatch.setattr(worker_tasks.batch_predict, "delay", _fake_delay)
    return captured


@pytest.mark.asyncio
async def test_predict_mode_defaults_skip_predicted(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, backend, batch, _ = await _seed(db_session, owner.id)
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={"ml_backend_id": str(backend.id), "batch_id": str(batch.id)},
    )
    assert resp.status_code == 200, resp.text
    assert _mock_celery["kwargs"]["predict_mode"] == "skip_predicted"


@pytest.mark.asyncio
async def test_predict_mode_overwrite_forwarded(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, backend, batch, _ = await _seed(db_session, owner.id)
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(backend.id),
            "batch_id": str(batch.id),
            "predict_mode": "overwrite",
        },
    )
    assert resp.status_code == 200, resp.text
    assert _mock_celery["kwargs"]["predict_mode"] == "overwrite"


@pytest.mark.asyncio
async def test_skip_hint_excludes_predicted(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, backend, batch, tasks = await _seed(db_session, owner.id)
    # 一个 task 标记已预标
    tasks[0].total_predictions = 1
    await db_session.commit()

    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={"ml_backend_id": str(backend.id), "batch_id": str(batch.id)},
    )
    assert resp.status_code == 200, resp.text
    # skip 模式：3 个 pending 里排除 1 个已预标 → hint=2
    assert resp.json()["total_tasks"] == 2


@pytest.mark.asyncio
async def test_clean_task_predictions_removes_ai_keeps_manual(
    db_session: AsyncSession, super_admin
):
    owner, _ = super_admin
    proj, backend, batch, tasks = await _seed(db_session, owner.id)
    t = tasks[0]
    t.total_predictions = 1
    db_session.add_all(
        [
            Annotation(
                id=uuid.uuid4(),
                task_id=t.id,
                project_id=proj.id,
                source="manual",
                class_name="cat",
                geometry={"x": 1, "y": 1, "w": 2, "h": 2},
                is_active=True,
            ),
            Annotation(
                id=uuid.uuid4(),
                task_id=t.id,
                project_id=proj.id,
                source="prediction_based",
                class_name="dog",
                geometry={"x": 3, "y": 3, "w": 4, "h": 4},
                is_active=True,
            ),
            Prediction(
                id=uuid.uuid4(),
                task_id=t.id,
                project_id=proj.id,
                result={"shapes": []},
                source="ml_backend",
            ),
        ]
    )
    await db_session.flush()

    counts = await BatchService(db_session).clean_task_predictions([t.id])
    assert counts["predictions"] == 1
    assert counts["ai_annotations_deactivated"] == 1

    # 人工标注保留 active，AI 标注软删
    manual_active = (
        await db_session.execute(
            select(func.count())
            .select_from(Annotation)
            .where(
                Annotation.task_id == t.id,
                Annotation.source == "manual",
                Annotation.is_active.is_(True),
            )
        )
    ).scalar()
    ai_active = (
        await db_session.execute(
            select(func.count())
            .select_from(Annotation)
            .where(
                Annotation.task_id == t.id,
                Annotation.source == "prediction_based",
                Annotation.is_active.is_(True),
            )
        )
    ).scalar()
    assert manual_active == 1
    assert ai_active == 0

    pred_count = (
        await db_session.execute(
            select(func.count())
            .select_from(Prediction)
            .where(Prediction.task_id == t.id)
        )
    ).scalar()
    assert pred_count == 0

    # total_predictions 归 0；仍有存活人工标注 → is_labeled True
    row = (
        await db_session.execute(
            select(Task.total_predictions, Task.is_labeled).where(Task.id == t.id)
        )
    ).one()
    assert row.total_predictions == 0
    assert row.is_labeled is True
