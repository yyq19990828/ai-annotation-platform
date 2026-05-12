from __future__ import annotations

import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.db.models.video_tracker_job import VideoTrackerJob
from app.services.video_tracker_runner import run_tracker_job
from app.workers.celery_app import celery_app


async def _run_video_tracker_job(job_id: str, celery_task_id: str | None) -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        async with SessionLocal() as db:
            job = await db.get(VideoTrackerJob, uuid.UUID(job_id))
            if job is not None and celery_task_id and not job.celery_task_id:
                job.celery_task_id = celery_task_id
                await db.commit()
            await run_tracker_job(db, uuid.UUID(job_id))
    finally:
        await engine.dispose()


@celery_app.task(bind=True, max_retries=1, default_retry_delay=30, queue="gpu")
def run_video_tracker_job(self, job_id: str) -> None:
    asyncio.run(_run_video_tracker_job(job_id, getattr(self.request, "id", None)))
