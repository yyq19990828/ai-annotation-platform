import csv
import io
import json
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, update, delete
from pydantic import BaseModel

from app.config import settings
from app.deps import get_db, require_roles, get_current_user
from app.db.models.user import User
from app.db.enums import UserRole
from app.schemas.user import UserOut
from app.schemas.invitation import InvitationCreate, InvitationCreated
from app.services.invitation import InvitationService
from app.services.audit import AuditService, AuditAction

router = APIRouter()

_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)

# project_admin 可在 annotator ↔ reviewer 之间互改；不可造 project_admin / super_admin / viewer
_PA_ASSIGNABLE_ROLES = {UserRole.REVIEWER.value, UserRole.ANNOTATOR.value}


async def _count_active_super_admins(db: AsyncSession) -> int:
    return (
        await db.execute(
            select(func.count(User.id)).where(
                User.role == UserRole.SUPER_ADMIN.value,
                User.is_active.is_(True),
            )
        )
    ).scalar_one()


async def _project_admin_manages_target(
    db: AsyncSession, *, actor: User, target: User
) -> bool:
    """project_admin 是否在他所管的项目里 (project.owner_id == actor) 见过 target。"""
    from app.db.models.project import Project
    from app.db.models.project_member import ProjectMember

    q = (
        select(func.count(ProjectMember.id))
        .join(Project, Project.id == ProjectMember.project_id)
        .where(
            Project.owner_id == actor.id,
            ProjectMember.user_id == target.id,
        )
    )
    cnt = (await db.execute(q)).scalar_one()
    return cnt > 0


async def _target_only_in_actor_projects(
    db: AsyncSession, *, actor: User, target: User
) -> bool:
    """target 是否仅在 actor 管理的项目里出现（跨项目用户需上级处理）。"""
    from app.db.models.project import Project
    from app.db.models.project_member import ProjectMember

    q = (
        select(func.count(ProjectMember.id).label("c"))
        .join(Project, Project.id == ProjectMember.project_id)
        .where(
            ProjectMember.user_id == target.id,
            Project.owner_id != actor.id,
        )
    )
    foreign = (await db.execute(q)).scalar_one()
    return foreign == 0


@router.get("", response_model=list[UserOut])
async def list_users(
    role: str | None = None,
    project_id: UUID | None = Query(None, description="可选项目过滤；project_admin 入参被忽略，强制限定到其管理项目"),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    """用户列表。
    - super_admin：默认全量；可选 `project_id` 过滤到该项目成员。
    - project_admin：自动限定到 `Project.owner_id == actor.id` 的项目成员（actor 自身始终可见）。
    """
    from app.db.models.project import Project
    from app.db.models.project_member import ProjectMember

    q = select(User).where(User.is_active.is_(True))
    if role:
        q = q.where(User.role == role)

    if actor.role == UserRole.PROJECT_ADMIN.value:
        # 子查询：actor 管理项目内全部 member.user_id
        members_subq = (
            select(ProjectMember.user_id)
            .join(Project, Project.id == ProjectMember.project_id)
            .where(Project.owner_id == actor.id)
        )
        q = q.where(or_(User.id.in_(members_subq), User.id == actor.id))
    elif project_id is not None:
        # super_admin 显式按项目过滤
        members_subq = select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
        q = q.where(User.id.in_(members_subq))

    result = await db.execute(q.order_by(User.created_at.desc()))
    return result.scalars().all()


_ExportFormat = Literal["csv", "json"]


@router.get("/export")
async def export_users(
    format: _ExportFormat = Query("csv"),
    request: Request = None,  # type: ignore[assignment]
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    rows = (
        await db.execute(
            select(User).where(User.is_active.is_(True)).order_by(User.created_at.desc())
        )
    ).scalars().all()

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    if format == "json":
        payload = [
            {
                "id": str(u.id),
                "email": u.email,
                "name": u.name,
                "role": u.role,
                "group_name": u.group_name,
                "group_id": str(u.group_id) if u.group_id else None,
                "status": u.status,
                "created_at": u.created_at.isoformat(),
            }
            for u in rows
        ]
        body = json.dumps(payload, ensure_ascii=False, indent=2)
        await AuditService.log(
            db,
            actor=actor,
            action="user.export",
            target_type="user",
            target_id=None,
            request=request,
            status_code=200,
            detail={"format": "json", "count": len(rows)},
        )
        await db.commit()
        return StreamingResponse(
            iter([body]),
            media_type="application/json; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="users_{ts}.json"'},
        )

    # CSV
    buf = io.StringIO()
    # Excel UTF-8 BOM 兼容
    buf.write("﻿")
    writer = csv.writer(buf)
    writer.writerow(["id", "email", "name", "role", "group_name", "group_id", "status", "created_at"])
    for u in rows:
        writer.writerow([
            str(u.id),
            u.email,
            u.name,
            u.role,
            u.group_name or "",
            str(u.group_id) if u.group_id else "",
            u.status,
            u.created_at.isoformat(),
        ])
    body = buf.getvalue()

    await AuditService.log(
        db,
        actor=actor,
        action="user.export",
        target_type="user",
        target_id=None,
        request=request,
        status_code=200,
        detail={"format": "csv", "count": len(rows)},
    )
    await db.commit()
    return StreamingResponse(
        iter([body]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="users_{ts}.csv"'},
    )


@router.post(
    "/invite",
    response_model=InvitationCreated,
    status_code=status.HTTP_201_CREATED,
)
async def invite_user(
    payload: InvitationCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    inv = await InvitationService.create(
        db,
        email=payload.email,
        role=payload.role,
        group_name=payload.group_name,
        invited_by=actor.id,
    )
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.USER_INVITE,
        target_type="user",
        target_id=inv.email,
        request=request,
        status_code=201,
        detail={"role": inv.role, "group_name": inv.group_name},
    )
    await db.commit()

    invite_url = f"{settings.frontend_base_url.rstrip('/')}/register?token={inv.token}"
    return InvitationCreated(
        invite_url=invite_url,
        token=inv.token,
        expires_at=inv.expires_at,
    )


class RoleChangePayload(BaseModel):
    role: str


@router.patch("/{user_id}/role", response_model=UserOut)
async def change_user_role(
    user_id: str,
    payload: RoleChangePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    if payload.role not in {r.value for r in UserRole}:
        raise HTTPException(status_code=400, detail=f"非法角色: {payload.role}")

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == actor.id:
        raise HTTPException(status_code=400, detail="不能修改自己的角色")

    old_role = user.role
    new_role = payload.role
    if old_role == new_role:
        return user

    # —— project_admin 子集合：仅可在 reviewer / annotator / viewer 间切换，且 target 必须在其管的项目里 ——
    if actor.role == UserRole.PROJECT_ADMIN.value:
        if old_role not in _PA_ASSIGNABLE_ROLES or new_role not in _PA_ASSIGNABLE_ROLES:
            raise HTTPException(
                status_code=403,
                detail="项目管理员仅能在审核员 / 标注员 之间切换角色",
            )
        if not await _project_admin_manages_target(db, actor=actor, target=user):
            raise HTTPException(status_code=403, detail="该用户不在你管理的项目内")

    # —— super_admin 兜底：最后一名 super_admin 不可被降级 ——
    if old_role == UserRole.SUPER_ADMIN.value and new_role != UserRole.SUPER_ADMIN.value:
        if await _count_active_super_admins(db) <= 1:
            raise HTTPException(status_code=400, detail="不能降级最后一名超级管理员")

    user.role = new_role
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.USER_ROLE_CHANGE,
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=200,
        detail={"email": user.email, "old": old_role, "new": new_role},
    )
    await db.commit()
    await db.refresh(user)
    return user


class DeleteUserPayload(BaseModel):
    """可选转交目标 —— 当 target 仍持有未完成任务时必填。"""
    transfer_to_user_id: UUID | None = None


_PENDING_TASK_STATUSES = (
    "pending",
    "in_progress",
    "review",
)


async def _count_pending_tasks(db: AsyncSession, *, target_id: UUID) -> tuple[int, list[str]]:
    """返回 (pending_count, sample_task_ids[5])。"""
    from app.db.models.task import Task

    q = (
        select(Task.id)
        .where(Task.assignee_id == target_id)
        .where(Task.status.in_(_PENDING_TASK_STATUSES))
        .order_by(Task.created_at.desc())
    )
    rows = (await db.execute(q.limit(5))).scalars().all()
    cnt = (
        await db.execute(
            select(func.count(Task.id))
            .where(Task.assignee_id == target_id)
            .where(Task.status.in_(_PENDING_TASK_STATUSES))
        )
    ).scalar_one()
    return cnt, [str(r) for r in rows]


async def _count_task_locks(db: AsyncSession, *, target_id: UUID) -> int:
    from app.db.models.task_lock import TaskLock

    return (
        await db.execute(
            select(func.count(TaskLock.id)).where(TaskLock.user_id == target_id)
        )
    ).scalar_one()


@router.delete("/{user_id}", response_model=UserOut)
async def delete_user(
    user_id: str,
    request: Request,
    payload: DeleteUserPayload | None = Body(None),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    """软删除（is_active=False）。super_admin 可删任意（除自己/最后一名超管）；
    project_admin 仅可删其项目内、且仅在其项目里出现的 annotator / reviewer / viewer。

    若 target 仍持有未完成任务（assignee_id + status in pending/in_progress/review）或 task_lock，
    返回 409，要求传入 `transfer_to_user_id`；前端弹"先转交"二次 Modal。
    """
    from app.db.models.task import Task
    from app.db.models.task_lock import TaskLock

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == actor.id:
        raise HTTPException(status_code=400, detail="不能删除自己")
    if not user.is_active:
        return user

    if actor.role == UserRole.PROJECT_ADMIN.value:
        if user.role not in _PA_ASSIGNABLE_ROLES:
            raise HTTPException(status_code=403, detail="项目管理员仅能删除其项目内的标注员/审核员")
        if not await _project_admin_manages_target(db, actor=actor, target=user):
            raise HTTPException(status_code=403, detail="该用户不在你管理的项目内")
        if not await _target_only_in_actor_projects(db, actor=actor, target=user):
            raise HTTPException(
                status_code=403,
                detail="该用户跨多个项目，须由超级管理员处理",
            )

    if user.role == UserRole.SUPER_ADMIN.value:
        if await _count_active_super_admins(db) <= 1:
            raise HTTPException(status_code=400, detail="不能删除最后一名超级管理员")

    # —— 关联任务检查 + 可选转交 ——
    pending_count, sample_ids = await _count_pending_tasks(db, target_id=user.id)
    lock_count = await _count_task_locks(db, target_id=user.id)
    transfer_to: UUID | None = payload.transfer_to_user_id if payload else None

    if (pending_count > 0 or lock_count > 0) and transfer_to is None:
        raise HTTPException(
            status_code=409,
            detail={
                "reason": "has_pending_tasks",
                "pending_task_count": pending_count,
                "locked_task_count": lock_count,
                "sample_task_ids": sample_ids,
                "message": f"该用户当前有 {pending_count} 个未完成任务、{lock_count} 个锁定任务，需先转交",
            },
        )

    transferred_count = 0
    if transfer_to is not None:
        receiver = await db.get(User, transfer_to)
        if receiver is None or not receiver.is_active:
            raise HTTPException(status_code=400, detail="转交目标用户不存在或已禁用")
        if receiver.id == user.id:
            raise HTTPException(status_code=400, detail="转交目标不能与被删用户相同")
        if receiver.role not in _PA_ASSIGNABLE_ROLES and receiver.role != UserRole.PROJECT_ADMIN.value:
            raise HTTPException(status_code=400, detail="转交目标角色不合法")
        if actor.role == UserRole.PROJECT_ADMIN.value:
            # project_admin 只能在自己项目内转交
            if not await _project_admin_manages_target(db, actor=actor, target=receiver):
                raise HTTPException(status_code=403, detail="转交目标不在你管理的项目内")

        # 转交未完成任务
        result = await db.execute(
            update(Task)
            .where(Task.assignee_id == user.id)
            .where(Task.status.in_(_PENDING_TASK_STATUSES))
            .values(assignee_id=receiver.id)
        )
        transferred_count = result.rowcount or 0
        # 清除原 user 持有的所有 task_lock（释放锁，不转给 receiver）
        await db.execute(delete(TaskLock).where(TaskLock.user_id == user.id))

    user.is_active = False
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.USER_DELETE,
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=200,
        detail={
            "email": user.email,
            "role": user.role,
            "transferred_to": str(transfer_to) if transfer_to else None,
            "transferred_count": transferred_count,
            "released_locks": lock_count if transfer_to else 0,
        },
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/{user_id}/deactivate", response_model=UserOut)
async def deactivate_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == actor.id:
        raise HTTPException(status_code=400, detail="不能停用自己")
    if not user.is_active:
        return user

    if actor.role == UserRole.PROJECT_ADMIN.value:
        if user.role not in _PA_ASSIGNABLE_ROLES:
            raise HTTPException(status_code=403, detail="项目管理员仅能停用其项目内的标注员/审核员")
        if not await _project_admin_manages_target(db, actor=actor, target=user):
            raise HTTPException(status_code=403, detail="该用户不在你管理的项目内")
        if not await _target_only_in_actor_projects(db, actor=actor, target=user):
            raise HTTPException(status_code=403, detail="该用户跨多个项目，须由超级管理员处理")

    if user.role == UserRole.SUPER_ADMIN.value:
        if await _count_active_super_admins(db) <= 1:
            raise HTTPException(status_code=400, detail="不能停用最后一名超级管理员")

    user.is_active = False
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.USER_DEACTIVATE,
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=200,
        detail={"email": user.email},
    )
    await db.commit()
    await db.refresh(user)
    return user


class GroupAssignPayload(BaseModel):
    group_id: str | None = None


@router.patch("/{user_id}/group", response_model=UserOut)
async def assign_user_group(
    user_id: str,
    payload: GroupAssignPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(*_MANAGERS)),
):
    from app.db.models.group import Group

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail="用户不存在")

    new_group: Group | None = None
    if payload.group_id:
        new_group = await db.get(Group, payload.group_id)
        if new_group is None:
            raise HTTPException(status_code=404, detail="数据组不存在")

    old_group_id = user.group_id
    old_group_name = user.group_name
    user.group_id = new_group.id if new_group else None
    user.group_name = new_group.name if new_group else None

    await AuditService.log(
        db,
        actor=actor,
        action="user.group_change",
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=200,
        detail={
            "email": user.email,
            "old_group_id": str(old_group_id) if old_group_id else None,
            "old_group_name": old_group_name,
            "new_group_id": str(new_group.id) if new_group else None,
            "new_group_name": new_group.name if new_group else None,
        },
    )
    await db.commit()
    await db.refresh(user)
    return user
