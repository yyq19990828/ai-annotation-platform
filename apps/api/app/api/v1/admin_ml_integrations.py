"""v0.9.3 · 超管 ML 集成总览。

聚合返回：
- storage：复用 storage.summarize_bucket 的两个 bucket 概览（仅 super_admin 走该端点）
- projects：跨所有项目的 ml_backends 列表，按 project 分组（保留 backend.url 但不返回 auth_token）

v0.9.6 · 加 /probe (无 DB 副作用的 health check) + /runtime-hints (前端 modal placeholder).
"""

from __future__ import annotations

import time
from typing import Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.enums import UserRole
from app.db.models.ml_backend import MLBackend
from app.db.models.project import Project
from app.db.models.user import User
from app.deps import get_db, require_roles
from app.schemas.ml_backend import MLBackendOut
from app.schemas.storage import BucketSummary
from app.services.storage import storage_service

router = APIRouter()


class ProjectMLBackendsGroup(BaseModel):
    project_id: str
    project_name: str
    backends: list[MLBackendOut]


class StorageOverview(BaseModel):
    items: list[BucketSummary]
    total_object_count: int
    total_size_bytes: int


class MLIntegrationsOverview(BaseModel):
    storage: StorageOverview
    projects: list[ProjectMLBackendsGroup]
    total_backends: int
    connected_backends: int


@router.get("/overview", response_model=MLIntegrationsOverview)
async def get_overview(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
):
    bucket_roles = {
        storage_service.bucket: "annotations",
        storage_service.datasets_bucket: "datasets",
    }
    items: list[BucketSummary] = []
    for b, role in bucket_roles.items():
        try:
            summary = storage_service.summarize_bucket(b)
            items.append(BucketSummary(role=role, **summary))
        except Exception as e:
            items.append(
                BucketSummary(
                    name=b,
                    status="error",
                    object_count=0,
                    total_size_bytes=0,
                    error=str(e)[:200],
                    role=role,
                )
            )
    storage_overview = StorageOverview(
        items=items,
        total_object_count=sum(i.object_count for i in items),
        total_size_bytes=sum(i.total_size_bytes for i in items),
    )

    res = await db.execute(
        select(MLBackend).order_by(MLBackend.project_id, MLBackend.created_at.desc())
    )
    backends = list(res.scalars().all())
    project_ids = {b.project_id for b in backends}
    projects_by_id: dict = {}
    if project_ids:
        pres = await db.execute(select(Project).where(Project.id.in_(project_ids)))
        for p in pres.scalars().all():
            projects_by_id[p.id] = p

    grouped: dict[str, ProjectMLBackendsGroup] = {}
    for b in backends:
        proj = projects_by_id.get(b.project_id)
        pid_str = str(b.project_id)
        if pid_str not in grouped:
            grouped[pid_str] = ProjectMLBackendsGroup(
                project_id=pid_str,
                project_name=proj.name if proj else "(已删除项目)",
                backends=[],
            )
        grouped[pid_str].backends.append(MLBackendOut.model_validate(b))

    return MLIntegrationsOverview(
        storage=storage_overview,
        projects=list(grouped.values()),
        total_backends=len(backends),
        connected_backends=sum(1 for b in backends if b.state == "connected"),
    )


# ── v0.9.6 · /probe + /runtime-hints ──────────────────────────────────


class ProbeRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=500)
    auth_method: Literal["none", "token"] = "none"
    auth_token: str | None = Field(default=None, max_length=500)


class ProbeResponse(BaseModel):
    """v0.9.6 · 无 DB 副作用的 health check.
    前端注册 modal 在保存前可调本端点验证连通性, 避免「先存再 health 失败 / DB 留无效行」摩擦.
    """

    ok: bool
    latency_ms: int
    status_code: int | None = None
    error: str | None = None
    gpu_info: dict | None = None
    cache: dict | None = None
    model_version: str | None = None


@router.post("/probe", response_model=ProbeResponse)
async def probe_backend(
    payload: ProbeRequest,
    _admin: User = Depends(require_roles(UserRole.PROJECT_ADMIN, UserRole.SUPER_ADMIN)),
):
    """探测一个 ML backend URL 的 /health 端点; 不写 DB."""
    headers = {"Content-Type": "application/json"}
    if payload.auth_method == "token" and payload.auth_token:
        headers["Authorization"] = f"Bearer {payload.auth_token}"
    base = payload.url.rstrip("/")
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=settings.ml_health_timeout) as client:
            resp = await client.get(f"{base}/health", headers=headers)
        latency_ms = int((time.monotonic() - start) * 1000)
        if resp.status_code != 200:
            return ProbeResponse(
                ok=False,
                latency_ms=latency_ms,
                status_code=resp.status_code,
                error=f"HTTP {resp.status_code}",
            )
        try:
            data = resp.json()
        except Exception:
            return ProbeResponse(
                ok=False,
                latency_ms=latency_ms,
                status_code=resp.status_code,
                error="响应非 JSON",
            )
        # ML backend /health 返回示例: { ok, gpu, gpu_info, cache, model_version, loaded }
        return ProbeResponse(
            ok=bool(data.get("ok", True)),
            latency_ms=latency_ms,
            status_code=resp.status_code,
            gpu_info=data.get("gpu_info"),
            cache=data.get("cache"),
            model_version=data.get("model_version"),
        )
    except (httpx.TimeoutException, httpx.RequestError) as e:
        latency_ms = int((time.monotonic() - start) * 1000)
        return ProbeResponse(
            ok=False,
            latency_ms=latency_ms,
            error=str(e)[:200] or "连接失败",
        )


class RuntimeHints(BaseModel):
    """v0.9.6 · 前端 modal 启动时一次性查; 提供注册 form 的 placeholder hint."""

    ml_backend_default_url: str | None = None


@router.get("/runtime-hints", response_model=RuntimeHints)
async def runtime_hints(
    _admin: User = Depends(require_roles(UserRole.PROJECT_ADMIN, UserRole.SUPER_ADMIN)),
):
    return RuntimeHints(
        ml_backend_default_url=settings.ml_backend_default_url or None,
    )


# ─── v0.9.7 · 全局 backend 列表 ────────────────────────────────────────


class GlobalBackendItem(BaseModel):
    """v0.9.7 · CreateProjectWizard step 4 dropdown 用的 backend 概要项."""

    id: str
    name: str
    url: str
    state: str
    is_interactive: bool
    auth_method: str
    health_meta: dict | None = None
    source_project_id: str
    source_project_name: str
    last_checked_at: str | None = None


class GlobalBackendListResponse(BaseModel):
    items: list[GlobalBackendItem]


@router.get("/all", response_model=GlobalBackendListResponse)
async def list_all_backends(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_roles(UserRole.PROJECT_ADMIN, UserRole.SUPER_ADMIN)),
) -> GlobalBackendListResponse:
    """列系统内所有 ml_backends, 含 source project name 作为来源标签.

    用于 CreateProjectWizard step 4 让用户选「复用一个已注册 backend」, 复用时
    create_project 端点会复制 row 入新项目 (保留 url/auth/extra_params, 重置 state).
    """
    res = await db.execute(
        select(MLBackend, Project.name)
        .join(Project, Project.id == MLBackend.project_id)
        .order_by(MLBackend.last_checked_at.desc().nullslast())
    )
    items: list[GlobalBackendItem] = []
    seen_urls: set[str] = set()
    for backend, project_name in res.all():
        # 同 url 多项目共享时只保留最新 health 的一份, 避免 dropdown 出 N 行重复
        if backend.url in seen_urls:
            continue
        seen_urls.add(backend.url)
        items.append(
            GlobalBackendItem(
                id=str(backend.id),
                name=backend.name,
                url=backend.url,
                state=backend.state,
                is_interactive=backend.is_interactive,
                auth_method=backend.auth_method,
                health_meta=backend.health_meta,
                source_project_id=str(backend.project_id),
                source_project_name=project_name or "(未命名项目)",
                last_checked_at=backend.last_checked_at.isoformat()
                if backend.last_checked_at
                else None,
            )
        )
    return GlobalBackendListResponse(items=items)
