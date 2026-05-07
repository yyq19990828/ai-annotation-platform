"""Production security headers middleware.

v0.8.8 · 仅在 environment=="production" 时由 main.py 注册。
注册顺序应在 CORSMiddleware 之前（先注册→后执行→最外层最后写头），
确保 CORS preflight / 业务响应都被覆盖。

CSP 当前为「宽松基线版」：
  - 允许 'unsafe-inline' style（前端运行时仍有部分 inline style，未来用 nonce 收紧）
  - 允许 Cloudflare Turnstile 域用于 CAPTCHA（v0.8.7 接入）
  - frame-ancestors 'none' 等价于 X-Frame-Options: DENY 的 modern 写法
未来 follow-up（见 ADR-0010）：CSP nonce-based + script-src 去 'unsafe-inline'。
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp


_HSTS_MAX_AGE = 60 * 60 * 24 * 365  # 1 year

_CSP_DIRECTIVES = (
    "default-src 'self'; "
    "img-src 'self' data: blob: https:; "
    "style-src 'self' 'unsafe-inline'; "
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; "
    "frame-src https://challenges.cloudflare.com; "
    "connect-src 'self' https: wss: ws:; "
    "font-src 'self' data:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """写入 production-only 安全响应头。

    /metrics 由独立 ASGI 子应用挂载（main.py），不经过本中间件——这是有意设计：
    Prometheus 内网 scrape 不需要 HSTS / CSP。
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        response: Response = await call_next(request)

        response.headers.setdefault(
            "Strict-Transport-Security",
            f"max-age={_HSTS_MAX_AGE}; includeSubDomains",
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault(
            "Referrer-Policy", "strict-origin-when-cross-origin"
        )
        response.headers.setdefault("Content-Security-Policy", _CSP_DIRECTIVES)

        return response
