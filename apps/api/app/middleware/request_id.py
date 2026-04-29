from __future__ import annotations

import time
import uuid
from contextvars import ContextVar

from prometheus_client import Counter, Histogram
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

# 供同一请求的所有代码（包括 AuditService / AuditMiddleware）读取
request_id_var: ContextVar[str] = ContextVar("request_id", default="")

HEADER_NAME = "X-Request-ID"

_http_requests = Counter(
    "anno_http_requests_total",
    "Total HTTP requests",
    ["method", "path", "status"],
)
_http_latency = Histogram(
    "anno_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "path"],
)

# 仅记录 /api/ 路径，避免 /health /metrics 计数爆炸
_METRIC_PREFIX = "/api/"


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    1. 生成/透传 X-Request-ID → ContextVar，审计日志用
    2. 记录 Prometheus HTTP 计数 + 延迟（仅 /api/ 路径）
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        rid = request.headers.get(HEADER_NAME) or uuid.uuid4().hex
        request_id_var.set(rid)

        start = time.monotonic()
        response: Response = await call_next(request)
        elapsed = time.monotonic() - start

        response.headers[HEADER_NAME] = rid

        path = request.url.path
        if path.startswith(_METRIC_PREFIX):
            _http_requests.labels(
                method=request.method,
                path=path,
                status=str(response.status_code),
            ).inc()
            _http_latency.labels(method=request.method, path=path).observe(elapsed)

        return response
