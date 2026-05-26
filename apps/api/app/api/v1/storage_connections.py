"""v0.11.14 · 存储连接器 API（服务端拉取导入的连接配置 + 超管主机白名单）。

权限：
  - global-scope 连接器、主机白名单：仅 super_admin。
  - project-scope 连接器：super_admin 或该项目 owner（project_admin）可建/改/删。
  - 查看/测试：在可见范围内（super_admin 全部；项目级需项目可见）。
密钥永不回吐（Out 仅 secret_set:bool）。create/test/import 三处都过白名单 + SSRF。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import ConnectorCryptoNotConfigured
from app.db.enums import UserRole
from app.db.models.storage_connection import StorageConnection
from app.db.models.user import User
from app.deps import assert_project_visible, get_current_user, get_db, require_roles
from app.schemas.storage_connection import (
    ConnectorAllowlistOut,
    ConnectorAllowlistUpdate,
    StorageConnectionCreate,
    StorageConnectionOut,
    StorageConnectionTestResult,
    StorageConnectionUpdate,
)
from app.services import connector_guard
from app.services.audit import AuditAction, AuditService
from app.services.storage_connection import (
    ConnectorValidationError,
    StorageConnectionService,
    to_out_dict,
)
from app.services.system_settings_service import SystemSettingsService

router = APIRouter()


def _crypto_guard(exc: ConnectorCryptoNotConfigured) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
    )


def _denied(exc: connector_guard.ConnectorHostDenied) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


async def _require_project_admin(
    db: AsyncSession, user: User, project_id: uuid.UUID
) -> None:
    """super_admin 或项目 owner 可管理该项目的连接器。"""
    if user.role == UserRole.SUPER_ADMIN:
        return
    project = await assert_project_visible(project_id, db, user)
    if project.owner_id != user.id:
        raise HTTPException(
            status_code=403, detail="仅项目负责人或超级管理员可管理连接器"
        )


async def _assert_can_view(
    db: AsyncSession, user: User, conn: StorageConnection
) -> None:
    if user.role == UserRole.SUPER_ADMIN or conn.scope == "global":
        return
    if conn.project_id is None:
        raise HTTPException(status_code=404, detail="连接器不存在")
    await assert_project_visible(conn.project_id, db, user)  # 不可见 → 404


async def _assert_can_admin(
    db: AsyncSession, user: User, conn: StorageConnection
) -> None:
    if conn.scope == "global":
        if user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="仅超级管理员可管理全局连接器")
        return
    await _require_project_admin(db, user, conn.project_id)


# ---- 主机白名单（仅 super_admin）。先于 /{conn_id} 注册避免被路径吞掉。----


@router.get("/allowlist", response_model=ConnectorAllowlistOut)
async def get_allowlist(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    return ConnectorAllowlistOut(entries=await connector_guard.get_allowlist(db))


@router.put("/allowlist", response_model=ConnectorAllowlistOut)
async def update_allowlist(
    payload: ConnectorAllowlistUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    entries = [e.strip() for e in payload.entries if e.strip()]
    await SystemSettingsService.set_many(
        db, {"connector_host_allowlist": entries}, actor.id
    )
    await AuditService.log(
        db,
        actor=actor,
        action=AuditAction.CONNECTOR_ALLOWLIST_UPDATE,
        target_type="connector",
        target_id="allowlist",
        request=request,
        status_code=200,
        detail={"count": len(entries)},
    )
    await db.commit()
    return ConnectorAllowlistOut(entries=entries)


# ---- 连接器 CRUD ----


@router.get("", response_model=list[StorageConnectionOut])
async def list_connections(
    project_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    is_super = user.role == UserRole.SUPER_ADMIN
    if project_id is not None and not is_super:
        await assert_project_visible(project_id, db, user)  # 不可见 → 404
    conns = await StorageConnectionService.list_visible(
        db, all_scopes=is_super and project_id is None, project_id=project_id
    )
    return [to_out_dict(c) for c in conns]


@router.post("", response_model=StorageConnectionOut, status_code=201)
async def create_connection(
    payload: StorageConnectionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.scope == "global":
        if user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="仅超级管理员可建全局连接器")
    else:
        if payload.project_id is None:
            raise HTTPException(
                status_code=400, detail="project-scope 连接器需指定 project_id"
            )
        await _require_project_admin(db, user, payload.project_id)

    try:
        conn = await StorageConnectionService.create(
            db,
            name=payload.name,
            kind=payload.kind,
            config=payload.config,
            secret=payload.secret,
            scope=payload.scope,
            project_id=payload.project_id if payload.scope == "project" else None,
            created_by=user.id,
        )
    except ConnectorValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except connector_guard.ConnectorHostDenied as e:
        raise _denied(e)
    except ConnectorCryptoNotConfigured as e:
        raise _crypto_guard(e)

    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.STORAGE_CONNECTION_CREATE,
        target_type="storage_connection",
        target_id=str(conn.id),
        request=request,
        status_code=201,
        detail={"kind": conn.kind, "scope": conn.scope},
    )
    await db.commit()
    await db.refresh(conn)
    return to_out_dict(conn)


@router.get("/{conn_id}", response_model=StorageConnectionOut)
async def get_connection(
    conn_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conn = await StorageConnectionService.get(db, conn_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="连接器不存在")
    await _assert_can_view(db, user, conn)
    return to_out_dict(conn)


@router.patch("/{conn_id}", response_model=StorageConnectionOut)
async def update_connection(
    conn_id: uuid.UUID,
    payload: StorageConnectionUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conn = await StorageConnectionService.get(db, conn_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="连接器不存在")
    await _assert_can_admin(db, user, conn)
    try:
        conn = await StorageConnectionService.update(
            db, conn, name=payload.name, config=payload.config, secret=payload.secret
        )
    except ConnectorValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except connector_guard.ConnectorHostDenied as e:
        raise _denied(e)
    except ConnectorCryptoNotConfigured as e:
        raise _crypto_guard(e)
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.STORAGE_CONNECTION_UPDATE,
        target_type="storage_connection",
        target_id=str(conn.id),
        request=request,
        status_code=200,
        detail={"secret_rotated": payload.secret is not None},
    )
    await db.commit()
    await db.refresh(conn)
    return to_out_dict(conn)


@router.delete("/{conn_id}", status_code=204)
async def delete_connection(
    conn_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conn = await StorageConnectionService.get(db, conn_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="连接器不存在")
    await _assert_can_admin(db, user, conn)
    await StorageConnectionService.delete(db, conn)
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.STORAGE_CONNECTION_DELETE,
        target_type="storage_connection",
        target_id=str(conn_id),
        request=request,
        status_code=204,
    )
    await db.commit()


@router.post("/{conn_id}/test", response_model=StorageConnectionTestResult)
async def test_connection(
    conn_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conn = await StorageConnectionService.get(db, conn_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="连接器不存在")
    await _assert_can_view(db, user, conn)
    try:
        ok, message, count = await StorageConnectionService.test_connection(db, conn)
    except connector_guard.ConnectorHostDenied as e:
        raise _denied(e)
    except ConnectorCryptoNotConfigured as e:
        raise _crypto_guard(e)
    await AuditService.log(
        db,
        actor=user,
        action=AuditAction.STORAGE_CONNECTION_TEST,
        target_type="storage_connection",
        target_id=str(conn_id),
        request=request,
        status_code=200,
        detail={"ok": ok},
    )
    await db.commit()
    return StorageConnectionTestResult(ok=ok, message=message, sample_count=count)
