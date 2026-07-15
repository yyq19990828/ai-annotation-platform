"""v0.8.6 F6 · 失败预测重试 Celery task

链路：
1. 读 failed_predictions 行 → 取 task_id + ml_backend_id
2. ws 推 `failed_prediction.retry.started`
3. 调 MLBackendClient.predict 重跑
4. 成功 → 写 predictions + 删 failed_predictions + async_jobs `job.completed`
5. 失败 → retry_count += 1 + last_retry_at + async_jobs `job.failed`

软上限 max=3 由路由层判断（HTTP 409）；本 task 信任传入。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


class _PredictionRetryTerminalFailure(Exception):
    def __init__(self, result: dict):
        self.result = result
        super().__init__(str(result.get("reason") or result.get("status") or "failed"))


@celery_app.task(
    bind=True, name="app.workers.predictions_retry.retry_failed_prediction"
)
def retry_failed_prediction(self, failed_id: str, user_id: str) -> dict:
    return asyncio.run(
        _run_retry(failed_id, user_id, celery_task_id=getattr(self.request, "id", None))
    )


async def _run_retry(
    failed_id: str, user_id: str, celery_task_id: str | None = None
) -> dict:
    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        return await _do_retry_with_factory(
            SessionLocal, failed_id, user_id, celery_task_id=celery_task_id
        )
    finally:
        await engine.dispose()


async def _do_retry_with_factory(
    session_factory,
    failed_id: str,
    user_id: str,
    celery_task_id: str | None = None,
) -> dict:
    """实际 retry 逻辑；session_factory 暴露便于测试 mock。"""
    from app.services import async_job as async_job_svc
    from app.services.async_job_notify import notify_job_terminal

    fid = uuid.UUID(failed_id)
    uid = uuid.UUID(user_id)

    async with session_factory() as db:
        project_id, payload = await _retry_job_metadata(db, fid)
        job = None
        try:
            async with async_job_svc.track_job(
                db,
                kind="prediction_retry",
                user_id=uid,
                project_id=project_id,
                payload=payload,
                celery_task_id=celery_task_id,
            ) as job:
                await db.commit()
                result = await _run_retry_attempt(session_factory, failed_id, user_id)
                job.result = _retry_result_payload(result)
                if result.get("status") != "succeeded":
                    raise _PredictionRetryTerminalFailure(result)
        except _PredictionRetryTerminalFailure as exc:
            if job is not None:
                await notify_job_terminal(db, job_id=job.id)
                await db.commit()
            return exc.result
        except Exception:
            if job is not None:
                await notify_job_terminal(db, job_id=job.id)
                await db.commit()
            raise

        if job is not None:
            await notify_job_terminal(db, job_id=job.id)
            await db.commit()
        return result


async def _retry_job_metadata(
    db: AsyncSession, fid: uuid.UUID
) -> tuple[uuid.UUID | None, dict]:
    from app.db.models.ml_backend_registry import MLBackendRegistry as MLBackend
    from app.db.models.prediction import FailedPrediction
    from app.db.models.project import Project
    from app.db.models.task import Task

    payload: dict = {"failed_prediction_id": str(fid)}
    fp = await db.get(FailedPrediction, fid)
    if not fp:
        return None, payload

    payload.update(
        {
            "task_id": str(fp.task_id) if fp.task_id else None,
            "project_id": str(fp.project_id),
            "ml_backend_id": str(fp.ml_backend_id) if fp.ml_backend_id else None,
            "error_type": fp.error_type,
            "message": (fp.message or "")[:200],
        }
    )
    task = await db.get(Task, fp.task_id) if fp.task_id else None
    if task is not None:
        payload["task_display_id"] = task.display_id
    project = await db.get(Project, fp.project_id)
    if project is not None:
        payload["project_display_id"] = project.display_id
        payload["project_name"] = project.name
    backend = await db.get(MLBackend, fp.ml_backend_id) if fp.ml_backend_id else None
    if backend is not None:
        payload["ml_backend_name"] = backend.name
    return fp.project_id, payload


def _retry_result_payload(result: dict) -> dict:
    status = str(result.get("status") or "")
    out = dict(result)
    if status == "succeeded":
        out.setdefault("success_count", 1)
        out.setdefault("failed_count", 0)
        return out
    out.setdefault("success_count", 0)
    out.setdefault("failed_count", 1)
    out.setdefault("reason", status or "failed")
    return out


async def _run_retry_attempt(session_factory, failed_id: str, user_id: str) -> dict:
    """重试业务逻辑。终态通知由外层 async_jobs 统一发。"""
    from app.db.models.ml_backend_registry import MLBackendRegistry as MLBackend
    from app.db.models.prediction import FailedPrediction
    from app.db.models.task import Task
    from app.services.ml_client import MLBackendClient
    from app.services.notification import NotificationService
    from app.services.prediction import PredictionService

    fid = uuid.UUID(failed_id)
    uid = uuid.UUID(user_id)

    # 第一阶段：读 failed + 推 started
    async with session_factory() as db:
        fp = await db.get(FailedPrediction, fid)
        if not fp:
            log.warning("retry_failed_prediction: not found id=%s", failed_id)
            return {"status": "not_found", "failed_id": failed_id}
        task = await db.get(Task, fp.task_id) if fp.task_id else None
        backend = (
            await db.get(MLBackend, fp.ml_backend_id) if fp.ml_backend_id else None
        )
        ns = NotificationService(db)
        await ns.notify(
            user_id=uid,
            type="failed_prediction.retry.started",
            target_type="failed_prediction",
            target_id=fid,
            payload={"project_id": str(fp.project_id)},
        )
        await db.commit()

    if not task or not backend:
        async with session_factory() as db:
            await _bump_retry_counter(db, fid)
            await db.commit()
        return {
            "status": "failed",
            "failed_id": failed_id,
            "reason": "missing_task_or_backend",
        }

    # 第二阶段：调 backend
    client = MLBackendClient(backend, shadow_session_factory=session_factory)
    try:
        results = await client.predict(
            [{"id": str(task.id), "file_path": task.file_path}]
        )
        if not results:
            raise RuntimeError("backend returned empty results")
        first = results[0]
    except Exception as exc:
        log.warning(
            "retry_failed_prediction: backend call failed id=%s err=%s", failed_id, exc
        )
        async with session_factory() as db:
            await _bump_retry_counter(db, fid)
            await db.commit()
        return {"status": "failed", "failed_id": failed_id, "reason": str(exc)[:200]}

    # 第三阶段：写 predictions + 删 failed + 推 succeeded
    async with session_factory() as db:
        pred_svc = PredictionService(db)
        pred = await pred_svc.create_from_ml_result(
            task_id=task.id,
            project_id=task.project_id,
            ml_backend_id=backend.id,
            result=first.result,
            score=first.score,
            model_version=first.model_version,
            inference_time_ms=first.inference_time_ms,
        )
        # 删除 failed_prediction 行
        fp_again = await db.get(FailedPrediction, fid)
        if fp_again:
            await db.delete(fp_again)
        await db.commit()

    return {
        "status": "succeeded",
        "failed_id": failed_id,
        "prediction_id": str(pred.id),
    }


async def _bump_retry_counter(db: AsyncSession, fid: uuid.UUID) -> None:
    from app.db.models.prediction import FailedPrediction

    fp = await db.get(FailedPrediction, fid)
    if fp:
        fp.retry_count = (fp.retry_count or 0) + 1
        fp.last_retry_at = datetime.now(timezone.utc)
        await db.flush()
