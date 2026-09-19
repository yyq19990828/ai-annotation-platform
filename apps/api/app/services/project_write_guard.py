"""Phase-aware project write authorization for asynchronous final writes (B3).

Long-running workers (cross-frame propagation, video tracker) must re-check the
*actual* task the write lands on, not the authority that was checked when work
was enqueued.  This module composes the existing canonical helpers:

* current project access (locked membership) from
  :mod:`app.services.project_access`;
* task editability and effective-assignee rules from
  ``app.api.v1.tasks._shared``;
* frozen review contributor evidence from
  :mod:`app.services.annotation_evidence`.

It deliberately adds no new policy language: an annotation-phase write requires
the effective annotator (or a manager), and a review-phase write requires a
reviewer/manager plus current, complete, non-self frozen evidence.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.user import User

_BUSY_SQLSTATES = {"55P03", "40001", "40P01"}


def _busy_lock_error(exc: BaseException) -> bool:
    orig = getattr(exc, "orig", None)
    sqlstate = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    return sqlstate in _BUSY_SQLSTATES


async def lock_actor_project_share(
    db: AsyncSession, actor_id, project_id, *, nowait: bool = True
) -> None:
    """Account-before-resource: bounded share lock on the actor's membership.

    Acquired before Task/Job locks so the final-write guard's later membership
    re-read does not introduce a Membership-after-Task wait cycle.
    """

    from sqlalchemy.exc import DBAPIError

    try:
        await db.execute(
            select(ProjectMember.id)
            .where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == actor_id,
            )
            .with_for_update(read=True, nowait=nowait)
        )
    except DBAPIError as exc:
        if _busy_lock_error(exc):
            raise HTTPException(
                status_code=409, detail={"reason": "membership_busy"}
            ) from exc
        raise


async def assert_phase_write_allowed(
    db: AsyncSession,
    task: Task,
    actor: User,
    *,
    action: str = "write",
    lock_membership: bool = True,
) -> None:
    """Authorize one final write to ``task`` by ``actor``.

    Raises 403/409 through the canonical helpers; callers translate them into
    their worker's terminal failure state.
    """

    from app.api.v1.tasks._shared import (
        _assert_effective_task_assignee,
        _assert_task_editable,
        _effective_task_assignee_id,
    )
    from app.db.models.project import Project
    from app.services.annotation_evidence import assert_review_evidence_current
    from app.services.project_access import resolve_project_access

    project = await db.get(Project, task.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="task_missing")
    try:
        access = await resolve_project_access(
            db, user=actor, project=project, lock_membership=lock_membership
        )
    except HTTPException as exc:
        raise HTTPException(status_code=403, detail="permission_changed") from exc

    _assert_task_editable(task, actor, access=access)
    effective_annotator_id = await _effective_task_assignee_id(db, task)
    if task.status == "review":
        assert_review_evidence_current(
            task, actor.id, effective_annotator_id=effective_annotator_id
        )
        return
    _assert_effective_task_assignee(
        actor,
        effective_annotator_id,
        action=action,
        project_id=task.project_id,
        access=access,
    )
