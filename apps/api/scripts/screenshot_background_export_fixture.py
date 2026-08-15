#!/usr/bin/env python3
"""Run and clean a real export job in the isolated screenshot database.

The project export endpoint still creates the job and dispatches its normal
Celery message.  The long-lived development worker points at the development
database, so this helper executes the production worker body against the
screenshot database instead.  Every owned row is marked and cleanup is scoped
to the screenshot-managed image project.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

_API_ROOT = Path(__file__).resolve().parent.parent
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from app.config import settings  # noqa: E402
from app.db.models.async_job import AsyncJob  # noqa: E402
from app.db.models.export_artifact import ExportArtifact  # noqa: E402
from app.db.models.notification import Notification  # noqa: E402
from app.services import async_job as async_job_svc  # noqa: E402
from app.services.storage import storage_service  # noqa: E402
from app.workers.export import _run_export  # noqa: E402
from scripts.cleanup_screenshot_ocr_flow import assert_screenshot_scope  # noqa: E402


ASSET_ID = "background-export-download"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("run", "cleanup"))
    parser.add_argument("--project-id", type=uuid.UUID, required=True)
    parser.add_argument("--task-id", type=uuid.UUID, required=True)
    parser.add_argument("--job-id", type=uuid.UUID)
    parser.add_argument("--running-hold-seconds", type=float, default=6.0)
    return parser.parse_args()


def _owned_predicate(project_id: uuid.UUID, job_id: uuid.UUID | None):
    marked = AsyncJob.payload["recording_asset_id"].astext == ASSET_ID
    if job_id is None:
        return (AsyncJob.project_id == project_id) & marked
    return (AsyncJob.project_id == project_id) & or_(
        marked,
        AsyncJob.id == job_id,
    )


async def _validate_and_mark(args: argparse.Namespace) -> dict:
    if args.job_id is None:
        raise RuntimeError("run requires --job-id")
    engine = create_async_engine(settings.database_url, echo=False)
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    try:
        async with session_factory() as db:
            await assert_screenshot_scope(
                db,
                project_key="image_demo",
                project_id=args.project_id,
                task_id=args.task_id,
            )
            job = await db.get(AsyncJob, args.job_id)
            if (
                job is None
                or job.project_id != args.project_id
                or job.kind != "export"
                or job.status != "pending"
            ):
                raise RuntimeError("export job is not a pending screenshot project job")
            targets = (job.payload or {}).get("targets")
            if targets != ["coco", "aap_json"]:
                raise RuntimeError(f"unexpected recording export targets: {targets!r}")
            job.payload = {
                **(job.payload or {}),
                "recording_asset_id": ASSET_ID,
            }
            await async_job_svc.mark_running(db, job.id, celery_task_id=None)
            await db.commit()
            return {
                "job_id": str(job.id),
                "targets": list(targets),
                "opts": {
                    "include_attributes": bool(
                        job.payload.get("include_attributes", True)
                    ),
                    "video_frame_mode": str(
                        job.payload.get("video_frame_mode", "keyframes")
                    ),
                    "axis_frame": str(job.payload.get("axis_frame", "iso")),
                    "indexed_overlap_policy": str(
                        job.payload.get("indexed_overlap_policy", "error")
                    ),
                    "video_overlap_policy": str(
                        job.payload.get("video_overlap_policy", "error")
                    ),
                    "mots_frame_base": int(job.payload.get("mots_frame_base", 0)),
                },
            }
    finally:
        await engine.dispose()


async def run_export(args: argparse.Namespace) -> dict:
    prepared = await _validate_and_mark(args)
    await asyncio.sleep(max(0.0, args.running_hold_seconds))
    await _run_export(
        project_id=str(args.project_id),
        batch_id=None,
        targets=prepared["targets"],
        opts=prepared["opts"],
        async_job_id=prepared["job_id"],
        celery_task_id=None,
    )
    return {"asset_id": ASSET_ID, **prepared}


async def cleanup(args: argparse.Namespace) -> dict[str, int]:
    engine = create_async_engine(settings.database_url, echo=False)
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    object_keys: list[str] = []
    try:
        async with session_factory() as db:
            await assert_screenshot_scope(
                db,
                project_key="image_demo",
                project_id=args.project_id,
                task_id=args.task_id,
            )
            jobs = list(
                (
                    await db.execute(
                        select(AsyncJob).where(
                            _owned_predicate(args.project_id, args.job_id)
                        )
                    )
                ).scalars()
            )
            if any(job.kind != "export" for job in jobs):
                raise RuntimeError("cleanup refused: selected non-export async job")
            job_ids = [job.id for job in jobs]
            for job in jobs:
                result = job.result or {}
                object_key = result.get("object_key")
                if result.get("cache_hit") is False and isinstance(object_key, str):
                    object_keys.append(object_key)

            artifacts = []
            if object_keys:
                artifacts = list(
                    (
                        await db.execute(
                            select(ExportArtifact).where(
                                ExportArtifact.project_id == args.project_id,
                                ExportArtifact.object_key.in_(object_keys),
                            )
                        )
                    ).scalars()
                )
                if {artifact.object_key for artifact in artifacts} != set(object_keys):
                    raise RuntimeError(
                        "cleanup refused: owned export artifact is incomplete"
                    )

            notification_result = None
            job_result = None
            artifact_result = None
            if job_ids:
                notification_result = await db.execute(
                    delete(Notification).where(Notification.target_id.in_(job_ids))
                )
            if artifacts:
                artifact_result = await db.execute(
                    delete(ExportArtifact).where(
                        ExportArtifact.id.in_([artifact.id for artifact in artifacts])
                    )
                )
            if job_ids:
                job_result = await db.execute(
                    delete(AsyncJob).where(AsyncJob.id.in_(job_ids))
                )
            await db.commit()
    finally:
        await engine.dispose()

    for object_key in object_keys:
        storage_service.delete_object(object_key, bucket=settings.minio_export_bucket)
    return {
        "async_jobs": job_result.rowcount if job_result is not None else 0,
        "notifications": (
            notification_result.rowcount if notification_result is not None else 0
        ),
        "export_artifacts": (
            artifact_result.rowcount if artifact_result is not None else 0
        ),
        "objects": len(object_keys),
    }


async def main_async(args: argparse.Namespace) -> dict:
    if args.action == "run":
        return await run_export(args)
    return await cleanup(args)


def main() -> int:
    if settings.environment == "production":
        print(
            "[background-export-download] refusing production database", file=sys.stderr
        )
        return 2
    result = asyncio.run(main_async(parse_args()))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
