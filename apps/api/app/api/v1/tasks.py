import base64
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user, require_roles, assert_project_visible
from app.db.enums import UserRole
from app.db.models.user import User
from app.db.models.task import Task
from app.db.models.annotation import Annotation
from app.schemas.task import TaskOut, TaskListResponse, TaskLockResponse, ReviewClaimResponse
from app.schemas.annotation import AnnotationCreate, AnnotationOut, AnnotationUpdate
from app.schemas.prediction import PredictionOut
from app.services.annotation import AnnotationService
from app.services.audit import AuditAction, AuditService
from app.services.prediction import PredictionService
from app.services.task_lock import TaskLockService
from app.services.scheduler import get_next_task
from app.services.storage import storage_service

router = APIRouter()

_ANNOTATORS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER, UserRole.ANNOTATOR)
_REVIEWERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER)
_LOCKED_STATUSES = {"review", "completed"}


def _assert_task_editable(task: Task) -> None:
    """v0.6.5: 已提交质检 / 已通过审核的任务对所有 annotation 写动作锁死。
    标注员要继续编辑必须先 withdraw（review 态）或 reopen（completed 态）。"""
    if task.status in _LOCKED_STATUSES:
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_locked", "status": task.status},
        )


async def _load_task_or_404(db: AsyncSession, task_id: uuid.UUID) -> Task:
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _encode_task_cursor(created_at, task_id: uuid.UUID) -> str:
    ts = created_at.astimezone(timezone.utc).isoformat() if created_at.tzinfo else created_at.isoformat()
    return base64.urlsafe_b64encode(f"{ts}|{task_id.hex}".encode()).decode()


def _decode_task_cursor(cursor: str):
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    ts_str, id_hex = raw.split("|", 1)
    from datetime import datetime
    ts = datetime.fromisoformat(ts_str)
    return ts, uuid.UUID(id_hex)


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    project_id: uuid.UUID = Query(...),
    status: str | None = None,
    assignee_id: uuid.UUID | None = None,
    batch_id: uuid.UUID | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    cursor: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await assert_project_visible(project_id, db, user)
    q = select(Task).where(Task.project_id == project_id)
    count_q = select(func.count()).select_from(Task).where(Task.project_id == project_id)
    if status:
        q = q.where(Task.status == status)
        count_q = count_q.where(Task.status == status)
    if assignee_id:
        q = q.where(Task.assignee_id == assignee_id)
        count_q = count_q.where(Task.assignee_id == assignee_id)
    if batch_id:
        q = q.where(Task.batch_id == batch_id)
        count_q = count_q.where(Task.batch_id == batch_id)

    if cursor:
        last_ts, last_id = _decode_task_cursor(cursor)
        q = q.where(
            or_(
                Task.created_at > last_ts,
                and_(Task.created_at == last_ts, Task.id > last_id),
            )
        ).order_by(Task.created_at, Task.id).limit(limit)
        tasks = list((await db.execute(q)).scalars().all())
        total = (await db.execute(count_q)).scalar() or 0
        dims = await _attach_dimensions_batch(db, tasks)
        next_cursor = (
            _encode_task_cursor(tasks[-1].created_at, tasks[-1].id)
            if len(tasks) == limit
            else None
        )
        return TaskListResponse(
            items=[_task_with_url(t, *dims.get(t.id, (None, None, None, None))) for t in tasks],
            total=total, limit=limit, offset=0, next_cursor=next_cursor,
        )

    total = (await db.execute(count_q)).scalar() or 0
    result = await db.execute(q.order_by(Task.sequence_order, Task.created_at).limit(limit).offset(offset))
    tasks = list(result.scalars().all())
    dims = await _attach_dimensions_batch(db, tasks)
    return TaskListResponse(
        items=[_task_with_url(t, *dims.get(t.id, (None, None, None, None))) for t in tasks],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/next", response_model=TaskOut | None)
async def next_task(
    project_id: uuid.UUID = Query(...),
    batch_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    await assert_project_visible(project_id, db, current_user)
    task = await get_next_task(current_user, project_id, db, batch_id=batch_id)
    if not task:
        return None
    await db.commit()
    w, h, thumb, bh = await _attach_dimensions(db, task)
    return _task_with_url(task, w, h, thumb, bh)


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    w, h, thumb, bh = await _attach_dimensions(db, task)
    return _task_with_url(task, w, h, thumb, bh)


@router.get("/{task_id}/annotations", response_model=list[AnnotationOut])
async def get_annotations(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = AnnotationService(db)
    return await svc.list_by_task(task_id)


@router.post("/{task_id}/annotations", response_model=AnnotationOut, status_code=201)
async def create_annotation(
    task_id: uuid.UUID,
    data: AnnotationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    _assert_task_editable(await _load_task_or_404(db, task_id))
    svc = AnnotationService(db)
    annotation = await svc.create(
        task_id=task_id,
        user_id=current_user.id,
        annotation_type=data.annotation_type,
        class_name=data.class_name,
        geometry=data.geometry.model_dump(),
        confidence=data.confidence,
        parent_prediction_id=data.parent_prediction_id,
        lead_time=data.lead_time,
        attributes=data.attributes,
    )
    await TaskLockService(db).heartbeat(task_id, current_user.id)
    await db.commit()
    await db.refresh(annotation)
    return annotation


@router.patch("/{task_id}/annotations/{annotation_id}", response_model=AnnotationOut)
async def update_annotation(
    task_id: uuid.UUID,
    annotation_id: uuid.UUID,
    data: AnnotationUpdate,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    _assert_task_editable(await _load_task_or_404(db, task_id))
    svc = AnnotationService(db)
    fields = data.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    # 早 load 一次：用于 If-Match 校验 + 字段级审计 diff（attributes 变更）
    existing = await db.get(Annotation, annotation_id)
    if existing is None or not existing.is_active:
        raise HTTPException(status_code=404, detail="Annotation not found")

    before_attributes: dict | None = None
    if "attributes" in fields:
        before_attributes = dict(existing.attributes or {})

    # 乐观并发控制：If-Match 头校验
    if_match = request.headers.get("If-Match", "").strip()
    if if_match:
        expected_version = if_match.removeprefix('W/"').removesuffix('"')
        try:
            expected_v = int(expected_version)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid If-Match format")
        if existing.version != expected_v:
            raise HTTPException(
                status_code=409,
                detail={"reason": "version_mismatch", "current_version": existing.version},
            )

    annotation = await svc.update(annotation_id, **fields)
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if annotation.task_id != task_id:
        raise HTTPException(status_code=400, detail="Annotation does not belong to this task")
    await TaskLockService(db).heartbeat(task_id, current_user.id)
    await AuditService.log(
        db,
        actor=current_user,
        action="annotation.update",
        target_type="annotation",
        target_id=str(annotation.id),
        request=request,
        status_code=200,
        detail={"task_id": str(task_id), "fields": list(fields.keys())},
    )
    # 字段级审计：每个变更的 attribute key 单独记一行，便于 GIN 索引按 field_key 过滤
    # v0.6.3 Q-2：N 个属性变更 → 一次 add_all + 一次 flush（原本 N 次 flush）
    if before_attributes is not None:
        after_attributes = dict(annotation.attributes or {})
        all_keys = set(before_attributes.keys()) | set(after_attributes.keys())
        change_items: list[dict] = []
        for key in sorted(all_keys):
            before_v = before_attributes.get(key)
            after_v = after_attributes.get(key)
            if before_v == after_v:
                continue
            change_items.append({
                "target_id": str(annotation.id),
                "detail": {
                    "task_id": str(task_id),
                    "field_key": key,
                    "before": before_v,
                    "after": after_v,
                },
            })
        if change_items:
            await AuditService.log_many(
                db,
                actor=current_user,
                action=AuditAction.ANNOTATION_ATTRIBUTE_CHANGE,
                target_type="annotation",
                request=request,
                status_code=200,
                items=change_items,
            )
    await db.commit()
    await db.refresh(annotation)
    response.headers["ETag"] = f'W/"{annotation.version}"'
    return annotation


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
    svc = PredictionService(db)
    predictions = await svc.list_by_task(task_id, model_version=model_version)

    # 第一步：min_confidence 过滤
    base: list[tuple[PredictionOut, list[dict]]] = []
    for p in predictions:
        shapes = list(p.result or [])
        if min_confidence is not None:
            shapes = [s for s in shapes if s.get("confidence", 0.0) >= min_confidence]
        if shapes:
            out = PredictionOut.model_validate(p)
            base.append((out, shapes))

    if limit is None and offset == 0:
        for out, shapes in base:
            out.result = shapes
        return [out for out, _ in base]

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
    for idx, (out, _) in enumerate(base):
        if idx in grouped:
            out.result = grouped[idx]
            result.append(out)
    return result


@router.post("/{task_id}/predictions/{prediction_id}/accept", response_model=list[AnnotationOut])
async def accept_prediction(
    task_id: uuid.UUID,
    prediction_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    _assert_task_editable(await _load_task_or_404(db, task_id))
    svc = AnnotationService(db)
    await svc.accept_prediction(prediction_id, current_user.id)
    await TaskLockService(db).heartbeat(task_id, current_user.id)
    await db.commit()
    return await svc.list_by_task(task_id)


@router.delete("/{task_id}/annotations/{annotation_id}", status_code=204)
async def delete_annotation(
    task_id: uuid.UUID,
    annotation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    _assert_task_editable(await _load_task_or_404(db, task_id))
    svc = AnnotationService(db)
    ok = await svc.delete(annotation_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Annotation not found")
    await TaskLockService(db).heartbeat(task_id, current_user.id)
    await db.commit()


@router.post("/{task_id}/submit")
async def submit_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await _load_task_or_404(db, task_id)
    if task.status not in ("pending", "in_progress"):
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_submittable", "status": task.status},
        )

    # v0.6.6: 提交者即 assignee。任务初始 assignee_id 为 NULL（创建时未指派），
    # 否则后续 withdraw/reopen 会因 assignee 校验失败而拒绝（"only assignee can withdraw"）。
    if task.assignee_id is None:
        task.assignee_id = current_user.id

    task.status = "review"
    task.submitted_at = datetime.now(timezone.utc)
    # 清空上一轮 review 痕迹（reopen → 再次 submit 场景）
    task.reviewer_id = None
    task.reviewer_claimed_at = None
    task.reviewed_at = None
    task.reject_reason = None

    lock_svc = TaskLockService(db)
    await lock_svc.release(task_id, current_user.id)

    from app.services.batch import BatchService
    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_SUBMIT,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "assignee_id": str(task.assignee_id) if task.assignee_id else None,
        },
    )

    await db.commit()
    return {"status": "submitted", "task_id": str(task_id)}


@router.post("/{task_id}/withdraw")
async def withdraw_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.6.5: 标注员撤回质检提交。
    前提：status=review、assignee == 当前用户、reviewer_claimed_at IS NULL。
    审核员一旦 claim 就锁死撤回入口，避免与审核动作打架。"""
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_in_review", "status": task.status},
        )
    if task.assignee_id != current_user.id and current_user.role not in (
        UserRole.SUPER_ADMIN.value, UserRole.PROJECT_ADMIN.value,
    ):
        raise HTTPException(status_code=403, detail="only assignee can withdraw")
    if task.reviewer_claimed_at is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "reason": "task_already_claimed",
                "reviewer_id": str(task.reviewer_id) if task.reviewer_id else None,
            },
        )

    task.status = "in_progress"
    task.submitted_at = None

    from app.db.models.project import Project
    project = await db.get(Project, task.project_id)
    if project:
        project.review_tasks = max((project.review_tasks or 0) - 1, 0)

    from app.services.batch import BatchService
    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_WITHDRAW,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={"project_id": str(task.project_id)},
    )

    await db.commit()
    return {"status": "withdrawn", "task_id": str(task_id)}


# ── Review endpoints ───────────────────���────────────────────────────────────

class ReviewAction(BaseModel):
    reason: str | None = None


@router.post("/{task_id}/review/claim", response_model=ReviewClaimResponse)
async def claim_review(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    """v0.6.5: 审核员进入审核页时调用（幂等）。
    第一个调用者写 reviewer_id + reviewer_claimed_at；
    后续调用者读取已存在的认领信息（不覆盖）。
    `reviewer_claimed_at` 一经设置即冻结标注员的 withdraw 入口。"""
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_in_review", "status": task.status},
        )

    if task.reviewer_claimed_at is None:
        task.reviewer_id = current_user.id
        task.reviewer_claimed_at = datetime.now(timezone.utc)
        await AuditService.log(
            db,
            actor=current_user,
            action=AuditAction.TASK_REVIEW_CLAIM,
            target_type="task",
            target_id=str(task_id),
            request=request,
            status_code=200,
            detail={"project_id": str(task.project_id)},
        )
        await db.commit()

    return ReviewClaimResponse(
        task_id=task.id,
        reviewer_id=task.reviewer_id,
        reviewer_claimed_at=task.reviewer_claimed_at,
        is_self=(task.reviewer_id == current_user.id),
    )


@router.post("/{task_id}/review/approve")
async def approve_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(status_code=400, detail="Task is not in review status")

    task.status = "completed"
    now = datetime.now(timezone.utc)
    task.reviewed_at = now
    if task.reviewer_id is None:
        task.reviewer_id = current_user.id
    if task.reviewer_claimed_at is None:
        task.reviewer_claimed_at = now

    from app.db.models.project import Project
    project = await db.get(Project, task.project_id)
    if project:
        project.completed_tasks = (project.completed_tasks or 0) + 1
        project.review_tasks = max((project.review_tasks or 0) - 1, 0)

    from app.services.batch import BatchService
    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_APPROVE,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "assignee_id": str(task.assignee_id) if task.assignee_id else None,
        },
    )

    await db.commit()
    return {"status": "approved", "task_id": str(task_id)}


@router.post("/{task_id}/review/reject")
async def reject_task(
    task_id: uuid.UUID,
    request: Request,
    body: ReviewAction | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    task = await _load_task_or_404(db, task_id)
    if task.status != "review":
        raise HTTPException(status_code=400, detail="Task is not in review status")

    reason = (body.reason if body else None) or None
    if not reason or not reason.strip():
        raise HTTPException(status_code=400, detail="reject reason is required")

    task.status = "in_progress"
    now = datetime.now(timezone.utc)
    task.reviewed_at = now
    task.reject_reason = reason.strip()
    if task.reviewer_id is None:
        task.reviewer_id = current_user.id
    if task.reviewer_claimed_at is None:
        task.reviewer_claimed_at = now

    from app.db.models.project import Project
    project = await db.get(Project, task.project_id)
    if project:
        project.review_tasks = max((project.review_tasks or 0) - 1, 0)

    from app.services.batch import BatchService
    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_REJECT,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "assignee_id": str(task.assignee_id) if task.assignee_id else None,
            "reason": task.reject_reason,
        },
    )

    await db.commit()
    return {"status": "rejected", "task_id": str(task_id), "reason": task.reject_reason}


@router.post("/{task_id}/reopen")
async def reopen_task(
    task_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    """v0.6.5: 标注员对已通过任务单方面重开编辑。
    前提：status=completed 且 assignee == 当前用户（admin 兜底）。
    清空 reviewer_* 但 detail 留 original_reviewer_id 用于通知；
    annotations 原地保留可继续改，依赖 audit_logs 回溯历史。"""
    task = await _load_task_or_404(db, task_id)
    if task.status != "completed":
        raise HTTPException(
            status_code=409,
            detail={"reason": "task_not_completed", "status": task.status},
        )
    if task.assignee_id != current_user.id and current_user.role not in (
        UserRole.SUPER_ADMIN.value, UserRole.PROJECT_ADMIN.value,
    ):
        raise HTTPException(status_code=403, detail="only assignee can reopen")

    original_reviewer_id = task.reviewer_id
    task.status = "in_progress"
    task.reopened_count = (task.reopened_count or 0) + 1
    task.last_reopened_at = datetime.now(timezone.utc)
    task.reviewer_id = None
    task.reviewer_claimed_at = None
    task.reviewed_at = None
    task.reject_reason = None
    task.submitted_at = None

    from app.db.models.project import Project
    project = await db.get(Project, task.project_id)
    if project:
        project.completed_tasks = max((project.completed_tasks or 0) - 1, 0)

    from app.services.batch import BatchService
    batch_svc = BatchService(db)
    await batch_svc.check_auto_transitions(task.batch_id)
    if task.batch_id:
        await batch_svc.recalculate_counters(task.batch_id)

    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.TASK_REOPEN,
        target_type="task",
        target_id=str(task_id),
        request=request,
        status_code=200,
        detail={
            "project_id": str(task.project_id),
            "original_reviewer_id": str(original_reviewer_id) if original_reviewer_id else None,
            "reopened_count": task.reopened_count,
        },
    )

    await db.commit()
    return {"status": "reopened", "task_id": str(task_id), "reopened_count": task.reopened_count}


# ── Task Lock endpoints ─────────────────────────────────────────────────────

@router.post("/{task_id}/lock", response_model=TaskLockResponse)
async def acquire_lock(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    svc = TaskLockService(db)
    lock = await svc.acquire(task_id, current_user.id)
    if not lock:
        raise HTTPException(status_code=409, detail="Task is locked by another user")
    await db.commit()
    return lock


@router.post("/{task_id}/lock/heartbeat")
async def heartbeat_lock(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    svc = TaskLockService(db)
    ok = await svc.heartbeat(task_id, current_user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="No active lock found")
    await db.commit()
    return {"status": "renewed"}


@router.delete("/{task_id}/lock", status_code=204)
async def release_lock(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    svc = TaskLockService(db)
    await svc.release(task_id, current_user.id)
    await db.commit()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _task_with_url(
    task: Task,
    width: int | None = None,
    height: int | None = None,
    thumbnail_path: str | None = None,
    blurhash: str | None = None,
) -> dict:
    bucket = storage_service.datasets_bucket if task.dataset_item_id else storage_service.bucket
    try:
        file_url = storage_service.generate_download_url(task.file_path, bucket=bucket)
    except Exception:
        file_url = None

    thumbnail_url: str | None = None
    if thumbnail_path:
        try:
            thumb_bucket = (
                storage_service.datasets_bucket if task.dataset_item_id
                else storage_service.bucket
            )
            thumbnail_url = storage_service.generate_download_url(
                thumbnail_path, bucket=thumb_bucket
            )
        except Exception:
            pass

    return {
        "id": task.id,
        "project_id": task.project_id,
        "display_id": task.display_id,
        "file_name": task.file_name,
        "file_url": file_url,
        "file_type": task.file_type,
        "tags": task.tags,
        "status": task.status,
        "assignee_id": task.assignee_id,
        "is_labeled": task.is_labeled,
        "overlap": task.overlap,
        "total_annotations": task.total_annotations,
        "total_predictions": task.total_predictions,
        "batch_id": task.batch_id,
        "sequence_order": task.sequence_order,
        "image_width": width,
        "image_height": height,
        "thumbnail_url": thumbnail_url,
        "blurhash": blurhash,
        "submitted_at": task.submitted_at,
        "reviewer_id": task.reviewer_id,
        "reviewer_claimed_at": task.reviewer_claimed_at,
        "reviewed_at": task.reviewed_at,
        "reject_reason": task.reject_reason,
        "reopened_count": task.reopened_count,
        "last_reopened_at": task.last_reopened_at,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


async def _attach_dimensions(
    db: AsyncSession, task: Task,
) -> tuple[int | None, int | None, str | None, str | None]:
    if task.dataset_item_id:
        from app.db.models.dataset import DatasetItem
        item = await db.get(DatasetItem, task.dataset_item_id)
        if item:
            return item.width, item.height, item.thumbnail_path, item.blurhash
    return None, None, task.thumbnail_path, task.blurhash


async def _attach_dimensions_batch(
    db: AsyncSession, tasks: list[Task],
) -> dict[uuid.UUID, tuple[int | None, int | None, str | None, str | None]]:
    result: dict[uuid.UUID, tuple[int | None, int | None, str | None, str | None]] = {}

    item_ids = [t.dataset_item_id for t in tasks if t.dataset_item_id]
    if item_ids:
        from app.db.models.dataset import DatasetItem
        rows = await db.execute(
            select(DatasetItem.id, DatasetItem.width, DatasetItem.height, DatasetItem.thumbnail_path, DatasetItem.blurhash)
            .where(DatasetItem.id.in_(item_ids))
        )
        item_data = {row[0]: (row[1], row[2], row[3], row[4]) for row in rows}
        for t in tasks:
            if t.dataset_item_id:
                result[t.id] = item_data.get(t.dataset_item_id, (None, None, None, None))

    for t in tasks:
        if t.id not in result:
            result[t.id] = (None, None, t.thumbnail_path, t.blurhash)

    return result
