"""v0.8.1 · 运行时系统设置读写服务

启动时 env 优先 → 运行时 PATCH 写 system_settings 表，覆盖 env。
读取走 30s 进程内 TTL 缓存（多 worker 各自独立，PATCH 后会清当前 worker 的 cache，
其他 worker 30s 后自然失效；对配置类小流量足够）。

白名单外的 key 一律拒绝写入；密码类字段 GET 时返回掩码（"***"），
audit_log 不记录敏感值（仅记录是否变更）。
"""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models.system_setting import SystemSetting


# 白名单：可在 admin UI 编辑的 key + 类型 + env 默认值名
EDITABLE_KEYS: dict[str, str] = {
    "allow_open_registration": "bool",
    "invitation_ttl_days": "int",
    "frontend_base_url": "str",
    "smtp_host": "str",
    "smtp_port": "int",
    "smtp_user": "str",
    "smtp_password": "str",
    "smtp_from": "str",
}

# 敏感字段：GET 返回掩码、audit_log 不记录值
SENSITIVE_KEYS: set[str] = {"smtp_password"}

# Per-process TTL cache
_CACHE_TTL_SECONDS = 30
_cache: dict[str, tuple[float, Any]] = {}


def _env_default(key: str) -> Any:
    """key 不在 DB 时回退到 settings (env/默认值)。"""
    return getattr(settings, key, None)


def _coerce(value_type: str, raw: Any) -> Any:
    if raw is None:
        return None
    if value_type == "bool":
        return bool(raw)
    if value_type == "int":
        return int(raw)
    return str(raw)


class SystemSettingsService:
    """读 = cache → DB → env；写 = 写 DB + 失效 cache。"""

    @staticmethod
    def _cache_get(key: str) -> tuple[bool, Any]:
        rec = _cache.get(key)
        if rec is None:
            return False, None
        ts, val = rec
        if time.time() - ts > _CACHE_TTL_SECONDS:
            _cache.pop(key, None)
            return False, None
        return True, val

    @staticmethod
    def _cache_set(key: str, value: Any) -> None:
        _cache[key] = (time.time(), value)

    @staticmethod
    def invalidate(key: str | None = None) -> None:
        if key is None:
            _cache.clear()
        else:
            _cache.pop(key, None)

    @staticmethod
    async def get(db: AsyncSession, key: str) -> Any:
        if key not in EDITABLE_KEYS:
            return _env_default(key)
        hit, val = SystemSettingsService._cache_get(key)
        if hit:
            return val
        row = await db.scalar(select(SystemSetting).where(SystemSetting.key == key))
        if row is None or row.value_json is None:
            value = _env_default(key)
        else:
            try:
                value = _coerce(row.value_type, row.value_json)
            except (TypeError, ValueError):
                value = _env_default(key)
        SystemSettingsService._cache_set(key, value)
        return value

    @staticmethod
    async def get_all(db: AsyncSession) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key in EDITABLE_KEYS:
            out[key] = await SystemSettingsService.get(db, key)
        return out

    @staticmethod
    async def set_many(
        db: AsyncSession,
        updates: dict[str, Any],
        actor_id: Any | None,
    ) -> dict[str, tuple[Any, Any]]:
        """返回 {key: (old, new)}，不含未变更项。空值串视为清空（写 NULL）。"""
        changes: dict[str, tuple[Any, Any]] = {}
        for key, new_val in updates.items():
            if key not in EDITABLE_KEYS:
                raise ValueError(f"非法配置项: {key}")
            value_type = EDITABLE_KEYS[key]
            old_val = await SystemSettingsService.get(db, key)
            # 类型规整
            if new_val == "" or new_val is None:
                stored: Any = None
            else:
                try:
                    stored = _coerce(value_type, new_val)
                except (TypeError, ValueError) as e:
                    raise ValueError(f"{key} 类型错误（期望 {value_type}）: {e}") from e
            if old_val == stored:
                continue
            stmt = pg_insert(SystemSetting).values(
                key=key,
                value_type=value_type,
                value_json=stored,
                updated_by=actor_id,
                updated_at=func.now(),
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=[SystemSetting.key],
                set_={
                    "value_json": stored,
                    "value_type": value_type,
                    "updated_by": actor_id,
                    "updated_at": func.now(),
                },
            )
            await db.execute(stmt)
            SystemSettingsService.invalidate(key)
            changes[key] = (old_val, stored)
        return changes

    @staticmethod
    async def reset(db: AsyncSession, key: str) -> None:
        """清掉 DB override，回退 env 默认。"""
        if key not in EDITABLE_KEYS:
            raise ValueError(f"非法配置项: {key}")
        await db.execute(delete(SystemSetting).where(SystemSetting.key == key))
        SystemSettingsService.invalidate(key)

    @staticmethod
    def mask_for_response(key: str, value: Any) -> Any:
        if key in SENSITIVE_KEYS and value:
            return "***"
        return value

    @staticmethod
    def safe_audit_detail(changes: dict[str, tuple[Any, Any]]) -> dict[str, Any]:
        """audit_log 用：敏感字段只记 changed=True，不记值。"""
        out: dict[str, Any] = {}
        for key, (old, new) in changes.items():
            if key in SENSITIVE_KEYS:
                out[key] = {"changed": True}
            else:
                out[key] = {"old": old, "new": new}
        return out
