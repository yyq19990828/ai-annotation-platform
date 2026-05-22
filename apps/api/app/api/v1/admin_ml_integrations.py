"""v0.9.3 · 超管 ML 集成总览。

聚合返回：
- storage：复用 storage.summarize_bucket 的两个 bucket 概览（仅 super_admin 走该端点）
- projects：跨所有项目的 ml_backends 列表，按 project 分组（保留 backend.url 但不返回 auth_token）

v0.9.6 · 加 /probe (无 DB 副作用的 health check) + /runtime-hints (前端 modal placeholder).
"""

from __future__ import annotations

import asyncio
import time
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, Request
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
from app.services.audit import AuditService
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
        storage_service.bug_reports_bucket: "bug-reports",
        storage_service.media_cache_bucket: "media-cache",
        storage_service.audit_archive_bucket: "audit-archive",
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


# ─── v0.10.26 · 容器直连观测 (与项目注册解耦) ──────────────────────────────
#
# 即使没有任何项目注册 backend, 运维也能直连 env 配的 ML_BACKEND_OBSERVE_URLS
# 看健康度 / 变体目录 / 试启动。观测 URL 假定免鉴权 (内网 / dev); 带 token 的
# backend 仍走项目注册路径。


def _observe_urls() -> list[str]:
    """配置的观测 URL; 留空时回退 [ml_backend_default_url] (若非空)。去重保序。"""
    urls = list(settings.ml_backend_observe_urls or [])
    if not urls and settings.ml_backend_default_url:
        urls = [settings.ml_backend_default_url]
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        key = u.rstrip("/")
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out


class VariantCatalog(BaseModel):
    sam_variant: list[str] = []
    dino_variant: list[str] = []


class ObserveTarget(BaseModel):
    url: str
    ok: bool
    latency_ms: int
    status_code: int | None = None
    error: str | None = None
    gpu_info: dict | None = None
    model_version: str | None = None
    pool: dict | None = None
    video_pool: dict | None = None  # v0.10.36 · 视频追踪显存池
    cache: dict | None = None
    variant_catalog: VariantCatalog | None = None
    supported_trackers: list[
        str
    ] = []  # v0.10.36 · /setup 暴露的 video tracker model_key 列表
    supports_variants: bool = False
    registered: bool = False
    registered_label: str | None = None


class ObserveResponse(BaseModel):
    targets: list[ObserveTarget]
    configured_count: int


def _extract_variant_catalog(setup: dict | None) -> VariantCatalog | None:
    """从 /setup.params 的 enum 字段抽变体目录 (sam_variant / dino_variant)。"""
    if not setup:
        return None
    props = ((setup.get("params") or {}).get("properties")) or {}
    sam = props.get("sam_variant", {}).get("enum") or []
    dino = props.get("dino_variant", {}).get("enum") or []
    if not sam and not dino:
        return None
    return VariantCatalog(sam_variant=list(sam), dino_variant=list(dino))


async def _probe_one(client: httpx.AsyncClient, base: str) -> ObserveTarget:
    """并发探测单个观测 URL 的 /health (+ /setup 取变体目录)。"""
    start = time.monotonic()
    try:
        resp = await client.get(f"{base}/health")
        latency_ms = int((time.monotonic() - start) * 1000)
        if resp.status_code != 200:
            return ObserveTarget(
                url=base,
                ok=False,
                latency_ms=latency_ms,
                status_code=resp.status_code,
                error=f"HTTP {resp.status_code}",
            )
        health = resp.json()
    except (httpx.TimeoutException, httpx.RequestError) as e:
        return ObserveTarget(
            url=base,
            ok=False,
            latency_ms=int((time.monotonic() - start) * 1000),
            error=str(e)[:200] or "连接失败",
        )
    except Exception as e:  # noqa: BLE001 — 响应非 JSON 等
        return ObserveTarget(
            url=base,
            ok=False,
            latency_ms=int((time.monotonic() - start) * 1000),
            error=f"响应解析失败: {str(e)[:120]}",
        )

    setup: dict | None = None
    try:
        sresp = await client.get(f"{base}/setup")
        if sresp.status_code == 200:
            setup = sresp.json()
    except Exception:  # noqa: BLE001 — /setup 可选, 失败不影响观测
        setup = None

    catalog = _extract_variant_catalog(setup)
    return ObserveTarget(
        url=base,
        ok=bool(health.get("ok", True)),
        latency_ms=latency_ms,
        status_code=200,
        gpu_info=health.get("gpu_info"),
        model_version=health.get("model_version"),
        pool=health.get("pool"),
        video_pool=health.get("video_pool"),  # v0.10.36
        cache=health.get("cache"),
        variant_catalog=catalog,
        supports_variants=catalog is not None,
        supported_trackers=list(
            (setup or {}).get("supported_trackers") or []
        ),  # v0.10.36
    )


@router.get("/observe", response_model=ObserveResponse)
async def observe_backends(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> ObserveResponse:
    """直连观测 env 配的后端容器: 并发探测各 URL 的 /health + /setup, 标注是否已被注册。"""
    urls = _observe_urls()
    if not urls:
        return ObserveResponse(targets=[], configured_count=0)

    async with httpx.AsyncClient(timeout=settings.ml_health_timeout) as client:
        targets = await asyncio.gather(*[_probe_one(client, u) for u in urls])

    # 标注哪些观测 URL 已被项目注册占用 (冲突感知)。
    res = await db.execute(select(MLBackend.url, MLBackend.project_id))
    reg_by_url: dict[str, set] = {}
    for url, pid in res.all():
        reg_by_url.setdefault(url.rstrip("/"), set()).add(pid)
    proj_names: dict = {}
    all_pids = {pid for pids in reg_by_url.values() for pid in pids}
    if all_pids:
        pres = await db.execute(
            select(Project.id, Project.name).where(Project.id.in_(all_pids))
        )
        proj_names = {pid: name for pid, name in pres.all()}

    for t in targets:
        pids = reg_by_url.get(t.url.rstrip("/"))
        if pids:
            t.registered = True
            names = [proj_names.get(p, "(已删除项目)") for p in pids]
            t.registered_label = " / ".join(names)

    return ObserveResponse(targets=list(targets), configured_count=len(urls))


class SmokeTestRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=500)
    sam_variant: str | None = None
    dino_variant: str | None = None


class SmokeTestResponse(BaseModel):
    ok: bool
    skipped: bool = False
    reloaded: bool | None = None
    auto_unloaded: bool = False
    load_latency_ms: int | None = None
    loaded_variant: dict | None = None
    message: str
    error: str | None = None


@router.post("/observe/smoke-test", response_model=SmokeTestResponse)
async def smoke_test_backend(
    payload: SmokeTestRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles(UserRole.SUPER_ADMIN)),
) -> SmokeTestResponse:
    """试启动: 空池时 warm 指定变体验证可加载性, 成功后自动 /unload 还原现场。

    若容器已有变体常驻 (很可能某注册 backend 正在用), 不预热也不卸载 —— 既然已载着
    就证明能启, 避免驱逐在用模型 (不和注册的 backend 冲突)。
    """
    base = payload.url.rstrip("/")
    variant = {"sam_variant": payload.sam_variant, "dino_variant": payload.dino_variant}
    audit_detail: dict = {"url": base, **variant}

    async def _audit(result: SmokeTestResponse) -> None:
        await AuditService.log(
            db,
            actor=admin,
            action="ml_backend.smoke_tested",
            target_type="ml_backend",
            target_id=base,
            request=request,
            status_code=200,
            detail={
                **audit_detail,
                "ok": result.ok,
                "skipped": result.skipped,
                "auto_unloaded": result.auto_unloaded,
            },
        )
        await db.commit()

    async with httpx.AsyncClient(timeout=settings.ml_predict_timeout) as client:
        # 1) 看池子是否已有变体常驻。
        try:
            hresp = await client.get(
                f"{base}/health", timeout=settings.ml_health_timeout
            )
            hresp.raise_for_status()
            health = hresp.json()
        except Exception as e:  # noqa: BLE001
            r = SmokeTestResponse(
                ok=False, message="试启动失败：/health 不可达", error=str(e)[:200]
            )
            await _audit(r)
            return r

        pool = health.get("pool") or {}
        loaded_variants = pool.get("loaded_variants") or []
        was_loaded = bool(health.get("loaded")) or bool(loaded_variants)

        if was_loaded:
            r = SmokeTestResponse(
                ok=True,
                skipped=True,
                loaded_variant=loaded_variants[0] if loaded_variants else None,
                message=(
                    f"容器已有变体常驻（{loaded_variants}），可加载性已证实；"
                    "为避免驱逐在用模型，未执行试启动。"
                ),
            )
            await _audit(r)
            return r

        # 2) 空池: warm 指定变体。
        body = {k: v for k, v in variant.items() if v}
        start = time.monotonic()
        try:
            rresp = await client.post(f"{base}/reload", json=body or None)
            rresp.raise_for_status()
            reload_data = rresp.json()
        except Exception as e:  # noqa: BLE001
            r = SmokeTestResponse(
                ok=False, message="试启动失败：模型未能加载", error=str(e)[:200]
            )
            await _audit(r)
            return r
        load_latency_ms = int((time.monotonic() - start) * 1000)

        # 3) 还原现场: 卸载我们刚预热的变体 (空池时 unload 不会动到别人)。
        auto_unloaded = False
        try:
            uresp = await client.post(
                f"{base}/unload", timeout=settings.ml_health_timeout
            )
            auto_unloaded = uresp.status_code == 200
        except Exception:  # noqa: BLE001 — 卸载失败不影响「能启起来」结论, idle watcher 兜底
            auto_unloaded = False

        loaded_variant = {
            "sam_variant": reload_data.get("sam_variant"),
            "dino_variant": reload_data.get("dino_variant"),
        }
        r = SmokeTestResponse(
            ok=True,
            reloaded=reload_data.get("reloaded"),
            auto_unloaded=auto_unloaded,
            load_latency_ms=load_latency_ms,
            loaded_variant=loaded_variant,
            message=(
                f"试启动成功（加载 {load_latency_ms}ms）"
                + (
                    "，已自动卸载还原。"
                    if auto_unloaded
                    else "，但自动卸载失败，idle 超时后会释放。"
                )
            ),
        )
        await _audit(r)
        return r
