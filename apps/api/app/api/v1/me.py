from datetime import datetime, timezone
from math import isfinite

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.deps import get_current_user, get_db
from app.db.models.user import User
from app.schemas.me import PasswordChange, ProfileUpdate
from app.schemas.user import UserOut, UserPreferences, UserPreferencesRead
from app.schemas.workbench_workspace import (
    MAX_NAMED_PRESETS,
    NamedWorkspacePreset,
    PresetId,
)
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


@router.get("/preferences", response_model=UserPreferencesRead)
async def get_preferences(user: User = Depends(get_current_user)) -> JSONResponse:
    """v0.9.41 · 读取当前用户的标注偏好。空字段走 schema 默认值。"""
    return _preferences_response(user.preferences or {})


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


_ATOMIC_PREFERENCE_MAP_PATHS = {
    ("workbench", "layout", "cameraPanels"),
    # 命名布局预设按整份清单提交；递归合并会让被删掉的那条永远留在库里。
    ("workbench", "layout", "workspace", "namedPresets"),
}
_WORKSPACE_CONTEXTS_PATH = ("workbench", "layout", "workspace", "contexts")
_WORKSPACE_PATH = ("workbench", "layout", "workspace")
_NAMED_PRESET_ADAPTER = TypeAdapter(dict[PresetId, NamedWorkspacePreset])


def _becomes_null_in_javascript(value) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return not isfinite(float(value))
    except OverflowError:
        return True


def _same_json_value(left, right) -> bool:
    """Compare JSON recursively without Python's bool/int equality coercion."""
    if left is None and _becomes_null_in_javascript(right):
        # JSON.stringify replaces a binary64 Infinity with null. The caller will
        # restore the stored opaque value rather than persisting that lossy form.
        return True
    if type(left) in (int, float) and type(right) in (int, float):
        # JSON has one number type. A browser round-trip may turn JSONB 1.0 into
        # 1 or normalize integers outside JavaScript's safe range. Comparing as
        # binary64 accepts that transport loss, then the caller restores the
        # actual stored value; booleans remain distinct from both forms.
        try:
            return float(left) == float(right)
        except OverflowError:
            return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(
            _same_json_value(value, right[key]) for key, value in left.items()
        )
    if isinstance(left, list):
        return len(left) == len(right) and all(
            _same_json_value(a, b) for a, b in zip(left, right, strict=True)
        )
    return left == right


def _duplicate_preset_name_groups(presets: dict) -> dict[str, frozenset[str]]:
    """Return trimmed names shared by multiple raw preset entries."""
    ids_by_name: dict[str, set[str]] = {}
    for preset_id, preset in presets.items():
        if not isinstance(preset_id, str) or not isinstance(preset, dict):
            continue
        name = preset.get("name")
        if isinstance(name, str):
            ids_by_name.setdefault(name.strip(), set()).add(preset_id)
    return {
        name: frozenset(preset_ids)
        for name, preset_ids in ids_by_name.items()
        if len(preset_ids) > 1
    }


def _workspace_value(prefs: dict) -> dict | None:
    value = prefs
    for key in _WORKSPACE_PATH:
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value if isinstance(value, dict) else None


def _with_workspace(prefs: dict, workspace: dict) -> dict:
    workbench = dict(prefs["workbench"])
    layout = dict(workbench["layout"])
    layout["workspace"] = workspace
    workbench["layout"] = layout
    return {**prefs, "workbench": workbench}


def _prepare_workspace_validation(
    payload: dict, existing: dict
) -> tuple[dict, dict[str, object], bool, bool]:
    """Validate current entries strictly while carrying stored opaque entries verbatim."""
    workspace = _workspace_value(payload)
    if workspace is None:
        return payload, {}, False, False
    stored_workspace = _workspace_value(existing)
    stored_engine = stored_workspace.get("engine") if stored_workspace else None
    engine_supplied = "engine" in workspace
    if (
        engine_supplied
        and stored_engine is not None
        and stored_engine != "dockview@8"
        and workspace["engine"] != stored_engine
    ):
        raise HTTPException(status_code=409, detail="layout_engine_downgrade")

    validation_workspace = dict(workspace)
    preset_only = "namedPresets" in workspace and set(workspace) == {"namedPresets"}
    if not engine_supplied and preset_only:
        # The response model requires an engine, while a preset-only PATCH must
        # leave an existing (possibly newer) enclosing engine untouched.
        validation_workspace["engine"] = "dockview@8"

    opaque: dict[str, object] = {}
    incoming_presets = workspace.get("namedPresets")
    stored_presets = (
        stored_workspace.get("namedPresets", {}) if stored_workspace else {}
    )
    if isinstance(incoming_presets, dict) and isinstance(stored_presets, dict):
        incoming_keys = set(incoming_presets)
        stored_keys = set(stored_presets)
        over_limit_compat = (
            len(incoming_presets) > MAX_NAMED_PRESETS and incoming_keys <= stored_keys
        )
        if len(incoming_presets) > MAX_NAMED_PRESETS and not over_limit_compat:
            # Keep the raw map in the validation payload so Pydantic reports the
            # normal max-length 422. Compatibility never permits adding a key to
            # an already over-limit map.
            return (
                _with_workspace(payload, validation_workspace),
                {},
                engine_supplied,
                stored_workspace is not None,
            )

        incoming_duplicates = _duplicate_preset_name_groups(incoming_presets)
        stored_duplicates = _duplicate_preset_name_groups(stored_presets)
        if any(
            stored_duplicates.get(name) is None
            or not preset_ids <= stored_duplicates[name]
            for name, preset_ids in incoming_duplicates.items()
        ):
            # Do not hide a newly introduced duplicate from the workspace-level
            # uniqueness validator, including collisions with opaque entries.
            # A strict subset is allowed so repeated single-entry deletions can
            # repair a pre-existing duplicate group.
            return (
                _with_workspace(payload, validation_workspace),
                {},
                engine_supplied,
                stored_workspace is not None,
            )
        preserved_duplicate_ids = (
            set().union(*incoming_duplicates.values()) if incoming_duplicates else set()
        )

        strict: dict[str, object] = {}
        for preset_id, preset in incoming_presets.items():
            unchanged = preset_id in stored_presets and _same_json_value(
                preset, stored_presets[preset_id]
            )
            if unchanged and (
                over_limit_compat or preset_id in preserved_duplicate_ids
            ):
                opaque[preset_id] = stored_presets[preset_id]
                continue
            try:
                _NAMED_PRESET_ADAPTER.validate_python({preset_id: preset})
            except ValidationError:
                if unchanged:
                    # Restore the actual stored object after validation rather
                    # than a browser-normalized equivalent (for example 1 vs 1.0).
                    opaque[preset_id] = stored_presets[preset_id]
                else:
                    # Keep new or modified invalid values in the validation
                    # payload so the normal Pydantic 422 identifies them.
                    strict[preset_id] = preset
            else:
                strict[preset_id] = preset
        validation_workspace["namedPresets"] = strict

    return (
        _with_workspace(payload, validation_workspace),
        opaque,
        engine_supplied,
        stored_workspace is not None,
    )


def _deep_merge_preferences(
    existing: dict, incoming: dict, *, _path: tuple[str, ...] = ()
) -> dict:
    """把 incoming 深合并到 existing 的副本: dict 递归、其它类型 (list / scalar) 直接覆盖。

    动机: pydantic exclude_unset PATCH 只带用户本次改的键, 顶层浅合并会让"改一个字段=
    整棵子树被 incoming 替换"→ 相邻字段被吹没 (v0.20.19 修过 ui/theme × secondary_bar_hidden
    的同源 bug)。深合并让 workbench.layout.attrPanelCollapsed 单键 PATCH 不冲掉 layout 其他
    字段, ai.secondary_by_model 里单 backend 桶 PATCH 也不冲掉其它 backend 的偏好。

    注: list 直接覆盖 (合并语义不确定), 前端如需增删列表元素应提交完整列表。
    workbench.layout.cameraPanels 是按 role 提交的完整 map；缺失 role 表示删除
    其自定义状态，故该路径不能递归合并。
    """
    out: dict = dict(existing)
    for k, v in incoming.items():
        cur = out.get(k)
        path = (*_path, k)
        if path in _ATOMIC_PREFERENCE_MAP_PATHS or _path == _WORKSPACE_CONTEXTS_PATH:
            out[k] = v
        elif isinstance(v, dict) and isinstance(cur, dict):
            out[k] = _deep_merge_preferences(cur, v, _path=path)
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


def _preferences_response(prefs: dict) -> JSONResponse:
    """Keep stored workspace envelopes intact for client recovery/version detection.

    Incoming workspace writes are strict. Reading must also tolerate corrupt or
    future layouts without failing the whole workbench or silently overwriting
    them with today's defaults. Other preferences keep their existing validation.
    """
    prefs = _strip_removed_workbench_keys(prefs)
    workbench = prefs.get("workbench", {})
    layout = workbench.get("layout", {}) if isinstance(workbench, dict) else {}
    has_workspace = isinstance(layout, dict) and "workspace" in layout
    if has_workspace:
        prefs = {
            **prefs,
            "workbench": {
                **workbench,
                "layout": {
                    key: value for key, value in layout.items() if key != "workspace"
                },
            },
        }
    content = UserPreferences.model_validate(prefs).model_dump(
        mode="json", by_alias=True
    )
    if has_workspace:
        content["workbench"]["layout"]["workspace"] = layout["workspace"]
    else:
        content["workbench"]["layout"].pop("workspace", None)
    return JSONResponse(content)


def _workspace_contexts(prefs: dict) -> dict:
    value = prefs
    for key in _WORKSPACE_CONTEXTS_PATH:
        if not isinstance(value, dict):
            return {}
        value = value.get(key, {})
    return value if isinstance(value, dict) else {}


@router.patch("/preferences", response_model=UserPreferencesRead)
async def update_preferences(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JSONResponse:
    """锁定最新用户偏好后深合并 PATCH；workspace context 原子替换且禁止版本降级。

    入参收 raw dict：先过 legacy 平铺键提升器 + 移除键剥离器（均 v0.16 移除）再手动走
    pydantic 校验，校验失败按 FastAPI 原生 422 形态抛出。"""
    promoted = _strip_removed_workbench_keys(_promote_legacy_workbench_keys(payload))
    user = (
        await db.execute(
            select(User)
            .where(User.id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    existing = user.preferences or {}
    validation_payload, opaque_presets, engine_supplied, had_stored_workspace = (
        _prepare_workspace_validation(promoted, existing)
    )
    try:
        validated = UserPreferences.model_validate(validation_payload)
    except ValidationError as exc:
        # 不回显 ctx 或原始 input：前者可能含异常对象，后者可能含溢出数值。
        # 保留定位与说明，避免错误响应本身再次 JSON 序列化失败变成 500。
        raise RequestValidationError(
            [
                {
                    "type": err["type"],
                    "loc": ("body", *err["loc"]),
                    "msg": err["msg"],
                }
                for err in exc.errors()
            ]
        ) from exc
    incoming = validated.model_dump(mode="json", exclude_unset=True, by_alias=True)
    incoming_workspace = _workspace_value(incoming)
    if incoming_workspace is not None:
        incoming_workspace = dict(incoming_workspace)
        if not engine_supplied and had_stored_workspace:
            incoming_workspace.pop("engine", None)
        if opaque_presets:
            incoming_workspace["namedPresets"] = {
                **incoming_workspace.get("namedPresets", {}),
                **opaque_presets,
            }
        incoming = _with_workspace(incoming, incoming_workspace)
    # 通用深度合并: dict 递归合并子键, 其它类型 (list/scalar) 直接覆盖。
    # 覆盖历史上按需增加的两层浅合并 (ai.* / ui.*): 现在 workbench 子树 (layout / common /
    # image / video / pointcloud) 与 ai.secondary_by_model (深度 2) 都能守住"单键 PATCH
    # 不冲掉同层邻居"的不变量, 前端任一 debounce writer 提交自己那半子键即可。
    stored_contexts = _workspace_contexts(existing)
    for context, envelope in _workspace_contexts(incoming).items():
        stored = stored_contexts.get(context)
        stored_version = (
            stored.get("schemaVersion") if isinstance(stored, dict) else None
        )
        if type(stored_version) is int and stored_version > envelope["schemaVersion"]:
            raise HTTPException(status_code=409, detail="layout_schema_downgrade")
    merged = _deep_merge_preferences(existing, incoming)
    merged = _strip_removed_workbench_keys(merged)
    response = _preferences_response(merged)
    user.preferences = merged
    await db.commit()
    return response


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
