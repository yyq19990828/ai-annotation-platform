import asyncio
import uuid
import json
import redis

from app.workers.celery_app import celery_app
from app.config import settings


def _publish_progress(
    project_id: str,
    current: int,
    total: int,
    status: str = "running",
    error: str | None = None,
):
    r = redis.from_url(settings.redis_url)
    r.publish(
        f"project:{project_id}:preannotate",
        json.dumps(
            {"current": current, "total": total, "status": status, "error": error}
        ),
    )
    r.close()


async def _run_batch(project_id: str, ml_backend_id: str, task_ids: list[str] | None):
    from sqlalchemy.ext.asyncio import (
        create_async_engine,
        async_sessionmaker,
        AsyncSession,
    )
    from sqlalchemy import select
    from app.db.models.task import Task
    from app.db.models.ml_backend import MLBackend
    from app.services.ml_client import MLBackendClient
    from app.services.prediction import PredictionService

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with SessionLocal() as db:
        backend = await db.get(MLBackend, uuid.UUID(ml_backend_id))
        if not backend:
            _publish_progress(
                project_id, 0, 0, status="error", error="ML Backend not found"
            )
            return

        if task_ids:
            uuids = [uuid.UUID(tid) for tid in task_ids]
            result = await db.execute(select(Task).where(Task.id.in_(uuids)))
        else:
            result = await db.execute(
                select(Task).where(
                    Task.project_id == uuid.UUID(project_id), Task.status == "pending"
                )
            )
        tasks = list(result.scalars().all())
        total = len(tasks)

        if total == 0:
            _publish_progress(project_id, 0, 0, status="completed")
            return

        client = MLBackendClient(backend)
        pred_svc = PredictionService(db)

        for i, task in enumerate(tasks):
            try:
                results = await client.predict(
                    [{"id": str(task.id), "file_path": task.file_path}]
                )
                for pred_result in results:
                    await pred_svc.create_from_ml_result(
                        task_id=task.id,
                        project_id=uuid.UUID(project_id),
                        ml_backend_id=backend.id,
                        result=pred_result.result,
                        score=pred_result.score,
                        model_version=pred_result.model_version,
                        inference_time_ms=pred_result.inference_time_ms,
                    )
                await db.commit()
            except Exception as exc:
                await pred_svc.create_failed(
                    task_id=task.id,
                    project_id=uuid.UUID(project_id),
                    ml_backend_id=backend.id,
                    error_type=type(exc).__name__,
                    message=str(exc),
                )
                await db.commit()

            _publish_progress(project_id, i + 1, total)

        _publish_progress(project_id, total, total, status="completed")

    await engine.dispose()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def batch_predict(
    self, project_id: str, ml_backend_id: str, task_ids: list[str] | None = None
):
    asyncio.run(_run_batch(project_id, ml_backend_id, task_ids))
