"""Account suspension, reactivation, and atomic work handoff.

The service keeps the preview and commit paths on the same snapshot builder.
The commit path locks the target and all currently referenced project, batch,
task, and lock rows before rebuilding the snapshot, so a stale preview cannot
silently apply a partial handoff.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import UserRole
from app.db.models.api_key import ApiKey
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.db.models.task_lock import TaskLock
from app.db.models.user import User
from app.schemas.user import (
    OffboardingCommitRequest,
    OffboardingPreview,
    OffboardingProjectRequest,
    OffboardingResult,
    OffboardingUnresolvedResult,
    OffboardingTransferResult,
    UserOut,
)
from app.services.audit import AuditAction, AuditService


ACTIVE_HANDOFF_STATUSES = ("pending", "in_progress", "review", "rejected")
REACTIVATABLE_KINDS = {"suspended", "emergency_suspended"}
HISTORICAL_KINDS = {"deleted", "historical_unknown"}
MANAGED_PROJECT_ROLES = ("annotator", "reviewer")


def lifecycle_user_out(user: User) -> UserOut:
    """Convert an ORM user without changing the response contract."""

    return UserOut.model_validate(user)


def set_disabled_metadata(
    user: User,
    *,
    kind: str,
    actor_id: uuid.UUID | None,
    reason: str | None,
    at: datetime | None = None,
) -> None:
    """Set all lifecycle fields together for every deactivation writer."""

    user.is_active = False
    user.disabled_kind = kind
    user.disabled_at = at or datetime.now(timezone.utc)
    user.disabled_by = actor_id
    user.disabled_reason = (reason or "").strip()[:500] or None


class UserLifecycleService:
    """Build and apply a versioned account offboarding snapshot."""

    @staticmethod
    async def _load_target(
        db: AsyncSession, target_id: uuid.UUID, *, for_update: bool = False
    ) -> User:
        stmt = select(User).where(User.id == target_id)
        if for_update:
            stmt = stmt.with_for_update()
        target = (await db.execute(stmt)).scalar_one_or_none()
        if target is None:
            raise HTTPException(status_code=404, detail="用户不存在")
        return target

    @staticmethod
    async def _project_ids_for_target(
        db: AsyncSession, target_id: uuid.UUID
    ) -> set[uuid.UUID]:
        member_ids = select(ProjectMember.project_id).where(
            ProjectMember.user_id == target_id
        )
        batch_ids = select(TaskBatch.project_id).where(
            or_(
                TaskBatch.annotator_id == target_id,
                TaskBatch.reviewer_id == target_id,
            )
        )
        task_ids = select(Task.project_id).where(
            or_(Task.assignee_id == target_id, Task.reviewer_id == target_id)
        )
        rows = await db.execute(
            select(Project.id).where(
                or_(
                    Project.owner_id == target_id,
                    Project.id.in_(member_ids),
                    Project.id.in_(batch_ids),
                    Project.id.in_(task_ids),
                )
            )
        )
        return {row[0] for row in rows.all()}

    @staticmethod
    async def _lock_task_scope(db: AsyncSession, task_id: uuid.UUID) -> None:
        # Keep this after the Task row lock. Annotation writes already use
        # Task -> advisory -> annotation; matching that order avoids a cycle.
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"aap:task-edit-lock:{task_id}"},
        )

    @classmethod
    async def _lock_snapshot_rows(cls, db: AsyncSession, target_id: uuid.UUID) -> None:
        """Lock resource rows in a stable order before execution recheck."""

        project_ids = await cls._project_ids_for_target(db, target_id)
        if project_ids:
            await db.execute(
                select(Project)
                .where(Project.id.in_(sorted(project_ids)))
                .order_by(Project.id)
                .with_for_update()
            )
            await db.execute(
                select(TaskBatch)
                .where(
                    TaskBatch.project_id.in_(sorted(project_ids)),
                    or_(
                        TaskBatch.annotator_id == target_id,
                        TaskBatch.reviewer_id == target_id,
                    ),
                )
                .order_by(TaskBatch.id)
                .with_for_update()
            )

        # Task rows are locked before the per-task advisory lock to match the
        # existing annotation write path. TaskLockService takes the advisory
        # lock before touching task_locks and never waits on Task rows.
        task_rows = await db.execute(
            select(Task)
            .where(or_(Task.assignee_id == target_id, Task.reviewer_id == target_id))
            .order_by(Task.id)
            .with_for_update()
        )
        task_ids = [task.id for task in task_rows.scalars().all()]
        for task_id in task_ids:
            await cls._lock_task_scope(db, task_id)

        await db.execute(
            select(TaskLock)
            .where(TaskLock.user_id == target_id)
            .order_by(TaskLock.id)
            .with_for_update()
        )

    @staticmethod
    async def _receiver_options(
        db: AsyncSession,
        *,
        project_id: uuid.UUID,
        target_id: uuid.UUID,
        role: str,
    ) -> list[dict[str, Any]]:
        if role == "owner":
            rows = (
                await db.execute(
                    select(User)
                    .where(
                        User.is_active.is_(True),
                        User.role == UserRole.PROJECT_ADMIN.value,
                        User.id != target_id,
                    )
                    .order_by(User.name, User.email, User.id)
                )
            ).scalars()
            return [
                {
                    "id": user.id,
                    "name": user.name,
                    "email": user.email,
                    "role": user.role,
                    "project_member_role": None,
                }
                for user in rows
            ]

        rows = (
            await db.execute(
                select(User, ProjectMember.role)
                .join(ProjectMember, ProjectMember.user_id == User.id)
                .where(
                    ProjectMember.project_id == project_id,
                    ProjectMember.role == role,
                    User.is_active.is_(True),
                    User.role == role,
                    User.id != target_id,
                )
                .order_by(User.name, User.email, User.id)
            )
        ).all()
        return [
            {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "role": user.role,
                "project_member_role": member_role,
            }
            for user, member_role in rows
        ]

    @staticmethod
    def _empty_task_counts() -> dict[str, int]:
        return {status_name: 0 for status_name in (*ACTIVE_HANDOFF_STATUSES, "locked")}

    @classmethod
    async def _collect_snapshot(
        cls, db: AsyncSession, target_id: uuid.UUID
    ) -> dict[str, Any]:
        target = await cls._load_target(db, target_id)
        project_ids = await cls._project_ids_for_target(db, target_id)
        projects = (
            list(
                (
                    await db.execute(
                        select(Project)
                        .where(Project.id.in_(sorted(project_ids)))
                        .order_by(Project.id)
                    )
                ).scalars()
            )
            if project_ids
            else []
        )

        members = list(
            (
                await db.execute(
                    select(ProjectMember)
                    .where(ProjectMember.user_id == target_id)
                    .order_by(ProjectMember.project_id, ProjectMember.role)
                )
            ).scalars()
        )
        batches = list(
            (
                await db.execute(
                    select(TaskBatch)
                    .where(
                        or_(
                            TaskBatch.annotator_id == target_id,
                            TaskBatch.reviewer_id == target_id,
                        ),
                        TaskBatch.status != "archived",
                    )
                    .order_by(TaskBatch.project_id, TaskBatch.id)
                )
            ).scalars()
        )
        tasks = list(
            (
                await db.execute(
                    select(Task)
                    .where(
                        or_(
                            Task.assignee_id == target_id, Task.reviewer_id == target_id
                        )
                    )
                    .order_by(Task.project_id, Task.id)
                )
            ).scalars()
        )
        locks = list(
            (
                await db.execute(
                    select(TaskLock)
                    .where(TaskLock.user_id == target_id)
                    .order_by(TaskLock.task_id, TaskLock.id)
                )
            ).scalars()
        )
        api_keys = list(
            (
                await db.execute(
                    select(ApiKey)
                    .where(ApiKey.user_id == target_id)
                    .order_by(ApiKey.created_at.desc(), ApiKey.id)
                )
            ).scalars()
        )

        member_roles: dict[uuid.UUID, set[str]] = defaultdict(set)
        for member in members:
            member_roles[member.project_id].add(member.role)
        batches_by_project: dict[uuid.UUID, list[TaskBatch]] = defaultdict(list)
        for batch in batches:
            batches_by_project[batch.project_id].append(batch)
        tasks_by_project: dict[uuid.UUID, list[Task]] = defaultdict(list)
        for task in tasks:
            tasks_by_project[task.project_id].append(task)
        locks_by_task: dict[uuid.UUID, int] = defaultdict(int)
        for lock in locks:
            locks_by_task[lock.task_id] += 1

        receivers: dict[str, dict[str, list[dict[str, Any]]]] = {}
        project_payload: list[dict[str, Any]] = []
        resource_state: dict[str, Any] = {
            "target": {
                "id": str(target.id),
                "is_active": target.is_active,
                "disabled_kind": target.disabled_kind,
                "disabled_at": target.disabled_at,
                "disabled_by": target.disabled_by,
                "disabled_reason": target.disabled_reason,
                "role": target.role,
            },
            "projects": [],
            "members": [],
            "batches": [],
            "tasks": [],
            "locks": [],
            "api_keys": [],
            "receivers": receivers,
        }
        for member in members:
            resource_state["members"].append(
                {
                    "id": str(member.id),
                    "project_id": str(member.project_id),
                    "role": member.role,
                }
            )
        for batch in batches:
            resource_state["batches"].append(
                {
                    "id": str(batch.id),
                    "project_id": str(batch.project_id),
                    "status": batch.status,
                    "annotator_id": str(batch.annotator_id)
                    if batch.annotator_id
                    else None,
                    "reviewer_id": str(batch.reviewer_id)
                    if batch.reviewer_id
                    else None,
                    "assigned_user_ids": list(batch.assigned_user_ids or []),
                }
            )
        for task in tasks:
            resource_state["tasks"].append(
                {
                    "id": str(task.id),
                    "project_id": str(task.project_id),
                    "batch_id": str(task.batch_id) if task.batch_id else None,
                    "status": task.status,
                    "assignee_id": str(task.assignee_id) if task.assignee_id else None,
                    "reviewer_id": str(task.reviewer_id) if task.reviewer_id else None,
                    "version": task.version,
                }
            )
        for lock in locks:
            resource_state["locks"].append(
                {
                    "id": str(lock.id),
                    "task_id": str(lock.task_id),
                    "expire_at": lock.expire_at,
                }
            )
        for key in api_keys:
            resource_state["api_keys"].append(
                {
                    "id": str(key.id),
                    "revoked_at": key.revoked_at,
                    "name": key.name,
                    "prefix": key.key_prefix,
                }
            )

        all_blockers: list[dict[str, str]] = []
        if not target.is_active and target.disabled_kind in HISTORICAL_KINDS:
            all_blockers.append(
                {
                    "code": "historical_inactive",
                    "message": "该账号的停用来源无法可靠判定，不能恢复或再次交接",
                }
            )
        for project in projects:
            role_payload: dict[str, dict[str, Any]] = {}
            project_blockers: list[dict[str, str]] = []
            for role in ("owner", "annotator", "reviewer"):
                role_batches = []
                if role == "owner":
                    present = project.owner_id == target_id
                elif role == "annotator":
                    role_batches = [
                        batch
                        for batch in batches_by_project[project.id]
                        if batch.annotator_id == target_id
                    ]
                    present = (
                        bool(role_batches)
                        or any(
                            task.assignee_id == target_id
                            for task in tasks_by_project[project.id]
                        )
                        or "annotator" in member_roles[project.id]
                    )
                else:
                    role_batches = [
                        batch
                        for batch in batches_by_project[project.id]
                        if batch.reviewer_id == target_id
                    ]
                    present = (
                        bool(role_batches)
                        or any(
                            task.reviewer_id == target_id
                            for task in tasks_by_project[project.id]
                        )
                        or "reviewer" in member_roles[project.id]
                    )

                opts = await cls._receiver_options(
                    db,
                    project_id=project.id,
                    target_id=target_id,
                    role=role,
                )
                receivers.setdefault(str(project.id), {})[role] = opts
                role_payload[role] = {
                    "present": present,
                    "batches": [
                        {"batch_id": batch.id, "batch_name": batch.name}
                        for batch in role_batches
                    ],
                    "receiver_options": opts,
                }
                if present and not opts:
                    code = f"no_{role}_receiver"
                    blocker = {
                        "code": code,
                        "message": f"项目「{project.name}」没有符合当前 {role} 权限的启用接收人",
                    }
                    project_blockers.append(blocker)
                    all_blockers.append(blocker)

            mismatched = {
                member_role
                for member_role in member_roles[project.id]
                if member_role != target.role
            }
            # A batch assignment can outlive a role change even when the
            # corresponding ProjectMember row was later removed. Treat either
            # source as a historic mixed-role anomaly instead of silently
            # choosing one responsibility.
            if any(
                (batch.annotator_id == target_id and target.role != "annotator")
                or (batch.reviewer_id == target_id and target.role != "reviewer")
                for batch in batches_by_project[project.id]
            ):
                mismatched.add("batch_assignment")
            if mismatched:
                blocker = {
                    "code": "historic_mixed_role",
                    "message": "该账号在项目成员或批次历史中同时出现不同职责，需人工核对",
                }
                project_blockers.append(blocker)
                all_blockers.append(blocker)

            task_counts: dict[str, dict[str, int]] = {
                "annotator": cls._empty_task_counts(),
                "reviewer": cls._empty_task_counts(),
            }
            for task in tasks_by_project[project.id]:
                if task.status not in ACTIVE_HANDOFF_STATUSES:
                    continue
                lock_count = locks_by_task.get(task.id, 0)
                if task.assignee_id == target_id:
                    task_counts["annotator"][task.status] += 1
                    task_counts["annotator"]["locked"] += lock_count
                if task.reviewer_id == target_id:
                    task_counts["reviewer"][task.status] += 1
                    task_counts["reviewer"]["locked"] += lock_count

            project_payload.append(
                {
                    "project_id": project.id,
                    "project_name": project.name,
                    "roles": role_payload,
                    "tasks": task_counts,
                    "blockers": project_blockers,
                }
            )
            resource_state["projects"].append(
                {
                    "id": str(project.id),
                    "owner_id": str(project.owner_id) if project.owner_id else None,
                }
            )

        canonical = json.dumps(resource_state, sort_keys=True, default=str).encode()
        version = hashlib.sha256(canonical).hexdigest()
        return {
            "target": target,
            "projects": projects,
            "batches": batches,
            "tasks": tasks,
            "locks": locks,
            "api_keys": api_keys,
            "members": members,
            "receivers": receivers,
            "project_payload": project_payload,
            "blockers": all_blockers,
            "version": version,
        }

    @classmethod
    async def preview(
        cls,
        db: AsyncSession,
        *,
        target_id: uuid.UUID,
        actor: User,
    ) -> OffboardingPreview:
        snapshot = await cls._collect_snapshot(db, target_id)
        await cls._assert_actor_scope(db, actor=actor, snapshot=snapshot)
        target = snapshot["target"]
        return OffboardingPreview(
            user=lifecycle_user_out(target),
            preview_version=snapshot["version"],
            generated_at=datetime.now(timezone.utc),
            projects=snapshot["project_payload"],
            api_keys=[
                {
                    "id": key.id,
                    "name": key.name,
                    "key_prefix": key.key_prefix,
                    "last_used_at": key.last_used_at,
                    "revoked_at": key.revoked_at,
                }
                for key in snapshot["api_keys"]
            ],
            blockers=snapshot["blockers"],
            can_commit=bool(
                (target.is_active or target.disabled_kind in REACTIVATABLE_KINDS)
                and not snapshot["blockers"]
                and target.disabled_kind not in HISTORICAL_KINDS
            ),
        )

    @staticmethod
    async def _assert_actor_scope(
        db: AsyncSession, *, actor: User, snapshot: dict[str, Any]
    ) -> None:
        target: User = snapshot["target"]
        if actor.id == target.id:
            raise HTTPException(status_code=400, detail="不能交接自己")
        if target.role == UserRole.SUPER_ADMIN.value:
            count = await db.scalar(
                select(func.count(User.id)).where(
                    User.role == UserRole.SUPER_ADMIN.value,
                    User.is_active.is_(True),
                )
            )
            if int(count or 0) <= 1:
                raise HTTPException(
                    status_code=400, detail="不能停用最后一名超级管理员"
                )
        if actor.role != UserRole.PROJECT_ADMIN.value:
            return
        if target.role not in MANAGED_PROJECT_ROLES:
            raise HTTPException(
                status_code=403,
                detail="项目管理员仅能处理其项目内的标注员/审核员",
            )
        projects: list[Project] = snapshot["projects"]
        if not projects or any(project.owner_id != actor.id for project in projects):
            raise HTTPException(
                status_code=403, detail="该用户存在不在你管理范围内的项目"
            )

    @staticmethod
    def _request_map(
        projects: Iterable[OffboardingProjectRequest],
    ) -> dict[uuid.UUID, OffboardingProjectRequest]:
        out: dict[uuid.UUID, OffboardingProjectRequest] = {}
        for project in projects:
            if project.project_id in out:
                raise HTTPException(
                    status_code=422, detail="同一项目不能重复提交交接映射"
                )
            out[project.project_id] = project
        return out

    @classmethod
    async def _validate_receiver(
        cls,
        db: AsyncSession,
        *,
        project_id: uuid.UUID,
        target_id: uuid.UUID,
        role: str,
        receiver_id: uuid.UUID | None,
        receiver_options: dict[str, list[dict[str, Any]]],
    ) -> None:
        if receiver_id is None:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "receiver_required",
                    "project_id": str(project_id),
                    "role": role,
                },
            )
        option_ids = {option["id"] for option in receiver_options.get(role, [])}
        if receiver_id not in option_ids:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "receiver_ineligible",
                    "project_id": str(project_id),
                    "role": role,
                    "receiver_id": str(receiver_id),
                },
            )

    @staticmethod
    def _conflict(snapshot: dict[str, Any], *, expected: str) -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "offboarding_preview_stale",
                "expected_preview_version": expected,
                "current_preview_version": snapshot["version"],
                "blockers": snapshot["blockers"],
            },
        )

    @classmethod
    async def offboard(
        cls,
        db: AsyncSession,
        *,
        target_id: uuid.UUID,
        actor: User,
        payload: OffboardingCommitRequest,
        request: Request | None = None,
    ) -> OffboardingResult:
        # Lock the target and every submitted receiver in one stable UUID order.
        # This prevents two concurrent handoffs (A -> B and B -> A) from
        # acquiring User locks in opposite orders. Missing receiver rows are
        # rejected after the target existence check and before any mutation.
        receiver_ids = {
            receiver_id
            for project in payload.projects
            for receiver_id in (
                project.owner_receiver_id,
                project.annotator_receiver_id,
                project.reviewer_receiver_id,
            )
            if receiver_id is not None
        }
        user_ids = sorted({target_id, *receiver_ids})
        locked_users = list(
            (
                await db.execute(
                    select(User)
                    .where(User.id.in_(user_ids))
                    .order_by(User.id)
                    .with_for_update()
                )
            ).scalars()
        )
        users_by_id = {user.id: user for user in locked_users}
        target = users_by_id.get(target_id)
        if target is None:
            raise HTTPException(status_code=404, detail="用户不存在")

        # Lock the concrete membership rows used to qualify submitted
        # receivers before rebuilding options. User row locks alone do not
        # protect a concurrent role/membership update.
        payload_project_ids = sorted(
            {project.project_id for project in payload.projects}
        )
        if payload_project_ids and receiver_ids:
            await db.execute(
                select(ProjectMember)
                .where(
                    ProjectMember.project_id.in_(payload_project_ids),
                    ProjectMember.user_id.in_(sorted(receiver_ids)),
                )
                .order_by(ProjectMember.project_id, ProjectMember.user_id)
                .with_for_update()
            )

        # All resource rows are now locked in a deterministic order. A second
        # snapshot is mandatory: the preview version is an optimistic
        # concurrency token, while row locks make execution validation and
        # mutation atomic.
        await cls._lock_snapshot_rows(db, target_id)
        snapshot = await cls._collect_snapshot(db, target_id)
        await cls._assert_actor_scope(db, actor=actor, snapshot=snapshot)
        if payload.preview_version != snapshot["version"]:
            raise cls._conflict(snapshot, expected=payload.preview_version)
        if not target.is_active and target.disabled_kind in HISTORICAL_KINDS:
            raise HTTPException(
                status_code=409, detail="历史未知或已删除账号不可再次交接"
            )
        if not target.is_active and target.disabled_kind not in REACTIVATABLE_KINDS:
            raise HTTPException(status_code=409, detail="账号当前状态不可交接")

        project_requests = cls._request_map(payload.projects)
        if payload.mode == "handoff":
            for project_payload in snapshot["project_payload"]:
                project_id = project_payload["project_id"]
                req = project_requests.get(project_id)
                if req is None:
                    req = OffboardingProjectRequest(project_id=project_id)
                role_opts = snapshot["receivers"].get(str(project_id), {})
                for role in ("owner", "annotator", "reviewer"):
                    role_info = project_payload["roles"][role]
                    if not role_info["present"]:
                        continue
                    receiver_id = getattr(req, f"{role}_receiver_id")
                    await cls._validate_receiver(
                        db,
                        project_id=project_id,
                        target_id=target_id,
                        role=role,
                        receiver_id=receiver_id,
                        receiver_options=role_opts,
                    )
            if snapshot["blockers"]:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "offboarding_blocked",
                        "blockers": snapshot["blockers"],
                    },
                )

        now = datetime.now(timezone.utc)
        transfers: list[OffboardingTransferResult] = []
        unresolved: list[OffboardingUnresolvedResult] = []
        revoked_key_ids: list[uuid.UUID] = []
        if payload.mode == "emergency_suspend":
            for project_payload in snapshot["project_payload"]:
                project_id = project_payload["project_id"]
                project_tasks = [
                    task
                    for task in snapshot["tasks"]
                    if task.project_id == project_id
                    and task.status in ACTIVE_HANDOFF_STATUSES
                ]
                project_batch_ids = [
                    batch.id
                    for batch in snapshot["batches"]
                    if batch.project_id == project_id
                ]
                project_lock_count = sum(
                    1
                    for lock in snapshot["locks"]
                    if any(task.id == lock.task_id for task in project_tasks)
                )
                for role in ("owner", "annotator", "reviewer"):
                    if not project_payload["roles"][role]["present"]:
                        continue
                    task_count = sum(
                        1
                        for task in project_tasks
                        if (role == "annotator" and task.assignee_id == target_id)
                        or (role == "reviewer" and task.reviewer_id == target_id)
                    )
                    unresolved.append(
                        OffboardingUnresolvedResult(
                            project_id=project_id,
                            role=role,
                            reason="emergency_suspension_requires_later_handoff",
                            batch_ids=project_batch_ids
                            if role in {"annotator", "reviewer"}
                            else [],
                            task_count=task_count,
                            lock_count=project_lock_count if role != "owner" else 0,
                        )
                    )
            set_disabled_metadata(
                target,
                kind="emergency_suspended",
                actor_id=actor.id,
                reason=payload.reason,
                at=now,
            )
        else:
            for project_payload in snapshot["project_payload"]:
                project_id = project_payload["project_id"]
                req = project_requests.get(project_id) or OffboardingProjectRequest(
                    project_id=project_id
                )
                project = next(
                    project
                    for project in snapshot["projects"]
                    if project.id == project_id
                )
                for role in ("owner", "annotator", "reviewer"):
                    if not project_payload["roles"][role]["present"]:
                        continue
                    receiver_id = getattr(req, f"{role}_receiver_id")
                    batches = [
                        batch
                        for batch in snapshot["batches"]
                        if batch.project_id == project_id
                        and (
                            (role == "annotator" and batch.annotator_id == target_id)
                            or (role == "reviewer" and batch.reviewer_id == target_id)
                        )
                    ]
                    role_tasks = [
                        task
                        for task in snapshot["tasks"]
                        if task.project_id == project_id
                        and task.status in ACTIVE_HANDOFF_STATUSES
                        and (
                            (role == "annotator" and task.assignee_id == target_id)
                            or (role == "reviewer" and task.reviewer_id == target_id)
                        )
                    ]
                    task_ids = {task.id for task in role_tasks}
                    role_lock_count = sum(
                        1 for lock in snapshot["locks"] if lock.task_id in task_ids
                    )
                    batch_ids = [batch.id for batch in batches]
                    if role == "owner":
                        project.owner_id = receiver_id
                        batch_ids = []
                        task_count = 0
                    else:
                        for batch in batches:
                            if role == "annotator":
                                batch.annotator_id = receiver_id
                            else:
                                batch.reviewer_id = receiver_id
                            assigned = [
                                str(batch.annotator_id) if batch.annotator_id else None,
                                str(batch.reviewer_id) if batch.reviewer_id else None,
                            ]
                            batch.assigned_user_ids = [
                                value for value in assigned if value
                            ]
                        for task in role_tasks:
                            if role == "annotator":
                                task.assignee_id = receiver_id
                                task.assigned_at = func.now()
                            else:
                                task.reviewer_id = receiver_id
                        task_count = len(role_tasks)
                    transfers.append(
                        OffboardingTransferResult(
                            project_id=project_id,
                            role=role,
                            receiver_id=receiver_id,
                            batch_ids=batch_ids,
                            task_count=task_count,
                            lock_count=role_lock_count,
                        )
                    )
            set_disabled_metadata(
                target,
                kind="suspended",
                actor_id=actor.id,
                reason=payload.reason,
                at=now,
            )

        # API keys are account resources. Authentication already checks
        # is_active, but revocation makes the offboarding result explicit and
        # ensures reactivation can never resurrect an old credential.
        for key in snapshot["api_keys"]:
            if key.revoked_at is None:
                key.revoked_at = now
                revoked_key_ids.append(key.id)
        await db.execute(delete(TaskLock).where(TaskLock.user_id == target_id))
        audit = await AuditService.log(
            db,
            actor=actor,
            action=AuditAction.USER_OFFBOARD,
            target_type="user",
            target_id=str(target.id),
            request=request,
            status_code=200,
            detail={
                "mode": payload.mode,
                "reason_present": bool(payload.reason.strip()),
                "transfers": [
                    transfer.model_dump(mode="json") for transfer in transfers
                ],
                "unresolved": [item.model_dump(mode="json") for item in unresolved],
                "revoked_api_key_count": len(revoked_key_ids),
            },
        )
        await db.flush()
        return OffboardingResult(
            user=lifecycle_user_out(target),
            status="suspended",
            mode=payload.mode,
            transfers=transfers,
            unresolved=unresolved,
            revoked_api_key_ids=revoked_key_ids,
            audit_id=audit.id,
        )

    @classmethod
    async def reactivate(
        cls,
        db: AsyncSession,
        *,
        target_id: uuid.UUID,
        actor: User,
        reason: str | None,
        request: Request | None = None,
    ) -> UserOut:
        target = await cls._load_target(db, target_id, for_update=True)
        if actor.id == target.id:
            raise HTTPException(status_code=400, detail="不能恢复自己")
        if actor.role == UserRole.PROJECT_ADMIN.value:
            if target.role not in MANAGED_PROJECT_ROLES:
                raise HTTPException(status_code=403, detail="项目管理员不能恢复该角色")
            project_ids = await cls._project_ids_for_target(db, target.id)
            if not project_ids:
                raise HTTPException(status_code=403, detail="该用户不在你管理的项目内")
            owned = await db.scalars(
                select(Project.id).where(
                    Project.id.in_(sorted(project_ids))
                    if project_ids
                    else text("false"),
                    Project.owner_id == actor.id,
                )
            )
            if set(owned.all()) != project_ids:
                raise HTTPException(
                    status_code=403, detail="该用户存在不在你管理范围内的项目"
                )
        if target.is_active:
            raise HTTPException(status_code=409, detail="账号当前已启用")
        if target.disabled_kind not in REACTIVATABLE_KINDS:
            raise HTTPException(status_code=409, detail="该停用状态不可恢复")
        target.is_active = True
        target.disabled_kind = None
        target.disabled_at = None
        target.disabled_by = None
        target.disabled_reason = None
        await AuditService.log(
            db,
            actor=actor,
            action=AuditAction.USER_REACTIVATE,
            target_type="user",
            target_id=str(target.id),
            request=request,
            status_code=200,
            detail={"reason_present": bool((reason or "").strip())},
        )
        await db.flush()
        return lifecycle_user_out(target)
