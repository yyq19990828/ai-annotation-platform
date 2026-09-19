"""Project membership mutations: add, role change (preview/CAS/handoff), remove.

This module is the single owner of ``project_members`` mutation introduced by
the project-scoped employee-roles plan (Increment B1).  It reuses the existing
effective-assignment helpers and the repository's nonblocking lock policy:

* the target membership is acquired with ``FOR UPDATE NOWAIT``; a busy row
  rolls the transaction back to a retryable ``409``;
* involved accounts are locked in stable id order with ``NOWAIT``;
* all resource queries are filtered to the *one* project, so a mutation never
  clears another project's locks, claims or assignments.

Nothing here performs whole-account offboarding; that remains owned by
``services/user_lifecycle.py``.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import PROJECT_ROLES, ProjectRole, TaskStatus
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.task_lock import TaskLock
from app.db.models.user import User
from app.services.audit import AuditAction, AuditService
from app.services.project_access import (
    assert_membership_role_compatible,
    membership_role_compatible,
)
from app.services.scheduler import (
    effective_task_assignee_expr,
    effective_task_reviewer_expr,
)

_BUSY_SQLSTATES = {"55P03", "40P01", "40001"}

#: Annotation work that has not reached review/completion.
UNFINISHED_ANNOTATION_STATUSES = (
    TaskStatus.PENDING.value,
    TaskStatus.IN_PROGRESS.value,
    TaskStatus.REJECTED.value,
)
#: Review work still waiting on the reviewer.
UNFINISHED_REVIEW_STATUSES = (TaskStatus.REVIEW.value,)

_BLOCKER_LABELS = {
    "unfinished_annotation_work": "成员仍有未完成的标注工作，需显式指派接收人",
    "unfinished_review_work": "成员仍有未完成的审核工作，需显式指派接收人",
    "active_locks": "成员持有效工作锁，需在交接中释放后才能变更职责",
    "reviewer_coverage_lost": "变更后将没有可用的质检员接收剩余审核工作",
    "invalid_replacement_annotator": "标注接收人必须是该项目中启用且职责匹配的员工",
    "invalid_replacement_reviewer": "质检接收人必须是该项目中启用且职责匹配的员工",
    "identical_replacement_responsibility": "标注接收人与质检接收人不能是同一账号",
    "same_role": "目标职责与当前职责相同",
}


def _busy_db_error(exc: DBAPIError) -> bool:
    return getattr(exc.orig, "sqlstate", None) in _BUSY_SQLSTATES


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _snapshot_token(snapshot: dict[str, Any]) -> str:
    payload = json.dumps(snapshot, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _blocker(code: str, **extra: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {"code": code, "message": _BLOCKER_LABELS.get(code, code)}
    entry.update(extra)
    return entry


async def _lock_membership_nowait(
    db: AsyncSession, *, project_id: uuid.UUID, member_id: uuid.UUID
) -> ProjectMember:
    stmt = (
        select(ProjectMember)
        .where(
            ProjectMember.id == member_id,
            ProjectMember.project_id == project_id,
        )
        .with_for_update(nowait=True)
        .execution_options(populate_existing=True)
    )
    try:
        member = (await db.execute(stmt)).scalar_one_or_none()
    except DBAPIError as exc:
        await db.rollback()
        if _busy_db_error(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "reason": "membership_busy",
                    "detail": "成员正在变更，请刷新后重试",
                },
            ) from exc
        raise
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="成员不存在")
    return member


async def _lock_accounts_nowait(
    db: AsyncSession, user_ids: list[uuid.UUID]
) -> dict[uuid.UUID, User]:
    ids = sorted({uid for uid in user_ids if uid is not None})
    if not ids:
        return {}
    try:
        rows = await db.scalars(
            select(User)
            .where(User.id.in_(ids))
            .order_by(User.id)
            .with_for_update(nowait=True)
            .execution_options(populate_existing=True)
        )
    except DBAPIError as exc:
        await db.rollback()
        if _busy_db_error(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "reason": "account_busy",
                    "detail": "账号正在变更，请刷新后重试",
                },
            ) from exc
        raise
    return {user.id: user for user in rows}


async def _project_role_member_ids(
    db: AsyncSession, *, project_id: uuid.UUID, project_role: str
) -> set[uuid.UUID]:
    rows = await db.execute(
        select(ProjectMember.user_id)
        .join(User, User.id == ProjectMember.user_id)
        .where(
            ProjectMember.project_id == project_id,
            ProjectMember.role == project_role,
            User.is_active.is_(True),
        )
    )
    return {user_id for (user_id,) in rows.all()}


async def _annotation_task_ids(
    db: AsyncSession, *, project_id: uuid.UUID, user_id: uuid.UUID
) -> list[uuid.UUID]:
    rows = await db.execute(
        select(Task.id)
        .outerjoin(TaskBatch, TaskBatch.id == Task.batch_id)
        .where(
            Task.project_id == project_id,
            Task.status.in_(UNFINISHED_ANNOTATION_STATUSES),
            effective_task_assignee_expr() == user_id,
        )
        .order_by(Task.id)
    )
    return [task_id for (task_id,) in rows.all()]


async def _review_task_ids(
    db: AsyncSession, *, project_id: uuid.UUID, user_id: uuid.UUID
) -> list[uuid.UUID]:
    rows = await db.execute(
        select(Task.id)
        .outerjoin(TaskBatch, TaskBatch.id == Task.batch_id)
        .where(
            Task.project_id == project_id,
            Task.status.in_(UNFINISHED_REVIEW_STATUSES),
            effective_task_reviewer_expr() == user_id,
        )
        .order_by(Task.id)
    )
    return [task_id for (task_id,) in rows.all()]


async def _claimed_review_task_ids(
    db: AsyncSession, *, project_id: uuid.UUID, user_id: uuid.UUID
) -> list[uuid.UUID]:
    rows = await db.execute(
        select(Task.id)
        .where(
            Task.project_id == project_id,
            Task.status.in_(UNFINISHED_REVIEW_STATUSES),
            Task.reviewer_id == user_id,
            Task.reviewer_claimed_at.is_not(None),
        )
        .order_by(Task.id)
    )
    return [task_id for (task_id,) in rows.all()]


async def _batch_ids(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    column,
    user_id: uuid.UUID,
) -> list[uuid.UUID]:
    rows = await db.execute(
        select(TaskBatch.id)
        .where(TaskBatch.project_id == project_id, column == user_id)
        .order_by(TaskBatch.id)
    )
    return [batch_id for (batch_id,) in rows.all()]


async def _active_lock_task_ids(
    db: AsyncSession, *, project_id: uuid.UUID, user_id: uuid.UUID
) -> list[uuid.UUID]:
    rows = await db.execute(
        select(TaskLock.task_id)
        .join(Task, Task.id == TaskLock.task_id)
        .where(
            Task.project_id == project_id,
            TaskLock.user_id == user_id,
            TaskLock.expire_at > _utcnow(),
        )
        .order_by(TaskLock.task_id)
    )
    return [task_id for (task_id,) in rows.all()]


async def build_member_resource_snapshot(
    db: AsyncSession, *, project: Project, member: ProjectMember
) -> dict[str, Any]:
    """Canonical, project-local snapshot of a member's outstanding resources."""

    user_id = member.user_id
    annotation_task_ids = await _annotation_task_ids(
        db, project_id=project.id, user_id=user_id
    )
    review_task_ids = await _review_task_ids(db, project_id=project.id, user_id=user_id)
    lock_task_ids = await _active_lock_task_ids(
        db, project_id=project.id, user_id=user_id
    )
    review_claim_task_ids = await _claimed_review_task_ids(
        db, project_id=project.id, user_id=user_id
    )
    batch_annotator_ids = await _batch_ids(
        db,
        project_id=project.id,
        column=TaskBatch.annotator_id,
        user_id=user_id,
    )
    batch_reviewer_ids = await _batch_ids(
        db,
        project_id=project.id,
        column=TaskBatch.reviewer_id,
        user_id=user_id,
    )
    eligible_reviewer_ids = sorted(
        str(uid)
        for uid in (
            await _project_role_member_ids(
                db, project_id=project.id, project_role=ProjectRole.REVIEWER.value
            )
        )
        - {user_id}
    )
    return {
        "member": {
            "id": str(member.id),
            "user_id": str(user_id),
            "role": member.role,
            "version": member.version,
        },
        "annotation_task_ids": sorted(str(tid) for tid in annotation_task_ids),
        "review_task_ids": sorted(str(tid) for tid in review_task_ids),
        "lock_task_ids": sorted(str(tid) for tid in lock_task_ids),
        "review_claim_task_ids": sorted(str(tid) for tid in review_claim_task_ids),
        "batch_annotator_ids": sorted(str(bid) for bid in batch_annotator_ids),
        "batch_reviewer_ids": sorted(str(bid) for bid in batch_reviewer_ids),
        "eligible_reviewer_ids": eligible_reviewer_ids,
    }


async def _validate_replacement(
    db: AsyncSession,
    *,
    project: Project,
    replacement_id: uuid.UUID | None,
    project_role: str,
) -> tuple[bool, dict[str, Any] | None]:
    if replacement_id is None:
        return False, None
    target = await db.get(User, replacement_id)
    if target is None or not target.is_active:
        return True, _blocker(f"invalid_replacement_{project_role}")
    if not membership_role_compatible(target.role, project_role):
        return True, _blocker(f"invalid_replacement_{project_role}")
    row = await db.execute(
        select(ProjectMember.id).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == replacement_id,
            ProjectMember.role == project_role,
        )
    )
    if row.scalar_one_or_none() is None:
        return True, _blocker(f"invalid_replacement_{project_role}")
    return True, None


async def evaluate_role_change(
    db: AsyncSession,
    *,
    project: Project,
    member: ProjectMember,
    target_role: str,
    replacement_annotator_id: uuid.UUID | None,
    replacement_reviewer_id: uuid.UUID | None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Return ``(snapshot, blocker_details)`` for a proposed role change.

    Read-only.  The same evaluation runs at preview and again under lock before
    the write, so a stale preview can never apply.
    """

    snapshot = await build_member_resource_snapshot(db, project=project, member=member)
    blockers: list[dict[str, Any]] = []

    if target_role == member.role:
        blockers.append(_blocker("same_role"))

    has_annotation_work = bool(
        snapshot["annotation_task_ids"] or snapshot["batch_annotator_ids"]
    )
    has_review_work = bool(
        snapshot["review_task_ids"] or snapshot["batch_reviewer_ids"]
    )

    annotation_replacement_ok, annotation_detail = await _validate_replacement(
        db,
        project=project,
        replacement_id=replacement_annotator_id,
        project_role=ProjectRole.ANNOTATOR.value,
    )
    reviewer_replacement_ok, reviewer_detail = await _validate_replacement(
        db,
        project=project,
        replacement_id=replacement_reviewer_id,
        project_role=ProjectRole.REVIEWER.value,
    )

    if (
        replacement_annotator_id is not None
        and replacement_reviewer_id is not None
        and replacement_annotator_id == replacement_reviewer_id
    ):
        blockers.append(_blocker("identical_replacement_responsibility"))

    if target_role != ProjectRole.ANNOTATOR.value and has_annotation_work:
        if annotation_detail is not None:
            blockers.append(annotation_detail)
        elif not annotation_replacement_ok:
            blockers.append(_blocker("unfinished_annotation_work"))

    if target_role != ProjectRole.REVIEWER.value and has_review_work:
        if reviewer_detail is not None:
            blockers.append(reviewer_detail)
        elif not reviewer_replacement_ok:
            blockers.append(_blocker("unfinished_review_work"))

    if snapshot["lock_task_ids"]:
        # Locks are released as part of an accepted mutation, but a viewer/target
        # transition with no handoff must not silently drop held work.
        if (
            target_role != member.role
            and not annotation_replacement_ok
            and not reviewer_replacement_ok
        ):
            blockers.append(
                _blocker("active_locks", task_ids=snapshot["lock_task_ids"])
            )

    if (
        member.role == ProjectRole.REVIEWER.value
        and target_role != ProjectRole.REVIEWER.value
        and has_review_work
        and not snapshot["eligible_reviewer_ids"]
        and not reviewer_replacement_ok
    ):
        blockers.append(_blocker("reviewer_coverage_lost"))

    return snapshot, blockers


async def add_member(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
    target_user_id: uuid.UUID,
    project_role: str,
) -> ProjectMember:
    """Add a compatible active account to the project (409 on duplicate)."""

    if project_role not in PROJECT_ROLES:
        raise HTTPException(status_code=400, detail="非法项目职责")
    await _lock_accounts_nowait(db, [actor.id, target_user_id])
    target = await db.get(User, target_user_id, populate_existing=True)
    if target is None or not target.is_active:
        raise HTTPException(status_code=404, detail="目标用户不存在")
    assert_membership_role_compatible(target.role, project_role)

    result = await db.execute(
        pg_insert(ProjectMember)
        .values(
            id=uuid.uuid4(),
            project_id=project.id,
            user_id=target_user_id,
            role=project_role,
            assigned_by=actor.id,
        )
        .on_conflict_do_nothing(index_elements=["project_id", "user_id"])
        .returning(ProjectMember.id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=409, detail="该用户已在项目中")

    member = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == target_user_id,
            )
        )
    ).scalar_one()
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.PROJECT_MEMBER_ADD,
        target_type="project_member",
        target_id=str(member.id),
        detail={
            "project_id": str(project.id),
            "user_id": str(target_user_id),
            "project_role": project_role,
            "platform_role": target.role,
        },
    )
    await db.commit()
    await db.refresh(member)
    return member


async def preview_role_change(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
    member_id: uuid.UUID,
    target_role: str,
    replacement_annotator_id: uuid.UUID | None,
    replacement_reviewer_id: uuid.UUID | None,
) -> dict[str, Any]:
    if target_role not in PROJECT_ROLES:
        raise HTTPException(status_code=400, detail="非法项目职责")
    member = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.id == member_id,
                ProjectMember.project_id == project.id,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="成员不存在")

    snapshot, blockers = await evaluate_role_change(
        db,
        project=project,
        member=member,
        target_role=target_role,
        replacement_annotator_id=replacement_annotator_id,
        replacement_reviewer_id=replacement_reviewer_id,
    )
    return {
        "member_id": member.id,
        "user_id": member.user_id,
        "current_role": member.role,
        "current_version": member.version,
        "target_role": target_role,
        "requires_handoff": bool(blockers),
        "blockers": [entry["code"] for entry in blockers],
        "blocker_details": blockers,
        "resource_snapshot": snapshot,
        "preview_token": _snapshot_token(snapshot),
    }


async def _release_member_project_locks(
    db: AsyncSession, *, project_id: uuid.UUID, user_id: uuid.UUID
) -> int:
    task_ids = await _active_lock_task_ids(db, project_id=project_id, user_id=user_id)
    if not task_ids:
        return 0
    await db.execute(
        delete(TaskLock).where(
            TaskLock.user_id == user_id,
            TaskLock.task_id.in_(task_ids),
        )
    )
    return len(task_ids)


async def _handoff_annotation_work(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    from_user_id: uuid.UUID,
    to_user_id: uuid.UUID,
) -> None:
    task_ids = await _annotation_task_ids(
        db, project_id=project_id, user_id=from_user_id
    )
    if task_ids:
        await db.execute(
            update(Task)
            .where(Task.id.in_(task_ids))
            .values(assignee_id=to_user_id, assignee_is_override=True)
        )
    await db.execute(
        update(TaskBatch)
        .where(
            TaskBatch.project_id == project_id,
            TaskBatch.annotator_id == from_user_id,
        )
        .values(annotator_id=to_user_id)
    )


async def _handoff_review_work(
    db: AsyncSession,
    *,
    project_id: uuid.UUID,
    from_user_id: uuid.UUID,
    to_user_id: uuid.UUID,
) -> None:
    task_ids = await _review_task_ids(db, project_id=project_id, user_id=from_user_id)
    if task_ids:
        await db.execute(
            update(Task)
            .where(Task.id.in_(task_ids))
            .values(
                reviewer_id=to_user_id,
                reviewer_is_override=True,
                reviewer_claimed_at=None,
            )
        )
    await db.execute(
        update(TaskBatch)
        .where(
            TaskBatch.project_id == project_id,
            TaskBatch.reviewer_id == from_user_id,
        )
        .values(reviewer_id=to_user_id)
    )


async def change_role(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
    member_id: uuid.UUID,
    target_role: str,
    expected_version: int,
    preview_token: str,
    reason: str,
    replacement_annotator_id: uuid.UUID | None,
    replacement_reviewer_id: uuid.UUID | None,
) -> ProjectMember:
    """Apply a role change with CAS, resource-snapshot revalidation and handoff."""

    if target_role not in PROJECT_ROLES:
        raise HTTPException(status_code=400, detail="非法项目职责")

    member = await _lock_membership_nowait(
        db, project_id=project.id, member_id=member_id
    )
    if member.version != expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "reason": "stale_member_version",
                "current_version": member.version,
            },
        )

    await _lock_accounts_nowait(
        db,
        [actor.id, member.user_id, replacement_annotator_id, replacement_reviewer_id],
    )
    # Re-read with fresh ORM state after the membership/account locks.
    member = await _lock_membership_nowait(
        db, project_id=project.id, member_id=member_id
    )
    if member.version != expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "reason": "stale_member_version",
                "current_version": member.version,
            },
        )

    snapshot, blockers = await evaluate_role_change(
        db,
        project=project,
        member=member,
        target_role=target_role,
        replacement_annotator_id=replacement_annotator_id,
        replacement_reviewer_id=replacement_reviewer_id,
    )
    if _snapshot_token(snapshot) != preview_token:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "reason": "stale_resource_snapshot",
                "detail": "资源已变化，请重新预览",
            },
        )
    if blockers:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "reason": "member_role_change_blocked",
                "blockers": blockers,
            },
        )

    old_role = member.role
    # Hand off responsibility the target role no longer carries.
    if (
        target_role != ProjectRole.ANNOTATOR.value
        and replacement_annotator_id is not None
    ):
        await _handoff_annotation_work(
            db,
            project_id=project.id,
            from_user_id=member.user_id,
            to_user_id=replacement_annotator_id,
        )
    if (
        target_role != ProjectRole.REVIEWER.value
        and replacement_reviewer_id is not None
    ):
        await _handoff_review_work(
            db,
            project_id=project.id,
            from_user_id=member.user_id,
            to_user_id=replacement_reviewer_id,
        )
    released = await _release_member_project_locks(
        db, project_id=project.id, user_id=member.user_id
    )

    member.role = target_role
    member.version = member.version + 1
    member.updated_at = _utcnow()

    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.PROJECT_MEMBER_ROLE_CHANGE,
        target_type="project_member",
        target_id=str(member.id),
        detail={
            "project_id": str(project.id),
            "user_id": str(member.user_id),
            "from_role": old_role,
            "to_role": target_role,
            "version": member.version,
            "reason": reason,
            "replacement_annotator_id": (
                str(replacement_annotator_id) if replacement_annotator_id else None
            ),
            "replacement_reviewer_id": (
                str(replacement_reviewer_id) if replacement_reviewer_id else None
            ),
            "released_lock_count": released,
        },
    )
    await db.commit()
    await db.refresh(member)
    return member


async def remove_member(
    db: AsyncSession,
    *,
    project: Project,
    actor: User,
    member_id: uuid.UUID,
) -> None:
    """Remove a member after the same blockers used by role change.

    An idle member is removed directly; outstanding work returns a 409 asking
    the caller to hand off first.  Assignments are never silently cleared.
    """

    member = await _lock_membership_nowait(
        db, project_id=project.id, member_id=member_id
    )
    snapshot, blockers = await evaluate_role_change(
        db,
        project=project,
        member=member,
        target_role=ProjectRole.VIEWER.value,
        replacement_annotator_id=None,
        replacement_reviewer_id=None,
    )
    blockers = [entry for entry in blockers if entry["code"] != "same_role"]
    if blockers:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"reason": "member_removal_blocked", "blockers": blockers},
        )

    await _release_member_project_locks(
        db, project_id=project.id, user_id=member.user_id
    )
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.PROJECT_MEMBER_REMOVE,
        target_type="project_member",
        target_id=str(member.id),
        detail={
            "project_id": str(project.id),
            "user_id": str(member.user_id),
            "project_role": member.role,
        },
    )
    await db.delete(member)
    await db.commit()
