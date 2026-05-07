"""v0.9.3 · 登录失败 IP 计数器（Redis）。

- key 形态：``login_failed:{ip}``
- 失败 → INCR + EXPIRE(window)；返回当前 count
- 成功 → DEL
- 用于 LoginPage progressive CAPTCHA：count ≥ 阈值后必填 Turnstile
"""

from __future__ import annotations

import logging

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

_KEY_PREFIX = "login_failed:"


def _get_redis() -> aioredis.Redis:
    return aioredis.from_url(settings.redis_url, decode_responses=True)


async def get_count(ip: str) -> int:
    if not ip:
        return 0
    r = _get_redis()
    try:
        val = await r.get(f"{_KEY_PREFIX}{ip}")
        return int(val) if val else 0
    except Exception as e:  # broker 故障时 fail-open（不阻塞登录）
        logger.warning("login_failed_counter.get redis error: %s", e)
        return 0
    finally:
        await r.aclose()


async def increment(ip: str) -> int:
    if not ip:
        return 0
    r = _get_redis()
    try:
        key = f"{_KEY_PREFIX}{ip}"
        new_val = await r.incr(key)
        # 仅在首次创建（值刚变成 1）设 TTL，后续 INCR 不重置窗口
        if new_val == 1:
            await r.expire(key, settings.login_failed_window_seconds)
        return int(new_val)
    except Exception as e:
        logger.warning("login_failed_counter.increment redis error: %s", e)
        return 0
    finally:
        await r.aclose()


async def reset(ip: str) -> None:
    if not ip:
        return
    r = _get_redis()
    try:
        await r.delete(f"{_KEY_PREFIX}{ip}")
    except Exception as e:
        logger.warning("login_failed_counter.reset redis error: %s", e)
    finally:
        await r.aclose()
