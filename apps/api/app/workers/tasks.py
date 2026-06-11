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


def _build_predict_context(
    *,
    prompt: str | None,
    output_mode: str,
    params: dict | None,
    model_id: str | None,
    task_type: str | None,
    model_variants: dict | None,
    class_filter: list[int] | None = None,
    box_threshold: float | None = None,
    text_threshold: float | None = None,
) -> dict | None:
    """构造发往 backend /predict 的 context (纯函数, 便于单测).

    两条互斥路径:
    - **协议 v2 结构化** (model_variants 非 None, 由面板几何 backend 触发): backend (yolo) 要
      `model_variants` dict + nested `params` + `type=<几何 task>`。修通 YOLO 批量预标
      (此前 worker 发扁平 series/size + type="text" 被 YOLO 422)。判定用 `is not None` 而非真值:
      前端几何 backend 恒发 `model_variants` 字段, variant 轴未就位时为空 dict `{}`——此时仍须走
      v2 路径才能透传 class_filter (类别白名单), 否则空 dict 落入扁平路径会静默丢弃 classes。
    - **既有扁平路径** (gsam2 文本 prompt / OCR / doc_layout): 不发 model_variants (→ None), 维持原样防回归。
    """
    if model_variants is not None:
        ctx: dict = {
            "type": task_type or "detection",
            "model_variants": model_variants,
            "params": params or {},
        }
        if model_id:
            ctx["model_id"] = model_id
        if class_filter:
            # v0.14.17 · 类别白名单 (模型原生类别 index 子集); yolo /predict 用 model.predict(classes=) 过滤.
            ctx["classes"] = class_filter
        if prompt:
            # YOLO 当前忽略 text (类别筛选走 classes 字段); 保留通道.
            ctx["text"] = prompt
        return ctx

    # ── 既有扁平路径 (gsam2 / OCR / doc_layout), 与 v0.14.9 行为逐字等价 ──
    context: dict | None = None
    if prompt:
        context = {"type": "text", "text": prompt, "output": output_mode}
        if box_threshold is not None:
            context["box_threshold"] = box_threshold
            context["text_threshold"] = text_threshold
        _reserved = {"type", "text", "output"}
        if params:
            context.update(
                {
                    k: v
                    for k, v in params.items()
                    if v is not None and k not in _reserved
                }
            )
    if task_type or model_id:
        if context is None:
            context = {}
        if task_type:
            context["type"] = task_type
        if model_id:
            context["model_id"] = model_id
    return context


def _model_label(model_variants: dict | None) -> str | None:
    """从 model_variants 派生展示串, 与 backend 回传的 model_version 一致 (series+size, 如 yolov8l).

    variant 轴未就位时 model_variants 为空 dict {} → 返回 None (不展示误导标签, backend 走默认)。
    """
    if not model_variants:
        return None
    series = model_variants.get("series")
    size = model_variants.get("size")
    if series and size:
        return f"{series}{size}"
    vals = [str(v) for v in model_variants.values() if v]
    return "".join(vals) or None


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
    predict_mode: str = "skip_predicted",
    model_id: str | None = None,
    task_type: str | None = None,
    model_variants: dict | None = None,
    class_filter: list[int] | None = None,
):
    """v0.9.5 · 批量预标 worker.

    新增参数：
    - prompt: 文本批量预标 prompt（None 时走老的 image-only 批量行为）。
    - output_mode: text 模式输出形态（box / mask / both），仅 prompt 非空生效。
    - batch_id: 跑完后自动转 PRE_ANNOTATED 的目标 batch；None 则不动状态。
    - celery_task_id (v0.9.8): 用于 _BatchPredictTask.on_failure 回查 async_jobs 行.
    - user_id (v0.10.45): 写 async_jobs owner, 供 /async-jobs owner-scope 列表可见.
    - model_id (v0.14.9): 协议 v2 多模型路由, 非空时写 context["model_id"]。
    - task_type (v0.14.9): 协议 v2 task 别名 ("ocr"/"doc_layout"/"text"), 非空时写
      context["type"]; 让 OCR / 版面分析等非纯文本 task 也能走批量预标。

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
    from app.db.models.async_job import AsyncJob, AsyncJobStatus
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
    failed_prediction_ids: list[str] = []
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

        # v0.9.5 / v0.14.9 / v0.14.17 · 构造 /predict context (扁平文本路径 vs v2 结构化路径,
        # 见 _build_predict_context). DINO 阈值取项目级 override.
        project = await db.get(Project, uuid.UUID(project_id))
        if project is not None:
            project_name = project.name
        context = _build_predict_context(
            prompt=prompt,
            output_mode=output_mode,
            params=params,
            model_id=model_id,
            task_type=task_type,
            model_variants=model_variants,
            class_filter=class_filter,
            box_threshold=float(project.box_threshold) if project is not None else None,
            text_threshold=float(project.text_threshold)
            if project is not None
            else None,
        )

        # v0.11.24 · 幂等：skip_predicted 排除已预标 task；append/overwrite 不排除。
        skip_predicted = predict_mode == "skip_predicted"
        # base_conds 不含预标过滤, 供 total==0 时回数候选区分「批次本就空」vs「全已预标被跳过」。
        if task_ids:
            base_conds = [Task.id.in_([uuid.UUID(tid) for tid in task_ids])]
        elif batch_id:
            # v0.9.5 · 指定 batch 时仅捞 batch 内 pending tasks
            base_conds = [
                Task.batch_id == uuid.UUID(batch_id),
                Task.status == "pending",
            ]
        else:
            base_conds = [
                Task.project_id == uuid.UUID(project_id),
                Task.status == "pending",
            ]
        sel = select(Task).where(*base_conds)
        if skip_predicted:
            sel = sel.where(Task.total_predictions == 0)
        result = await db.execute(sel)
        tasks = list(result.scalars().all())
        total = len(tasks)

        # v0.11.24 · overwrite：预标前清掉这批 task 的旧预测（保留人工标注），避免叠加。
        # 不重置 task 状态（与删批次不同）——预标只换预测内容、不动流程。
        if predict_mode == "overwrite" and tasks:
            from app.services.batch import BatchService

            await BatchService(db).clean_task_predictions([t.id for t in tasks])
            await db.flush()

        # v0.10.49 · async_jobs 单一真值：建 batch_predict 行 (status=running)。
        # domain 字段（batch_id / ml_backend / prompt / total_tasks）进 payload。
        batch = await db.get(TaskBatch, uuid.UUID(batch_id)) if batch_id else None
        # v0.14.18 · payload 记实际模型路由 (溯源 + 任务页展示用了哪个模型)。
        # output_mode 只在它真正被消费的文本 prompt 路径才记 (见 _build_predict_context 的
        # `if prompt:` 分支); 几何/yolo 路径不读 output_mode, 记了会误导成「用了 mask」。
        job_payload: dict = {
            "batch_id": batch_id,
            "batch_display_id": batch.display_id if batch else None,
            "ml_backend_id": ml_backend_id,
            "total_tasks": total,
            "prompt": (prompt or "")[:200],
            "project_display_id": project.display_id if project else None,
            "project_name": project.name if project else None,
            "ml_backend_name": backend.name,
        }
        if model_id:
            job_payload["model_id"] = model_id
        if task_type:
            job_payload["task_type"] = task_type
        if model_variants is not None:
            job_payload["model_variants"] = model_variants
            label = _model_label(model_variants)
            if label:
                job_payload["model_label"] = label
        if prompt:
            job_payload["output_mode"] = output_mode
        aj = await async_job_svc.create_job(
            db,
            kind="batch_predict",
            user_id=uuid.UUID(user_id) if user_id else None,
            project_id=uuid.UUID(project_id),
            payload=job_payload,
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

        async def _cancel_requested() -> bool:
            job_for_cancel = await db.get(AsyncJob, async_job_id)
            if job_for_cancel is None:
                return False
            await db.refresh(job_for_cancel)
            if job_for_cancel.status == AsyncJobStatus.CANCELLED.value:
                return True
            return bool((job_for_cancel.payload or {}).get("cancel_requested"))

        async def _finish_cancelled(cancelled_at_index: int) -> None:
            processed_count = success_count + failed_count
            skipped_count = max(0, total - processed_count)
            duration_ms = int((time.perf_counter() - started_perf) * 1000)
            if total > 0:
                await async_job_svc.update_progress(
                    db, async_job_id, int((processed_count / total) * 100)
                )
            await async_job_svc.mark_cancelled(
                db,
                async_job_id,
                result={
                    "success_count": success_count,
                    "failed_count": failed_count,
                    "failed_prediction_ids": failed_prediction_ids,
                    "done_count": processed_count,
                    "skipped_count": skipped_count,
                    "cancelled_at_index": cancelled_at_index,
                    "duration_ms": duration_ms,
                    "total_cost": f"{running_total_cost:.4f}",
                },
            )
            await notify_job_terminal(db, job_id=async_job_id)
            await db.commit()
            _publish_progress(
                project_id,
                processed_count,
                total,
                status="cancelled",
                job_meta={
                    **job_meta_base,
                    "success_count": success_count,
                    "failed_count": failed_count,
                    "done_count": processed_count,
                    "skipped_count": skipped_count,
                    "duration_ms": duration_ms,
                },
            )

        if total == 0:
            duration_ms = int((time.perf_counter() - started_perf) * 1000)
            result_payload: dict = {
                "success_count": 0,
                "failed_count": 0,
                "duration_ms": duration_ms,
                "total_cost": "0.0000",
            }
            # skip_predicted 下 total==0 可能是「候选 task 全部已预标被跳过」而非批次本就空。
            # 回数不含预标过滤的候选, >0 即全被跳过 → 标 reason 供前端给明确文案。
            if skip_predicted:
                from sqlalchemy import func

                cnt = await db.execute(
                    select(func.count()).select_from(Task).where(*base_conds)
                )
                skipped_n = int(cnt.scalar_one() or 0)
                if skipped_n > 0:
                    result_payload["skipped_count"] = skipped_n
                    result_payload["reason"] = "all_predicted"
            await async_job_svc.mark_complete(
                db,
                async_job_id,
                result=result_payload,
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
            if await _cancel_requested():
                await _finish_cancelled(cancelled_at_index=i)
                await engine.dispose()
                return

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
                failed = await pred_svc.create_failed(
                    task_id=task.id,
                    project_id=uuid.UUID(project_id),
                    ml_backend_id=backend.id,
                    error_type=type(exc).__name__,
                    message=str(exc),
                )
                failed_prediction_ids.append(str(failed.id))
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

        if await _cancel_requested():
            await _finish_cancelled(cancelled_at_index=success_count + failed_count)
            await engine.dispose()
            return

        # B-45 · 全部子项失败 → job 视为失败（避免「失败也显示已完成」），
        # 不推进 batch 状态、终态走 failed 分支。
        all_failed = success_count == 0 and failed_count > 0

        # v0.9.5 · 跑完自动 active → pre_annotated（仅当指定 batch + 当前还在 active 时）
        if batch_id and not all_failed:
            batch = await db.get(TaskBatch, uuid.UUID(batch_id))
            if batch and batch.status == BatchStatus.ACTIVE:
                batch.status = BatchStatus.PRE_ANNOTATED
                await db.commit()

        # v0.10.49 · 结束时点 → 写 async_job final stats (result JSONB)
        duration_ms = int((time.perf_counter() - started_perf) * 1000)
        result_stats = {
            "success_count": success_count,
            "failed_count": failed_count,
            "failed_prediction_ids": failed_prediction_ids,
            "duration_ms": duration_ms,
            # v0.9.11 · total_cost 接通 PredictionMeta.total_cost 累加
            "total_cost": f"{running_total_cost:.4f}",
        }
        if all_failed:
            await async_job_svc.mark_failed(
                db,
                async_job_id,
                error=f"全部 {failed_count} 条预标失败",
                result=result_stats,
            )
        else:
            await async_job_svc.mark_complete(
                db,
                async_job_id,
                result=result_stats,
            )
        await notify_job_terminal(db, job_id=async_job_id)
        await db.commit()

        _publish_progress(
            project_id,
            total,
            total,
            status="failed" if all_failed else "completed",
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
    predict_mode: str = "skip_predicted",
    model_id: str | None = None,
    task_type: str | None = None,
    model_variants: dict | None = None,
    class_filter: list[int] | None = None,
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
            predict_mode=predict_mode,
            model_id=model_id,
            task_type=task_type,
            model_variants=model_variants,
            class_filter=class_filter,
        )
    )
