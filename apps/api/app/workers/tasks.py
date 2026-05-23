import asyncio
import json
import time
import uuid

import redis

from app.config import settings
from app.workers.celery_app import celery_app


def _publish_progress(
    project_id: str,
    current: int,
    total: int,
    status: str = "running",
    error: str | None = None,
    job_meta: dict | None = None,
):
    """v0.9.5: 单项目预标进度. v0.9.8: 同时发到全局 channel `global:prediction-jobs`,
    让 Topbar 徽章 / 切项目 toast 可跨项目订阅. job_meta 仅在开始/结束/失败 3 时点发,
    避免高频中间帧塞爆全局通道."""
    payload = {
        "current": current,
        "total": total,
        "status": status,
        "error": error,
    }
    r = redis.from_url(settings.redis_url)
    try:
        r.publish(f"project:{project_id}:preannotate", json.dumps(payload))
        if job_meta is not None:
            global_payload = {**payload, "project_id": project_id, **job_meta}
            r.publish("global:prediction-jobs", json.dumps(global_payload))
    finally:
        r.close()


async def _run_batch(
    project_id: str,
    ml_backend_id: str,
    task_ids: list[str] | None,
    prompt: str | None = None,
    output_mode: str = "mask",
    batch_id: str | None = None,
    celery_task_id: str | None = None,
    user_id: str | None = None,
    params: dict | None = None,
):
    """v0.9.5 · 批量预标 worker.

    新增参数：
    - prompt: 文本批量预标 prompt（None 时走老的 image-only 批量行为）。
    - output_mode: text 模式输出形态（box / mask / both），仅 prompt 非空生效。
    - batch_id: 跑完后自动转 PRE_ANNOTATED 的目标 batch；None 则不动状态。
    - celery_task_id (v0.9.8): 用于 _BatchPredictTask.on_failure 回查 async_jobs 行.
    - user_id (v0.10.45): 写 async_jobs owner, 供 /async-jobs owner-scope 列表可见.

    v0.10.49 · async_jobs 收敛：async_jobs 升为单一真值，prediction_jobs 专表已删。
    domain 字段（batch_id / prompt / 统计）进 payload/result JSONB。
    """
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import (
        AsyncSession,
        async_sessionmaker,
        create_async_engine,
    )

    from app.db.enums import BatchStatus
    from app.db.models.ml_backend import MLBackend
    from app.db.models.project import Project
    from app.db.models.task import Task
    from app.db.models.task_batch import TaskBatch
    from app.services import async_job as async_job_svc
    from app.services.async_job_notify import notify_job_terminal
    from app.services.ml_client import MLBackendClient
    from app.services.prediction import PredictionService

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    started_perf = time.perf_counter()
    success_count = 0
    failed_count = 0
    project_name: str | None = None
    # v0.9.11 · 累加每条 prediction.meta.total_cost; job 完成时写 async_job.result.total_cost.
    # grounded-sam2-backend 当前不返回 cost (留 0.0), LLM-backed backend (sam3 / future) 自然到位.
    running_total_cost = 0.0

    async with SessionLocal() as db:
        backend = await db.get(MLBackend, uuid.UUID(ml_backend_id))
        if not backend:
            _publish_progress(
                project_id, 0, 0, status="error", error="ML Backend not found"
            )
            return

        # v0.9.5 · 文本批量预标透传 ctx（DINO 阈值取项目级 override）
        context: dict | None = None
        project = await db.get(Project, uuid.UUID(project_id))
        if project is not None:
            project_name = project.name
        if prompt:
            context = {
                "type": "text",
                "text": prompt,
                "output": output_mode,
            }
            if project is not None:
                context["box_threshold"] = float(project.box_threshold)
                context["text_threshold"] = float(project.text_threshold)
            # v0.10.38 · 按后端参数面板 (epic 阶段 2): 选中 backend 的 /setup.params 值覆盖项目级兜底.
            # 保留 context 结构性键 (type/text/output) 不被 params 覆盖, 防止破坏 predict 请求语义.
            _reserved = {"type", "text", "output"}
            if params:
                context.update(
                    {
                        k: v
                        for k, v in params.items()
                        if v is not None and k not in _reserved
                    }
                )

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

        # v0.10.49 · async_jobs 单一真值：建 batch_predict 行 (status=running)。
        # domain 字段（batch_id / ml_backend / prompt / total_tasks）进 payload。
        batch = await db.get(TaskBatch, uuid.UUID(batch_id)) if batch_id else None
        aj = await async_job_svc.create_job(
            db,
            kind="batch_predict",
            user_id=uuid.UUID(user_id) if user_id else None,
            project_id=uuid.UUID(project_id),
            payload={
                "batch_id": batch_id,
                "batch_display_id": batch.display_id if batch else None,
                "ml_backend_id": ml_backend_id,
                "total_tasks": total,
                "prompt": (prompt or "")[:200],
                "project_display_id": project.display_id if project else None,
                "project_name": project.name if project else None,
                "ml_backend_name": backend.name,
                "output_mode": output_mode,
            },
            celery_task_id=celery_task_id,
        )
        await async_job_svc.mark_running(db, aj.id, celery_task_id=celery_task_id)
        await db.commit()
        async_job_id = aj.id

        job_meta_base = {
            "job_id": str(async_job_id),
            "project_name": project_name,
            "batch_id": batch_id,
        }
        # 开始时点 → 全局通道发 running
        _publish_progress(
            project_id,
            0,
            total,
            status="running",
            job_meta=job_meta_base,
        )

        if total == 0:
            duration_ms = int((time.perf_counter() - started_perf) * 1000)
            await async_job_svc.mark_complete(
                db,
                async_job_id,
                result={
                    "success_count": 0,
                    "failed_count": 0,
                    "duration_ms": duration_ms,
                    "total_cost": "0.0000",
                },
            )
            await notify_job_terminal(db, job_id=async_job_id)
            await db.commit()
            _publish_progress(
                project_id,
                0,
                0,
                status="completed",
                job_meta=job_meta_base,
            )
            await engine.dispose()
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
                        token_meta=pred_result.meta,
                    )
                    # v0.9.11 · 单条 cost 累加到 job 级总费用
                    if pred_result.meta:
                        cost = pred_result.meta.get("total_cost")
                        if cost is not None:
                            running_total_cost += float(cost)
                await db.commit()
                success_count += 1
            except Exception as exc:
                await pred_svc.create_failed(
                    task_id=task.id,
                    project_id=uuid.UUID(project_id),
                    ml_backend_id=backend.id,
                    error_type=type(exc).__name__,
                    message=str(exc),
                )
                await db.commit()
                failed_count += 1

            _publish_progress(project_id, i + 1, total)

            # v0.10.16 · async_jobs 进度（每 5% 步长写一次，避免每条都 DB write）
            if total > 0:
                pct = int(((i + 1) / total) * 100)
                if pct % 5 == 0 or (i + 1) == total:
                    try:
                        await async_job_svc.update_progress(db, async_job_id, pct)
                        await db.commit()
                    except Exception:
                        await db.rollback()

        # v0.9.5 · 跑完自动 active → pre_annotated（仅当指定 batch + 当前还在 active 时）
        if batch_id:
            batch = await db.get(TaskBatch, uuid.UUID(batch_id))
            if batch and batch.status == BatchStatus.ACTIVE:
                batch.status = BatchStatus.PRE_ANNOTATED
                await db.commit()

        # v0.10.49 · 结束时点 → 写 async_job final stats (result JSONB)
        duration_ms = int((time.perf_counter() - started_perf) * 1000)
        await async_job_svc.mark_complete(
            db,
            async_job_id,
            result={
                "success_count": success_count,
                "failed_count": failed_count,
                "duration_ms": duration_ms,
                # v0.9.11 · total_cost 接通 PredictionMeta.total_cost 累加
                "total_cost": f"{running_total_cost:.4f}",
            },
        )
        await notify_job_terminal(db, job_id=async_job_id)
        await db.commit()

        _publish_progress(
            project_id,
            total,
            total,
            status="completed",
            job_meta={
                **job_meta_base,
                "success_count": success_count,
                "failed_count": failed_count,
                "duration_ms": duration_ms,
            },
        )

    await engine.dispose()


async def _mark_job_failed(celery_task_id: str, error_message: str) -> None:
    """v0.10.49 · _BatchPredictTask.on_failure 回查 async_jobs 行写错误.

    任务级未捕获异常（dispatch TypeError / 内部 raise / Celery retry 耗尽）走这条路；
    job 通过 celery_task_id 反查（worker 创建 async_job 时已存）。"""
    from sqlalchemy.ext.asyncio import (
        AsyncSession,
        async_sessionmaker,
        create_async_engine,
    )

    from app.services import async_job as async_job_svc
    from app.services.async_job_notify import notify_job_terminal

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        async with SessionLocal() as db:
            aj = await async_job_svc.find_by_celery_task_id(db, celery_task_id)
            if aj is None:
                return
            await async_job_svc.mark_failed(db, aj.id, error=error_message)
            await notify_job_terminal(db, job_id=aj.id)
            await db.commit()
    finally:
        await engine.dispose()


class _BatchPredictTask(celery_app.Task):
    """B-1: dispatch 阶段（如 TypeError 关键字不识别）或 body 内未捕获异常都推到 WS,
    避免前端停在「已排队」状态。args[0] 是 project_id。
    v0.10.49: 同步把 async_jobs 行翻成 status='failed'。"""

    def on_failure(self, exc, task_id, args, kwargs, einfo):  # noqa: ARG002
        project_id = kwargs.get("project_id") or (args[0] if args else None)
        error_message = f"{type(exc).__name__}: {exc}"
        if project_id:
            try:
                _publish_progress(
                    str(project_id),
                    0,
                    0,
                    status="error",
                    error=error_message,
                    job_meta={"job_celery_task_id": task_id},
                )
            except Exception:
                pass
        try:
            asyncio.run(_mark_job_failed(task_id, error_message))
        except Exception:
            pass


@celery_app.task(
    bind=True,
    base=_BatchPredictTask,
    max_retries=3,
    default_retry_delay=30,
)
def batch_predict(
    self,
    project_id: str,
    ml_backend_id: str,
    task_ids: list[str] | None = None,
    prompt: str | None = None,
    output_mode: str = "mask",
    batch_id: str | None = None,
    user_id: str | None = None,
    params: dict | None = None,
):
    asyncio.run(
        _run_batch(
            project_id,
            ml_backend_id,
            task_ids,
            prompt=prompt,
            output_mode=output_mode,
            batch_id=batch_id,
            celery_task_id=self.request.id,
            user_id=user_id,
            params=params,
        )
    )
