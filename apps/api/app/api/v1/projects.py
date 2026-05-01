import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from app.deps import (
    get_db,
    get_current_user,
    require_roles,
    require_project_visible,
    require_project_owner,
)
from app.db.enums import UserRole
from app.db.models.user import User
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.schemas.project import (
    ProjectOut,
    ProjectCreate,
    ProjectUpdate,
    ProjectStats,
    ProjectMemberOut,
    ProjectMemberCreate,
    ProjectTransferRequest,
)
from app.services.display_id import next_display_id

router = APIRouter()

_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)


def _visible_project_filter(user: User):
    """构造按当前用户可见性过滤项目的子查询条件 (Project 主查询)。"""
    if user.role == UserRole.SUPER_ADMIN:
        return None  # 不过滤
    if user.role == UserRole.PROJECT_ADMIN:
        return Project.owner_id == user.id
    # annotator / reviewer / viewer：通过 ProjectMember 关联
    return Project.id.in_(
        select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
    )


async def _serialize_project(db: AsyncSession, project: Project) -> dict:
    """补齐 owner_name + member_count，转 dict 以喂给 ProjectOut。"""
    owner_name = None
    if project.owner_id:
        owner_row = await db.execute(
            select(User.name).where(User.id == project.owner_id)
        )
        owner_name = owner_row.scalar_one_or_none()
    count_row = await db.execute(
        select(func.count()).select_from(ProjectMember).where(
            ProjectMember.project_id == project.id
        )
    )
    member_count = count_row.scalar() or 0
    data = {
        c.name: getattr(project, c.name) for c in project.__table__.columns
    }
    data["owner_name"] = owner_name
    data["member_count"] = member_count
    return data


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    status: str | None = None,
    search: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = select(Project)
    cond = _visible_project_filter(user)
    if cond is not None:
        q = q.where(cond)
    if status:
        q = q.where(Project.status == status)
    if search:
        q = q.where(Project.name.ilike(f"%{search}%"))
    result = await db.execute(q.order_by(Project.created_at.desc()))
    projects = result.scalars().all()
    return [await _serialize_project(db, p) for p in projects]


@router.get("/stats", response_model=ProjectStats)
async def get_stats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.db.models.annotation import Annotation

    q = select(Project)
    cond = _visible_project_filter(user)
    if cond is not None:
        q = q.where(cond)
    result = await db.execute(q)
    projects = result.scalars().all()
    total = sum(p.total_tasks for p in projects)
    completed = sum(p.completed_tasks for p in projects)
    review = sum(p.review_tasks for p in projects)

    visible_ids = [p.id for p in projects]

    if not visible_ids:
        return ProjectStats(
            total_data=0, completed=0, ai_rate=0.0, pending_review=0,
            total_annotations=0, ai_derived_annotations=0,
        )

    total_ann_result = await db.execute(
        select(func.count()).select_from(Annotation).where(
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
            Annotation.project_id.in_(visible_ids),
        )
    )
    total_annotations = total_ann_result.scalar() or 0

    ai_ann_result = await db.execute(
        select(func.count()).select_from(Annotation).where(
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
            Annotation.parent_prediction_id.isnot(None),
            Annotation.project_id.in_(visible_ids),
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
        display_id=await next_display_id(db, "projects"),
        owner_id=current_user.id,
        **data.model_dump(),
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return await _serialize_project(db, project)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
):
    return await _serialize_project(db, project)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    data: ProjectUpdate,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(project, k, v)
    await db.commit()
    await db.refresh(project)
    return await _serialize_project(db, project)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    pid = str(project.id)
    p = {"pid": pid}

    await db.execute(text(
        "DELETE FROM annotation_comments WHERE project_id = :pid"
    ), p)
    await db.execute(text(
        "DELETE FROM annotation_drafts WHERE task_id IN "
        "(SELECT id FROM tasks WHERE project_id = :pid)"
    ), p)
    await db.execute(text(
        "DELETE FROM prediction_metas WHERE prediction_id IN "
        "(SELECT id FROM predictions WHERE project_id = :pid) "
        "OR failed_prediction_id IN "
        "(SELECT id FROM failed_predictions WHERE project_id = :pid)"
    ), p)
    await db.execute(text(
        "UPDATE annotations SET parent_prediction_id = NULL, "
        "parent_annotation_id = NULL WHERE project_id = :pid"
    ), p)
    await db.execute(text(
        "DELETE FROM annotations WHERE project_id = :pid"
    ), p)
    await db.execute(text(
        "DELETE FROM predictions WHERE project_id = :pid"
    ), p)
    await db.execute(text(
        "DELETE FROM failed_predictions WHERE project_id = :pid"
    ), p)
    await db.execute(text(
        "DELETE FROM task_locks WHERE task_id IN "
        "(SELECT id FROM tasks WHERE project_id = :pid)"
    ), p)
    await db.execute(text(
        "DELETE FROM ml_backends WHERE project_id = :pid"
    ), p)
    await db.execute(text(
        "UPDATE bug_reports SET project_id = NULL, task_id = NULL "
        "WHERE project_id = :pid"
    ), p)
    await db.execute(text(
        "DELETE FROM tasks WHERE project_id = :pid"
    ), p)

    await db.delete(project)
    await db.commit()
    return Response(status_code=204)


@router.post("/{project_id}/transfer", response_model=ProjectOut)
async def transfer_owner(
    body: ProjectTransferRequest,
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")

    target = await db.get(User, body.new_owner_id)
    if target is None or not target.is_active:
        raise HTTPException(status_code=404, detail="目标用户不存在")
    if target.role != UserRole.PROJECT_ADMIN:
        raise HTTPException(status_code=400, detail="仅可转移给 project_admin")

    project.owner_id = target.id
    await db.commit()
    await db.refresh(project)
    return await _serialize_project(db, project)


@router.get("/{project_id}/members", response_model=list[ProjectMemberOut])
async def list_members(
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        select(ProjectMember, User.name, User.email)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project.id)
        .order_by(ProjectMember.assigned_at.desc())
    )
    out = []
    for member, user_name, user_email in rows.all():
        out.append(
            ProjectMemberOut(
                id=member.id,
                user_id=member.user_id,
                user_name=user_name,
                user_email=user_email,
                role=member.role,
                assigned_at=member.assigned_at,
            )
        )
    return out


@router.post("/{project_id}/members", response_model=ProjectMemberOut, status_code=201)
async def add_member(
    body: ProjectMemberCreate,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target = await db.get(User, body.user_id)
    if target is None or not target.is_active:
        raise HTTPException(status_code=404, detail="目标用户不存在")
    if body.role == "annotator" and target.role != UserRole.ANNOTATOR:
        raise HTTPException(status_code=400, detail="目标用户角色不是标注员")
    if body.role == "reviewer" and target.role != UserRole.REVIEWER:
        raise HTTPException(status_code=400, detail="目标用户角色不是审核员")

    existing = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == body.user_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="该用户已在项目中")

    member = ProjectMember(
        id=uuid.uuid4(),
        project_id=project.id,
        user_id=body.user_id,
        role=body.role,
        assigned_by=current_user.id,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return ProjectMemberOut(
        id=member.id,
        user_id=member.user_id,
        user_name=target.name,
        user_email=target.email,
        role=member.role,
        assigned_at=member.assigned_at,
    )


@router.delete("/{project_id}/members/{member_id}", status_code=204)
async def remove_member(
    member_id: uuid.UUID,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    member = await db.get(ProjectMember, member_id)
    if member is None or member.project_id != project.id:
        raise HTTPException(status_code=404, detail="成员不存在")
    await db.delete(member)
    await db.commit()
    return Response(status_code=204)


@router.get("/{project_id}/export")
async def export_project(
    format: str = Query("coco", pattern="^(coco|voc|yolo)$"),
    include_attributes: bool = Query(True, description="是否在导出包中携带 annotation.attributes 与 project.attribute_schema"),
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
):
    from app.services.export import ExportService

    svc = ExportService(db)

    if format == "coco":
        content = await svc.export_coco(project.id, include_attributes=include_attributes)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename={project.display_id}_coco.json"},
        )

    if format == "yolo":
        data = await svc.export_yolo(project.id, include_attributes=include_attributes)
        return Response(
            content=data,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={project.display_id}_yolo.zip"},
        )

    data = await svc.export_voc(project.id, include_attributes=include_attributes)
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
    body: PreannotateRequest,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ml_backend import MLBackendService

    svc = MLBackendService(db)
    backend = await svc.get(body.ml_backend_id)
    if not backend:
        raise HTTPException(status_code=404, detail="ML Backend not found")

    from app.workers.tasks import batch_predict
    job = batch_predict.delay(
        str(project.id),
        str(body.ml_backend_id),
        [str(tid) for tid in body.task_ids] if body.task_ids else None,
    )
    return {"job_id": job.id, "status": "queued"}
