from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.tasks import _assert_task_visible
from app.db.enums import UserRole
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.user import User
from app.deps import get_current_user, get_db, require_roles
from app.schemas.video_tracker_job import VideoTrackerJobOut
from app.services.audit import AuditAction, AuditService
from app.services.scheduler import is_privileged_for_project
from app.services.video_tracker_job_service import (
    cancel_tracker_job,
    get_tracker_job,
    tracker_job_out,
)

router = APIRouter()

_ANNOTATORS = (
    UserRole.SUPER_ADMIN,
    UserRole.PROJECT_ADMIN,
    UserRole.REVIEWER,
    UserRole.ANNOTATOR,
)


async def _load_visible_job_task(
    db: AsyncSession, job_id: uuid.UUID, user: User
) -> tuple[Task, VideoTrackerJobOut]:
    row = await get_tracker_job(db, job_id)
    task = await db.get(Task, row.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Video tracker job not found")
    await _assert_task_visible(db, task, user)
    return task, tracker_job_out(row)


async def _assert_can_cancel(
    db: AsyncSession,
    task: Task,
    body: VideoTrackerJobOut,
    user: User,
) -> None:
    project = await db.get(Project, task.project_id)
    if body.created_by == user.id or (
        project and is_privileged_for_project(user, project)
    ):
        return
    raise HTTPException(
        status_code=403, detail="Video tracker job belongs to another user"
    )


@router.get("/{job_id}", response_model=VideoTrackerJobOut)
async def get_video_tracker_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _, body = await _load_visible_job_task(db, job_id, current_user)
    return body


@router.delete("/{job_id}", response_model=VideoTrackerJobOut)
async def cancel_video_tracker_job(
    job_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    task, body = await _load_visible_job_task(db, job_id, current_user)
    await _assert_can_cancel(db, task, body, current_user)
    body = await cancel_tracker_job(db, job_id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.VIDEO_TRACKER_JOB_CANCEL,
        target_type="video_tracker_job",
        target_id=job_id,
        request=request,
        status_code=200,
        detail={"task_id": str(task.id), "status": body.status},
    )
    await db.commit()
    return body
