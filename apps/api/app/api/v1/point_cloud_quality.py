from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.tasks._shared import _REVIEWERS, _assert_task_visible, _visible_task_ids
from app.db.models.annotation import Annotation
from app.db.models.point_cloud_quality import (
    PointCloudQualityIssue,
    PointCloudQualityRun,
)
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.user import User
from app.deps import get_db, require_project_visible, require_roles
from app.schemas.point_cloud_quality import (
    POINT_CLOUD_QUALITY_RULE_CODES,
    PointCloudQualityIssueOut,
    PointCloudQualityIssuePage,
    PointCloudQualityIssuePatch,
    PointCloudQualityRunOut,
    PointCloudQualityRunRequest,
)
from app.services import async_job as async_job_svc
from app.services.audit import AuditAction, AuditService
from app.services.point_cloud_quality.service import (
    PointCloudQualityError,
    create_quality_run,
    dispatch_quality_run,
    list_issues,
    refresh_issue_staleness,
)
from app.services.scheduler import is_privileged_for_project


router = APIRouter()


def _raise_quality_error(exc: PointCloudQualityError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


def _run_out(run: PointCloudQualityRun, *, reused: bool = False):
    return PointCloudQualityRunOut.model_validate(run).model_copy(
        update={"reused": reused}
    )


async def _assert_request_visible(
    db: AsyncSession,
    *,
    project: Project,
    user: User,
    body: PointCloudQualityRunRequest,
) -> None:
    if body.scope in {"project", "scene_ids"}:
        if not is_privileged_for_project(user, project):
            raise HTTPException(
                status_code=403,
                detail="project and scene quality scans require project owner",
            )
        return
    task_ids: set[uuid.UUID]
    if body.scope == "task_ids":
        task_ids = set(body.task_ids)
    else:
        rows = (
            await db.execute(
                select(Annotation.id, Annotation.task_id).where(
                    Annotation.project_id == project.id,
                    Annotation.id.in_(body.annotation_ids),
                )
            )
        ).all()
        if {row.id for row in rows} != set(body.annotation_ids):
            raise HTTPException(status_code=404, detail="3D annotation not found")
        task_ids = {row.task_id for row in rows}
    tasks = list(
        (
            await db.execute(
                select(Task).where(Task.project_id == project.id, Task.id.in_(task_ids))
            )
        ).scalars()
    )
    if {row.id for row in tasks} != task_ids:
        raise HTTPException(status_code=404, detail="Task not found")
    for task in tasks:
        await _assert_task_visible(db, task, user)


async def _assert_issue_visible(
    db: AsyncSession, issue: PointCloudQualityIssue, user: User
) -> Project:
    project = await db.get(Project, issue.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if is_privileged_for_project(user, project):
        return project
    if issue.task_id is None:
        raise HTTPException(status_code=403, detail="Quality issue not visible")
    task = await db.get(Task, issue.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    await _assert_task_visible(db, task, user)
    return project


@router.post(
    "/projects/{project_id}/point-cloud-quality/runs",
    response_model=PointCloudQualityRunOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_run(
    body: PointCloudQualityRunRequest,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    await _assert_request_visible(db, project=project, user=current_user, body=body)
    try:
        run, job, created = await create_quality_run(
            db, project=project, actor_id=current_user.id, request=body
        )
    except PointCloudQualityError as exc:
        _raise_quality_error(exc)
    await db.commit()
    if created and job is not None:
        try:
            await dispatch_quality_run(db, run_id=run.id, async_job_id=job.id)
        except PointCloudQualityError as exc:
            run = await db.get(PointCloudQualityRun, run.id)
            if run is not None:
                run.status = "failed"
                run.error_message = str(exc.detail)[:4000]
                run.completed_at = datetime.now(timezone.utc)
            await async_job_svc.mark_failed(db, job.id, error=str(exc.detail))
            await db.commit()
            _raise_quality_error(exc)
    await db.refresh(run)
    return _run_out(run, reused=not created)


@router.get(
    "/projects/{project_id}/point-cloud-quality/runs/{run_id}",
    response_model=PointCloudQualityRunOut,
)
async def get_run(
    run_id: uuid.UUID,
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    run = await db.get(PointCloudQualityRun, run_id)
    if run is None or run.project_id != project.id:
        raise HTTPException(status_code=404, detail="Point cloud quality run not found")
    if not is_privileged_for_project(current_user, project):
        task_ids = [uuid.UUID(value) for value in run.scope_json.get("task_ids", [])]
        if await _visible_task_ids(db, project, current_user, task_ids) != set(
            task_ids
        ):
            raise HTTPException(status_code=403, detail="Quality run not visible")
    return _run_out(run)


@router.get(
    "/projects/{project_id}/point-cloud-quality/issues",
    response_model=PointCloudQualityIssuePage,
)
async def get_issues(
    project: Project = Depends(require_project_visible),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
    issue_status: Literal["open", "resolved", "wont_fix", "stale"] | None = Query(
        default=None, alias="status"
    ),
    severity: Literal["blocker", "warning", "info"] | None = None,
    code: str | None = None,
    scene_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    annotation_id: uuid.UUID | None = None,
    scene_track_id: uuid.UUID | None = None,
    frame: int | None = Query(default=None, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    if code is not None and code not in POINT_CLOUD_QUALITY_RULE_CODES:
        raise HTTPException(status_code=422, detail="Unknown point cloud quality code")
    allowed_task_ids: set[uuid.UUID] | None = None
    if not is_privileged_for_project(current_user, project):
        all_task_ids = list(
            (
                await db.execute(select(Task.id).where(Task.project_id == project.id))
            ).scalars()
        )
        allowed_task_ids = await _visible_task_ids(
            db, project, current_user, all_task_ids
        )
    rows, total = await list_issues(
        db,
        project_id=project.id,
        status=issue_status,
        severity=severity,
        code=code,
        scene_id=scene_id,
        task_id=task_id,
        annotation_id=annotation_id,
        scene_track_id=scene_track_id,
        frame=frame,
        allowed_task_ids=allowed_task_ids,
        limit=limit,
        offset=offset,
    )
    await db.flush()
    for row in rows:
        await db.refresh(row)
    payload = [PointCloudQualityIssueOut.model_validate(row) for row in rows]
    await db.commit()
    return PointCloudQualityIssuePage(
        items=payload,
        total=total,
    )


@router.get(
    "/point-cloud-quality/issues/{issue_id}",
    response_model=PointCloudQualityIssueOut,
)
async def get_issue(
    issue_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    issue = await db.get(PointCloudQualityIssue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Quality issue not found")
    await _assert_issue_visible(db, issue, current_user)
    await refresh_issue_staleness(db, issue)
    await db.flush()
    await db.refresh(issue)
    payload = PointCloudQualityIssueOut.model_validate(issue)
    await db.commit()
    return payload


@router.patch(
    "/point-cloud-quality/issues/{issue_id}",
    response_model=PointCloudQualityIssueOut,
)
async def patch_issue(
    issue_id: uuid.UUID,
    body: PointCloudQualityIssuePatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_REVIEWERS)),
):
    issue = await db.get(PointCloudQualityIssue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Quality issue not found")
    await _assert_issue_visible(db, issue, current_user)
    if await refresh_issue_staleness(db, issue):
        raise HTTPException(
            status_code=409, detail={"reason": "point_cloud_quality_issue_stale"}
        )
    previous = issue.status
    issue.status = body.status
    issue.resolution_reason = (body.reason or "").strip() or None
    if body.status == "open":
        issue.resolved_by_id = None
        issue.resolved_at = None
    else:
        issue.resolved_by_id = current_user.id
        issue.resolved_at = datetime.now(timezone.utc)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.POINT_CLOUD_QUALITY_ISSUE_STATUS,
        target_type="point_cloud_quality_issue",
        target_id=issue.id,
        request=request,
        status_code=200,
        detail={
            "from": previous,
            "to": issue.status,
            "reason": issue.resolution_reason,
        },
    )
    await db.commit()
    await db.refresh(issue)
    return PointCloudQualityIssueOut.model_validate(issue)
