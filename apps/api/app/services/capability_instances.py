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
    """从 extract_capabilities 返回值取 models[], 字段裁剪到能力相关。

    v0.14.12 起补透传 supported_variants + variant_combinations + model_family,
    支撑前端模型市场列表按主 variant 轴展开「具体模型」行 (yolo 的 series×size
    受 MODEL_MATRIX 约束, 必须用 variant_combinations 严格列举合法组合)。
    """
    if not caps:
        return []
    out: list[dict] = []
    for m in caps.get("models") or []:
        out.append(
            {
                "id": m.get("id", ""),
                "display_name": m.get("display_name") or m.get("id", ""),
                "task": m.get("task", "unknown"),
                "model_family": m.get("model_family"),
                "infra": m.get("infra"),
                "is_interactive": bool(m.get("is_interactive")),
                "supported_prompts": list(m.get("supported_prompts") or []),
                "supported_geometric_outputs": list(
                    m.get("supported_geometric_outputs") or []
                ),
                "supported_trackers": list(m.get("supported_trackers") or []),
                # 协议③ · 属性输出类型 + schema 自描述, 供前端「从 backend 导入属性」.
                "output_attribute_types": list(m.get("output_attribute_types") or []),
                "output_attribute_schema": list(m.get("output_attribute_schema") or []),
                "modality": m.get("modality"),
                "supported_variants": list(m.get("supported_variants") or []),
                "variant_combinations": list(m.get("variant_combinations") or []),
                "variants_shared_across_tasks": bool(
                    m.get("variants_shared_across_tasks", False)
                ),
                # v0.14.13 · backend 自报的默认 variant 组合, 供前端 VariantSelector 取初值.
                "default_variants": dict(m.get("default_variants") or {}),
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
                # v0.14.14: backend 自报是否支持 POST /warmup (协议 §4.4).
                "warmup_endpoint": bool(caps.get("warmup_endpoint", False)),
                "models": _shape_models(caps),
            }
        )
    return instances


async def _load_registered_instances(db: AsyncSession) -> tuple[list[dict], set[str]]:
    """从 ml_backends 表读已注册 backend; health_meta 快照缺失时 fallback 到
    live /setup 探测 (保证 v0.14.9 之前注册的老 backend 也能即时显示)。

    返回 (实例列表, 已注册 URL 集合); URL 集合给 env-only 用作去重。
    """
    stmt = select(MLBackend).where(MLBackend.state == "connected")
    result = await db.execute(stmt)
    backends = result.scalars().all()

    urls: set[str] = {b.url.rstrip("/") for b in backends}
    if not backends:
        return [], urls

    # 第一遍: 从 health_meta 快照拿 models; 记录需要 live 探测的 backend。
    snapshots: list[dict | None] = []
    needs_probe: list[int] = []
    for idx, b in enumerate(backends):
        caps: dict | None = None
        if b.health_meta and isinstance(b.health_meta, dict):
            caps = b.health_meta.get("capabilities")
        if _shape_models(caps):
            snapshots.append(caps)
        else:
            snapshots.append(None)
            needs_probe.append(idx)

    # 第二遍: 并发 live 探测 (只对快照缺 models 的 backend)。
    if needs_probe:
        timeout = httpx.Timeout(float(settings.ml_health_timeout))
        async with httpx.AsyncClient(timeout=timeout) as client:
            setups = await asyncio.gather(
                *[
                    _probe_setup(client, backends[i].url.rstrip("/"))
                    for i in needs_probe
                ]
            )
        for i, setup in zip(needs_probe, setups):
            snapshots[i] = extract_capabilities(setup) if setup else None

    instances: list[dict] = []
    for b, caps in zip(backends, snapshots):
        models = _shape_models(caps)
        if not models:
            # 探测失败 / 协议 v1 backend 合成单 model 也失败 → 静默 skip。
            logger.debug(
                "instances: skip registered backend %s (no models in snapshot or live probe)",
                b.name,
            )
            continue
        instances.append(
            {
                "source": "registered",
                "name": b.name,
                "infra": (caps or {}).get("infra") or "unknown",
                # v0.14.14: backend 自报是否支持 POST /warmup (协议 §4.4).
                "warmup_endpoint": bool((caps or {}).get("warmup_endpoint", False)),
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
