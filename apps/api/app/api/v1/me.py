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
    return UserPreferences.model_validate(
        _strip_removed_workbench_keys(user.preferences or {})
    )


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


# v0.16 移除 · 已从 schema 移除、但存量 JSONB 仍可能残留的 workbench.layout 旧键。
# 0105 迁移已批量清除；这里作为运行期安全网，防迁移未跑 / 灰度 / 回滚时
# GET/PATCH /me/preferences 因 WorkbenchLayoutPreferences(extra="forbid") 直接 422。
_REMOVED_WORKBENCH_LAYOUT_KEYS = ("leftWidth", "rightWidth")


def _deep_merge_preferences(existing: dict, incoming: dict) -> dict:
    """把 incoming 深合并到 existing 的副本: dict 递归、其它类型 (list / scalar) 直接覆盖。

    动机: pydantic exclude_unset PATCH 只带用户本次改的键, 顶层浅合并会让"改一个字段=
    整棵子树被 incoming 替换"→ 相邻字段被吹没 (v0.20.19 修过 ui/theme × secondary_bar_hidden
    的同源 bug)。深合并让 workbench.layout.attrPanelCollapsed 单键 PATCH 不冲掉 layout 其他
    字段, ai.secondary_by_model 里单 backend 桶 PATCH 也不冲掉其它 backend 的偏好。

    注: list 直接覆盖 (合并语义不确定), 前端如需增删列表元素应提交完整列表。
    """
    out: dict = dict(existing)
    for k, v in incoming.items():
        cur = out.get(k)
        if isinstance(v, dict) and isinstance(cur, dict):
            out[k] = _deep_merge_preferences(cur, v)
        else:
            out[k] = v
    return out


def _strip_removed_workbench_keys(prefs: dict) -> dict:
    """剥除 workbench.layout 里已移除的边栏像素宽度旧键（leftWidth/rightWidth）。

    不可变：命中旧键时返回浅拷贝（含清理后的 layout），否则原样返回入参。
    v0.16 连同 0105 迁移窗口期一并移除。"""
    workbench = prefs.get("workbench")
    if not isinstance(workbench, dict):
        return prefs
    layout = workbench.get("layout")
    if not isinstance(layout, dict) or not any(
        key in layout for key in _REMOVED_WORKBENCH_LAYOUT_KEYS
    ):
        return prefs
    clean_layout = {
        key: value
        for key, value in layout.items()
        if key not in _REMOVED_WORKBENCH_LAYOUT_KEYS
    }
    return {**prefs, "workbench": {**workbench, "layout": clean_layout}}


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

    入参收 raw dict：先过 legacy 平铺键提升器 + 移除键剥离器（均 v0.16 移除）再手动走
    pydantic 校验，校验失败按 FastAPI 原生 422 形态抛出。"""
    promoted = _strip_removed_workbench_keys(_promote_legacy_workbench_keys(payload))
    try:
        validated = UserPreferences.model_validate(promoted)
    except ValidationError as exc:
        # 只透传 JSON 可序列化字段：pydantic 的 err["ctx"] 可能含 ValueError 等
        # 非可序列化对象，整条 **err 透传会让 FastAPI 兜底编码 422 体时 500。
        raise RequestValidationError(
            [
                {
                    "type": err["type"],
                    "loc": ("body", *err["loc"]),
                    "msg": err["msg"],
                    "input": err.get("input"),
                }
                for err in exc.errors()
            ]
        ) from exc
    incoming = validated.model_dump(mode="json", exclude_unset=True, by_alias=True)
    # 通用深度合并: dict 递归合并子键, 其它类型 (list/scalar) 直接覆盖。
    # 覆盖历史上按需增加的两层浅合并 (ai.* / ui.*): 现在 workbench 子树 (layout / common /
    # image / video / pointcloud) 与 ai.secondary_by_model (深度 2) 都能守住"单键 PATCH
    # 不冲掉同层邻居"的不变量, 前端任一 debounce writer 提交自己那半子键即可。
    existing = user.preferences or {}
    merged = _deep_merge_preferences(existing, incoming)
    merged = _strip_removed_workbench_keys(merged)
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
