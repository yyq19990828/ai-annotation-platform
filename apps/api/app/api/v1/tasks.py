import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user, require_roles
from app.db.enums import UserRole
from app.db.models.user import User
from app.db.models.task import Task
from app.schemas.task import TaskOut, TaskLockResponse
from app.schemas.annotation import AnnotationCreate, AnnotationOut
from app.schemas.prediction import PredictionOut
from app.services.annotation import AnnotationService
from app.services.prediction import PredictionService
from app.services.task_lock import TaskLockService
from app.services.scheduler import get_next_task
from app.services.storage import storage_service

router = APIRouter()

_ANNOTATORS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER, UserRole.ANNOTATOR)
_REVIEWERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER)


@router.get("/next", response_model=TaskOut | None)
async def next_task(
    project_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await get_next_task(current_user.id, project_id, db)
    if not task:
        return None
    await db.commit()
    return _task_with_url(task)


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_with_url(task)


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
    svc = AnnotationService(db)
    annotation = await svc.create(
        task_id=task_id,
        user_id=current_user.id,
        annotation_type=data.annotation_type,
        class_name=data.class_name,
        geometry=data.geometry,
        confidence=data.confidence,
        parent_prediction_id=data.parent_prediction_id,
        lead_time=data.lead_time,
    )
    await db.commit()
    await db.refresh(annotation)
    return annotation


@router.get("/{task_id}/predictions", response_model=list[PredictionOut])
async def get_predictions(
    task_id: uuid.UUID,
    model_version: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = PredictionService(db)
    return await svc.list_by_task(task_id, model_version=model_version)


@router.post("/{task_id}/predictions/{prediction_id}/accept", response_model=list[AnnotationOut])
async def accept_prediction(
    task_id: uuid.UUID,
    prediction_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    svc = AnnotationService(db)
    await svc.accept_prediction(prediction_id, current_user.id)
    await db.commit()
    return await svc.list_by_task(task_id)


@router.post("/{task_id}/submit")
async def submit_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = "review"
    lock_svc = TaskLockService(db)
    await lock_svc.release(task_id, current_user.id)
    await db.commit()
    return {"status": "submitted", "task_id": str(task_id)}


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

def _task_with_url(task: Task) -> dict:
    try:
        file_url = storage_service.generate_download_url(task.file_path)
    except Exception:
        file_url = None

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
        "sequence_order": task.sequence_order,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }
