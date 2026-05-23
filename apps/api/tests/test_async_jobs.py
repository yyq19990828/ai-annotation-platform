"""v0.10.16 · async_jobs 表 + service + API 端点单测（ROADMAP §1.7）。

覆盖：
- service: create_job / mark_running / update_progress / mark_complete / mark_failed
  / track_job 上下文（happy + raise）
- API: GET /async-jobs owner-scoped、super_admin 看全部、cancel kind 白名单 + 终态拒绝
"""

from __future__ import annotations

import pytest

from app.db.models.async_job import AsyncJobStatus
from app.db.models.project import Project
from app.services import async_job as async_job_svc


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestAsyncJobService:
    async def test_create_run_complete_flow(self, db_session, annotator):
        user, _ = annotator
        aj = await async_job_svc.create_job(
            db_session,
            kind="batch_predict",
            user_id=user.id,
            payload={"total": 10},
            celery_task_id="celery-1",
        )
        assert aj.status == AsyncJobStatus.PENDING.value
        await async_job_svc.mark_running(db_session, aj.id)
        await db_session.flush()
        await db_session.refresh(aj)
        assert aj.status == AsyncJobStatus.RUNNING.value
        assert aj.started_at is not None

        await async_job_svc.update_progress(db_session, aj.id, 47)
        await db_session.flush()
        await db_session.refresh(aj)
        assert aj.progress_pct == 47

        await async_job_svc.mark_complete(
            db_session, aj.id, result={"success": 9, "fail": 1}
        )
        await db_session.flush()
        await db_session.refresh(aj)
        assert aj.status == AsyncJobStatus.COMPLETED.value
        assert aj.progress_pct == 100
        assert aj.result == {"success": 9, "fail": 1}
        assert aj.completed_at is not None

    async def test_mark_failed_with_error_message(self, db_session, annotator):
        user, _ = annotator
        aj = await async_job_svc.create_job(
            db_session, kind="predictions_import", user_id=user.id
        )
        await async_job_svc.mark_failed(db_session, aj.id, error="boom")
        await db_session.flush()
        await db_session.refresh(aj)
        assert aj.status == AsyncJobStatus.FAILED.value
        assert aj.error_message == "boom"

    async def test_mark_complete_does_not_overwrite_failed(self, db_session, annotator):
        user, _ = annotator
        aj = await async_job_svc.create_job(
            db_session, kind="audit_archive", user_id=user.id
        )
        await async_job_svc.mark_failed(db_session, aj.id, error="db down")
        await async_job_svc.mark_complete(db_session, aj.id)
        await db_session.flush()
        await db_session.refresh(aj)
        # 仍是 failed，complete 是幂等的
        assert aj.status == AsyncJobStatus.FAILED.value

    async def test_progress_pct_clamps(self, db_session):
        aj = await async_job_svc.create_job(db_session, kind="batch_predict")
        await async_job_svc.update_progress(db_session, aj.id, 150)
        await db_session.flush()
        await db_session.refresh(aj)
        assert aj.progress_pct == 100
        await async_job_svc.update_progress(db_session, aj.id, -5)
        await db_session.flush()
        await db_session.refresh(aj)
        assert aj.progress_pct == 0

    async def test_track_job_context_marks_complete_on_success(
        self, db_session, annotator
    ):
        user, _ = annotator
        async with async_job_svc.track_job(
            db_session, kind="audit_archive", user_id=user.id
        ) as aj:
            assert aj.status == AsyncJobStatus.RUNNING.value
        await db_session.refresh(aj)
        assert aj.status == AsyncJobStatus.COMPLETED.value

    async def test_track_job_context_marks_failed_on_raise(self, db_session, annotator):
        user, _ = annotator
        with pytest.raises(ValueError):
            async with async_job_svc.track_job(
                db_session, kind="audit_archive", user_id=user.id
            ) as aj:
                raise ValueError("bad")
        await db_session.refresh(aj)
        assert aj.status == AsyncJobStatus.FAILED.value
        assert "bad" in (aj.error_message or "")


class TestAsyncJobsAPI:
    async def test_list_owner_scoped(self, httpx_client_bound, db_session, annotator):
        user, token = annotator
        # 自己的 job
        own = await async_job_svc.create_job(
            db_session, kind="batch_predict", user_id=user.id
        )
        # 别人的 job
        await async_job_svc.create_job(db_session, kind="batch_predict")
        await db_session.flush()

        r = await httpx_client_bound.get("/api/v1/async-jobs", headers=_bearer(token))
        assert r.status_code == 200
        body = r.json()
        ids = {item["id"] for item in body["items"]}
        assert str(own.id) in ids
        # annotator 看不到他人的 job
        assert all(item["user_id"] == str(user.id) for item in body["items"])

    async def test_super_admin_sees_all(
        self, httpx_client_bound, db_session, super_admin, annotator
    ):
        _, admin_token = super_admin
        anno_user, _ = annotator
        await async_job_svc.create_job(
            db_session, kind="batch_predict", user_id=anno_user.id
        )
        await db_session.flush()

        r = await httpx_client_bound.get(
            "/api/v1/async-jobs", headers=_bearer(admin_token)
        )
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    async def test_list_filters_and_project_meta(
        self, httpx_client_bound, db_session, annotator
    ):
        user, token = annotator
        project = Project(
            display_id="PROJ-AJ-1",
            name="Async Jobs Project",
            type_label="Image Classification",
            type_key="image_classification",
            owner_id=user.id,
        )
        other_project = Project(
            display_id="PROJ-AJ-2",
            name="Other Project",
            type_label="Image Classification",
            type_key="image_classification",
            owner_id=user.id,
        )
        db_session.add_all([project, other_project])
        await db_session.flush()

        matching = await async_job_svc.create_job(
            db_session,
            kind="batch_predict",
            user_id=user.id,
            project_id=project.id,
            payload={
                "prompt": "detect buses",
                "batch_display_id": "BATCH-AJ-1",
            },
        )
        await async_job_svc.mark_running(db_session, matching.id)
        await async_job_svc.create_job(
            db_session,
            kind="batch_predict",
            user_id=user.id,
            project_id=project.id,
            payload={"prompt": "detect cars", "batch_display_id": "BATCH-AJ-2"},
        )
        await async_job_svc.create_job(
            db_session,
            kind="batch_predict",
            user_id=user.id,
            project_id=other_project.id,
            payload={"prompt": "detect buses", "batch_display_id": "BATCH-AJ-3"},
        )
        await db_session.flush()

        r = await httpx_client_bound.get(
            "/api/v1/async-jobs",
            params=[
                ("project_id", str(project.id)),
                ("search", "BATCH-AJ-1"),
                ("status", "pending"),
                ("status", "running"),
            ],
            headers=_bearer(token),
        )

        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        item = body["items"][0]
        assert item["id"] == str(matching.id)
        assert item["project_display_id"] == "PROJ-AJ-1"
        assert item["project_name"] == "Async Jobs Project"

    async def test_cancel_unsupported_kind_rejected(
        self, httpx_client_bound, db_session, annotator
    ):
        user, token = annotator
        aj = await async_job_svc.create_job(
            db_session, kind="batch_predict", user_id=user.id
        )
        await async_job_svc.mark_running(db_session, aj.id)
        await db_session.flush()

        r = await httpx_client_bound.post(
            f"/api/v1/async-jobs/{aj.id}/cancel", headers=_bearer(token)
        )
        assert r.status_code == 400
        assert "not cancellable" in r.json()["detail"]

    async def test_cancel_supported_kind_succeeds(
        self, httpx_client_bound, db_session, annotator
    ):
        user, token = annotator
        aj = await async_job_svc.create_job(
            db_session, kind="predictions_import", user_id=user.id
        )
        await async_job_svc.mark_running(db_session, aj.id)
        await db_session.flush()

        r = await httpx_client_bound.post(
            f"/api/v1/async-jobs/{aj.id}/cancel", headers=_bearer(token)
        )
        assert r.status_code == 200
        # 刷新看库
        await db_session.refresh(aj)
        assert aj.status == AsyncJobStatus.CANCELLED.value

    async def test_cancel_already_terminal_rejected(
        self, httpx_client_bound, db_session, annotator
    ):
        user, token = annotator
        aj = await async_job_svc.create_job(
            db_session, kind="predictions_import", user_id=user.id
        )
        await async_job_svc.mark_complete(db_session, aj.id)
        await db_session.flush()

        r = await httpx_client_bound.post(
            f"/api/v1/async-jobs/{aj.id}/cancel", headers=_bearer(token)
        )
        assert r.status_code == 409
