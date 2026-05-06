"""v0.8.1 · 系统设置 PATCH + 开放注册 toggle 联动验证。"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.system_settings_service import SystemSettingsService


pytestmark = pytest.mark.asyncio


async def test_get_requires_super_admin(httpx_client, project_admin):
    _, token = project_admin
    res = await httpx_client.get(
        "/api/v1/settings/system",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403


async def test_patch_round_trip(httpx_client, super_admin, db_session: AsyncSession):
    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}

    # 初始 GET
    res = await httpx_client.get("/api/v1/settings/system", headers=headers)
    assert res.status_code == 200
    initial = res.json()

    # PATCH allow_open_registration=True + invitation_ttl_days=30
    res = await httpx_client.patch(
        "/api/v1/settings/system",
        headers=headers,
        json={"allow_open_registration": True, "invitation_ttl_days": 30},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["allow_open_registration"] is True
    assert body["invitation_ttl_days"] == 30

    # 再 GET 应保持
    SystemSettingsService.invalidate()
    res = await httpx_client.get("/api/v1/settings/system", headers=headers)
    assert res.json()["allow_open_registration"] is True
    assert res.json()["invitation_ttl_days"] == 30

    # 还原（避免污染其它 test）
    await httpx_client.patch(
        "/api/v1/settings/system",
        headers=headers,
        json={
            "allow_open_registration": initial["allow_open_registration"],
            "invitation_ttl_days": initial["invitation_ttl_days"],
        },
    )


async def test_patch_invalid_ttl_returns_422(httpx_client, super_admin):
    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}
    res = await httpx_client.patch(
        "/api/v1/settings/system",
        headers=headers,
        json={"invitation_ttl_days": 999},
    )
    # pydantic Field(ge=1, le=90) 会拦截
    assert res.status_code == 422


async def test_smtp_password_masked_in_response(
    httpx_client, super_admin, db_session: AsyncSession
):
    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}

    res = await httpx_client.patch(
        "/api/v1/settings/system",
        headers=headers,
        json={
            "smtp_host": "smtp.test.local",
            "smtp_port": 587,
            "smtp_user": "u@test",
            "smtp_password": "secret-p@ss",
            "smtp_from": "noreply@test.local",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    # password_set true，response 不直接回密码
    assert body["smtp"]["password_set"] is True
    assert "password" not in body["smtp"]
    assert body["smtp"]["host"] == "smtp.test.local"
    assert body["smtp"]["configured"] is True

    # 清理
    await httpx_client.patch(
        "/api/v1/settings/system",
        headers=headers,
        json={
            "smtp_host": "",
            "smtp_port": None,
            "smtp_user": "",
            "smtp_password": "",
            "smtp_from": "",
        },
    )


async def test_open_register_status_reflects_db_override(
    httpx_client, super_admin, db_session
):
    """PATCH allow_open_registration 后 /auth/registration-status 返回新值
    （证明 DB override 正确接管 env 默认）。"""
    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}

    await httpx_client.patch(
        "/api/v1/settings/system",
        headers=headers,
        json={"allow_open_registration": True},
    )
    SystemSettingsService.invalidate()

    res = await httpx_client.get("/api/v1/auth/registration-status")
    assert res.status_code == 200
    assert res.json()["open_registration_enabled"] is True

    await httpx_client.patch(
        "/api/v1/settings/system",
        headers=headers,
        json={"allow_open_registration": False},
    )
    SystemSettingsService.invalidate()
    res = await httpx_client.get("/api/v1/auth/registration-status")
    assert res.json()["open_registration_enabled"] is False


async def test_audit_log_excludes_smtp_password_value(
    httpx_client, super_admin, db_session: AsyncSession
):
    """审计 detail 中 smtp_password 仅记录 changed=True，不含明文。"""
    from sqlalchemy import select
    from app.db.models.audit_log import AuditLog

    _, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}

    await httpx_client.patch(
        "/api/v1/settings/system",
        headers=headers,
        json={"smtp_password": "highly-secret-string"},
    )

    rows = (
        await db_session.execute(
            select(AuditLog)
            .where(AuditLog.action == "system.settings_update")
            .order_by(AuditLog.id.desc())
            .limit(1)
        )
    ).scalars().all()
    assert rows, "expected at least one audit row"
    detail = rows[0].detail_json or {}
    assert "smtp_password" in detail
    assert detail["smtp_password"] == {"changed": True}
    assert "highly-secret-string" not in str(detail)

    # 清理
    await httpx_client.patch(
        "/api/v1/settings/system",
        headers=headers,
        json={"smtp_password": ""},
    )
