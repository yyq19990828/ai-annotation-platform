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
import json
import logging
import random
from datetime import datetime, timezone

import redis as redis_sync
from sqlalchemy import select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings
from app.db.base import async_session
from app.db.models.ml_backend import MLBackend
from app.services.ml_backend import MLBackendService
from app.services.ml_client import MLBackendClient
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


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
            # ml_backends 无 is_active 字段; state == 'disconnected' 跳过 (一直 down 的 backend 不打)
            rows = (
                await db.execute(
                    select(MLBackend).where(MLBackend.state != "disconnected")
                )
            ).scalars().all()
            backends = list(rows)
    finally:
        await engine.dispose()

    snapshots: list[dict] = []
    now = datetime.now(timezone.utc).isoformat()
    for backend in backends:
        try:
            client = MLBackendClient(backend)
            ok, meta = await client.health_meta()
            snap = {
                "backend_id": str(backend.id),
                "backend_name": backend.name,
                "state": "ok" if ok else "error",
                "timestamp": now,
            }
            if meta:
                for key in ("gpu_info", "host", "cache", "model_version"):
                    if key in meta:
                        snap[key] = meta[key]
            snapshots.append(snap)
        except Exception as exc:  # noqa: BLE001 — 单 backend 失败不影响其他
            log.debug("publish_ml_backend_stats: backend=%s err=%s", backend.id, exc)
            snapshots.append(
                {
                    "backend_id": str(backend.id),
                    "backend_name": backend.name,
                    "state": "error",
                    "timestamp": now,
                }
            )

    r2 = redis_sync.from_url(settings.redis_url)
    try:
        # 单帧 publish 整个 list, 前端按 backend_id 路由到对应 PerfHud panel
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
    async with async_session() as db:
        rows = (await db.execute(select(MLBackend.id))).scalars().all()
        backend_ids = list(rows)

    results: list[dict] = []
    for backend_id in backend_ids:
        if jitter_max_seconds > 0:
            await asyncio.sleep(random.uniform(0, jitter_max_seconds))
        try:
            async with async_session() as db:
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
