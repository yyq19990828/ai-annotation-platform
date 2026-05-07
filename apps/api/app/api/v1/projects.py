import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Request
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


async def _serialize_project(
    db: AsyncSession,
    project: Project,
    *,
    ai_completed_lookup: dict[uuid.UUID, int] | None = None,
    batch_summary_lookup: dict[uuid.UUID, dict] | None = None,
) -> dict:
    """补齐 owner_name + member_count + ai_completed_tasks，转 dict 以喂给 ProjectOut。

    v0.7.0：in_progress_tasks 已是持久化列（alembic 0028）；ai_completed_tasks 由调用方
    通过 ai_completed_lookup 批量提供（list_projects 路径）或 fallback 单独查询。
    """
    owner_name = None
    if project.owner_id:
        owner_row = await db.execute(
            select(User.name).where(User.id == project.owner_id)
        )
        owner_name = owner_row.scalar_one_or_none()
    count_row = await db.execute(
        select(func.count())
        .select_from(ProjectMember)
        .where(ProjectMember.project_id == project.id)
    )
    member_count = count_row.scalar() or 0

    if ai_completed_lookup is not None:
        ai_completed = int(ai_completed_lookup.get(project.id, 0))
    else:
        from app.db.models.annotation import Annotation

        ai_row = await db.execute(
            select(func.count(func.distinct(Annotation.task_id))).where(
                Annotation.project_id == project.id,
                Annotation.parent_prediction_id.is_not(None),
                Annotation.is_active.is_(True),
            )
        )
        ai_completed = int(ai_row.scalar() or 0)

    if batch_summary_lookup is not None:
        batch_summary = batch_summary_lookup.get(
            project.id, {"total": 0, "assigned": 0, "in_review": 0}
        )
    else:
        from app.db.models.task_batch import TaskBatch

        bs_row = (
            await db.execute(
                select(
                    func.count().label("total"),
                    func.count()
                    .filter(TaskBatch.annotator_id.is_not(None))
                    .label("assigned"),
                    func.count()
                    .filter(TaskBatch.status == "reviewing")
                    .label("in_review"),
                ).where(TaskBatch.project_id == project.id)
            )
        ).one()
        batch_summary = {
            "total": int(bs_row.total),
            "assigned": int(bs_row.assigned),
            "in_review": int(bs_row.in_review),
        }

    data = {c.name: getattr(project, c.name) for c in project.__table__.columns}
    data["owner_name"] = owner_name
    data["member_count"] = member_count
    data["ai_completed_tasks"] = ai_completed
    data["batch_summary"] = batch_summary
    return data


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    status: str | None = None,
    search: str | None = None,
    # v0.7.2 · 高级筛选维度（FilterDrawer 对接）
    type_key: list[str] | None = Query(None),
    member_id: uuid.UUID | None = None,
    created_from: str | None = None,  # ISO date "2026-01-01"
    created_to: str | None = None,
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
    if type_key:
        q = q.where(Project.type_key.in_(type_key))
    if member_id is not None:
        q = q.where(
            Project.id.in_(
                select(ProjectMember.project_id).where(
                    ProjectMember.user_id == member_id
                )
            )
        )
    if created_from:
        q = q.where(Project.created_at >= created_from)
    if created_to:
        q = q.where(Project.created_at <= created_to)
    result = await db.execute(q.order_by(Project.created_at.desc()))
    projects = result.scalars().all()

    # v0.7.0：批量预查 ai_completed_tasks 避免 N+1 — 单 GROUP BY 查询
    from app.db.models.annotation import Annotation
    from app.db.models.task_batch import TaskBatch

    project_ids = [p.id for p in projects]
    ai_lookup: dict[uuid.UUID, int] = {}
    bs_lookup: dict[uuid.UUID, dict] = {}
    if project_ids:
        ai_rows = (
            await db.execute(
                select(
                    Annotation.project_id,
                    func.count(func.distinct(Annotation.task_id)).label("cnt"),
                )
                .where(
                    Annotation.project_id.in_(project_ids),
                    Annotation.parent_prediction_id.is_not(None),
                    Annotation.is_active.is_(True),
                )
                .group_by(Annotation.project_id)
            )
        ).all()
        ai_lookup = {row[0]: int(row[1]) for row in ai_rows}

        # batch_summary：每项目一行，{total, assigned, in_review}
        bs_rows = (
            await db.execute(
                select(
                    TaskBatch.project_id,
                    func.count().label("total"),
                    func.count()
                    .filter(TaskBatch.annotator_id.is_not(None))
                    .label("assigned"),
                    func.count()
                    .filter(TaskBatch.status == "reviewing")
                    .label("in_review"),
                )
                .where(TaskBatch.project_id.in_(project_ids))
                .group_by(TaskBatch.project_id)
            )
        ).all()
        bs_lookup = {
            row[0]: {
                "total": int(row[1]),
                "assigned": int(row[2]),
                "in_review": int(row[3]),
            }
            for row in bs_rows
        }

    return [
        await _serialize_project(
            db,
            p,
            ai_completed_lookup=ai_lookup,
            batch_summary_lookup=bs_lookup,
        )
        for p in projects
    ]


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
            total_data=0,
            completed=0,
            ai_rate=0.0,
            pending_review=0,
            total_annotations=0,
            ai_derived_annotations=0,
        )

    total_ann_result = await db.execute(
        select(func.count())
        .select_from(Annotation)
        .where(
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
            Annotation.project_id.in_(visible_ids),
        )
    )
    total_annotations = total_ann_result.scalar() or 0

    ai_ann_result = await db.execute(
        select(func.count())
        .select_from(Annotation)
        .where(
            Annotation.is_active.is_(True),
            Annotation.was_cancelled.is_(False),
            Annotation.parent_prediction_id.isnot(None),
            Annotation.project_id.in_(visible_ids),
        )
    )
    ai_derived_annotations = ai_ann_result.scalar() or 0

    ai_rate = (
        round(ai_derived_annotations / total_annotations * 100, 1)
        if total_annotations
        else 0.0
    )

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
    payload = data.model_dump(exclude_none=True)
    # v0.8.6 F3 · 绑定 backend 时用 backend.name 覆盖 ai_model（display hint）
    if payload.get("ml_backend_id"):
        payload = await _apply_backend_display_hint(db, payload)
    project = Project(
        id=uuid.uuid4(),
        display_id=await next_display_id(db, "projects"),
        owner_id=current_user.id,
        **payload,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return await _serialize_project(db, project)


async def _apply_backend_display_hint(
    db: AsyncSession, payload: dict
) -> dict:
    """v0.8.6 F3 helper：ml_backend_id 存在时，用 backend.name 覆盖 ai_model。"""
    from app.db.models.ml_backend import MLBackend as _MLB

    backend = await db.get(_MLB, payload["ml_backend_id"])
    if backend is not None:
        payload["ai_model"] = backend.name
    return payload


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
    payload = data.model_dump(exclude_unset=True)
    # v0.8.6 F3 · 绑定 backend 时用 backend.name 覆盖 ai_model（display hint）
    if payload.get("ml_backend_id"):
        payload = await _apply_backend_display_hint(db, payload)
    for k, v in payload.items():
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

    await db.execute(text("DELETE FROM annotation_comments WHERE project_id = :pid"), p)
    await db.execute(
        text(
            "DELETE FROM annotation_drafts WHERE task_id IN "
            "(SELECT id FROM tasks WHERE project_id = :pid)"
        ),
        p,
    )
    await db.execute(
        text(
            "DELETE FROM prediction_metas WHERE prediction_id IN "
            "(SELECT id FROM predictions WHERE project_id = :pid) "
            "OR failed_prediction_id IN "
            "(SELECT id FROM failed_predictions WHERE project_id = :pid)"
        ),
        p,
    )
    await db.execute(
        text(
            "UPDATE annotations SET parent_prediction_id = NULL, "
            "parent_annotation_id = NULL WHERE project_id = :pid"
        ),
        p,
    )
    await db.execute(text("DELETE FROM annotations WHERE project_id = :pid"), p)
    await db.execute(text("DELETE FROM predictions WHERE project_id = :pid"), p)
    await db.execute(text("DELETE FROM failed_predictions WHERE project_id = :pid"), p)
    await db.execute(
        text(
            "DELETE FROM task_locks WHERE task_id IN "
            "(SELECT id FROM tasks WHERE project_id = :pid)"
        ),
        p,
    )
    await db.execute(text("DELETE FROM ml_backends WHERE project_id = :pid"), p)
    await db.execute(
        text(
            "UPDATE bug_reports SET project_id = NULL, task_id = NULL "
            "WHERE project_id = :pid"
        ),
        p,
    )
    await db.execute(text("DELETE FROM tasks WHERE project_id = :pid"), p)

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
    request: Request,
    format: str = Query("coco", pattern="^(coco|voc|yolo)$"),
    include_attributes: bool = Query(
        True,
        description="是否在导出包中携带 annotation.attributes 与 project.attribute_schema",
    ),
    project: Project = Depends(require_project_visible),
    actor: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.export import ExportService
    from app.services.audit import AuditService, AuditAction, export_detail

    svc = ExportService(db)

    if format == "coco":
        content = await svc.export_coco(
            project.id, include_attributes=include_attributes
        )
        await AuditService.log(
            db,
            actor=actor,
            action=AuditAction.PROJECT_EXPORT,
            target_type="project",
            target_id=str(project.id),
            request=request,
            status_code=200,
            detail=export_detail(
                actor=actor,
                request=request,
                base={"format": format, "project_display_id": project.display_id},
                filter_criteria={"include_attributes": include_attributes},
            ),
        )
        await db.commit()
        return Response(
            content=content,
            media_type="application/json",
            headers={
                "Content-Disposition": f"attachment; filename={project.display_id}_coco.json"
            },
        )

    if format == "yolo":
        data = await svc.export_yolo(project.id, include_attributes=include_attributes)
        await AuditService.log(
            db,
            actor=actor,
            action=AuditAction.PROJECT_EXPORT,
            target_type="project",
            target_id=str(project.id),
            request=request,
            status_code=200,
            detail=export_detail(
                actor=actor,
                request=request,
                base={"format": format, "project_display_id": project.display_id},
                filter_criteria={"include_attributes": include_attributes},
            ),
        )
        await db.commit()
        return Response(
            content=data,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={project.display_id}_yolo.zip"
            },
        )

    data = await svc.export_voc(project.id, include_attributes=include_attributes)
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.PROJECT_EXPORT,
        target_type="project",
        target_id=str(project.id),
        request=request,
        status_code=200,
        detail={"format": format, "project_display_id": project.display_id},
    )
    await db.commit()
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={project.display_id}_voc.zip"
        },
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


@router.get("/{project_id}/orphan-tasks/preview")
async def preview_orphan_tasks(
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    """v0.6.7 二修 B-10：预览本项目中「无源 task」（dataset_item_id 为空 / 指向已 unlink 的数据集 / 指向已删除 dataset_item）。"""
    from sqlalchemy import select, func
    from app.db.models.task import Task
    from app.db.models.dataset import DatasetItem
    from app.db.models.annotation import Annotation
    from app.db.models.dataset import ProjectDataset

    # 孤儿条件：tasks 不存在仍 link 着的 (dataset_item → dataset → project_datasets)
    orphan_task_ids = (
        (
            await db.execute(
                select(Task.id).where(
                    Task.project_id == project.id,
                    ~Task.id.in_(
                        select(Task.id)
                        .join(DatasetItem, DatasetItem.id == Task.dataset_item_id)
                        .join(
                            ProjectDataset,
                            (ProjectDataset.dataset_id == DatasetItem.dataset_id)
                            & (ProjectDataset.project_id == project.id),
                        )
                        .where(Task.project_id == project.id)
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    task_count = len(orphan_task_ids)
    ann_count = 0
    if orphan_task_ids:
        ann_count = (
            await db.execute(
                select(func.count(Annotation.id)).where(
                    Annotation.task_id.in_(list(orphan_task_ids))
                )
            )
        ).scalar() or 0
    return {"orphan_tasks": task_count, "orphan_annotations": int(ann_count)}


@router.post("/{project_id}/orphan-tasks/cleanup")
async def cleanup_orphan_tasks(
    request: Request,
    project: Project = Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """v0.6.7 二修 B-10：删除本项目所有「无源 task」（含 annotations / locks / comments），重算 counters。

    适用场景：v0.6.0~v0.6.6 期间 link_project 写 dataset_item_id 但未持久化 batch 关系，
    后续数据集被 unlink / 删除留下的孤儿 task。
    """
    pid = str(project.id)
    # 用项目 delete 同款 raw SQL 但只针对孤儿 task ids
    orphan_q = """
        SELECT id FROM tasks WHERE project_id = :pid AND id NOT IN (
            SELECT t.id FROM tasks t
            JOIN dataset_items di ON di.id = t.dataset_item_id
            JOIN project_datasets pd ON pd.dataset_id = di.dataset_id AND pd.project_id = t.project_id
            WHERE t.project_id = :pid
        )
    """
    rows = (await db.execute(text(orphan_q), {"pid": pid})).all()
    if not rows:
        return {"deleted_tasks": 0, "deleted_annotations": 0}
    orphan_count = len(rows)

    # v0.7.0：把 ANY(:ids) 序列化数组改为子查询联查，避免 10 万级孤儿场景下的 array overflow。
    # 所有 DELETE / UPDATE 共用同一 orphan-id 子查询。
    orphan_subq = (
        "SELECT id FROM tasks WHERE project_id = :pid AND id NOT IN ("
        "  SELECT t.id FROM tasks t"
        "  JOIN dataset_items di ON di.id = t.dataset_item_id"
        "  JOIN project_datasets pd ON pd.dataset_id = di.dataset_id AND pd.project_id = t.project_id"
        "  WHERE t.project_id = :pid"
        ")"
    )
    ann_count = (
        await db.execute(
            text(f"SELECT COUNT(*) FROM annotations WHERE task_id IN ({orphan_subq})"),
            {"pid": pid},
        )
    ).scalar() or 0

    await db.execute(
        text(
            f"DELETE FROM annotation_comments WHERE annotation_id IN ("
            f"  SELECT id FROM annotations WHERE task_id IN ({orphan_subq}))"
        ),
        {"pid": pid},
    )
    await db.execute(
        text(f"DELETE FROM annotation_drafts WHERE task_id IN ({orphan_subq})"),
        {"pid": pid},
    )
    await db.execute(
        text(
            f"UPDATE annotations SET parent_prediction_id = NULL, parent_annotation_id = NULL "
            f"WHERE task_id IN ({orphan_subq})"
        ),
        {"pid": pid},
    )
    await db.execute(
        text(f"DELETE FROM annotations WHERE task_id IN ({orphan_subq})"), {"pid": pid}
    )
    await db.execute(
        text(f"DELETE FROM task_locks WHERE task_id IN ({orphan_subq})"), {"pid": pid}
    )
    await db.execute(
        text(f"UPDATE bug_reports SET task_id = NULL WHERE task_id IN ({orphan_subq})"),
        {"pid": pid},
    )
    await db.execute(
        text(f"DELETE FROM tasks WHERE id IN ({orphan_subq})"), {"pid": pid}
    )

    # 重算 project + batch counters（v0.7.0：含 in_progress_tasks）
    from sqlalchemy import select, func
    from app.db.models.task import Task
    from app.db.models.task_batch import TaskBatch

    row = (
        await db.execute(
            select(
                func.count().label("total"),
                func.count().filter(Task.status == "completed").label("completed"),
                func.count().filter(Task.status == "review").label("review"),
                func.count().filter(Task.status == "in_progress").label("in_progress"),
            ).where(Task.project_id == project.id)
        )
    ).one()
    project.total_tasks = row.total
    project.completed_tasks = row.completed
    project.review_tasks = row.review
    project.in_progress_tasks = row.in_progress

    batches = (
        (await db.execute(select(TaskBatch).where(TaskBatch.project_id == project.id)))
        .scalars()
        .all()
    )
    for b in batches:
        r = (
            await db.execute(
                select(
                    func.count().label("total"),
                    func.count().filter(Task.status == "completed").label("completed"),
                    func.count().filter(Task.status == "review").label("review"),
                ).where(Task.batch_id == b.id)
            )
        ).one()
        b.total_tasks = r.total
        b.completed_tasks = r.completed
        b.review_tasks = r.review

    from app.services.audit import AuditService

    await AuditService.log(
        db,
        actor=current_user,
        action="project.cleanup_orphans",
        target_type="project",
        target_id=str(project.id),
        request=request,
        status_code=200,
        detail={"deleted_tasks": orphan_count, "deleted_annotations": int(ann_count)},
    )
    await db.commit()
    return {"deleted_tasks": orphan_count, "deleted_annotations": int(ann_count)}


# ── v0.7.3 · 项目侧关联数据集 ────────────────────────────────────────────


@router.get("/{project_id}/datasets")
async def list_project_datasets(
    project_id: uuid.UUID,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
):
    """列出本项目已关联的所有数据集（含基础元数据 + task 数）。"""
    from app.db.models.dataset import Dataset, DatasetItem, ProjectDataset
    from app.db.models.task import Task

    rows = (
        await db.execute(
            select(Dataset, ProjectDataset.created_at.label("linked_at"))
            .join(ProjectDataset, ProjectDataset.dataset_id == Dataset.id)
            .where(ProjectDataset.project_id == project_id)
            .order_by(ProjectDataset.created_at.desc())
        )
    ).all()

    if not rows:
        return []

    ds_ids = [r[0].id for r in rows]
    item_counts = dict(
        (
            await db.execute(
                select(DatasetItem.dataset_id, func.count())
                .where(DatasetItem.dataset_id.in_(ds_ids))
                .group_by(DatasetItem.dataset_id)
            )
        ).all()
    )
    task_counts = dict(
        (
            await db.execute(
                select(DatasetItem.dataset_id, func.count())
                .join(Task, Task.dataset_item_id == DatasetItem.id)
                .where(
                    Task.project_id == project_id, DatasetItem.dataset_id.in_(ds_ids)
                )
                .group_by(DatasetItem.dataset_id)
            )
        ).all()
    )

    return [
        {
            "id": str(d.id),
            "display_id": d.display_id,
            "name": d.name,
            "data_type": d.data_type,
            "linked_at": linked_at.isoformat() if linked_at else None,
            "items_count": int(item_counts.get(d.id, 0)),
            "tasks_in_project": int(task_counts.get(d.id, 0)),
        }
        for d, linked_at in rows
    ]
