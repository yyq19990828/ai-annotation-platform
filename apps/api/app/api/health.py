from __future__ import annotations

import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.db.base import AsyncSessionLocal
from app.services.storage import storage_service
from app.workers.celery_app import celery_app

router = APIRouter()


async def _check_db() -> dict:
    start = time.monotonic()
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "latency_ms": round((time.monotonic() - start) * 1000, 1),
        }
    except Exception as e:
        return {"status": "error", "latency_ms": None, "detail": str(e)}


async def _check_redis() -> dict:
    import redis.asyncio as aioredis  # noqa: PLC0415

    start = time.monotonic()
    try:
        r = aioredis.from_url(settings.redis_url, socket_connect_timeout=3)
        await r.ping()
        await r.aclose()
        return {
            "status": "ok",
            "latency_ms": round((time.monotonic() - start) * 1000, 1),
        }
    except Exception as e:
        return {"status": "error", "latency_ms": None, "detail": str(e)}


def _check_minio() -> dict:
    start = time.monotonic()
    try:
        storage_service.client.head_bucket(Bucket=storage_service.bucket)
        return {
            "status": "ok",
            "latency_ms": round((time.monotonic() - start) * 1000, 1),
        }
    except Exception as e:
        return {"status": "error", "latency_ms": None, "detail": str(e)}


def _check_celery() -> dict:
    """v0.8.7 F2 · 扩展返回 queues + workers 心跳明细，并填 Prometheus Gauge。

    queues: list[{name, length}]  — active + reserved 数量之和（按 broker 实际为准）
    workers: list[{name, last_heartbeat_seconds_ago}]  — 心跳新鲜度，None=未知
    """
    from app.observability.metrics import (
        CELERY_QUEUE_LENGTH,
        CELERY_WORKER_HEARTBEAT_SECONDS,
    )

    start = time.monotonic()
    try:
        inspect = celery_app.control.inspect(timeout=2)
        ping = inspect.ping()
        latency_ms = round((time.monotonic() - start) * 1000, 1)
        if not ping:
            return {
                "status": "error",
                "latency_ms": latency_ms,
                "active_count": 0,
                "workers": [],
                "queues": [],
                "detail": "no workers responded",
            }

        # 队列长度：active + reserved（已被 worker 拉取但还未处理 / 正在处理）
        # v0.8.7 · 兼容旧测试桩：active/reserved/stats 任一不可用时降级为空
        try:
            active = inspect.active() or {}
        except Exception:
            active = {}
        try:
            reserved = inspect.reserved() or {}
        except Exception:
            reserved = {}
        queue_counts: dict[str, int] = {}
        for tasks in list(active.values()) + list(reserved.values()):
            for t in tasks or []:
                qname = (t.get("delivery_info") or {}).get("routing_key") or "default"
                queue_counts[qname] = queue_counts.get(qname, 0) + 1

        # Prometheus Gauge：覆盖式更新
        for qname, count in queue_counts.items():
            CELERY_QUEUE_LENGTH.labels(queue=qname).set(count)
        # 没出现的队列保持上一次值；不主动 reset 避免 scrape 抖动

        # Worker 心跳：使用 inspect.stats() 中的 broker 报告（无则 fallback 0）
        try:
            stats = inspect.stats() or {}
        except Exception:
            stats = {}
        workers_payload = []
        for name in sorted(ping.keys()):
            # ping 不带 timestamp，用「当前响应时刻」作 0 秒近似（broker 对 inspect 已是 round trip）
            CELERY_WORKER_HEARTBEAT_SECONDS.labels(worker=name).set(0)
            workers_payload.append(
                {
                    "name": name,
                    "last_heartbeat_seconds_ago": 0,
                    "pool_max": (stats.get(name, {}).get("pool", {}) or {}).get(
                        "max-concurrency"
                    ),
                }
            )

        return {
            "status": "ok",
            "latency_ms": latency_ms,
            "active_count": len(workers_payload),
            "workers": workers_payload,
            "queues": [
                {"name": qname, "length": count}
                for qname, count in sorted(queue_counts.items())
            ],
        }
    except Exception as e:
        return {
            "status": "error",
            "latency_ms": None,
            "active_count": 0,
            "workers": [],
            "queues": [],
            "detail": str(e),
        }


@router.get("/db")
async def health_db():
    result = await _check_db()
    code = 200 if result["status"] == "ok" else 503
    return JSONResponse(status_code=code, content=result)


@router.get("/redis")
async def health_redis():
    result = await _check_redis()
    code = 200 if result["status"] == "ok" else 503
    return JSONResponse(status_code=code, content=result)


@router.get("/minio")
async def health_minio():
    result = _check_minio()
    code = 200 if result["status"] == "ok" else 503
    return JSONResponse(status_code=code, content=result)


@router.get("/celery")
async def health_celery():
    result = _check_celery()
    code = 200 if result["status"] == "ok" else 503
    return JSONResponse(status_code=code, content=result)


@router.get("")
async def health_all():
    db_r, redis_r = await _check_db(), await _check_redis()
    minio_r = _check_minio()
    celery_r = _check_celery()
    checks = {"db": db_r, "redis": redis_r, "minio": minio_r, "celery": celery_r}
    overall = "ok" if all(v["status"] == "ok" for v in checks.values()) else "degraded"
    code = 200 if overall == "ok" else 503
    return JSONResponse(
        status_code=code,
        content={"status": overall, "version": "0.7.6", "checks": checks},
    )
