"""v0.8.6 F2 · ML Backend 周期健康检查任务

每 60s 扫描所有 ML Backend，调用 `/health` 端点更新 `state` + `last_checked_at`。
单 Celery task 内串行扫描所有 backend，每个 backend 调用前 0-3s 抖动错峰，
避免同节点 backend 同时被打 health 触发 GPU CUDA 上下文 contention。

设计理由参考 `docs/plans/2026-05-07-v0.8.6-rustling-raven.md` §F2。

v0.9.11 PerfHud · 新增 publish_ml_backend_stats: 每 1s 把所有 is_active=true backend 的
/health 实时快照 publish 到 redis channel `ml-backend-stats:global`. 仅在 WS 订阅者 > 0
时执行实拉 (Redis key `ml-backend-stats:subscribers` 计数门控), 节省 GPU 探活成本.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
from datetime import datetime, timezone
from urllib.parse import urlparse

import redis as redis_sync
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.db.models.ml_backend_registry import MLBackendRegistry as MLBackend
from app.services.ml_backend import MLBackendService
from app.workers._db import task_session
from app.services.ml_client import MLBackendClient
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)

_PERFHUD_META_KEYS = (
    "gpu_info",
    "host",
    "cache",
    "model_version",
    "loaded",
    "idle_unload_seconds",
    "last_request_age_seconds",
    "pool",
    "video_pool",
)


def _build_stats_snapshot(
    backend: MLBackend,
    *,
    ok: bool,
    meta: dict | None,
    timestamp: str,
    physical_key: str | None = None,
    url_host: str | None = None,
    bindings: list[dict] | None = None,
) -> dict:
    snap = {
        "physical_key": physical_key or f"backend:{backend.id}",
        "url_host": url_host,
        "backend_id": str(backend.id),
        "backend_name": backend.name,
        "bindings": bindings or [_binding_for_backend(backend)],
        "state": "ok" if ok else "error",
        "timestamp": timestamp,
    }
    if meta:
        for key in _PERFHUD_META_KEYS:
            if key in meta:
                snap[key] = meta[key]
    return snap


def _endpoint_identity(url: str) -> tuple[str, str] | None:
    """Return a stable physical endpoint identity and a user-facing host label."""
    parsed = urlparse(url if "://" in url else f"//{url}")
    host = (parsed.hostname or "").lower()
    if not host:
        return None
    scheme = parsed.scheme or "http"
    hostport = f"{host}:{parsed.port}" if parsed.port else host
    return f"{scheme}://{hostport}", hostport


def _backend_group_key(backend: MLBackend) -> tuple[str, str, str | None]:
    endpoint = _endpoint_identity(backend.url)
    if endpoint is None:
        fallback = f"backend:{backend.id}"
        return fallback, fallback, None
    endpoint_key, hostport = endpoint
    auth_key = f"{backend.auth_method}:{backend.auth_token or ''}"
    if backend.auth_method == "none" and not backend.auth_token:
        public_key = endpoint_key
    else:
        auth_fingerprint = hashlib.sha256(auth_key.encode("utf-8")).hexdigest()[:8]
        public_key = f"{endpoint_key}|auth:{auth_fingerprint}"
    return f"{endpoint_key}|auth:{auth_key}", public_key, hostport


def _binding_for_backend(
    backend: MLBackend,
    *,
    project_display_id: str | None = None,
    project_name: str | None = None,
) -> dict:
    return {
        "backend_id": str(backend.id),
        "backend_name": backend.name,
        # v0.19.0 ADR-0044 · backend 全局化, 不再属于单一项目; 项目归属由 project_ml_backend
        # 关联表表达 (健康概览不再按项目拆分)。
        "project_id": None,
        "project_display_id": project_display_id,
        "project_name": project_name,
    }


def _group_backend_rows(
    rows: list[tuple[MLBackend, str | None, str | None]],
) -> list[dict]:
    grouped: dict[str, dict] = {}
    for backend, project_display_id, project_name in rows:
        group_key, physical_key, url_host = _backend_group_key(backend)
        group = grouped.setdefault(
            group_key,
            {
                "backend": backend,
                "physical_key": physical_key,
                "url_host": url_host,
                "bindings": [],
            },
        )
        group["bindings"].append(
            _binding_for_backend(
                backend,
                project_display_id=project_display_id,
                project_name=project_name,
            )
        )
    return list(grouped.values())


@celery_app.task(name="app.workers.ml_health.check_ml_backends_health")
def check_ml_backends_health() -> dict:
    return asyncio.run(_run_async())


async def _run_async() -> dict:
    return await check_all_backends()


@celery_app.task(name="app.workers.ml_health.publish_ml_backend_stats")
def publish_ml_backend_stats() -> dict:
    """v0.9.11 PerfHud · 1s 实时快照推送到 WS. 0 订阅者时短路 skip."""
    return asyncio.run(_publish_stats_async())


async def _publish_stats_async() -> dict:
    r = redis_sync.from_url(settings.redis_url)
    try:
        raw = r.get("ml-backend-stats:subscribers")
    except Exception as e:  # noqa: BLE001
        log.debug("subscribers key read failed: %s", e)
        raw = None
    finally:
        try:
            r.close()
        except Exception:
            pass
    try:
        subscribers = int(raw) if raw is not None else 0
    except (TypeError, ValueError):
        subscribers = 0
    if subscribers <= 0:
        return {"skipped": True, "subscribers": 0}

    # Celery prefork + 全局 asyncpg engine 共享会触发 "another operation in progress",
    # 用 per-task engine + NullPool 模式 (与 tasks._run_batch 一致). 1s 高频但单次 < 50ms.
    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    try:
        async with SessionLocal() as db:
            # 全局注册表; state == 'disconnected' 跳过 (一直 down 的 backend 不打)
            backends = (
                await db.execute(
                    select(MLBackend)
                    .where(MLBackend.state != "disconnected")
                    .order_by(MLBackend.created_at.asc())
                )
            ).scalars().all()
            rows = [(b, None, None) for b in backends]
    finally:
        await engine.dispose()

    snapshots: list[dict] = []
    now = datetime.now(timezone.utc).isoformat()
    for group in _group_backend_rows(list(rows)):
        backend = group["backend"]
        try:
            client = MLBackendClient(backend)
            ok, meta = await client.health_meta()
            snapshots.append(
                _build_stats_snapshot(
                    backend,
                    ok=ok,
                    meta=meta,
                    timestamp=now,
                    physical_key=group["physical_key"],
                    url_host=group["url_host"],
                    bindings=group["bindings"],
                )
            )
        except Exception as exc:  # noqa: BLE001 — 单 backend 失败不影响其他
            log.debug("publish_ml_backend_stats: backend=%s err=%s", backend.id, exc)
            snapshots.append(
                {
                    "physical_key": group["physical_key"],
                    "url_host": group["url_host"],
                    "backend_id": str(backend.id),
                    "backend_name": backend.name,
                    "bindings": group["bindings"],
                    "state": "error",
                    "timestamp": now,
                }
            )

    r2 = redis_sync.from_url(settings.redis_url)
    try:
        # 单帧 publish 整个 list, 前端按 physical_key 路由到对应 PerfHud panel.
        r2.publish(
            "ml-backend-stats:global",
            json.dumps({"backends": snapshots, "timestamp": now}),
        )
    finally:
        try:
            r2.close()
        except Exception:
            pass
    return {"published": len(snapshots), "subscribers": subscribers}


async def check_all_backends(jitter_max_seconds: float = 3.0) -> dict:
    """串行扫描所有 ML Backend；每个 backend 检查前抖动 0~jitter_max 秒错峰。

    返回 ``{"checked": N, "results": [{"id":..., "state":..., "healthy":bool}, ...]}``。
    """
    async with task_session() as db:
        rows = (await db.execute(select(MLBackend.id))).scalars().all()
        backend_ids = list(rows)

    results: list[dict] = []
    for backend_id in backend_ids:
        if jitter_max_seconds > 0:
            await asyncio.sleep(random.uniform(0, jitter_max_seconds))
        try:
            async with task_session() as db:
                svc = MLBackendService(db)
                healthy = await svc.check_health(backend_id)
                await db.commit()
                # 重新读取以拿到 fresh state
                fresh = await svc.get(backend_id)
                results.append(
                    {
                        "id": str(backend_id),
                        "state": fresh.state if fresh else "unknown",
                        "healthy": healthy,
                    }
                )
        except Exception as exc:  # noqa: BLE001 — 单个 backend 失败不影响其他
            log.warning(
                "check_ml_backends_health: backend=%s failed: %s", backend_id, exc
            )
            results.append({"id": str(backend_id), "state": "error", "healthy": False})

    log.info(
        "check_ml_backends_health: checked=%d at=%s",
        len(results),
        datetime.now(timezone.utc).isoformat(),
    )
    return {"checked": len(results), "results": results}
