"""v0.11.19 · 内部服务发现路由 (不进 OpenAPI 公开 schema)。

提供 Prometheus `http_sd_config` 期望的 JSON 格式, 从 `ml_backends` 表动态
生成 ML backend 的 scrape target 列表, 让新注册的 backend 自动接入监控。

安全:
  - 网段隔离: `infra/docker/nginx.conf` 显式 deny `/api/v1/internal/`,
    与根路径 `/metrics` 一样靠"反代不转发"做隔离 (不依赖 /api/ 前缀里
    的 OpenAPI 缺失)。直连 api 容器才能访问。
  - 可选 token: env `METRICS_SD_TOKEN` 非空时校验请求头
    `Authorization: Bearer <env>` (常量时间比较), 不匹配返回 401;
    为空则不校验。

不暴露给 OpenAPI 公开 schema (include_in_schema=False)。
"""

from __future__ import annotations

import secrets
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models.ml_backend_registry import MLBackendRegistry as MLBackend
from app.deps import get_db

router = APIRouter()


def _url_to_hostport(url: str) -> str | None:
    """从 backend url 剥出 host:port (去掉 scheme / path)。无法解析返回 None。"""
    parsed = urlparse(url if "://" in url else f"//{url}")
    host = parsed.hostname
    if not host:
        return None
    return f"{host}:{parsed.port}" if parsed.port else host


def _check_token(authorization: str | None) -> None:
    """METRICS_SD_TOKEN 非空时校验 bearer token, 否则免鉴权。"""
    token = settings.metrics_sd_token
    if not token:
        return
    expected = f"Bearer {token}"
    if not secrets.compare_digest(authorization or "", expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid metrics-sd token",
        )


@router.get("/metrics-targets", include_in_schema=False)
async def metrics_targets(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """返回 Prometheus http_sd 格式的 ML backend scrape target 列表。

    v0.19.0 ADR-0044 · backend 已全局去重 (registry url unique), 仍按 host:port 兜底去重。
    """
    _check_token(authorization)

    rows = await db.execute(select(MLBackend).where(MLBackend.state != "disconnected"))
    by_target: dict[str, MLBackend] = {}
    for b in rows.scalars():
        hostport = _url_to_hostport(b.url)
        if not hostport:
            continue
        by_target.setdefault(hostport, b)

    return [
        {
            "targets": [hp],
            "labels": {
                "service": b.name,
                "backend_id": str(b.id),
            },
        }
        for hp, b in by_target.items()
    ]
