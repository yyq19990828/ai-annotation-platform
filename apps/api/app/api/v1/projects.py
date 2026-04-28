import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.deps import get_db, get_current_user, require_roles
from app.db.enums import UserRole
from app.db.models.user import User
from app.db.models.project import Project
from app.schemas.project import ProjectOut, ProjectCreate, ProjectStats

router = APIRouter()

_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    status: str | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Project)
    if status:
        q = q.where(Project.status == status)
    if search:
        q = q.where(Project.name.ilike(f"%{search}%"))
    result = await db.execute(q.order_by(Project.created_at.desc()))
    return result.scalars().all()


@router.get("/stats", response_model=ProjectStats)
async def get_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from sqlalchemy import func
    from app.db.models.annotation import Annotation

    result = await db.execute(select(Project))
    projects = result.scalars().all()
    total = sum(p.total_tasks for p in projects)
    completed = sum(p.completed_tasks for p in projects)
    review = sum(p.review_tasks for p in projects)

    total_ann_result = await db.execute(
        select(func.count()).select_from(Annotation).where(
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
        )
    )
    total_annotations = total_ann_result.scalar() or 0

    ai_ann_result = await db.execute(
        select(func.count()).select_from(Annotation).where(
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
            Annotation.parent_prediction_id.isnot(None),
        )
    )
    ai_derived_annotations = ai_ann_result.scalar() or 0

    ai_rate = round(ai_derived_annotations / total_annotations * 100, 1) if total_annotations else 0.0

    return ProjectStats(
        total_data=total,
        completed=completed,
        ai_rate=ai_rate,
        pending_review=review,
        total_annotations=total_annotations,
        ai_derived_annotations=ai_derived_annotations,
    )


@router.post("", response_model=ProjectOut)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    project = Project(
        id=uuid.uuid4(),
        display_id=f"P-{str(uuid.uuid4())[:4].upper()}",
        owner_id=current_user.id,
        **data.model_dump(),
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


@router.get("/{project_id}/export")
async def export_project(
    project_id: uuid.UUID,
    format: str = Query("coco", pattern="^(coco|voc|yolo)$"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from app.services.export import ExportService

    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    svc = ExportService(db)

    if format == "coco":
        content = await svc.export_coco(project_id)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={project.display_id}_coco.json"},
        )

    if format == "yolo":
        data = await svc.export_yolo(project_id)
        return Response(
            content=data,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={project.display_id}_yolo.zip"},
        )

    data = await svc.export_voc(project_id)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={project.display_id}_voc.zip"},
    )


class PreannotateRequest(BaseModel):
    ml_backend_id: uuid.UUID
    task_ids: list[uuid.UUID] | None = None


@router.post("/{project_id}/preannotate")
async def trigger_preannotation(
    project_id: uuid.UUID,
    body: PreannotateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_MANAGERS)),
):
    from app.services.ml_backend import MLBackendService

    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    svc = MLBackendService(db)
    backend = await svc.get(body.ml_backend_id)
    if not backend:
        raise HTTPException(status_code=404, detail="ML Backend not found")

    from app.workers.tasks import batch_predict
    job = batch_predict.delay(
        str(project_id),
        str(body.ml_backend_id),
        [str(tid) for tid in body.task_ids] if body.task_ids else None,
    )
    return {"job_id": job.id, "status": "queued"}
