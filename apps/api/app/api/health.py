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
    start = time.monotonic()
    try:
        ping = celery_app.control.inspect(timeout=2).ping()
        latency_ms = round((time.monotonic() - start) * 1000, 1)
        if not ping:
            return {
                "status": "error",
                "latency_ms": latency_ms,
                "active_count": 0,
                "workers": [],
                "detail": "no workers responded",
            }
        workers = sorted(ping.keys())
        return {
            "status": "ok",
            "latency_ms": latency_ms,
            "active_count": len(workers),
            "workers": workers,
        }
    except Exception as e:
        return {
            "status": "error",
            "latency_ms": None,
            "active_count": 0,
            "workers": [],
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
