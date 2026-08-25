"""3D Scene 轨迹拆分 / 合并 API。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.tasks._shared import (
    _ANNOTATORS,
    _assert_task_editable,
    _assert_task_visible,
    _load_task_or_404,
    _visible_task_ids,
)
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.user import User
from app.deps import get_db, require_roles
from app.schemas.track_operation import (
    TrackOperationCandidatesResponse,
    TrackOperationExecuteRequest,
    TrackOperationPreviewResponse,
    TrackOperationRequest,
    TrackOperationResult,
)
from app.services.audit import AuditAction, AuditService
from app.services.task_lock import TaskLockService
from app.services.track_operation import (
    MAX_CANDIDATE_SCAN,
    PreparedTrackOperation,
    apply_track_operation,
    list_structural_merge_candidates,
    prepare_track_operation,
)


router = APIRouter()


def _track_error(status_code: int, reason: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"reason": reason, "message": message},
    )


async def _task_access_map(
    db: AsyncSession,
    *,
    project: Project,
    current_user: User,
    task_ids: set[uuid.UUID],
) -> dict[uuid.UUID, Task]:
    rows = list(
        (
            await db.execute(
                select(Task).where(Task.id.in_(task_ids)).order_by(Task.id)
            )
        ).scalars()
    )
    by_id = {row.id: row for row in rows}
    visible_ids = await _visible_task_ids(db, project, current_user, list(task_ids))
    return {task_id: task for task_id, task in by_id.items() if task_id in visible_ids}


def _tasks_are_editable(
    tasks: dict[uuid.UUID, Task],
    *,
    task_ids: set[uuid.UUID] | frozenset[uuid.UUID],
    current_user: User,
) -> bool:
    if not set(task_ids).issubset(tasks):
        return False
    try:
        for task_id in sorted(task_ids, key=str):
            _assert_task_editable(tasks[task_id], current_user)
    except HTTPException:
        return False
    return True


async def _assert_prepared_mutable(
    db: AsyncSession,
    *,
    anchor_task: Task,
    current_user: User,
    prepared: PreparedTrackOperation,
) -> None:
    project = await db.get(Project, anchor_task.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task_ids = set(prepared.task_ids)
    tasks = await _task_access_map(
        db,
        project=project,
        current_user=current_user,
        task_ids=task_ids,
    )
    if not _tasks_are_editable(
        tasks,
        task_ids=task_ids,
        current_user=current_user,
    ):
        raise _track_error(
            409,
            "track_member_unavailable",
            "every track member task must be visible and editable",
        )


def _preview_response(prepared: PreparedTrackOperation):
    return {
        "operation": prepared.request.operation,
        "scene_id": prepared.context.scene_id,
        "scene_name": prepared.context.scene_name,
        "primary": prepared.primary.summary,
        "secondary": prepared.secondary.summary if prepared.secondary else None,
        "survivor_track_id": prepared.primary.summary.track_id,
        "affected_member_count": prepared.affected_member_count,
        "rewritten_member_count": prepared.rewritten_member_count,
        "snapshot_token": prepared.snapshot_token,
    }


@router.get(
    "/{task_id}/track-operations/candidates",
    response_model=TrackOperationCandidatesResponse,
)
async def list_track_operation_candidates(
    task_id: uuid.UUID,
    track_id: str = Query(..., min_length=1, max_length=64),
    limit: int = Query(20, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    anchor_task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, anchor_task, current_user)
    _assert_task_editable(anchor_task, current_user)
    _, structural = await list_structural_merge_candidates(
        db,
        anchor_task=anchor_task,
        primary_track_id=track_id,
        limit=min(MAX_CANDIDATE_SCAN, limit * 4),
    )
    project = await db.get(Project, anchor_task.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Task not found")
    all_task_ids = set(structural.primary.task_ids)
    for candidate in structural.candidates:
        all_task_ids.update(candidate.task_ids)
    tasks = await _task_access_map(
        db,
        project=project,
        current_user=current_user,
        task_ids=all_task_ids,
    )
    if not _tasks_are_editable(
        tasks,
        task_ids=structural.primary.task_ids,
        current_user=current_user,
    ):
        raise _track_error(
            409,
            "track_member_unavailable",
            "every selected track member task must be visible and editable",
        )

    visible_candidates = [
        candidate
        for candidate in structural.candidates
        if _tasks_are_editable(
            tasks,
            task_ids=candidate.task_ids,
            current_user=current_user,
        )
    ]
    return TrackOperationCandidatesResponse(
        primary=structural.primary.summary,
        candidates=[candidate.summary for candidate in visible_candidates[:limit]],
        truncated=(
            structural.truncated
            or len(structural.candidates) > limit
            or len(visible_candidates) > limit
        ),
    )


@router.post(
    "/{task_id}/track-operations/preview",
    response_model=TrackOperationPreviewResponse,
)
async def preview_track_operation(
    task_id: uuid.UUID,
    data: TrackOperationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    anchor_task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, anchor_task, current_user)
    _assert_task_editable(anchor_task, current_user)
    prepared = await prepare_track_operation(
        db,
        anchor_task=anchor_task,
        request=data,
    )
    await _assert_prepared_mutable(
        db,
        anchor_task=anchor_task,
        current_user=current_user,
        prepared=prepared,
    )
    return TrackOperationPreviewResponse(**_preview_response(prepared))


@router.post(
    "/{task_id}/track-operations",
    response_model=TrackOperationResult,
)
async def execute_track_operation(
    task_id: uuid.UUID,
    data: TrackOperationExecuteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ANNOTATORS)),
):
    anchor_task = await _load_task_or_404(db, task_id)
    await _assert_task_visible(db, anchor_task, current_user)
    _assert_task_editable(anchor_task, current_user)
    operation = TrackOperationRequest.model_validate(
        data.model_dump(exclude={"snapshot_token"})
    )
    prepared = await prepare_track_operation(
        db,
        anchor_task=anchor_task,
        request=operation,
        for_update=True,
    )
    await _assert_prepared_mutable(
        db,
        anchor_task=anchor_task,
        current_user=current_user,
        prepared=prepared,
    )
    mutation = await apply_track_operation(
        db,
        prepared=prepared,
        expected_snapshot_token=data.snapshot_token,
    )
    await TaskLockService(db).heartbeat(anchor_task.id, current_user.id)
    await AuditService.log(
        db,
        actor=current_user,
        action=AuditAction.ANNOTATION_UPDATE,
        target_type="scene",
        target_id=str(prepared.context.scene_id),
        request=request,
        status_code=200,
        detail={
            "operation": f"point_cloud_track.{operation.operation}",
            "anchor_task_id": str(anchor_task.id),
            "split_after_frame": operation.split_after_frame,
            "primary_track_id": operation.primary_track_id,
            "secondary_track_id": operation.secondary_track_id,
            "survivor_track_id": prepared.primary.summary.track_id,
            "created_track_id": mutation.created_track_id,
            "updated_member_count": mutation.updated_member_count,
            "snapshot_token_prefix": prepared.snapshot_token[:12],
        },
    )
    await db.commit()
    return TrackOperationResult(
        **_preview_response(prepared),
        created_track_id=mutation.created_track_id,
        updated_member_count=mutation.updated_member_count,
    )
