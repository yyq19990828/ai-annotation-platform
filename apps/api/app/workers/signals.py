"""v0.10.16 · Celery signal 兜底 —— 把 task crash / revoke 翻成 async_jobs.failed/cancelled。

设计原则：
- 仅做**兜底**。正常路径下 batch_predict / video_tracker / predictions_import 应该
  在自身完成/异常逻辑里显式 mark_complete/mark_failed；signals 只覆盖未走那条路径
  的极端情况（worker 进程 crash、Celery revoke、未被 except 接住的 raise）。
- 通过 task_id (celery_task_id) 反查 async_jobs；查不到不报错（不是所有 Celery
  task 都对应 async_jobs，如 ml_health / cleanup 等高频小任务）。
- 信号回调里**不允许 await**，所以同步建 engine + asyncio.run。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from celery.signals import task_failure, task_revoked
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.db.models.async_job import AsyncJobStatus
from app.db.models.mask_qc import MaskQCRun
from app.db.models.point_cloud_quality import PointCloudQualityRun
from app.db.models.mask_repair_batch import MaskRepairBatch
from app.db.models.mask_format_import import MaskFormatImport
from app.services import async_job as async_job_svc
from app.services.async_job_notify import notify_job_terminal

log = logging.getLogger(__name__)


async def _mark_failed(celery_task_id: str, error: str) -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        async with SessionLocal() as db:
            aj = await async_job_svc.find_by_celery_task_id(db, celery_task_id)
            if aj is None:
                return
            if aj.status in {
                AsyncJobStatus.COMPLETED.value,
                AsyncJobStatus.FAILED.value,
                AsyncJobStatus.CANCELLED.value,
            }:
                return
            await async_job_svc.mark_failed(db, aj.id, error=error)
            if aj.kind == "mask_qc":
                run = (
                    await db.execute(
                        select(MaskQCRun)
                        .where(MaskQCRun.async_job_id == aj.id)
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if run is not None and run.status in {"pending", "running"}:
                    run.status = "failed"
                    run.error_message = error[:4000]
                    run.completed_at = datetime.now(timezone.utc)
            elif aj.kind == "point_cloud_quality":
                run = (
                    await db.execute(
                        select(PointCloudQualityRun)
                        .where(PointCloudQualityRun.async_job_id == aj.id)
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if run is not None and run.status in {"pending", "running"}:
                    run.status = "failed"
                    run.error_message = error[:4000]
                    run.completed_at = datetime.now(timezone.utc)
            elif aj.kind in {"mask_repair", "mask_repair_rollback"}:
                condition = (
                    MaskRepairBatch.rollback_async_job_id == aj.id
                    if aj.kind == "mask_repair_rollback"
                    else MaskRepairBatch.async_job_id == aj.id
                )
                batch = (
                    await db.execute(
                        select(MaskRepairBatch).where(condition).with_for_update()
                    )
                ).scalar_one_or_none()
                if batch is not None:
                    batch.status = (
                        "rollback_failed"
                        if aj.kind == "mask_repair_rollback"
                        else "failed"
                    )
                    batch.completed_at = datetime.now(timezone.utc)
            elif aj.kind == "mask_format_import":
                batch = (
                    await db.execute(
                        select(MaskFormatImport)
                        .where(MaskFormatImport.async_job_id == aj.id)
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if batch is not None:
                    batch.status = "failed"
                    batch.completed_at = datetime.now(timezone.utc)
            await notify_job_terminal(db, job_id=aj.id)
            await db.commit()
    finally:
        await engine.dispose()


async def _mark_cancelled(celery_task_id: str) -> None:
    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        async with SessionLocal() as db:
            aj = await async_job_svc.find_by_celery_task_id(db, celery_task_id)
            if aj is None:
                return
            await async_job_svc.mark_cancelled(db, aj.id)
            if aj.kind == "mask_qc":
                run = (
                    await db.execute(
                        select(MaskQCRun)
                        .where(MaskQCRun.async_job_id == aj.id)
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if run is not None and run.status in {"pending", "running"}:
                    run.status = "cancelled"
                    run.completed_at = datetime.now(timezone.utc)
            elif aj.kind == "point_cloud_quality":
                run = (
                    await db.execute(
                        select(PointCloudQualityRun)
                        .where(PointCloudQualityRun.async_job_id == aj.id)
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if run is not None and run.status in {"pending", "running"}:
                    run.status = "cancelled"
                    run.completed_at = datetime.now(timezone.utc)
            elif aj.kind == "mask_repair":
                batch = (
                    await db.execute(
                        select(MaskRepairBatch)
                        .where(MaskRepairBatch.async_job_id == aj.id)
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if batch is not None and batch.status in {"pending", "running"}:
                    completed_shards = [
                        value
                        for value in (
                            (batch.result_json or {}).get("shards") or {}
                        ).values()
                        if isinstance(value, dict)
                        and value.get("status") == "completed"
                    ]
                    batch.status = "partial" if completed_shards else "cancelled"
                    batch.completed_at = datetime.now(timezone.utc)
            elif aj.kind == "mask_format_import":
                batch = (
                    await db.execute(
                        select(MaskFormatImport)
                        .where(MaskFormatImport.async_job_id == aj.id)
                        .with_for_update()
                    )
                ).scalar_one_or_none()
                if batch is not None and batch.status in {"pending", "running"}:
                    committed = [
                        value
                        for value in (
                            (batch.result_json or {}).get("items") or {}
                        ).values()
                        if isinstance(value, dict)
                        and value.get("status") == "committed"
                    ]
                    batch.status = "partial" if committed else "cancelled"
                    batch.completed_at = datetime.now(timezone.utc)
            await notify_job_terminal(db, job_id=aj.id)
            await db.commit()
    finally:
        await engine.dispose()


@task_failure.connect
def _on_task_failure(  # noqa: ARG001
    sender=None,
    task_id=None,
    exception=None,
    einfo=None,
    **kwargs,
):
    """兜底：未被 task body except 捕获的异常。"""
    if not task_id:
        return
    try:
        error = f"{type(exception).__name__}: {exception}" if exception else "unknown"
        asyncio.run(_mark_failed(task_id, error))
    except Exception:
        log.exception("async_jobs signal _on_task_failure failed")


@task_revoked.connect
def _on_task_revoked(  # noqa: ARG001
    sender=None,
    request=None,
    terminated=None,
    signum=None,
    expired=None,
    **kwargs,
):
    """兜底：Celery revoke / terminate / expired。"""
    task_id = getattr(request, "id", None) if request else None
    if not task_id:
        return
    try:
        asyncio.run(_mark_cancelled(task_id))
    except Exception:
        log.exception("async_jobs signal _on_task_revoked failed")
