"""v0.9.11 · SecurityHeadersMiddleware CSP 收紧验证.

API 响应路径 script-src 已去 'unsafe-inline' (HTML 路径走 Nginx sub_filter 注入 nonce).
style-src 'unsafe-inline' 保留, 留 v0.10.x ProjectSettingsPage 重构同窗口收紧.
"""

from __future__ import annotations

import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.middleware.security_headers import SecurityHeadersMiddleware


def _build_app() -> Starlette:
    async def hello(_request):
        return JSONResponse({"ok": True})

    app = Starlette(routes=[Route("/hello", hello)])
    app.add_middleware(SecurityHeadersMiddleware)
    return app


def test_csp_script_src_drops_unsafe_inline():
    """API 响应 CSP script-src 不再含 'unsafe-inline'."""
    client = TestClient(_build_app())
    resp = client.get("/hello")
    assert resp.status_code == 200
    csp = resp.headers["content-security-policy"]
    # script-src 区块定位: 找 "script-src ..." 子串到下一 ";"
    script_src_idx = csp.find("script-src ")
    assert script_src_idx >= 0, csp
    script_src_end = csp.find(";", script_src_idx)
    script_src = csp[script_src_idx:script_src_end]
    assert "'unsafe-inline'" not in script_src, f"script-src 仍含 unsafe-inline: {script_src}"
    # Turnstile 仍允许
    assert "https://challenges.cloudflare.com" in script_src


def test_csp_style_src_retains_unsafe_inline():
    """v0.9.11 仅收紧 script-src; style-src 'unsafe-inline' 保留 (前端 ~2600 处内联 style 待 v0.10.x 迁移)."""
    client = TestClient(_build_app())
    resp = client.get("/hello")
    csp = resp.headers["content-security-policy"]
    style_idx = csp.find("style-src ")
    assert style_idx >= 0
    style_end = csp.find(";", style_idx)
    style_src = csp[style_idx:style_end]
    assert "'unsafe-inline'" in style_src


def test_other_security_headers_intact():
    """其他安全 header 保持不变."""
    client = TestClient(_build_app())
    resp = client.get("/hello")
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("x-frame-options") == "DENY"
    assert resp.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "max-age=" in resp.headers.get("strict-transport-security", "")
