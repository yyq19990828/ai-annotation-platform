"""v0.11.14 · 存储连接器 API：权限 / 白名单门禁 / 密钥脱敏。"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from app.config import settings


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
    # 超管可写可读
    await _set_allowlist(httpx_client, super_token, ["8.8.8.0/24"])
    r = await httpx_client.get(
        "/api/v1/storage-connections/allowlist", headers=_h(super_token)
    )
    assert r.json()["entries"] == ["8.8.8.0/24"]


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


async def test_project_scope_requires_project_id(
    httpx_client, super_admin, crypto_key
):
    _, super_token = super_admin
    await _set_allowlist(httpx_client, super_token, ["8.8.8.0/24"])
    payload = {**_S3_CONN, "scope": "project", "project_id": None}
    r = await httpx_client.post(
        "/api/v1/storage-connections", headers=_h(super_token), json=payload
    )
    assert r.status_code == 400


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
