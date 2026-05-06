from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.v1.router import api_router
from app.api.v1.ws import router as ws_router
from app.api.health import router as health_router
from app.core.logging import setup_logging
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.ratelimit import limiter
from app.middleware.audit import AuditMiddleware
from app.middleware.request_id import RequestIDMiddleware
from app.services.storage import storage_service

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
    storage_service.ensure_all_buckets()
    yield


app = FastAPI(title=settings.app_name, version="0.7.7", lifespan=lifespan)
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
