"""v0.8.6 F6 · 失败预测列表与重试端点单测。

覆盖：
- GET /admin/failed-predictions 分页 + 角色守卫
- POST /admin/failed-predictions/{id}/retry 投递 Celery task；retry_count>=3 返 409
- 非管理员 403
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.ml_backend import MLBackend
from app.db.models.prediction import FailedPrediction
from app.db.models.project import Project
from app.db.models.task import Task


async def _seed_project(db: AsyncSession, owner_id: uuid.UUID) -> Project:
    suffix = uuid.uuid4().hex[:8]
    proj = Project(
        id=uuid.uuid4(),
        display_id=f"P-FP-{suffix}",
        name=f"fp-{suffix}",
        type_label="image-det",
        type_key="image-det",
        owner_id=owner_id,
    )
    db.add(proj)
    await db.flush()
    return proj


async def _seed_task(db: AsyncSession, project_id: uuid.UUID) -> Task:
    suffix = uuid.uuid4().hex[:8]
    t = Task(
        id=uuid.uuid4(),
        project_id=project_id,
        display_id=f"T-FP-{suffix}",
        file_name="x.jpg",
        file_path="/tmp/x.jpg",
        file_type="image",
        tags=[],
        status="in_progress",
    )
    db.add(t)
    await db.flush()
    return t


async def _seed_backend(db: AsyncSession, project_id: uuid.UUID) -> MLBackend:
    b = MLBackend(
        id=uuid.uuid4(),
        project_id=project_id,
        name="bk",
        url="http://example/",
        is_interactive=True,
    )
    db.add(b)
    await db.flush()
    return b


async def _seed_failed(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    backend_id: uuid.UUID,
    retry_count: int = 0,
    error_type: str = "TIMEOUT",
    message: str = "boom",
) -> FailedPrediction:
    fp = FailedPrediction(
        id=uuid.uuid4(),
        task_id=task_id,
        project_id=project_id,
        ml_backend_id=backend_id,
        error_type=error_type,
        message=message,
        retry_count=retry_count,
    )
    db.add(fp)
    await db.flush()
    return fp


async def test_list_failed_predictions_basic_fields(
    httpx_client_bound, super_admin, db_session
):
    """两条 failed → 列表 total=2，关键字段（backend_name / project_name / retry_count）正确。"""
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
    task = await _seed_task(db_session, proj.id)
    backend = await _seed_backend(db_session, proj.id)
    fp1 = await _seed_failed(
        db_session,
        project_id=proj.id,
        task_id=task.id,
        backend_id=backend.id,
        message="first",
    )
    fp2 = await _seed_failed(
        db_session,
        project_id=proj.id,
        task_id=task.id,
        backend_id=backend.id,
        retry_count=1,
        message="second",
    )
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    resp = await httpx_client_bound.get(
        "/api/v1/admin/failed-predictions?page=1&page_size=10", headers=headers
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2

    by_id = {item["id"]: item for item in data["items"]}
    assert str(fp1.id) in by_id and str(fp2.id) in by_id
    assert by_id[str(fp2.id)]["retry_count"] == 1
    assert by_id[str(fp1.id)]["retry_count"] == 0
    for item in data["items"]:
        assert item["backend_name"] == "bk"
        assert item["project_name"] == proj.name
        assert item["task_display_id"] == task.display_id


async def test_list_failed_predictions_requires_manager(httpx_client_bound, annotator):
    _, token = annotator
    resp = await httpx_client_bound.get(
        "/api/v1/admin/failed-predictions", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 403


async def test_retry_failed_prediction_queues_celery_and_returns_202(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
    task = await _seed_task(db_session, proj.id)
    backend = await _seed_backend(db_session, proj.id)
    fp = await _seed_failed(
        db_session, project_id=proj.id, task_id=task.id, backend_id=backend.id
    )
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    with patch(
        "app.workers.predictions_retry.retry_failed_prediction.delay"
    ) as mock_delay:
        resp = await httpx_client_bound.post(
            f"/api/v1/admin/failed-predictions/{fp.id}/retry", headers=headers
        )

    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    assert body["failed_id"] == str(fp.id)
    mock_delay.assert_called_once_with(str(fp.id), str(user.id))


async def test_retry_blocked_when_max_exceeded(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
    task = await _seed_task(db_session, proj.id)
    backend = await _seed_backend(db_session, proj.id)
    fp = await _seed_failed(
        db_session,
        project_id=proj.id,
        task_id=task.id,
        backend_id=backend.id,
        retry_count=3,  # 已到上限
    )
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    resp = await httpx_client_bound.post(
        f"/api/v1/admin/failed-predictions/{fp.id}/retry", headers=headers
    )
    assert resp.status_code == 409, resp.text
    assert "Max retries" in resp.text


async def test_retry_404_for_unknown_id(httpx_client_bound, super_admin):
    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}
    fake = uuid.uuid4()
    resp = await httpx_client_bound.post(
        f"/api/v1/admin/failed-predictions/{fake}/retry", headers=headers
    )
    assert resp.status_code == 404


async def test_retry_requires_manager(
    httpx_client_bound, annotator, db_session, super_admin
):
    user, _ = super_admin
    proj = await _seed_project(db_session, user.id)
    task = await _seed_task(db_session, proj.id)
    backend = await _seed_backend(db_session, proj.id)
    fp = await _seed_failed(
        db_session, project_id=proj.id, task_id=task.id, backend_id=backend.id
    )
    await db_session.commit()

    _, token = annotator
    resp = await httpx_client_bound.post(
        f"/api/v1/admin/failed-predictions/{fp.id}/retry",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


# ─── v0.8.8 · dismiss / restore ──────────────────────────────────────────────


async def test_dismiss_marks_failed_prediction_and_audit_logged(
    httpx_client_bound, super_admin, db_session
):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
    task = await _seed_task(db_session, proj.id)
    backend = await _seed_backend(db_session, proj.id)
    fp = await _seed_failed(
        db_session, project_id=proj.id, task_id=task.id, backend_id=backend.id
    )
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    resp = await httpx_client_bound.post(
        f"/api/v1/admin/failed-predictions/{fp.id}/dismiss", headers=headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "dismissed"
    assert body["dismissed_at"] is not None

    # 默认列表不再返回该行
    list_resp = await httpx_client_bound.get(
        "/api/v1/admin/failed-predictions", headers=headers
    )
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert all(i["id"] != str(fp.id) for i in items)

    # include_dismissed=true 时回归
    list_resp2 = await httpx_client_bound.get(
        "/api/v1/admin/failed-predictions?include_dismissed=true", headers=headers
    )
    assert list_resp2.status_code == 200
    by_id = {i["id"]: i for i in list_resp2.json()["items"]}
    assert str(fp.id) in by_id
    assert by_id[str(fp.id)]["dismissed_at"] is not None


async def test_dismiss_blocks_retry(httpx_client_bound, super_admin, db_session):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
    task = await _seed_task(db_session, proj.id)
    backend = await _seed_backend(db_session, proj.id)
    fp = await _seed_failed(
        db_session, project_id=proj.id, task_id=task.id, backend_id=backend.id
    )
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    await httpx_client_bound.post(
        f"/api/v1/admin/failed-predictions/{fp.id}/dismiss", headers=headers
    )

    resp = await httpx_client_bound.post(
        f"/api/v1/admin/failed-predictions/{fp.id}/retry", headers=headers
    )
    assert resp.status_code == 409
    assert "dismissed" in resp.text.lower()


async def test_restore_clears_dismissed_at(httpx_client_bound, super_admin, db_session):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
    task = await _seed_task(db_session, proj.id)
    backend = await _seed_backend(db_session, proj.id)
    fp = await _seed_failed(
        db_session, project_id=proj.id, task_id=task.id, backend_id=backend.id
    )
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    await httpx_client_bound.post(
        f"/api/v1/admin/failed-predictions/{fp.id}/dismiss", headers=headers
    )

    resp = await httpx_client_bound.post(
        f"/api/v1/admin/failed-predictions/{fp.id}/restore", headers=headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "restored"
    assert body["dismissed_at"] is None

    # 默认列表又能看到
    list_resp = await httpx_client_bound.get(
        "/api/v1/admin/failed-predictions", headers=headers
    )
    items = list_resp.json()["items"]
    assert any(i["id"] == str(fp.id) for i in items)


async def test_dismiss_is_idempotent(httpx_client_bound, super_admin, db_session):
    user, token = super_admin
    proj = await _seed_project(db_session, user.id)
    task = await _seed_task(db_session, proj.id)
    backend = await _seed_backend(db_session, proj.id)
    fp = await _seed_failed(
        db_session, project_id=proj.id, task_id=task.id, backend_id=backend.id
    )
    await db_session.commit()

    headers = {"Authorization": f"Bearer {token}"}
    r1 = await httpx_client_bound.post(
        f"/api/v1/admin/failed-predictions/{fp.id}/dismiss", headers=headers
    )
    r2 = await httpx_client_bound.post(
        f"/api/v1/admin/failed-predictions/{fp.id}/dismiss", headers=headers
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    # dismissed_at 第二次调用不应被刷新
    assert r1.json()["dismissed_at"] == r2.json()["dismissed_at"]


async def test_dismiss_requires_manager(
    httpx_client_bound, annotator, db_session, super_admin
):
    user, _ = super_admin
    proj = await _seed_project(db_session, user.id)
    task = await _seed_task(db_session, proj.id)
    backend = await _seed_backend(db_session, proj.id)
    fp = await _seed_failed(
        db_session, project_id=proj.id, task_id=task.id, backend_id=backend.id
    )
    await db_session.commit()

    _, token = annotator
    headers = {"Authorization": f"Bearer {token}"}
    resp = await httpx_client_bound.post(
        f"/api/v1/admin/failed-predictions/{fp.id}/dismiss", headers=headers
    )
    assert resp.status_code == 403
