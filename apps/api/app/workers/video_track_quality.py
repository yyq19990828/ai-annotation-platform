from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from app.db.models.video_track_quality import VideoTrackQualityRun
from app.services import async_job as async_job_svc
from app.services.async_job_notify import notify_job_terminal
from app.services.video_track_quality import (
    VideoTrackQualityError,
    evaluate_run,
    replace_issues,
)
from app.workers._db import task_session
from app.workers.celery_app import celery_app


@celery_app.task(bind=True, name="app.workers.video_track_quality.run")
def run_video_track_quality(self, run_id: str) -> None:
    asyncio.run(_run(uuid.UUID(run_id), getattr(self.request, "id", None)))


async def _run(run_id: uuid.UUID, celery_task_id: str | None) -> None:
    async with task_session() as db:
        run = await db.get(VideoTrackQualityRun, run_id)
        if run is None or run.status != "pending":
            return
        now = datetime.now(timezone.utc)
        run.status = "running"
        run.started_at = now
        run.progress_pct = 5
        if run.async_job_id:
            await async_job_svc.mark_running(
                db, run.async_job_id, celery_task_id=celery_task_id
            )
        await db.commit()
        try:
            metrics, pairs, issues = await evaluate_run(db, run)
            await replace_issues(db, run, issues)
            run.metrics = metrics
            run.pairs = pairs
            run.progress_pct = 100
            run.status = (
                "empty_overlap"
                if not pairs
                and not any(issue["code"] == "unsupported_geometry" for issue in issues)
                and not any(
                    int(metrics.get(key, 0)) for key in ("IDTP", "IDFN", "IDFP")
                )
                else "completed"
            )
            run.completed_at = datetime.now(timezone.utc)
            if run.async_job_id:
                await async_job_svc.mark_complete(
                    db,
                    run.async_job_id,
                    result={"run_id": str(run.id), "status": run.status},
                )
        except VideoTrackQualityError as exc:
            run.status = (
                "stale"
                if exc.detail["reason"] == "video_track_quality_stale"
                else "failed"
            )
            run.stale_at = datetime.now(timezone.utc) if run.status == "stale" else None
            run.error_message = str(exc.detail)[:4000]
            run.completed_at = datetime.now(timezone.utc)
            if run.async_job_id:
                await async_job_svc.mark_failed(
                    db, run.async_job_id, error=str(exc.detail)
                )
        except Exception as exc:
            run.status = "failed"
            run.error_message = f"{type(exc).__name__}: {exc}"[:4000]
            run.completed_at = datetime.now(timezone.utc)
            if run.async_job_id:
                await async_job_svc.mark_failed(
                    db, run.async_job_id, error=run.error_message
                )
        if run.async_job_id:
            await notify_job_terminal(db, job_id=run.async_job_id)
        await db.commit()
