"""v0.11.15 · 外部连接器数据集导入 worker。"""

from __future__ import annotations

import asyncio
from contextlib import suppress
import logging
import uuid
from datetime import datetime, timezone
from typing import BinaryIO

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.db.models.async_job import AsyncJob, AsyncJobStatus
from app.db.models.dataset import Dataset
from app.db.models.storage_connection import StorageConnection
from app.services import async_job as async_job_svc
from app.services.async_job_notify import notify_job_terminal
from app.services.dataset import DatasetService, IngestOutcome
from app.services.sources import build_adapter
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.workers.dataset_import.run_dataset_import")
def run_dataset_import(self, job_id: str) -> None:
    asyncio.run(
        _run_dataset_import(
            job_id=job_id,
            celery_task_id=getattr(self.request, "id", None),
        )
    )


async def _cancel_requested(db: AsyncSession, job_id: uuid.UUID) -> bool:
    job = await db.get(AsyncJob, job_id)
    if job is None:
        return True
    await db.refresh(job)
    if job.status == AsyncJobStatus.CANCELLED.value:
        return True
    return bool((job.payload or {}).get("cancel_requested"))


async def _finish_cancelled(
    db: AsyncSession,
    job_id: uuid.UUID,
    *,
    result: dict,
) -> None:
    job = await db.get(AsyncJob, job_id)
    if job is None:
        return
    if job.status in {
        AsyncJobStatus.PENDING.value,
        AsyncJobStatus.RUNNING.value,
        AsyncJobStatus.CANCELLED.value,
    }:
        job.status = AsyncJobStatus.CANCELLED.value
        job.completed_at = datetime.now(timezone.utc)
        job.result = result


def _close_stream(stream: BinaryIO) -> None:
    close = getattr(stream, "close", None)
    if callable(close):
        with suppress(Exception):
            close()


def _result(
    *,
    total: int,
    added: int,
    skipped: int,
    error_count: int,
    errors: list[dict],
    linked_tasks: int,
    cancelled_at_index: int | None = None,
) -> dict:
    out = {
        "total": total,
        "added": added,
        "imported": added,
        "skipped": skipped,
        "error_count": error_count,
        "errors": errors,
        "linked_tasks": linked_tasks,
    }
    if cancelled_at_index is not None:
        out["cancelled_at_index"] = cancelled_at_index
    return out


async def _run_dataset_import(
    *,
    job_id: str,
    celery_task_id: str | None,
) -> None:
    job_uuid = uuid.UUID(job_id)
    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    adapter = None
    try:
        async with SessionLocal() as db:
            try:
                await async_job_svc.mark_running(
                    db, job_uuid, celery_task_id=celery_task_id
                )
                await db.commit()

                job = await db.get(AsyncJob, job_uuid)
                if job is None:
                    return
                payload = job.payload or {}
                dataset_id = uuid.UUID(str(payload["dataset_id"]))
                connection_id = uuid.UUID(str(payload["connection_id"]))
                source_path = str(payload.get("source_path") or "")
                recursive = bool(payload.get("recursive", True))
                include_globs = payload.get("include_globs")
                if not isinstance(include_globs, list):
                    include_globs = []

                dataset = await db.get(Dataset, dataset_id)
                if dataset is None:
                    raise ValueError("dataset not found")
                conn = await db.get(StorageConnection, connection_id)
                if conn is None:
                    raise ValueError("storage connection not found")

                adapter = await build_adapter(db, conn)
                objects = list(adapter.list(source_path, recursive, include_globs))
                total = len(objects)
                total_bytes = sum(max(0, obj.size) for obj in objects)
                if total > settings.dataset_import_max_files:
                    raise ValueError(
                        "import file count exceeds limit "
                        f"({total} > {settings.dataset_import_max_files})"
                    )
                if total_bytes > settings.dataset_import_max_total_bytes:
                    raise ValueError(
                        "import total bytes exceeds limit "
                        f"({total_bytes} > {settings.dataset_import_max_total_bytes})"
                    )

                await async_job_svc.update_progress(
                    db,
                    job_uuid,
                    5 if total else 90,
                    extra_payload={"total_files": total, "total_bytes": total_bytes},
                )
                await db.commit()

                svc = DatasetService(db)
                added = 0
                skipped = 0
                linked_tasks = 0
                errors: list[dict] = []
                error_count = 0
                last_pct = 5

                for index, obj in enumerate(objects, start=1):
                    if await _cancel_requested(db, job_uuid):
                        await _finish_cancelled(
                            db,
                            job_uuid,
                            result=_result(
                                total=total,
                                added=added,
                                skipped=skipped + (total - index + 1),
                                error_count=error_count,
                                errors=errors,
                                linked_tasks=linked_tasks,
                                cancelled_at_index=index - 1,
                            ),
                        )
                        await notify_job_terminal(db, job_id=job_uuid)
                        await db.commit()
                        return

                    try:
                        stream = adapter.open(obj.relpath)
                        try:
                            outcome = await svc.ingest_one(
                                dataset_id,
                                obj.relpath,
                                stream,
                                size=obj.size,
                            )
                        finally:
                            _close_stream(stream)
                        if outcome.status == "added":
                            added += 1
                            linked_tasks += outcome.linked_tasks
                            await db.commit()
                            if outcome.item_id is not None:
                                try:
                                    await svc.enqueue_media_for_items([outcome.item_id])
                                except Exception as exc:  # noqa: BLE001
                                    log.warning(
                                        "dataset_import media enqueue failed "
                                        "job=%s item=%s err=%s",
                                        job_id,
                                        outcome.item_id,
                                        exc,
                                    )
                        elif outcome.status == "skipped":
                            skipped += 1
                            await db.commit()
                        else:
                            error_count += 1
                            _append_error(errors, outcome)
                            await db.rollback()
                    except Exception as exc:  # noqa: BLE001
                        await db.rollback()
                        error_count += 1
                        _append_error(
                            errors,
                            IngestOutcome(
                                status="error",
                                relpath=obj.relpath,
                                error=f"{type(exc).__name__}: {exc}",
                            ),
                        )
                        log.warning(
                            "dataset_import item failed job=%s relpath=%s err=%s",
                            job_id,
                            obj.relpath,
                            exc,
                        )

                    pct = 5 + int(index / max(total, 1) * 90)
                    if pct >= last_pct + 5 or index == total:
                        await async_job_svc.update_progress(db, job_uuid, pct)
                        await db.commit()
                        last_pct = pct

                result = _result(
                    total=total,
                    added=added,
                    skipped=skipped,
                    error_count=error_count,
                    errors=errors,
                    linked_tasks=linked_tasks,
                )
                await async_job_svc.mark_complete(db, job_uuid, result=result)
                await notify_job_terminal(db, job_id=job_uuid)
                await db.commit()
            except Exception as exc:  # noqa: BLE001
                await db.rollback()
                err = f"{type(exc).__name__}: {exc}"
                try:
                    await async_job_svc.mark_failed(db, job_uuid, error=err)
                    await notify_job_terminal(db, job_id=job_uuid)
                    await db.commit()
                except Exception:
                    await db.rollback()
                raise
    finally:
        if adapter is not None:
            with suppress(Exception):
                adapter.close()
        await engine.dispose()


def _append_error(errors: list[dict], outcome: IngestOutcome) -> None:
    if len(errors) >= 100:
        return
    errors.append(
        {
            "relpath": outcome.relpath,
            "error": outcome.error or outcome.reason or "unknown error",
        }
    )
