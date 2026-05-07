"""v0.8.6 F6 · 失败预测重试 Celery task

链路：
1. 读 failed_predictions 行 → 取 task_id + ml_backend_id
2. ws 推 `failed_prediction.retry.started`
3. 调 MLBackendClient.predict 重跑
4. 成功 → 写 predictions + 删 failed_predictions + ws `succeeded`
5. 失败 → retry_count += 1 + last_retry_at + ws `failed`

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


@celery_app.task(name="app.workers.predictions_retry.retry_failed_prediction")
def retry_failed_prediction(failed_id: str, user_id: str) -> dict:
    return asyncio.run(_run_retry(failed_id, user_id))


async def _run_retry(failed_id: str, user_id: str) -> dict:
    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        return await _do_retry_with_factory(SessionLocal, failed_id, user_id)
    finally:
        await engine.dispose()


async def _do_retry_with_factory(
    session_factory, failed_id: str, user_id: str
) -> dict:
    """实际 retry 逻辑；session_factory 暴露便于测试 mock。"""
    from app.db.models.ml_backend import MLBackend
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
            return {"status": "not_found"}
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
            ns = NotificationService(db)
            await ns.notify(
                user_id=uid,
                type="failed_prediction.retry.failed",
                target_type="failed_prediction",
                target_id=fid,
                payload={"reason": "missing_task_or_backend"},
            )
            await _bump_retry_counter(db, fid)
            await db.commit()
        return {"status": "failed", "reason": "missing_task_or_backend"}

    # 第二阶段：调 backend
    client = MLBackendClient(backend)
    try:
        results = await client.predict([{"id": str(task.id), "file_path": task.file_path}])
        if not results:
            raise RuntimeError("backend returned empty results")
        first = results[0]
    except Exception as exc:
        log.warning(
            "retry_failed_prediction: backend call failed id=%s err=%s", failed_id, exc
        )
        async with session_factory() as db:
            await _bump_retry_counter(db, fid)
            ns = NotificationService(db)
            await ns.notify(
                user_id=uid,
                type="failed_prediction.retry.failed",
                target_type="failed_prediction",
                target_id=fid,
                payload={"error": str(exc)[:200]},
            )
            await db.commit()
        return {"status": "failed", "reason": str(exc)[:200]}

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
        ns = NotificationService(db)
        await ns.notify(
            user_id=uid,
            type="failed_prediction.retry.succeeded",
            target_type="failed_prediction",
            target_id=fid,
            payload={"prediction_id": str(pred.id)},
        )
        await db.commit()

    return {"status": "succeeded", "failed_id": failed_id}


async def _bump_retry_counter(db: AsyncSession, fid: uuid.UUID) -> None:
    from app.db.models.prediction import FailedPrediction

    fp = await db.get(FailedPrediction, fid)
    if fp:
        fp.retry_count = (fp.retry_count or 0) + 1
        fp.last_retry_at = datetime.now(timezone.utc)
        await db.flush()
