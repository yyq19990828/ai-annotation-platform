from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.v1.router import api_router
from app.api.v1.ws import router as ws_router
from app.api.health import router as health_router
from app.core.logging import setup_logging
from app.middleware.audit import AuditMiddleware
from app.middleware.request_id import RequestIDMiddleware
from app.services.storage import storage_service

setup_logging(level="DEBUG" if settings.debug else "INFO")


@asynccontextmanager
async def lifespan(app: FastAPI):
    storage_service.ensure_all_buckets()
    yield


app = FastAPI(title=settings.app_name, version="0.4.8", lifespan=lifespan)

# 中间件注册顺序：先注册 → 后执行（dispatch 包装）。
# AuditMiddleware 在 CORS 之后注册，保证 CORS preflight 不被审计。
app.add_middleware(AuditMiddleware)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:5173"],
    allow_origin_regex=r"http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")
app.include_router(ws_router)
app.include_router(health_router, prefix="/health", tags=["health"])

# Prometheus metrics — 仅供内部 scrape，不经过 AuditMiddleware
from prometheus_client import Counter, Histogram, make_asgi_app as _prom_app, CONTENT_TYPE_LATEST  # noqa: E402
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
