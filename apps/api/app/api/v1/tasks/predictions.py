import uuid
from typing import Any
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import (
    get_db,
    get_current_user,
    require_roles,
)
from app.db.models.user import User
from app.db.models.prediction import Prediction
from app.schemas.annotation import (
    AnnotationOut,
)
from app.schemas.prediction import PredictionOut
from app.services.annotation import AnnotationService
from app.services.prediction import PredictionService
from app.services.task_lock import TaskLockService


from app.api.v1.tasks._shared import (
    _assert_task_editable,
    _load_task_or_404,
    _assert_task_visible,
    _ANNOTATORS,
)

router = APIRouter()


@router.get("/{task_id}/predictions", response_model=list[PredictionOut])
async def get_predictions(
    task_id: uuid.UUID,
    model_version: str | None = None,
    min_confidence: float | None = Query(None, ge=0.0, le=1.0),
    limit: int | None = Query(None, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    返回该任务的预测。每个 Prediction.result 内含多个 shape；当 limit 设定时，
    按 shape 置信度 desc 跨 Prediction 排序、截取 [offset, offset+limit]，再回到原 Prediction 容器。
    """
    task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, task, current_user)
    svc = PredictionService(db)
    predictions = await svc.list_by_task(task_id, model_version=model_version)

    # v0.9.5 · 一次性 join PredictionMeta 取 cost / inference_time_ms（单条费用透传）
    pred_ids = [p.id for p in predictions]
    meta_map: dict[uuid.UUID, tuple[int | None, float | None]] = {}
    if pred_ids:
        from app.db.models.prediction import PredictionMeta

        meta_rows = await db.execute(
            select(
                PredictionMeta.prediction_id,
                PredictionMeta.inference_time_ms,
                PredictionMeta.total_cost,
            ).where(PredictionMeta.prediction_id.in_(pred_ids))
        )
        for pred_id, ms, cost in meta_rows:
            if pred_id is not None:
                meta_map[pred_id] = (ms, cost)

    # 第一步：LabelStudio → 内部 schema 适配 + min_confidence 过滤
    # v0.9.7 fix · DB 存 LabelStudio 标准 {type, value, score}, 前端期望 {type, class_name,
    # geometry, confidence}. 在 read 路径补 adapter, DB 不动 (保持导出兼容).
    # v0.9.11 · PredictionOut.result 类型从 list[dict] 收紧到 list[PredictionShape], 改为
    # 内部 shape 转换后再构造 PredictionOut (避免 raw LS shape 直接验证失败).
    from app.services.prediction import to_internal_shape

    def _build_out(p, shapes: list[dict]) -> PredictionOut:
        ms, cost = meta_map.get(p.id, (None, None))
        return PredictionOut.model_validate(
            {
                "id": p.id,
                "task_id": p.task_id,
                "project_id": p.project_id,
                "ml_backend_id": p.ml_backend_id,
                "model_version": p.model_version,
                "score": p.score,
                "source": getattr(p, "source", None),
                "tool_unit_id": getattr(p, "tool_unit_id", None) or "bbox",
                "result": shapes,
                "cluster": p.cluster,
                "created_at": p.created_at,
                "inference_time_ms": ms,
                "total_cost": cost,
            }
        )

    base: list[tuple[Any, list[dict]]] = []  # (raw prediction, internal shapes)
    for p in predictions:
        # B-37 · 跳过被驳回的 shape 下标; 防止刷新后 AI 待审框重现.
        rejected_set = set(p.rejected_shape_indexes or [])
        shapes = []
        for shape_index, raw_shape in enumerate(p.result or []):
            if shape_index in rejected_set:
                continue
            shape = dict(to_internal_shape(raw_shape))
            shape["shape_index"] = shape_index
            shapes.append(shape)
        if min_confidence is not None:
            shapes = [s for s in shapes if s.get("confidence", 0.0) >= min_confidence]
        if shapes:
            base.append((p, shapes))

    if limit is None and offset == 0:
        return [_build_out(p, shapes) for p, shapes in base]

    # 第二步：跨 Prediction 按置信度排序 + offset/limit 截取
    flat: list[tuple[int, dict]] = []
    for idx, (_, shapes) in enumerate(base):
        for s in shapes:
            flat.append((idx, s))
    flat.sort(key=lambda x: x[1].get("confidence", 0.0), reverse=True)
    sliced = flat[offset : (offset + limit) if limit else None]

    # 第三步：按原 Prediction 顺序重组
    grouped: dict[int, list[dict]] = {}
    for idx, s in sliced:
        grouped.setdefault(idx, []).append(s)
    result: list[PredictionOut] = []
    for idx, (p, _) in enumerate(base):
        if idx in grouped:
            result.append(_build_out(p, grouped[idx]))
    return result


@router.post(
    "/{task_id}/predictions/{prediction_id}/accept", response_model=list[AnnotationOut]
)
async def accept_prediction(
    task_id: uuid.UUID,
    prediction_id: uuid.UUID,
    shape_index: int | None = Query(
        None,
        ge=0,
        description="可选: 仅采纳指定下标的 shape (一个 prediction 可含多个 shape).",
    ),
    override_class_name: str | None = Query(
        None,
        description=(
            "可选: 采纳时把类别落到指定项目标签 (v0.14.17). 用于预测类名既不在项目标签集、"
            "又无 alias 命中时, 由人当场选项目类别再采纳, 避免 422 拒死。"
        ),
    ),
    attribute_overrides: dict | None = Body(
        None,
        embed=True,
        description=(
            "可选 (v0.18.3): 采纳前在工作台审阅候选属性时改过的值, 按属性键覆盖 shape 自带的 "
            "attributes 原子落库 (多阶段预标的 select/multiselect 属性审阅 + 分步采纳)。"
        ),
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    _assert_task_editable(await _load_task_or_404(db, task_id))
    svc = AnnotationService(db)
    anns = await svc.accept_prediction(
        prediction_id,
        current_user.id,
        shape_index=shape_index,
        override_class_name=override_class_name,
        attribute_overrides=attribute_overrides,
    )
    # v0.20.22 · 契约: None → 404 (prediction 不存在 / shape_index 越界); 成功 →
    # 仅返回本次新建的 annotation 列表。原实现另跑 list_by_task 返回整题全量,
    # 前端把全量当"刚新建"逐条 PATCH 合并 AI 候选属性 → 污染人工标注 (改动 1 根因)。
    if anns is None:
        raise HTTPException(
            status_code=404,
            detail="Prediction not found or shape_index out of range",
        )
    await TaskLockService(db).heartbeat(task_id, current_user.id)
    await db.commit()
    return anns


@router.post("/{task_id}/predictions/{prediction_id}/reject", status_code=204)
async def reject_prediction(
    task_id: uuid.UUID,
    prediction_id: uuid.UUID,
    shape_index: int | None = Query(
        None,
        ge=0,
        description="可选: 仅驳回指定下标的 shape; 不传则驳回该 Prediction 全部 shape.",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """B-37 · 驳回 AI 预测候选 shape, 持久化到 predictions.rejected_shape_indexes.

    后续 GET /tasks/{id}/predictions 会跳过这些下标, 刷新页面后 AI 待审框不会重现.
    驳回是软操作: prediction 行仍在库中, 仅在该数组追加被拒下标 (去重).
    """
    _assert_task_editable(await _load_task_or_404(db, task_id))
    # v0.10.25 · predictions 复合 PK (id, created_at) 后不能用 db.get(单值)，改按 id 查。
    pred = (
        await db.execute(select(Prediction).where(Prediction.id == prediction_id))
    ).scalar_one_or_none()
    if not pred or pred.task_id != task_id:
        raise HTTPException(status_code=404, detail="Prediction not found")
    total_shapes = len(pred.result or [])
    if shape_index is not None and shape_index >= total_shapes:
        raise HTTPException(
            status_code=400,
            detail=f"shape_index {shape_index} out of range (0..{total_shapes - 1})",
        )
    current = list(pred.rejected_shape_indexes or [])
    current_set = set(current)
    targets = [shape_index] if shape_index is not None else list(range(total_shapes))
    for idx in targets:
        if idx not in current_set:
            current.append(idx)
            current_set.add(idx)
    pred.rejected_shape_indexes = current
    await TaskLockService(db).heartbeat(task_id, current_user.id)
    await db.commit()
    return None
