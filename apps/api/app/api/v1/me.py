from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.deps import get_current_user, get_db
from app.db.models.audit_log import AuditLog
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.task import Task
from app.db.models.user import User
from app.schemas.me import PasswordChange, ProfileUpdate
from app.schemas.user import UserOut
from app.services.audit import AuditAction, AuditService

router = APIRouter()


@router.patch("", response_model=UserOut)
async def update_profile(
    payload: ProfileUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    old_name = user.name
    user.name = payload.name.strip()
    if not user.name:
        raise HTTPException(status_code=400, detail="姓名不能为空")

    if user.name != old_name:
        await AuditService.log(
            db,
            actor=user,
            action=AuditAction.USER_PROFILE_UPDATE,
            target_type="user",
            target_id=str(user.id),
            request=request,
            status_code=200,
            detail={"old_name": old_name, "new_name": user.name},
        )
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/notifications")
async def get_notifications(
    limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    返回与当前用户相关的审计通知（非自己操作的）。
    相关规则：
    - target_type=user, target_id=self → 被邀请 / 被改角色 / 被改组等
    - target_type=project, target_id 属于自己负责的项目
    - target_type=task, target_id ∈ assignee 是自己的任务 → approve/reject 通知
    - target_type=task, action=task.reopen, detail.original_reviewer_id == self → 标注员重开通知原审核员
    - 排除自己触发的操作（actor_id == self）
    """
    my_id_str = str(user.id)

    # 查自己负责的项目 id
    owner_rows = await db.execute(
        select(Project.id).where(Project.owner_id == user.id)
    )
    owned_ids = [str(r[0]) for r in owner_rows.all()]

    # 也收集自己作为成员的项目
    member_rows = await db.execute(
        select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
    )
    member_ids = [str(r[0]) for r in member_rows.all()]
    project_ids = list(set(owned_ids + member_ids))

    # v0.6.5 · 通知扩展：自己作为 assignee 的任务 + 自己作为原 reviewer 的 reopen 事件
    my_task_rows = await db.execute(
        select(Task.id).where(Task.assignee_id == user.id)
    )
    my_task_ids = [str(r[0]) for r in my_task_rows.all()]

    filters = [
        (AuditLog.target_type == "user") & (AuditLog.target_id == my_id_str),
    ]
    if project_ids:
        filters.append(
            (AuditLog.target_type == "project") & (AuditLog.target_id.in_(project_ids))
        )
    if my_task_ids:
        filters.append(
            (AuditLog.target_type == "task") & (AuditLog.target_id.in_(my_task_ids))
        )
    # 标注员重开 → 通知原 reviewer
    filters.append(
        (AuditLog.target_type == "task")
        & (AuditLog.action == "task.reopen")
        & (AuditLog.detail_json["original_reviewer_id"].astext == my_id_str)
    )

    rows = (
        await db.execute(
            select(AuditLog)
            .where(
                or_(*filters),
                AuditLog.actor_id != user.id,
            )
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    items = []
    for r in rows:
        items.append({
            "id": r.id,
            "action": r.action,
            "actor_email": r.actor_email,
            "actor_role": r.actor_role,
            "target_type": r.target_type,
            "target_id": r.target_id,
            "detail_json": r.detail_json,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {"items": items, "total": len(items)}


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: PasswordChange,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="原密码不正确")
    if payload.old_password == payload.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与原密码相同")

    user.password_hash = hash_password(payload.new_password)
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.USER_PASSWORD_CHANGE,
        target_type="user",
        target_id=str(user.id),
        request=request,
        status_code=204,
        detail={"email": user.email},
    )
    await db.commit()
    return None
