"""Dedicated PostgreSQL role boundary for proof-backed GPU tombstone GC.

Moved verbatim from the legacy flat module ``gpu_collector_database.py``; this is an
independent infrastructure leaf consumed only by the collector / health worker
orchestration. No other GPU domain module may import it.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import Settings, settings


_MAX_DATABASE_URL_FILE_BYTES = 16 * 1024
_ROLE_CAPABILITIES_SQL = text(
    """
    SELECT
        current_user AS role_name,
        role.rolsuper AS is_superuser,
        role.rolcreaterole AS can_create_role,
        role.rolcreatedb AS can_create_database,
        role.rolreplication AS can_replicate,
        role.rolbypassrls AS can_bypass_rls,
        EXISTS (
            SELECT 1
            FROM pg_auth_members AS membership
            WHERE membership.member = role.oid
              AND membership.set_option
        ) AS can_set_other_role,
        has_table_privilege(
            current_user, 'public.ml_backend_registry', 'SELECT'
        ) AS can_select_registry,
        has_column_privilege(
            current_user, 'public.ml_backend_registry', 'id', 'UPDATE'
        ) AS can_lock_registry,
        has_table_privilege(
            current_user, 'public.ml_backend_registry', 'INSERT'
        ) AS can_insert_registry,
        has_table_privilege(
            current_user, 'public.ml_backend_registry', 'UPDATE'
        ) AS can_update_registry,
        has_table_privilege(
            current_user, 'public.ml_backend_registry', 'DELETE'
        ) AS can_delete_registry,
        has_table_privilege(
            current_user, 'public.gpu_backend_memberships', 'SELECT'
        ) AS can_select_memberships,
        has_column_privilege(
            current_user,
            'public.gpu_backend_memberships',
            'backend_registry_id',
            'UPDATE'
        ) AS can_lock_memberships,
        has_table_privilege(
            current_user, 'public.gpu_backend_memberships', 'INSERT'
        ) AS can_insert_memberships,
        has_table_privilege(
            current_user, 'public.gpu_backend_memberships', 'UPDATE'
        ) AS can_update_memberships,
        has_table_privilege(
            current_user, 'public.gpu_backend_memberships', 'DELETE'
        ) AS can_delete_memberships,
        has_table_privilege(
            current_user, 'public.gpu_backend_fences', 'SELECT'
        ) AS can_select_fences,
        has_column_privilege(
            current_user,
            'public.gpu_backend_fences',
            'backend_registry_id',
            'UPDATE'
        ) AS can_lock_fences,
        has_table_privilege(
            current_user, 'public.gpu_backend_fences', 'INSERT'
        ) AS can_insert_fences,
        has_table_privilege(
            current_user, 'public.gpu_backend_fences', 'UPDATE'
        ) AS can_update_fences,
        has_table_privilege(
            current_user, 'public.gpu_backend_fences', 'DELETE'
        ) AS can_delete_fences
    FROM pg_roles AS role
    WHERE role.rolname = current_user
    """
)


class GPUCollectorDatabaseConfigError(ValueError):
    """The collector credential or database privilege boundary is unsafe."""


@dataclass(frozen=True)
class GPUCollectorDatabase:
    engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    application_role: str
    collector_role: str


def load_gpu_collector_database_url(config: Settings = settings) -> str:
    """Read and validate the collector URL without exposing it in settings/logs."""

    path = config.gpu_arbiter_collector_database_url_file
    if not path or path != path.strip():
        raise GPUCollectorDatabaseConfigError(
            "GPU collector database URL file is not configured"
        )
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(_MAX_DATABASE_URL_FILE_BYTES + 1)
    except OSError as exc:
        raise GPUCollectorDatabaseConfigError(
            "GPU collector database URL file is unavailable"
        ) from exc
    if not raw:
        raise GPUCollectorDatabaseConfigError(
            "GPU collector database URL file is empty"
        )
    if len(raw) > _MAX_DATABASE_URL_FILE_BYTES:
        raise GPUCollectorDatabaseConfigError(
            "GPU collector database URL file is too large"
        )
    try:
        database_url = raw.decode("utf-8").strip()
    except UnicodeDecodeError:
        raise GPUCollectorDatabaseConfigError(
            "GPU collector database URL file must be UTF-8"
        ) from None
    if not database_url or "\n" in database_url or "\r" in database_url:
        raise GPUCollectorDatabaseConfigError(
            "GPU collector database URL file must contain exactly one URL"
        )
    try:
        parsed = make_url(database_url)
    except Exception as exc:  # noqa: BLE001 - never echo credential parser details
        raise GPUCollectorDatabaseConfigError(
            "GPU collector database URL is invalid"
        ) from exc
    if (
        parsed.drivername != "postgresql+asyncpg"
        or not parsed.username
        or not parsed.password
        or not parsed.host
        or not parsed.database
    ):
        raise GPUCollectorDatabaseConfigError(
            "GPU collector database URL must be a complete postgresql+asyncpg URL"
        )
    return database_url


def validate_gpu_collector_role_boundary(
    application: Mapping[str, Any],
    collector: Mapping[str, Any],
) -> tuple[str, str]:
    """Require distinct, least-privilege application and collector roles."""

    application_role = application.get("role_name")
    collector_role = collector.get("role_name")
    if (
        not isinstance(application_role, str)
        or not application_role
        or not isinstance(collector_role, str)
        or not collector_role
        or application_role == collector_role
    ):
        raise GPUCollectorDatabaseConfigError(
            "GPU collector must use a distinct PostgreSQL role"
        )
    if any(
        application.get(key) is not False
        for key in (
            "is_superuser",
            "can_create_role",
            "can_create_database",
            "can_replicate",
            "can_bypass_rls",
            "can_set_other_role",
            "can_delete_memberships",
            "can_delete_fences",
        )
    ):
        raise GPUCollectorDatabaseConfigError(
            "ordinary application role can bypass the GPU collector boundary"
        )
    if any(
        collector.get(key) is not False
        for key in (
            "is_superuser",
            "can_create_role",
            "can_create_database",
            "can_replicate",
            "can_bypass_rls",
            "can_set_other_role",
            "can_lock_registry",
            "can_insert_registry",
            "can_update_registry",
            "can_delete_registry",
            "can_insert_memberships",
            "can_update_memberships",
            "can_insert_fences",
            "can_update_fences",
        )
    ):
        raise GPUCollectorDatabaseConfigError(
            "GPU collector role has privileges outside its bounded GC contract"
        )
    required = (
        "can_select_registry",
        "can_select_memberships",
        "can_lock_memberships",
        "can_delete_memberships",
        "can_select_fences",
        "can_lock_fences",
        "can_delete_fences",
    )
    if any(collector.get(key) is not True for key in required):
        raise GPUCollectorDatabaseConfigError(
            "GPU collector role is missing required GC privileges"
        )
    return application_role, collector_role


async def _role_capabilities(
    session_factory: async_sessionmaker[AsyncSession],
) -> Mapping[str, Any]:
    async with session_factory() as db:
        row = (await db.execute(_ROLE_CAPABILITIES_SQL)).mappings().one_or_none()
    if row is None:
        raise GPUCollectorDatabaseConfigError(
            "PostgreSQL role capability query returned no row"
        )
    return row


async def open_gpu_collector_database(
    application_factory: async_sessionmaker[AsyncSession],
    config: Settings = settings,
) -> GPUCollectorDatabase:
    """Open the dedicated collector pool and prove the role boundary."""

    database_url = load_gpu_collector_database_url(config)
    engine = create_async_engine(database_url, echo=False)
    collector_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    try:
        application = await _role_capabilities(application_factory)
        collector = await _role_capabilities(collector_factory)
        application_role, collector_role = validate_gpu_collector_role_boundary(
            application,
            collector,
        )
    except BaseException:
        await engine.dispose()
        raise
    return GPUCollectorDatabase(
        engine=engine,
        session_factory=collector_factory,
        application_role=application_role,
        collector_role=collector_role,
    )


__all__ = [
    "GPUCollectorDatabase",
    "GPUCollectorDatabaseConfigError",
    "load_gpu_collector_database_url",
    "open_gpu_collector_database",
    "validate_gpu_collector_role_boundary",
]
