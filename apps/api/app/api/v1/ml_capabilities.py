"""v0.14.11 · 协议级能力目录端点 (与 ml backend 注册解耦).

- `GET /v1/ml-capabilities/protocol` 返回 task / infra / modality / geometry
  四张受控词表 + 每条 task 的人类可读元数据。
- 登录用户即可访问 (与 /model-market 页面同权限); 不暴露任何 backend 实例信息,
  因此不限 super_admin。
- 响应为常量级别 SSOT 派生, 进程内构造一次后冻结, ETag + 304 缓存。
"""

from __future__ import annotations

import hashlib
import json

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.user import User
from app.deps import get_current_user, get_db
from app.schemas.ml_capabilities import (
    CapabilityInstanceItem,
    CapabilityInstancesResponse,
    InstanceModelItem,
    ProtocolCapabilitiesResponse,
    ProtocolGeometryItem,
    ProtocolInfraItem,
    ProtocolModalityItem,
    ProtocolPromptItem,
    ProtocolTaskItem,
    SuggestedBackendItem,
)
from app.services.capability_instances import load_capability_instances
from app.services.capability_registry import (
    GEOMETRIES,
    INFRAS,
    MODALITIES,
    PROMPTS,
    TASKS,
)

router = APIRouter()


def _build_payload() -> ProtocolCapabilitiesResponse:
    return ProtocolCapabilitiesResponse(
        version="v2",
        tasks=[
            ProtocolTaskItem(
                id=t.id,
                label=t.label,
                summary=t.summary,
                default_geometry=list(t.default_geometry),
                default_modalities=list(t.default_modalities),
                typical_models=list(t.typical_models),
                protocol_notes=t.protocol_notes,
                suggested_backends=[
                    SuggestedBackendItem(
                        name=s.name,
                        repo_url=s.repo_url,
                        summary=s.summary,
                        research_link=s.research_link,
                        infra=s.infra,
                        builtin=s.builtin,
                    )
                    for s in t.suggested_backends
                ],
            )
            for t in TASKS
        ],
        infras=[
            ProtocolInfraItem(id=s.id, label=s.label, summary=s.summary) for s in INFRAS
        ],
        modalities=[
            ProtocolModalityItem(id=s.id, label=s.label, summary=s.summary)
            for s in MODALITIES
        ],
        geometries=[
            ProtocolGeometryItem(id=s.id, label=s.label, summary=s.summary)
            for s in GEOMETRIES
        ],
        prompts=[
            ProtocolPromptItem(
                id=s.id,
                label=s.label,
                summary=s.summary,
                requires_input=s.requires_input,
                interactive_route=s.interactive_route,
            )
            for s in PROMPTS
        ],
    )


# 进程内冻结的 payload + ETag (SSOT 是模块常量, 一次构造即可)。
_PAYLOAD: ProtocolCapabilitiesResponse = _build_payload()
_PAYLOAD_JSON: str = _PAYLOAD.model_dump_json()
_ETAG: str = (
    'W/"'
    + hashlib.sha256(
        json.dumps(json.loads(_PAYLOAD_JSON), sort_keys=True).encode()
    ).hexdigest()[:16]
    + '"'
)


@router.get(
    "/protocol",
    response_model=ProtocolCapabilitiesResponse,
    responses={304: {"description": "Not Modified"}},
)
async def get_protocol_capabilities(
    request: Request,
    response: Response,
    _: User = Depends(get_current_user),
) -> ProtocolCapabilitiesResponse | Response:
    """协议级能力目录 (静态 SSOT, 与 backend 注册无关)。

    `Cache-Control: private, max-age=300` + `ETag`。客户端二次请求带
    `If-None-Match: <etag>` 时返回 304。
    """
    if request.headers.get("if-none-match") == _ETAG:
        return Response(
            status_code=status.HTTP_304_NOT_MODIFIED, headers={"etag": _ETAG}
        )
    response.headers["etag"] = _ETAG
    response.headers["cache-control"] = "private, max-age=300"
    return _PAYLOAD


@router.get("/instances", response_model=CapabilityInstancesResponse)
async def get_capability_instances(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> CapabilityInstancesResponse:
    """平台已知 backend 实例的能力清单 (与项目级注册解耦).

    数据源:
    - env-only: settings.ml_backend_observe_urls 配的容器, 探测 /setup;
    - registered: ml_backends 表中 state=connected 的项, 读 health_meta 快照。

    字段裁剪: 不暴露 url / gpu_info / cache / pool 等运维敏感信息,
    让普通登录用户也能看到完整 model 清单。
    """
    raw = await load_capability_instances(db)
    return CapabilityInstancesResponse(
        instances=[
            CapabilityInstanceItem(
                source=item["source"],
                name=item["name"],
                infra=item["infra"],
                # v0.14.14 · backend 自报是否支持 POST /warmup (协议 §4.4).
                warmup_endpoint=bool(item.get("warmup_endpoint", False)),
                models=[InstanceModelItem(**m) for m in item["models"]],
            )
            for item in raw
        ]
    )
