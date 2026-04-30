import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user, require_roles, require_project_visible, require_project_owner
from app.db.enums import UserRole
from app.db.models.user import User
from app.db.models.project import Project
from app.schemas.batch import BatchCreate, BatchUpdate, BatchOut, BatchTransition, BatchSplitRequest
from app.services.batch import BatchService
from app.services.audit import AuditService, AuditAction

router = APIRouter()

_REVIEWERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN, UserRole.REVIEWER)


def _batch_to_out(batch) -> BatchOut:
    total = batch.total_tasks or 1
    pct = round((batch.completed_tasks / total) * 100, 1) if batch.total_tasks else 0.0
    out = BatchOut.model_validate(batch)
    out.progress_pct = pct
    return out


@router.get("")
async def list_batches(
    project_id: uuid.UUID,
    status: str | None = None,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
):
    svc = BatchService(db)
    batches = await svc.list_by_project(project_id, status)
    return [_batch_to_out(b) for b in batches]


@router.get("/{batch_id}")
async def get_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")
    return _batch_to_out(batch)


@router.post("", status_code=201)
async def create_batch(
    project_id: uuid.UUID,
    data: BatchCreate,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    batch = await svc.create(project_id, data, current_user.id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_CREATED,
        target_type="batch",
        target_id=str(batch.id),
        request=request,
        status_code=201,
        detail={"name": batch.name, "project_id": str(project_id)},
    )
    await db.commit()
    await db.refresh(batch)
    return _batch_to_out(batch)


@router.patch("/{batch_id}")
async def update_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    data: BatchUpdate,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")
    batch = await svc.update(batch_id, data)
    await db.commit()
    await db.refresh(batch)
    return _batch_to_out(batch)


@router.delete("/{batch_id}", status_code=204)
async def delete_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")
    affected = batch.total_tasks
    await svc.delete(batch_id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_DELETED,
        target_type="batch",
        target_id=str(batch_id),
        request=request,
        status_code=204,
        detail={"name": batch.name, "affected_tasks": affected},
    )
    await db.commit()


@router.post("/{batch_id}/transition")
async def transition_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    data: BatchTransition,
    request: Request,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")

    old_status = batch.status
    batch = await svc.transition(batch_id, data.target_status, current_user.id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_STATUS_CHANGED,
        target_type="batch",
        target_id=str(batch_id),
        request=request,
        status_code=200,
        detail={"before": old_status, "after": batch.status},
    )
    await db.commit()
    await db.refresh(batch)
    return _batch_to_out(batch)


@router.post("/split")
async def split_batches(
    project_id: uuid.UUID,
    data: BatchSplitRequest,
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    svc = BatchService(db)
    batches = await svc.split(project_id, data, current_user.id)
    for b in batches:
        await AuditService.log(
            db,
            actor=current_user,
            action=AuditAction.BATCH_CREATED,
            target_type="batch",
            target_id=str(b.id),
            request=request,
            status_code=200,
            detail={"name": b.name, "strategy": data.strategy, "total_tasks": b.total_tasks},
        )
    await db.commit()
    for b in batches:
        await db.refresh(b)
    return [_batch_to_out(b) for b in batches]


@router.post("/{batch_id}/reject")
async def reject_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    request: Request,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    svc = BatchService(db)
    batch = await svc.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")

    batch, affected = await svc.reject_batch(batch_id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.BATCH_REJECTED,
        target_type="batch",
        target_id=str(batch_id),
        request=request,
        status_code=200,
        detail={"affected_tasks": affected},
    )
    await db.commit()
    await db.refresh(batch)
    return _batch_to_out(batch)


@router.get("/{batch_id}/export")
async def export_batch(
    project_id: uuid.UUID,
    batch_id: uuid.UUID,
    format: str = Query("coco", pattern="^(coco|voc|yolo)$"),
    include_attributes: bool = Query(True),
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
):
    from app.services.export import ExportService

    svc_batch = BatchService(db)
    batch = await svc_batch.get(batch_id)
    if not batch or batch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Batch not found")

    svc = ExportService(db)
    fname = f"{project.display_id}_{batch.display_id}"

    if format == "coco":
        content = await svc.export_coco(project_id, batch_id=batch_id, include_attributes=include_attributes)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={fname}_coco.json"},
        )

    if format == "yolo":
        data = await svc.export_yolo(project_id, batch_id=batch_id, include_attributes=include_attributes)
        return Response(
            content=data,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={fname}_yolo.zip"},
        )

    data = await svc.export_voc(project_id, batch_id=batch_id, include_attributes=include_attributes)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={fname}_voc.zip"},
    )
