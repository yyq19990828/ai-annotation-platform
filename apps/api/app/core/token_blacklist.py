"""v0.7.8 · JWT Token 黑名单 + 代际号 (generation) 机制。

- blacklist_token: 将单个 jti 加入黑名单（TTL = token 剩余有效时间）
- is_blacklisted: 检查 jti 是否在黑名单中
- increment_user_generation: "登出全部设备" — 递增代际号使所有旧 token 失效
- get_user_generation: 获取当前代际号
"""

from __future__ import annotations

import redis.asyncio as aioredis

from app.config import settings

_KEY_PREFIX = "token_bl:"
_GEN_PREFIX = "token_gen:"


def _get_redis() -> aioredis.Redis:
    return aioredis.from_url(settings.redis_url, decode_responses=True)


async def blacklist_token(jti: str, ttl_seconds: int) -> None:
    if ttl_seconds <= 0:
        return
    r = _get_redis()
    try:
        await r.setex(f"{_KEY_PREFIX}{jti}", ttl_seconds, "1")
    finally:
        await r.aclose()


async def is_blacklisted(jti: str) -> bool:
    r = _get_redis()
    try:
        return await r.exists(f"{_KEY_PREFIX}{jti}") > 0
    finally:
        await r.aclose()


async def increment_user_generation(user_id: str) -> int:
    r = _get_redis()
    try:
        return await r.incr(f"{_GEN_PREFIX}{user_id}")
    finally:
        await r.aclose()


async def get_user_generation(user_id: str) -> int:
    r = _get_redis()
    try:
        val = await r.get(f"{_GEN_PREFIX}{user_id}")
        return int(val) if val else 0
    finally:
        await r.aclose()
