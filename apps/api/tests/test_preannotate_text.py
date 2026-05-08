"""v0.9.5 · POST /projects/{id}/preannotate 文本批量预标触发端点。

覆盖参数校验四条主路径：
1. backend 不存在 → 404
2. batch 不存在 / 跨项目 → 404
3. batch 状态非 active → 400
4. happy path → 202 风格响应携带 channel + total_tasks

不跑 Celery（mock batch_predict.delay）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import BatchStatus
from app.db.models.ml_backend import MLBackend
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed(
    db: AsyncSession, owner_id: uuid.UUID, *, batch_status: str = BatchStatus.ACTIVE
):
    suffix = uuid.uuid4().hex[:8]
    proj = Project(
        id=uuid.uuid4(),
        display_id=f"P-{suffix}",
        name=f"preanno-{suffix}",
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
        status=batch_status,
    )
    db.add(batch)
    await db.flush()

    for i in range(3):
        db.add(
            Task(
                id=uuid.uuid4(),
                project_id=proj.id,
                batch_id=batch.id,
                display_id=f"T-{suffix}-{i}",
                file_name=f"img{i}.jpg",
                file_path=f"items/{suffix}-{i}.jpg",
                file_type="image",
                status="pending",
            )
        )
    await db.commit()
    return proj, backend, batch


@pytest.fixture
def _mock_celery(monkeypatch):
    """把 batch_predict.delay 替换成假 job 对象，避免真触发 Celery。"""
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
async def test_preannotate_backend_not_found(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, _, _ = await _seed(db_session, owner.id)
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={"ml_backend_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_preannotate_batch_not_found(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, backend, _ = await _seed(db_session, owner.id)
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(backend.id),
            "batch_id": str(uuid.uuid4()),
        },
    )
    assert resp.status_code == 404
    assert "batch" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_preannotate_batch_wrong_status(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, backend, batch = await _seed(
        db_session, owner.id, batch_status=BatchStatus.DRAFT
    )
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(backend.id),
            "batch_id": str(batch.id),
            "prompt": "person",
        },
    )
    assert resp.status_code == 400
    assert "active" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_preannotate_happy_path_text_box_mode(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, backend, batch = await _seed(db_session, owner.id)
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(backend.id),
            "batch_id": str(batch.id),
            "prompt": "ripe apples",
            "output_mode": "box",
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "queued"
    assert data["job_id"] == "fake-job-uuid"
    assert data["total_tasks"] == 3
    assert data["channel"] == f"project:{proj.id}:preannotate"

    # delay 收到的 kwargs 透传 prompt + output_mode + batch_id
    assert _mock_celery["kwargs"]["prompt"] == "ripe apples"
    assert _mock_celery["kwargs"]["output_mode"] == "box"
    assert _mock_celery["kwargs"]["batch_id"] == str(batch.id)


@pytest.mark.asyncio
async def test_preannotate_invalid_output_mode_rejected(
    httpx_client_bound, super_admin, db_session, _mock_celery
):
    owner, token = super_admin
    proj, backend, batch = await _seed(db_session, owner.id)
    resp = await httpx_client_bound.post(
        f"/api/v1/projects/{proj.id}/preannotate",
        headers=_bearer(token),
        json={
            "ml_backend_id": str(backend.id),
            "batch_id": str(batch.id),
            "output_mode": "invalid",
        },
    )
    assert resp.status_code == 422
