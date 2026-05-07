"""v0.9.3 · /me/api-keys CRUD + ak_ token 鉴权测试。"""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_list_create_revoke_api_key(httpx_client, super_admin):
    user, token = super_admin
    headers = {"Authorization": f"Bearer {token}"}

    # 列表初始为空
    res = await httpx_client.get("/api/v1/me/api-keys", headers=headers)
    assert res.status_code == 200
    assert res.json() == []

    # 创建
    res = await httpx_client.post(
        "/api/v1/me/api-keys",
        headers=headers,
        json={"name": "ci bot", "scopes": ["annotations:read"]},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "ci bot"
    assert body["scopes"] == ["annotations:read"]
    assert body["plaintext"].startswith("ak_")
    assert body["key_prefix"] == body["plaintext"][:12]
    assert body["revoked_at"] is None
    key_id = body["id"]
    plaintext = body["plaintext"]

    # 列表中可见
    res = await httpx_client.get("/api/v1/me/api-keys", headers=headers)
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1
    assert "plaintext" not in items[0]  # 列表绝不返回明文

    # 用 ak_ token 调 /me 应同样能识别为该用户
    res = await httpx_client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {plaintext}"}
    )
    assert res.status_code == 200
    assert res.json()["email"] == user.email

    # 吊销
    res = await httpx_client.delete(f"/api/v1/me/api-keys/{key_id}", headers=headers)
    assert res.status_code == 204

    # 吊销后再用 ak_ 应 401
    res = await httpx_client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {plaintext}"}
    )
    assert res.status_code == 401

    # 重复吊销 404
    res = await httpx_client.delete(f"/api/v1/me/api-keys/{key_id}", headers=headers)
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_api_key_isolated_between_users(httpx_client, super_admin, annotator):
    """A 用户创建的 key 不应出现在 B 用户的列表中，且 B 不能 revoke A 的 key。"""
    _user_a, token_a = super_admin
    _user_b, token_b = annotator

    res = await httpx_client.post(
        "/api/v1/me/api-keys",
        headers={"Authorization": f"Bearer {token_a}"},
        json={"name": "a key", "scopes": []},
    )
    assert res.status_code == 201
    a_key_id = res.json()["id"]

    res = await httpx_client.get(
        "/api/v1/me/api-keys",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert res.status_code == 200
    assert res.json() == []

    res = await httpx_client.delete(
        f"/api/v1/me/api-keys/{a_key_id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_invalid_ak_token_rejected(httpx_client):
    res = await httpx_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer ak_invalidxxxxxxxxxxxxxxxxxx"},
    )
    assert res.status_code == 401
