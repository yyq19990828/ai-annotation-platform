#!/usr/bin/env python3
"""Precisely remove persistent data created by one screenshot OCR recording.

This helper is intentionally limited to the screenshot-managed OCR project. It
cleans the exact task, accepted annotations, Celery job, and Celery result named
by the recorder; it never scans or mutates user-owned projects. Audit rows are
immutable by design and are deliberately not bypassed here.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

_API_ROOT = Path(__file__).resolve().parent.parent
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from app.config import settings  # noqa: E402
from app.db.models.async_job import AsyncJob  # noqa: E402
from app.db.models.annotation import Annotation  # noqa: E402
from app.db.models.dataset import Dataset, ProjectDataset  # noqa: E402
from app.db.models.project import Project  # noqa: E402
from app.db.models.task import Task  # noqa: E402
from app.services.batch import BatchService  # noqa: E402
from app.services.screenshot_seed_spec import (  # noqa: E402
    PROJECT_SPECS,
    SEED_MANAGED_BY,
)
from app.workers.celery_app import celery_app  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-id", type=uuid.UUID, required=True)
    parser.add_argument("--task-id", type=uuid.UUID, required=True)
    parser.add_argument("--celery-task-id", required=True)
    parser.add_argument("--annotation-id", type=uuid.UUID, action="append", default=[])
    return parser.parse_args()


async def assert_screenshot_ocr_scope(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
) -> None:
    project = await db.get(Project, project_id)
    expected_display_id = PROJECT_SPECS["ocr_demo"].display_id
    if project is None or project.display_id != expected_display_id:
        raise RuntimeError(
            f"cleanup scope is not screenshot OCR project {expected_display_id}: {project_id}"
        )

    task = await db.get(Task, task_id)
    if task is None or task.project_id != project_id:
        raise RuntimeError(
            f"cleanup task does not belong to screenshot OCR project: {task_id}"
        )

    datasets = (
        (
            await db.execute(
                select(Dataset)
                .join(
                    ProjectDataset,
                    ProjectDataset.dataset_id == Dataset.id,
                )
                .where(ProjectDataset.project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    managed = any(
        isinstance(dataset.metadata_, dict)
        and isinstance(dataset.metadata_.get("seed"), dict)
        and dataset.metadata_["seed"].get("managed_by") == SEED_MANAGED_BY
        and dataset.metadata_["seed"].get("logical_key") == "ocr_demo"
        for dataset in datasets
    )
    if not managed:
        raise RuntimeError(
            "cleanup refused: OCR project is not screenshot-seed managed"
        )


async def cleanup(args: argparse.Namespace) -> dict[str, int]:
    engine = create_async_engine(settings.database_url, echo=False)
    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    try:
        async with session_factory() as db:
            await assert_screenshot_ocr_scope(
                db,
                project_id=args.project_id,
                task_id=args.task_id,
            )
            annotation_result = await db.execute(
                delete(Annotation).where(
                    Annotation.id.in_(args.annotation_id),
                    Annotation.task_id == args.task_id,
                )
            )
            prediction_counts = await BatchService(db).clean_task_predictions(
                [args.task_id]
            )
            job_result = await db.execute(
                delete(AsyncJob).where(
                    AsyncJob.celery_task_id == args.celery_task_id,
                )
            )
            await db.commit()
    finally:
        await engine.dispose()

    # Celery result backend is outside PostgreSQL. Forgetting an already-expired
    # result is harmless and keeps the recorder idempotent for the afterAll retry.
    try:
        celery_app.AsyncResult(args.celery_task_id).forget()
    except Exception as exc:  # noqa: BLE001 - DB cleanup remains authoritative
        print(
            f"[cleanup-screenshot-ocr] WARN celery forget failed: {exc}",
            file=sys.stderr,
        )

    return {
        **prediction_counts,
        "annotations": annotation_result.rowcount or 0,
        "async_jobs": job_result.rowcount or 0,
    }


def main() -> int:
    if settings.environment == "production":
        print("[cleanup-screenshot-ocr] refusing to run in production", file=sys.stderr)
        return 2
    args = parse_args()
    counts = asyncio.run(cleanup(args))
    print(f"[cleanup-screenshot-ocr] {json.dumps(counts, sort_keys=True)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
