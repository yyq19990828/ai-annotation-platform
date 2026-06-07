from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.tasks import _attach_dimensions_batch, _task_with_url
from app.deps import assert_project_visible, get_current_user, get_db
from app.db.enums import UserRole
from app.db.models.project import Project
from app.db.models.project_task_view import ProjectTaskView
from app.db.models.user import User
from app.schemas.task_view import (
    DataManagerTaskOut,
    ProjectTaskQueryRequest,
    ProjectTaskQueryResponse,
    ProjectTaskViewCopyRequest,
    ProjectTaskViewCreate,
    ProjectTaskViewListResponse,
    ProjectTaskViewOut,
    ProjectTaskViewUpdate,
)
from app.services.audit import AuditAction, AuditService
from app.services.task_views import TaskViewService, builtin_views
from app.services.user_brief import resolve_briefs

router = APIRouter()


def _can_manage_project(user: User, project: Project) -> bool:
    return user.role == UserRole.SUPER_ADMIN or project.owner_id == user.id


def _assert_can_write_view(user: User, project: Project, view: ProjectTaskView) -> None:
    if view.visibility == "private":
        if view.owner_id == user.id or user.role == UserRole.SUPER_ADMIN:
            return
        raise HTTPException(status_code=403, detail="Only the view owner can edit it")
    if _can_manage_project(user, project):
        return
    raise HTTPException(
        status_code=403, detail="Only project admins can edit shared views"
    )


def _sort_to_json(payload) -> list[dict]:
    return [
        item.model_dump() if hasattr(item, "model_dump") else dict(item)
        for item in payload
    ]


async def _commit_or_duplicate(db: AsyncSession) -> None:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Task view name already exists"
        ) from exc


def _view_out(
    view: ProjectTaskView, task_count: int | None = None
) -> ProjectTaskViewOut:
    out = ProjectTaskViewOut.model_validate(view, from_attributes=True)
    out.task_count = task_count
    return out


@router.get(
    "/projects/{project_id}/task-views", response_model=ProjectTaskViewListResponse
)
async def list_task_views(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    svc = TaskViewService(db)
    builtins = builtin_views(project_id)
    saved = await svc.list_views(project_id, user.id)
    # 单条聚合查询算出全部视图计数，避免每个视图一次往返 (N+1)。
    counts = await svc.count_for_filters(
        project_id,
        [b["filter_json"] for b in builtins] + [v.filter_json for v in saved],
        user=user,
        project=project,
    )
    items: list[ProjectTaskViewOut] = []
    for builtin, count in zip(builtins, counts):
        items.append(ProjectTaskViewOut(**builtin, task_count=count))
    for view, count in zip(saved, counts[len(builtins) :]):
        items.append(_view_out(view, task_count=count))
    return ProjectTaskViewListResponse(items=items)


@router.post(
    "/projects/{project_id}/task-views",
    response_model=ProjectTaskViewOut,
    status_code=201,
)
async def create_task_view(
    project_id: uuid.UUID,
    payload: ProjectTaskViewCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    if payload.visibility == "project" and not _can_manage_project(user, project):
        raise HTTPException(
            status_code=403, detail="Only project admins can create shared views"
        )
    svc = TaskViewService(db)
    view = await svc.create_view(
        project_id=project_id,
        owner_id=user.id,
        name=payload.name,
        visibility=payload.visibility,
        filter_json=payload.filter_json,
        sort_json=_sort_to_json(payload.sort_json),
        columns_json=payload.columns_json,
    )
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.PROJECT_UPDATE,
        target_type="project_task_view",
        target_id=view.id,
        request=request,
        status_code=201,
        detail={"project_id": str(project_id), "visibility": view.visibility},
    )
    await _commit_or_duplicate(db)
    return _view_out(view)


@router.get(
    "/projects/{project_id}/task-views/{view_id}", response_model=ProjectTaskViewOut
)
async def get_task_view(
    project_id: uuid.UUID,
    view_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    svc = TaskViewService(db)
    view = await svc.get_view(project_id, view_id, user.id)
    count = await svc.count_for_filter(
        project_id, view.filter_json, user=user, project=project
    )
    return _view_out(view, task_count=count)


@router.patch(
    "/projects/{project_id}/task-views/{view_id}", response_model=ProjectTaskViewOut
)
async def update_task_view(
    project_id: uuid.UUID,
    view_id: uuid.UUID,
    payload: ProjectTaskViewUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    svc = TaskViewService(db)
    view = await svc.get_view(project_id, view_id, user.id)
    _assert_can_write_view(user, project, view)
    next_visibility = payload.visibility
    if next_visibility == "project" and not _can_manage_project(user, project):
        raise HTTPException(
            status_code=403, detail="Only project admins can share views"
        )
    view = await svc.update_view(
        view,
        name=payload.name,
        visibility=payload.visibility,
        filter_json=payload.filter_json,
        sort_json=_sort_to_json(payload.sort_json)
        if payload.sort_json is not None
        else None,
        columns_json=payload.columns_json,
    )
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.PROJECT_UPDATE,
        target_type="project_task_view",
        target_id=view.id,
        request=request,
        status_code=200,
        detail={"project_id": str(project_id), "visibility": view.visibility},
    )
    await _commit_or_duplicate(db)
    return _view_out(view)


@router.delete("/projects/{project_id}/task-views/{view_id}", status_code=204)
async def delete_task_view(
    project_id: uuid.UUID,
    view_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    svc = TaskViewService(db)
    view = await svc.get_view(project_id, view_id, user.id)
    _assert_can_write_view(user, project, view)
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.PROJECT_UPDATE,
        target_type="project_task_view",
        target_id=view.id,
        request=request,
        status_code=204,
        detail={"project_id": str(project_id), "deleted": True},
    )
    await svc.delete_view(view)
    await db.commit()
    return None


@router.post(
    "/projects/{project_id}/task-views/{view_id}/copy",
    response_model=ProjectTaskViewOut,
    status_code=201,
)
async def copy_task_view(
    project_id: uuid.UUID,
    view_id: uuid.UUID,
    payload: ProjectTaskViewCopyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    svc = TaskViewService(db)
    source = await svc.get_view(project_id, view_id, user.id)
    visibility = payload.visibility or source.visibility
    if visibility == "project" and not _can_manage_project(user, project):
        raise HTTPException(
            status_code=403, detail="Only project admins can create shared views"
        )
    view = await svc.create_view(
        project_id=project_id,
        owner_id=user.id,
        name=payload.name or f"{source.name} 副本",
        visibility=visibility,
        filter_json=source.filter_json,
        sort_json=source.sort_json,
        columns_json=source.columns_json,
    )
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.PROJECT_UPDATE,
        target_type="project_task_view",
        target_id=view.id,
        request=request,
        status_code=201,
        detail={"project_id": str(project_id), "copied_from": str(source.id)},
    )
    await _commit_or_duplicate(db)
    return _view_out(view)


@router.post(
    "/projects/{project_id}/tasks/query", response_model=ProjectTaskQueryResponse
)
async def query_project_tasks(
    project_id: uuid.UUID,
    payload: ProjectTaskQueryRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = await assert_project_visible(project_id, db, user)
    svc = TaskViewService(db)
    rows, total = await svc.query_tasks(
        project_id=project_id,
        filter_json=payload.filter_json,
        sort_json=_sort_to_json(payload.sort_json),
        limit=payload.limit,
        offset=payload.offset,
        user=user,
        project=project,
    )
    tasks = [row[0] for row in rows]
    dims = await _attach_dimensions_batch(db, tasks)
    user_ids = {t.assignee_id for t in tasks if t.assignee_id} | {
        t.reviewer_id for t in tasks if t.reviewer_id
    }
    briefs = await resolve_briefs(db, user_ids) if user_ids else {}
    items: list[DataManagerTaskOut] = []
    for row in rows:
        task = row[0]
        base = _task_with_url(
            task,
            *dims.get(task.id, (None, None, None, None, None)),
            briefs=briefs,
        ).model_dump()
        base.update(
            {
                "annotation_count": task.total_annotations,
                "prediction_count": task.total_predictions,
                "avg_prediction_confidence": row.avg_prediction_confidence,
                "unresolved_feedback_count": row.unresolved_feedback_count or 0,
                "model_versions": list(row.model_versions or []),
                "scene_name": row.scene_name,
                "frame_index": row.frame_index,
                "last_activity_at": row.last_activity_at,
            }
        )
        items.append(DataManagerTaskOut(**base))
    return ProjectTaskQueryResponse(
        items=items,
        total=total,
        limit=payload.limit,
        offset=payload.offset,
    )


@router.get(
    "/projects/{project_id}/task-views/{view_id}/tasks",
    response_model=ProjectTaskQueryResponse,
)
async def query_task_view_tasks(
    project_id: uuid.UUID,
    view_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await assert_project_visible(project_id, db, user)
    svc = TaskViewService(db)
    view = await svc.get_view(project_id, view_id, user.id)
    return await query_project_tasks(
        project_id,
        ProjectTaskQueryRequest(
            filter_json=view.filter_json,
            sort_json=view.sort_json,
            columns_json=view.columns_json,
            limit=limit,
            offset=offset,
        ),
        db,
        user,
    )
