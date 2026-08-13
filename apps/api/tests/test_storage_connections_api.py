"""v0.11.14 · 存储连接器 API：权限 / 白名单门禁 / 密钥脱敏。"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.config import settings
from app.db.models.audit_log import AuditLog


@pytest.fixture
def crypto_key(monkeypatch):
    monkeypatch.setattr(
        settings, "connector_encryption_key", Fernet.generate_key().decode()
    )


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _set_allowlist(client, super_token, entries):
    r = await client.put(
        "/api/v1/storage-connections/allowlist",
        headers=_h(super_token),
        json={"entries": entries},
    )
    assert r.status_code == 200, r.text


_S3_CONN = {
    "name": "ext-oss",
    "kind": "s3",
    "config": {"endpoint": "http://8.8.8.8:9000", "bucket": "data"},
    "secret": {"access_key": "AK", "secret_key": "SK"},
    "scope": "global",
}


async def test_allowlist_super_admin_only(httpx_client, super_admin, project_admin):
    _, super_token = super_admin
    _, pm_token = project_admin
    # 项目管理员读/写白名单都 403
    assert (
        await httpx_client.get(
            "/api/v1/storage-connections/allowlist", headers=_h(pm_token)
        )
    ).status_code == 403
    assert (
        await httpx_client.put(
            "/api/v1/storage-connections/allowlist",
            headers=_h(pm_token),
            json={"entries": ["8.8.8.0/24"]},
        )
    ).status_code == 403
    assert (
        await httpx_client.delete(
            "/api/v1/storage-connections/allowlist", headers=_h(pm_token)
        )
    ).status_code == 403
    # 超管可写可读
    await _set_allowlist(httpx_client, super_token, ["8.8.8.0/24"])
    r = await httpx_client.get(
        "/api/v1/storage-connections/allowlist", headers=_h(super_token)
    )
    assert r.json() == {"entries": ["8.8.8.0/24"], "source": "database"}


async def test_allowlist_uses_env_default_when_db_unset(
    httpx_client, super_admin, monkeypatch
):
    _, super_token = super_admin
    monkeypatch.setattr(settings, "connector_host_allowlist", ["8.8.8.0/24"])
    r = await httpx_client.get(
        "/api/v1/storage-connections/allowlist", headers=_h(super_token)
    )
    assert r.status_code == 200
    assert r.json() == {"entries": ["8.8.8.0/24"], "source": "environment"}


async def test_allowlist_normalizes_rejects_invalid_and_resets_to_env(
    httpx_client, super_admin, monkeypatch
):
    _, super_token = super_admin
    monkeypatch.setattr(settings, "connector_host_allowlist", ["9.9.9.0/24"])

    updated = await httpx_client.put(
        "/api/v1/storage-connections/allowlist",
        headers=_h(super_token),
        json={
            "entries": [
                " 10.0.3.5/24 ",
                "Example.COM.",
                ".AliYunCS.com.",
                "example.com",
            ]
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json() == {
        "entries": ["10.0.3.0/24", "example.com", ".aliyuncs.com"],
        "source": "database",
    }

    invalid = await httpx_client.put(
        "/api/v1/storage-connections/allowlist",
        headers=_h(super_token),
        json={"entries": ["https://example.com/path"]},
    )
    assert invalid.status_code == 422

    current = await httpx_client.get(
        "/api/v1/storage-connections/allowlist", headers=_h(super_token)
    )
    assert current.json()["entries"] == [
        "10.0.3.0/24",
        "example.com",
        ".aliyuncs.com",
    ]

    reset = await httpx_client.delete(
        "/api/v1/storage-connections/allowlist", headers=_h(super_token)
    )
    assert reset.status_code == 200
    assert reset.json() == {
        "entries": ["9.9.9.0/24"],
        "source": "environment",
    }


async def test_allowlist_update_and_reset_audit_only_mode_and_count(
    httpx_client, super_admin, db_session
):
    _, super_token = super_admin
    await _set_allowlist(httpx_client, super_token, ["8.8.8.0/24"])
    reset = await httpx_client.delete(
        "/api/v1/storage-connections/allowlist", headers=_h(super_token)
    )
    assert reset.status_code == 200

    rows = list(
        (
            await db_session.scalars(
                select(AuditLog)
                .where(AuditLog.action == "connector.allowlist_update")
                .order_by(AuditLog.id)
            )
        ).all()
    )
    assert [row.detail_json for row in rows] == [
        {"mode": "override", "count": 1},
        {"mode": "reset", "count": len(settings.connector_host_allowlist)},
    ]


async def test_deployment_sftp_preset_is_super_admin_only_and_contains_no_secret(
    httpx_client, super_admin, project_admin, monkeypatch
):
    _, super_token = super_admin
    _, pm_token = project_admin
    endpoint = "/api/v1/storage-connections/deployment-sftp-preset"

    assert (await httpx_client.get(endpoint, headers=_h(pm_token))).status_code == 403

    monkeypatch.setattr(settings, "connector_deployment_sftp_host", "")
    disabled = await httpx_client.get(endpoint, headers=_h(super_token))
    assert disabled.json() == {"enabled": False, "host": None, "port": 22}

    monkeypatch.setattr(settings, "connector_deployment_sftp_host", "10.0.3.5")
    enabled = await httpx_client.get(endpoint, headers=_h(super_token))
    assert enabled.json() == {"enabled": True, "host": "10.0.3.5", "port": 22}
    assert "password" not in enabled.text and "private_key" not in enabled.text


async def test_create_global_connection_redacts_secret(
    httpx_client, super_admin, crypto_key
):
    _, super_token = super_admin
    await _set_allowlist(httpx_client, super_token, ["8.8.8.0/24"])
    r = await httpx_client.post(
        "/api/v1/storage-connections", headers=_h(super_token), json=_S3_CONN
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["secret_set"] is True
    assert body["kind"] == "s3"
    # 密钥绝不回吐
    assert "secret" not in body
    assert "SK" not in r.text and "AK" not in r.text


async def test_create_blocked_when_host_not_allowlisted(
    httpx_client, super_admin, crypto_key
):
    _, super_token = super_admin
    await _set_allowlist(httpx_client, super_token, ["9.9.9.0/24"])  # 不含 8.8.8.8
    r = await httpx_client.post(
        "/api/v1/storage-connections", headers=_h(super_token), json=_S3_CONN
    )
    assert r.status_code == 400, r.text


async def test_create_blocked_when_allowlist_empty(
    httpx_client, super_admin, crypto_key
):
    _, super_token = super_admin
    await _set_allowlist(httpx_client, super_token, [])
    r = await httpx_client.post(
        "/api/v1/storage-connections", headers=_h(super_token), json=_S3_CONN
    )
    assert r.status_code == 400


async def test_project_admin_cannot_create_global(
    httpx_client, super_admin, project_admin, crypto_key
):
    _, super_token = super_admin
    _, pm_token = project_admin
    await _set_allowlist(httpx_client, super_token, ["8.8.8.0/24"])
    r = await httpx_client.post(
        "/api/v1/storage-connections", headers=_h(pm_token), json=_S3_CONN
    )
    assert r.status_code == 403


async def test_owner_scope_does_not_write_project_id(
    httpx_client, super_admin, project_admin, crypto_key
):
    _, super_token = super_admin
    user, pm_token = project_admin
    await _set_allowlist(httpx_client, super_token, ["8.8.8.0/24"])
    payload = {**_S3_CONN, "scope": "owner", "project_id": None}
    r = await httpx_client.post(
        "/api/v1/storage-connections", headers=_h(pm_token), json=payload
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["scope"] == "owner"
    assert body["project_id"] is None
    assert body["created_by"] == str(user.id)


async def test_owner_scope_list_and_usage_is_owner_or_global_only(
    httpx_client, super_admin, project_admin, crypto_key
):
    _, super_token = super_admin
    _, pm_token = project_admin
    await _set_allowlist(httpx_client, super_token, ["8.8.8.0/24"])

    global_res = await httpx_client.post(
        "/api/v1/storage-connections",
        headers=_h(super_token),
        json=_S3_CONN,
    )
    assert global_res.status_code == 201, global_res.text
    global_id = global_res.json()["id"]

    own_res = await httpx_client.post(
        "/api/v1/storage-connections",
        headers=_h(pm_token),
        json={**_S3_CONN, "name": "pm-oss", "scope": "owner"},
    )
    assert own_res.status_code == 201, own_res.text
    own_id = own_res.json()["id"]

    other_res = await httpx_client.post(
        "/api/v1/storage-connections",
        headers=_h(super_token),
        json={**_S3_CONN, "name": "admin-private", "scope": "owner"},
    )
    assert other_res.status_code == 201, other_res.text
    other_id = other_res.json()["id"]

    listed = await httpx_client.get("/api/v1/storage-connections", headers=_h(pm_token))
    assert listed.status_code == 200
    ids = {item["id"] for item in listed.json()}
    assert ids == {global_id, own_id}

    hidden = await httpx_client.get(
        f"/api/v1/storage-connections/{other_id}", headers=_h(pm_token)
    )
    assert hidden.status_code == 404
    unusable = await httpx_client.post(
        f"/api/v1/storage-connections/{other_id}/test", headers=_h(pm_token)
    )
    assert unusable.status_code == 404


async def test_create_503_when_crypto_unconfigured(
    httpx_client, super_admin, monkeypatch
):
    _, super_token = super_admin
    monkeypatch.setattr(settings, "connector_encryption_key", "")
    await _set_allowlist(httpx_client, super_token, ["8.8.8.0/24"])
    r = await httpx_client.post(
        "/api/v1/storage-connections", headers=_h(super_token), json=_S3_CONN
    )
    assert r.status_code == 503
