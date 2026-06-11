from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.deps import get_current_user, get_db
from app.db.models.user import User
from app.schemas.me import PasswordChange, ProfileUpdate
from app.schemas.user import UserOut, UserPreferences
from app.services.audit import AuditAction, AuditService
from app.services.deactivation_service import DeactivationService

router = APIRouter()


@router.post("/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
async def heartbeat(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """v0.8.3 · 在线状态心跳。

    前端每 30s 调一次（document.visibilityState === 'visible' 时），刷新
    last_seen_at 与 status='online'。Celery beat `mark_inactive_offline` 任务
    据 last_seen_at 把超 OFFLINE_THRESHOLD_MINUTES 的用户置 offline。
    """
    user.last_seen_at = datetime.now(timezone.utc)
    if user.status != "online":
        user.status = "online"
    await db.commit()
    return None


class DeactivationRequest(BaseModel):
    """v0.8.1 · 自助注销申请：可附原因（≤500 字符）。"""

    reason: str | None = Field(default=None, max_length=500)


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
    # v0.8.1 · 管理员重置后用户自助改密 → 清空标志，恢复正常状态
    user.password_admin_reset_at = None
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


@router.post("/deactivation-request", response_model=UserOut)
async def request_self_deactivation(
    payload: DeactivationRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """v0.8.1 · 自助注销申请。7 天冷静期，期间可撤销。"""
    await DeactivationService.request(
        db, user=user, reason=payload.reason, request=request
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/preferences", response_model=UserPreferences)
async def get_preferences(user: User = Depends(get_current_user)) -> UserPreferences:
    """v0.9.41 · 读取当前用户的标注偏好。空字段走 schema 默认值。"""
    return UserPreferences.model_validate(user.preferences or {})


# v0.16 移除 · v0.15.3 把 workbench 平铺键拆为 common/image 子树后，部署窗口期内
# 已打开的旧前端 tab 仍会 PATCH 平铺键；在 pydantic 校验前把已知旧键提升到对应子树。
_LEGACY_WORKBENCH_KEYS: dict[str, str] = {
    "smoothImage": "image",
    "cssImageFilter": "image",
    "controlPointsSize": "image",
    "snapToGrid": "image",
    "longTaskSampleRate": "common",
}


def _promote_legacy_workbench_keys(payload: dict) -> dict:
    """把 workbench 子树里的旧平铺键提升到对应子树；新旧位置同时出现以新子树值为准。

    v0.16 移除（连同 _LEGACY_WORKBENCH_KEYS 与 update_preferences 的调用点）。"""
    workbench = payload.get("workbench")
    if not isinstance(workbench, dict) or not any(
        key in workbench for key in _LEGACY_WORKBENCH_KEYS
    ):
        return payload
    workbench = dict(workbench)
    for key, subtree_key in _LEGACY_WORKBENCH_KEYS.items():
        if key not in workbench:
            continue
        subtree = workbench.get(subtree_key)
        if subtree is not None and not isinstance(subtree, dict):
            # 子树类型非法：不动，留给 pydantic 校验报错
            continue
        value = workbench.pop(key)
        merged_subtree = dict(subtree or {})
        merged_subtree.setdefault(key, value)
        workbench[subtree_key] = merged_subtree
    return {**payload, "workbench": workbench}


@router.patch("/preferences", response_model=UserPreferences)
async def update_preferences(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserPreferences:
    """更新 preferences，按顶层子树（workbench / ai）合并，未提交的子树保持不变。

    pydantic forbid extra 防脏写入。改为子树级合并（而非整体替换）后，工作台渲染偏好与
    AI 工具参数偏好可各自独立保存，互不覆盖。workbench 内部仍由前端提交全量子树；
    单独 PATCH layout 会覆盖旧 workbench 渲染字段。

    入参收 raw dict：先过 legacy 平铺键提升器（v0.16 移除）再手动走 pydantic 校验，
    校验失败按 FastAPI 原生 422 形态抛出。"""
    promoted = _promote_legacy_workbench_keys(payload)
    try:
        validated = UserPreferences.model_validate(promoted)
    except ValidationError as exc:
        raise RequestValidationError(
            [{**err, "loc": ("body", *err["loc"])} for err in exc.errors()]
        ) from exc
    incoming = validated.model_dump(mode="json", exclude_unset=True, by_alias=True)
    merged = {**(user.preferences or {}), **incoming}
    user.preferences = merged
    await db.commit()
    return UserPreferences.model_validate(merged)


@router.delete("/deactivation-request", response_model=UserOut)
async def cancel_self_deactivation(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """v0.8.1 · 冷静期内撤销自助注销申请。"""
    await DeactivationService.cancel(db, user=user, request=request)
    await db.commit()
    await db.refresh(user)
    return user


# v0.8.4 · 工作台 task_events 批量写入
from app.config import settings  # noqa: E402
from app.schemas.task_event import TaskEventBatchIn, TaskEventBatchOut  # noqa: E402


def _enqueue_task_events(payload_list: list[dict]) -> bool:
    """投递到 Celery；broker 不可用时返回 False 让上层 fallback。"""
    try:
        from app.workers.task_events import persist_task_events_batch

        persist_task_events_batch.delay(payload_list)
        return True
    except Exception:  # pragma: no cover - defensive
        return False


@router.post("/task-events:batch", response_model=TaskEventBatchOut)
async def submit_task_events(
    payload: TaskEventBatchIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """v0.8.4 · 工作台 useSessionStats 每 N 条 flush 此端点。
    user_id 强制设为当前登录用户（即使前端误传也覆盖）。"""
    import uuid as _uuid

    payload_list: list[dict] = []
    for ev in payload.events:
        payload_list.append(
            {
                "id": str(ev.client_id or _uuid.uuid4()),
                "task_id": str(ev.task_id),
                "user_id": str(user.id),
                "project_id": str(ev.project_id),
                "kind": ev.kind,
                "started_at": ev.started_at.isoformat(),
                "ended_at": ev.ended_at.isoformat(),
                "duration_ms": ev.duration_ms,
                "annotation_count": ev.annotation_count,
                "was_rejected": ev.was_rejected,
            }
        )

    queued = False
    if settings.task_events_async:
        queued = _enqueue_task_events(payload_list)

    if not queued:
        from app.db.models.task_event import TaskEvent

        for ev in payload.events:
            db.add(
                TaskEvent(
                    id=ev.client_id or _uuid.uuid4(),
                    task_id=ev.task_id,
                    user_id=user.id,
                    project_id=ev.project_id,
                    kind=ev.kind,
                    started_at=ev.started_at,
                    ended_at=ev.ended_at,
                    duration_ms=ev.duration_ms,
                    annotation_count=ev.annotation_count,
                    was_rejected=ev.was_rejected,
                )
            )
        await db.commit()

    return TaskEventBatchOut(accepted=len(payload_list), queued_async=queued)
