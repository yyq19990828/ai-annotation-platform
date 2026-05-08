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


async def _run_batch(
    project_id: str,
    ml_backend_id: str,
    task_ids: list[str] | None,
    prompt: str | None = None,
    output_mode: str = "mask",
    batch_id: str | None = None,
):
    """v0.9.5 · 批量预标 worker.

    新增参数：
    - prompt: 文本批量预标 prompt（None 时走老的 image-only 批量行为）。
    - output_mode: text 模式输出形态（box / mask / both），仅 prompt 非空生效。
    - batch_id: 跑完后自动转 PRE_ANNOTATED 的目标 batch；None 则不动状态。
    """
    from sqlalchemy.ext.asyncio import (
        create_async_engine,
        async_sessionmaker,
        AsyncSession,
    )
    from sqlalchemy import select
    from app.db.enums import BatchStatus
    from app.db.models.task import Task
    from app.db.models.task_batch import TaskBatch
    from app.db.models.ml_backend import MLBackend
    from app.db.models.project import Project
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

        # v0.9.5 · 文本批量预标透传 ctx（DINO 阈值取项目级 override）
        context: dict | None = None
        if prompt:
            project = await db.get(Project, uuid.UUID(project_id))
            context = {
                "type": "text",
                "text": prompt,
                "output": output_mode,
            }
            if project is not None:
                context["box_threshold"] = float(project.box_threshold)
                context["text_threshold"] = float(project.text_threshold)

        if task_ids:
            uuids = [uuid.UUID(tid) for tid in task_ids]
            result = await db.execute(select(Task).where(Task.id.in_(uuids)))
        elif batch_id:
            # v0.9.5 · 指定 batch 时仅捞 batch 内 pending tasks
            result = await db.execute(
                select(Task).where(
                    Task.batch_id == uuid.UUID(batch_id),
                    Task.status == "pending",
                )
            )
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

        from app.api.v1.ml_backends import _resolve_task_url

        for i, task in enumerate(tasks):
            try:
                results = await client.predict(
                    [{"id": str(task.id), "file_path": _resolve_task_url(task)}],
                    context=context,
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

        # v0.9.5 · 跑完自动 active → pre_annotated（仅当指定 batch + 当前还在 active 时）
        if batch_id:
            batch = await db.get(TaskBatch, uuid.UUID(batch_id))
            if batch and batch.status == BatchStatus.ACTIVE:
                batch.status = BatchStatus.PRE_ANNOTATED
                await db.commit()

        _publish_progress(project_id, total, total, status="completed")

    await engine.dispose()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def batch_predict(
    self,
    project_id: str,
    ml_backend_id: str,
    task_ids: list[str] | None = None,
    prompt: str | None = None,
    output_mode: str = "mask",
    batch_id: str | None = None,
):
    asyncio.run(
        _run_batch(
            project_id,
            ml_backend_id,
            task_ids,
            prompt=prompt,
            output_mode=output_mode,
            batch_id=batch_id,
        )
    )
