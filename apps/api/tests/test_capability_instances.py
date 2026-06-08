"""v0.14.11 · GET /v1/ml-capabilities/instances 端点测试.

覆盖:
- 401 未登录 (鉴权与 /protocol 一致, 登录用户可访问)。
- env-only 容器 + 项目级注册 backend 合并 (mock probe + DB fixture)。
- 字段裁剪: 不暴露 url / health_meta / gpu_info / cache。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from app.db.models.ml_backend import MLBackend
from tests.factory import create_project


@pytest.mark.asyncio
async def test_instances_requires_auth(httpx_client):
    r = await httpx_client.get("/api/v1/ml-capabilities/instances")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_instances_returns_empty_when_no_backend(
    httpx_client, auth_headers, monkeypatch
):
    """无 env-only 配置 + 无注册 backend → instances 为空。"""
    from app.services import capability_instances as svc

    monkeypatch.setattr(svc, "_observe_urls", lambda: [])
    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    assert r.status_code == 200
    assert r.json() == {"instances": []}


@pytest.mark.asyncio
async def test_instances_merges_env_only_and_registered(
    httpx_client, auth_headers, db_session, super_admin, monkeypatch
):
    """env-only 探测 + 注册 backend 同时返回, env-only 在前。"""
    from app.services import capability_instances as svc

    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, name="P-Instances")

    # mock env-only 容器探测
    fake_setup_env = {
        "name": "gsam2-env",
        "infra": "pytorch",
        "supported_prompts": ["text"],
        "models": [
            {
                "id": "gsam2-detection",
                "display_name": "gsam2-det",
                "task": "detection",
                "infra": "pytorch",
                "supported_geometric_outputs": ["bbox"],
            },
        ],
    }
    monkeypatch.setattr(svc, "_observe_urls", lambda: ["http://gsam2:8001"])
    monkeypatch.setattr(svc, "_probe_setup", AsyncMock(return_value=fake_setup_env))

    # 写一个 connected 注册 backend, health_meta.capabilities 含 sam3 model
    backend = MLBackend(
        id=uuid.uuid4(),
        project_id=proj.id,
        name="sam3-registered",
        url="http://sam3:8002",
        state="connected",
        is_interactive=True,
        auth_method="none",
        extra_params={},
        health_meta={
            "capabilities": {
                "infra": "pytorch",
                "models": [
                    {
                        "id": "sam3-detection",
                        "display_name": "sam3 det",
                        "task": "detection",
                        "infra": "pytorch",
                        "supported_geometric_outputs": ["bbox"],
                    }
                ],
            }
        },
    )
    db_session.add(backend)
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data["instances"]) == 2

    env_inst, reg_inst = data["instances"]
    assert env_inst["source"] == "env_only"
    assert env_inst["name"] == "gsam2-env"
    assert env_inst["infra"] == "pytorch"
    assert len(env_inst["models"]) == 1
    assert env_inst["models"][0]["task"] == "detection"

    assert reg_inst["source"] == "registered"
    assert reg_inst["name"] == "sam3-registered"
    assert reg_inst["infra"] == "pytorch"
    assert reg_inst["models"][0]["task"] == "detection"


@pytest.mark.asyncio
async def test_instances_skip_env_only_url_already_registered(
    httpx_client, auth_headers, db_session, super_admin, monkeypatch
):
    """env-only 与注册 URL 相同时去重: 只走注册路径, 避免重复展示。"""
    from app.services import capability_instances as svc

    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, name="P-Dedup")

    probe = AsyncMock()
    monkeypatch.setattr(svc, "_observe_urls", lambda: ["http://samesource:8001"])
    monkeypatch.setattr(svc, "_probe_setup", probe)

    backend = MLBackend(
        id=uuid.uuid4(),
        project_id=proj.id,
        name="samesource-reg",
        url="http://samesource:8001",
        state="connected",
        is_interactive=False,
        auth_method="none",
        extra_params={},
        health_meta={
            "capabilities": {
                "infra": "pytorch",
                "models": [
                    {
                        "id": "m1",
                        "display_name": "M1",
                        "task": "detection",
                        "supported_geometric_outputs": ["bbox"],
                    }
                ],
            }
        },
    )
    db_session.add(backend)
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    assert r.status_code == 200
    insts = r.json()["instances"]
    assert len(insts) == 1
    assert insts[0]["source"] == "registered"
    # _probe_setup 不应被调用 (URL 已注册)
    probe.assert_not_called()


@pytest.mark.asyncio
async def test_instances_live_probe_when_snapshot_missing(
    httpx_client, auth_headers, db_session, super_admin, monkeypatch
):
    """registered backend health_meta 缺 models 时, fallback 到 live /setup 探测。

    覆盖 v0.14.9 之前注册的老 backend: state=connected 但 health_meta.capabilities
    为 NULL, 应直接探测 backend.url 拿最新 models[], 而不是被 skip 掉。
    """
    from app.services import capability_instances as svc

    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, name="P-LiveProbe")

    monkeypatch.setattr(svc, "_observe_urls", lambda: [])

    # mock live 探测返回协议 v2 多 model setup
    fake_live_setup = {
        "name": "gsam2",
        "infra": "pytorch",
        "supported_prompts": ["point", "bbox", "text"],
        "models": [
            {
                "id": "grounded-sam2-detection",
                "display_name": "gsam2 检测",
                "task": "detection",
                "infra": "pytorch",
                "supported_geometric_outputs": ["bbox"],
            },
            {
                "id": "grounded-sam2-tracker",
                "display_name": "gsam2 追踪",
                "task": "tracker",
                "infra": "pytorch",
                "supported_geometric_outputs": ["bbox"],
            },
        ],
    }
    probe = AsyncMock(return_value=fake_live_setup)
    monkeypatch.setattr(svc, "_probe_setup", probe)

    # 注册 backend 但 health_meta 是协议 v1 时代的快照 (无 capabilities)
    backend = MLBackend(
        id=uuid.uuid4(),
        project_id=proj.id,
        name="gsam2.legacy",
        url="http://gsam2-legacy:8001",
        state="connected",
        is_interactive=True,
        auth_method="none",
        extra_params={},
        health_meta={"gpu_info": {"memory_used_mb": 100}},  # 没 capabilities
    )
    db_session.add(backend)
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    assert r.status_code == 200
    insts = r.json()["instances"]
    assert len(insts) == 1
    assert insts[0]["source"] == "registered"
    assert insts[0]["name"] == "gsam2.legacy"
    assert len(insts[0]["models"]) == 2
    tasks = {m["task"] for m in insts[0]["models"]}
    assert tasks == {"detection", "tracker"}
    probe.assert_called_once()


@pytest.mark.asyncio
async def test_instances_no_sensitive_fields_leaked(
    httpx_client, auth_headers, db_session, super_admin, monkeypatch
):
    """字段裁剪: response 中不出现 url / gpu_info / cache / health_meta 等运维敏感字段。"""
    from app.services import capability_instances as svc

    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, name="P-Leak")

    monkeypatch.setattr(svc, "_observe_urls", lambda: [])

    backend = MLBackend(
        id=uuid.uuid4(),
        project_id=proj.id,
        name="leaky",
        url="http://secret-internal:8001",
        state="connected",
        is_interactive=False,
        auth_method="none",
        extra_params={"auth_token_hint": "should-not-leak"},
        health_meta={
            "gpu_info": {"memory_used_mb": 12345},
            "cache": {"hits": 999},
            "capabilities": {
                "infra": "pytorch",
                "models": [
                    {
                        "id": "m1",
                        "display_name": "M1",
                        "task": "detection",
                        "supported_geometric_outputs": ["bbox"],
                    }
                ],
            },
        },
    )
    db_session.add(backend)
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    body = r.text
    assert "secret-internal" not in body
    assert "gpu_info" not in body
    assert "memory_used_mb" not in body
    assert "auth_token_hint" not in body
    assert "12345" not in body


# ---------- v0.14.14: warmup_endpoint 在 instances 中暴露 ----------


@pytest.mark.asyncio
async def test_instances_warmup_endpoint_from_env_only(
    httpx_client, auth_headers, db_session, super_admin, monkeypatch
):
    """env-only backend 自报 warmup_endpoint=true 时, instances 响应应带 true."""
    from app.services import capability_instances as svc

    user, _ = super_admin
    await create_project(db_session, owner_id=user.id, name="P-Warm")

    fake_setup = {
        "name": "yolo-env",
        "infra": "pytorch",
        "warmup_endpoint": True,
        "models": [
            {
                "id": "detect",
                "task": "detection",
                "supported_geometric_outputs": ["bbox"],
            }
        ],
    }
    monkeypatch.setattr(svc, "_observe_urls", lambda: ["http://yolo-env:8003"])
    monkeypatch.setattr(svc, "_probe_setup", AsyncMock(return_value=fake_setup))

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    data = r.json()
    assert data["instances"][0]["warmup_endpoint"] is True


@pytest.mark.asyncio
async def test_instances_warmup_endpoint_false_when_missing(
    httpx_client, auth_headers, db_session, super_admin, monkeypatch
):
    """老 backend (没 warmup_endpoint 字段) → instances.warmup_endpoint=False."""
    from app.services import capability_instances as svc

    user, _ = super_admin
    await create_project(db_session, owner_id=user.id, name="P-NoWarm")

    fake_setup = {
        "name": "legacy",
        "infra": "pytorch",
        # 没有 warmup_endpoint 字段
        "models": [
            {
                "id": "detect",
                "task": "detection",
                "supported_geometric_outputs": ["bbox"],
            }
        ],
    }
    monkeypatch.setattr(svc, "_observe_urls", lambda: ["http://legacy:8000"])
    monkeypatch.setattr(svc, "_probe_setup", AsyncMock(return_value=fake_setup))

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    data = r.json()
    assert data["instances"][0]["warmup_endpoint"] is False
