"""v0.14.11 · 平台已知 backend 实例的能力清单 (与项目级注册解耦).

「协议能力目录」需要回答两个问题:
1. 「平台支持哪些 AI 标注能力?」 → 协议层 (capability_registry.py + /protocol 端点)。
2. 「现在跑着哪些 model 可用?」 → 实例层 (本模块 + /instances 端点)。

本模块合并两个数据源, 让普通登录用户也能看到完整 model 清单:
- env-only 容器: settings.ml_backend_observe_urls 配置的 backend (docker-compose
  自带或运维直连), 探测 /setup 拿协议 v2 的 models[];
- 项目级注册 backend: ml_backends 表, 读 health_meta.capabilities (与项目级
  /capabilities 端点同源).

输出字段裁剪: 只暴露 source / display_name / infra / models[], 不暴露 url /
gpu_info / cache / pool 等运维敏感信息, 让普通用户安全消费。
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models.ml_backend import MLBackend
from app.services.ml_capabilities import extract_capabilities

logger = logging.getLogger(__name__)


def _observe_urls() -> list[str]:
    """env 配置的观测 URL (去重保序). 留空时回退 ml_backend_default_url。"""
    urls = list(settings.ml_backend_observe_urls or [])
    if not urls and settings.ml_backend_default_url:
        urls = [settings.ml_backend_default_url]
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        key = u.rstrip("/")
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out


async def _probe_setup(client: httpx.AsyncClient, base: str) -> dict | None:
    """轻量探测 /setup, 失败返回 None (不抛, 上游按缺数据处理)。"""
    try:
        resp = await client.get(f"{base}/setup")
        if resp.status_code == 200:
            return resp.json()
    except (httpx.TimeoutException, httpx.RequestError):
        return None
    except Exception:  # noqa: BLE001 — 响应非 JSON 等
        return None
    return None


def _shape_models(caps: dict | None) -> list[dict]:
    """从 extract_capabilities 返回值取 models[], 字段裁剪到能力相关。"""
    if not caps:
        return []
    out: list[dict] = []
    for m in caps.get("models") or []:
        out.append(
            {
                "id": m.get("id", ""),
                "display_name": m.get("display_name") or m.get("id", ""),
                "task": m.get("task", "unknown"),
                "infra": m.get("infra"),
                "is_interactive": bool(m.get("is_interactive")),
                "supported_prompts": list(m.get("supported_prompts") or []),
                "supported_geometric_outputs": list(
                    m.get("supported_geometric_outputs") or []
                ),
                "supported_trackers": list(m.get("supported_trackers") or []),
                "modality": m.get("modality"),
            }
        )
    return out


async def _load_env_only_instances(registered_urls: set[str]) -> list[dict]:
    """探测 env-only 容器, 跳过已被项目级注册的 URL (避免重复展示)。"""
    candidates = [u for u in _observe_urls() if u.rstrip("/") not in registered_urls]
    if not candidates:
        return []
    timeout = httpx.Timeout(float(settings.ml_health_timeout))
    async with httpx.AsyncClient(timeout=timeout) as client:
        setups = await asyncio.gather(
            *[_probe_setup(client, u) for u in candidates], return_exceptions=False
        )
    instances: list[dict] = []
    for url, setup in zip(candidates, setups):
        caps = extract_capabilities(setup) if setup else None
        if not caps:
            continue
        instances.append(
            {
                "source": "env_only",
                "name": (setup or {}).get("name") or url.rstrip("/").split("/")[-1],
                "infra": caps.get("infra", "unknown"),
                "models": _shape_models(caps),
            }
        )
    return instances


async def _load_registered_instances(db: AsyncSession) -> tuple[list[dict], set[str]]:
    """从 ml_backends 表读已注册 backend, 复用 health_meta.capabilities 快照。

    返回 (实例列表, 已注册 URL 集合); URL 集合给 env-only 用作去重。
    """
    stmt = select(MLBackend).where(MLBackend.state == "connected")
    result = await db.execute(stmt)
    backends = result.scalars().all()

    instances: list[dict] = []
    urls: set[str] = set()
    for b in backends:
        urls.add(b.url.rstrip("/"))
        # health_meta.capabilities 是 extract_capabilities 写入的快照 (含 models[]).
        caps: dict | None = None
        if b.health_meta and isinstance(b.health_meta, dict):
            caps = b.health_meta.get("capabilities")
        models = _shape_models(caps)
        if not models:
            # 未探测过 / 协议 v1 未升级的 backend 略过, 避免 model 字段为空的卡。
            continue
        instances.append(
            {
                "source": "registered",
                "name": b.name,
                "infra": (caps or {}).get("infra") or "unknown",
                "models": models,
            }
        )
    return instances, urls


async def load_capability_instances(db: AsyncSession) -> list[dict]:
    """合并 env-only + registered → 平台已知 backend 实例清单。

    顺序: env-only 在前 (通常是 docker-compose 自带的 builtin), registered 在后。
    """
    registered, registered_urls = await _load_registered_instances(db)
    env_only = await _load_env_only_instances(registered_urls)
    return env_only + registered
