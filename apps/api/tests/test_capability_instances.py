"""GET /v1/ml-capabilities/instances 端点测试.

v0.19.0 ADR-0044 · 数据源统一为全局注册表 ml_backend_registry (无 project 作用域,
url unique)。env 配的 backend 启动钩子已 upsert 成 source='env' 行, 不再有 env-only
临时探测分支; instance.source 取注册行的 source ('manual' | 'env')。

覆盖:
- 401 未登录 (鉴权与 /protocol 一致, 登录用户可访问)。
- 多个全局注册项 (source=env / manual) 合并返回。
- health_meta 快照命中时不做 live /setup 探测; 快照缺 models 时 fallback live 探测。
- 字段裁剪: 不暴露 url / health_meta / gpu_info / cache。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from app.db.models.ml_backend_registry import MLBackendRegistry


@pytest.mark.asyncio
async def test_instances_requires_auth(httpx_client):
    r = await httpx_client.get("/api/v1/ml-capabilities/instances")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_instances_returns_empty_when_no_backend(httpx_client, auth_headers):
    """全局注册表为空 → instances 为空。"""
    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    assert r.status_code == 200
    assert r.json() == {"instances": []}


@pytest.mark.asyncio
async def test_instances_returns_env_and_manual_registry_rows(
    httpx_client, auth_headers, db_session
):
    """source=env 与 source=manual 的全局注册项同时返回, source 透传注册行。"""
    db_session.add_all(
        [
            MLBackendRegistry(
                id=uuid.uuid4(),
                name="gsam2-env",
                url="http://gsam2:8001",
                state="connected",
                is_interactive=True,
                auth_method="none",
                extra_params={},
                source="env",
                health_meta={
                    "capabilities": {
                        "infra": "pytorch",
                        "models": [
                            {
                                "id": "gsam2-detection",
                                "display_name": "gsam2-det",
                                "task": "detection",
                                "infra": "pytorch",
                                "supported_geometric_outputs": ["bbox"],
                            }
                        ],
                    }
                },
            ),
            MLBackendRegistry(
                id=uuid.uuid4(),
                name="sam3-registered",
                url="http://sam3:8002",
                state="connected",
                is_interactive=True,
                auth_method="none",
                extra_params={},
                source="manual",
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
            ),
        ]
    )
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data["instances"]) == 2

    by_name = {inst["name"]: inst for inst in data["instances"]}
    env_inst = by_name["gsam2-env"]
    assert env_inst["source"] == "env"
    assert env_inst["infra"] == "pytorch"
    assert len(env_inst["models"]) == 1
    assert env_inst["models"][0]["task"] == "detection"

    reg_inst = by_name["sam3-registered"]
    assert reg_inst["source"] == "manual"
    assert reg_inst["infra"] == "pytorch"
    assert reg_inst["models"][0]["task"] == "detection"


@pytest.mark.asyncio
async def test_instances_uses_snapshot_without_live_probe(
    httpx_client, auth_headers, db_session, monkeypatch
):
    """health_meta.capabilities 快照命中时, 直接用快照, 不发 live /setup 探测。"""
    from app.services import capability_instances as svc

    probe = AsyncMock()
    monkeypatch.setattr(svc, "_probe_setup", probe)

    db_session.add(
        MLBackendRegistry(
            id=uuid.uuid4(),
            name="snapshot-reg",
            url="http://snapshot:8001",
            state="connected",
            is_interactive=False,
            auth_method="none",
            extra_params={},
            source="manual",
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
    )
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    assert r.status_code == 200
    insts = r.json()["instances"]
    assert len(insts) == 1
    assert insts[0]["source"] == "manual"
    # 快照已含 models → 不应做 live 探测。
    probe.assert_not_called()


@pytest.mark.asyncio
async def test_instances_live_probe_when_snapshot_missing(
    httpx_client, auth_headers, db_session, monkeypatch
):
    """registered backend health_meta 缺 models 时, fallback 到 live /setup 探测。

    覆盖老 backend: state=connected 但 health_meta.capabilities 为 NULL,
    应直接探测 backend.url 拿最新 models[], 而不是被 skip 掉。
    """
    from app.services import capability_instances as svc

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
    db_session.add(
        MLBackendRegistry(
            id=uuid.uuid4(),
            name="gsam2.legacy",
            url="http://gsam2-legacy:8001",
            state="connected",
            is_interactive=True,
            auth_method="none",
            extra_params={},
            source="manual",
            health_meta={"gpu_info": {"memory_used_mb": 100}},  # 没 capabilities
        )
    )
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    assert r.status_code == 200
    insts = r.json()["instances"]
    assert len(insts) == 1
    assert insts[0]["source"] == "manual"
    assert insts[0]["name"] == "gsam2.legacy"
    assert len(insts[0]["models"]) == 2
    tasks = {m["task"] for m in insts[0]["models"]}
    assert tasks == {"detection", "tracker"}
    probe.assert_called_once()


@pytest.mark.asyncio
async def test_instances_no_sensitive_fields_leaked(
    httpx_client, auth_headers, db_session
):
    """字段裁剪: response 中不出现 url / gpu_info / cache / health_meta 等运维敏感字段。"""
    db_session.add(
        MLBackendRegistry(
            id=uuid.uuid4(),
            name="leaky",
            url="http://secret-internal:8001",
            state="connected",
            is_interactive=False,
            auth_method="none",
            extra_params={"auth_token_hint": "should-not-leak"},
            source="manual",
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
    )
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


# ---------- warmup_endpoint 在 instances 中暴露 ----------


@pytest.mark.asyncio
async def test_instances_warmup_endpoint_true(httpx_client, auth_headers, db_session):
    """backend 自报 warmup_endpoint=true 时, instances 响应应带 true."""
    db_session.add(
        MLBackendRegistry(
            id=uuid.uuid4(),
            name="yolo-env",
            url="http://yolo-env:8003",
            state="connected",
            auth_method="none",
            extra_params={},
            source="env",
            health_meta={
                "capabilities": {
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
            },
        )
    )
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    data = r.json()
    assert data["instances"][0]["warmup_endpoint"] is True


@pytest.mark.asyncio
async def test_instances_warmup_endpoint_false_when_missing(
    httpx_client, auth_headers, db_session
):
    """老 backend (没 warmup_endpoint 字段) → instances.warmup_endpoint=False."""
    db_session.add(
        MLBackendRegistry(
            id=uuid.uuid4(),
            name="legacy",
            url="http://legacy:8000",
            state="connected",
            auth_method="none",
            extra_params={},
            source="manual",
            health_meta={
                "capabilities": {
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
            },
        )
    )
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    data = r.json()
    assert data["instances"][0]["warmup_endpoint"] is False


# ---------- v0.19.2 WS0 · supported_inputs + resource_profile 透传 ----------


@pytest.mark.asyncio
async def test_instances_passthrough_supported_inputs_and_resource_profile(
    httpx_client, auth_headers, db_session
):
    """WS0: /instances 现透传 supported_inputs + resource_profile (原被裁掉),

    供全局编排选择器消费投递契约 / 批量画像; 缺字段时 → [] / {}。
    """
    db_session.add_all(
        [
            MLBackendRegistry(
                id=uuid.uuid4(),
                name="onnxtools-env",
                url="http://onnxtools:8004",
                state="connected",
                auth_method="none",
                extra_params={},
                source="env",
                health_meta={
                    "capabilities": {
                        "infra": "onnx",
                        "models": [
                            {
                                "id": "classify",
                                "task": "classification",
                                "supported_inputs": ["crop", "full_image"],
                                "resource_profile": {
                                    "device": "gpu",
                                    "batchable": True,
                                },
                                "output_attribute_types": ["class"],
                            }
                        ],
                    }
                },
            ),
            MLBackendRegistry(
                id=uuid.uuid4(),
                name="legacy-no-fields",
                url="http://legacy2:8005",
                state="connected",
                auth_method="none",
                extra_params={},
                source="manual",
                health_meta={
                    "capabilities": {
                        "infra": "pytorch",
                        "models": [
                            {
                                "id": "detect",
                                "task": "detection",
                                "supported_geometric_outputs": ["bbox"],
                            }
                        ],
                    }
                },
            ),
        ]
    )
    await db_session.flush()

    r = await httpx_client.get(
        "/api/v1/ml-capabilities/instances", headers=auth_headers
    )
    assert r.status_code == 200
    by_name = {inst["name"]: inst for inst in r.json()["instances"]}

    m = by_name["onnxtools-env"]["models"][0]
    assert m["supported_inputs"] == ["crop", "full_image"]
    assert m["resource_profile"] == {"device": "gpu", "batchable": True}

    legacy = by_name["legacy-no-fields"]["models"][0]
    assert legacy["supported_inputs"] == []
    assert legacy["resource_profile"] == {}
