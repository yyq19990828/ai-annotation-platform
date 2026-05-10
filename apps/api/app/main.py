from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.v1.router import api_router
from app.api.v1.ws import router as ws_router, close_redis_pool as _close_ws_redis_pool
from app.api.v1.bug_reports import close_bug_reopen_redis_pool
from app.api.health import router as health_router
from app.core.logging import setup_logging
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.ratelimit import limiter
from app.middleware.audit import AuditMiddleware
from app.middleware.request_id import RequestIDMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.services.storage import storage_service

import logging

logger = logging.getLogger(__name__)

setup_logging(level="DEBUG" if settings.debug else "INFO")


# v0.6.6 · Sentry 初始化（DSN 留空则完全不启用）
if settings.sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    def _sentry_before_send(event, hint):
        # 移除请求头中的 Authorization，避免 token 上报
        req = (event or {}).get("request") or {}
        headers = req.get("headers") or {}
        if isinstance(headers, dict):
            for k in list(headers.keys()):
                if k.lower() == "authorization":
                    headers[k] = "[REDACTED]"
        return event

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        before_send=_sentry_before_send,
        send_default_pii=False,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    if (
        settings.environment == "production"
        and settings.secret_key == "dev-secret-change-in-production"
    ):
        raise RuntimeError(
            "PRODUCTION ENVIRONMENT DETECTED WITH DEFAULT SECRET KEY. "
            "Set SECRET_KEY to a strong random value in your .env file."
        )
    # v0.8.8 · production 环境未配置 SENTRY_DSN 时启动告警（不阻断启动，
    # 避免运维忘记填导致线上错误失踪）。
    if settings.environment == "production" and not settings.sentry_dsn:
        logger.warning(
            "Production environment has no SENTRY_DSN configured; "
            "error tracking is disabled. Set SENTRY_DSN in .env to enable."
        )
    storage_service.ensure_all_buckets()
    yield
    # v0.9.13 · shutdown: 释放 WS Redis pool (带 2s timeout), 避免 --reload / SIGTERM 时
    # worker 卡 "Waiting for background tasks to complete". 客户端 WS 收到 1006 后会自走
    # 指数退避重连. timeout 兜底见 ws.py:close_redis_pool 注释.
    try:
        await _close_ws_redis_pool()
        await close_bug_reopen_redis_pool()
    except Exception:
        # shutdown 期任何异常都不能传播 — uvicorn 会捕获后转 ERROR 日志并继续退出
        pass


app = FastAPI(title=settings.app_name, version="0.8.8", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# 中间件注册顺序：先注册 → 后执行（dispatch 包装）。
# AuditMiddleware 在 CORS 之后注册，保证 CORS preflight 不被审计。
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(AuditMiddleware)
app.add_middleware(RequestIDMiddleware)
if settings.environment == "production" and not settings.cors_allow_origins:
    raise RuntimeError(
        "production 环境必须显式设置 CORS_ALLOW_ORIGINS（JSON 列表或逗号分隔）"
    )

# v0.8.8 · SecurityHeadersMiddleware production-only。
# 注册顺序在 CORSMiddleware 之前 → dispatch 后执行 → 写 HSTS/CSP 时
# CORS 头已就位，可以一并出站。
if settings.environment == "production":
    app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_origin_regex=settings.effective_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"]
    if settings.environment != "production"
    else settings.cors_allow_methods,
    allow_headers=["*"]
    if settings.environment != "production"
    else settings.cors_allow_headers,
)

app.include_router(api_router, prefix="/api/v1")
app.include_router(ws_router)
app.include_router(health_router, prefix="/health", tags=["health"])

# Prometheus metrics — 仅供内部 scrape，不经过 AuditMiddleware
from prometheus_client import (  # noqa: E402
    Counter,
    Histogram,
    make_asgi_app as _prom_app,
    CONTENT_TYPE_LATEST,
)
from starlette.responses import Response as StarletteResponse  # noqa: E402

_http_requests = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "path", "status_code"],
)
_http_latency = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration",
    ["method", "path"],
)

_prom_asgi = _prom_app()


@app.get("/metrics", include_in_schema=False)
async def metrics():
    from prometheus_client import generate_latest

    return StarletteResponse(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
