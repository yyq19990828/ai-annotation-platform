import asyncio
import json
import logging
import uuid
import redis.asyncio as aioredis
from redis.asyncio.connection import ConnectionPool
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.config import settings
from app.core.security import decode_access_token
from app.services.notification import channel_for

router = APIRouter()
log = logging.getLogger(__name__)


# v0.7.0：模块级共享连接池，避免每次 WS 连接都新建 Redis socket。
# WS 副本数 ↑ 时 Redis 连接数受 max_connections 上限保护。
_REDIS_POOL: ConnectionPool | None = None


def _get_redis_pool() -> ConnectionPool:
    global _REDIS_POOL
    if _REDIS_POOL is None:
        _REDIS_POOL = ConnectionPool.from_url(
            settings.redis_url,
            max_connections=200,
            decode_responses=False,
        )
    return _REDIS_POOL


HEARTBEAT_INTERVAL = 30  # 秒；防 LB / nginx idle timeout（默认 60s）主动断连


async def _heartbeat_loop(websocket: WebSocket) -> None:
    """每 30s 推一帧 ping。客户端不需响应（仅保活）。"""
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            await websocket.send_text(json.dumps({"type": "ping"}))
    except (WebSocketDisconnect, asyncio.CancelledError):
        return
    except Exception as e:
        log.debug("heartbeat loop ended: %s", e)


@router.websocket("/ws/projects/{project_id}/preannotate")
async def preannotate_progress(websocket: WebSocket, project_id: uuid.UUID):
    await websocket.accept()
    r = aioredis.Redis(connection_pool=_get_redis_pool())
    pubsub = r.pubsub()
    channel = f"project:{project_id}:preannotate"
    await pubsub.subscribe(channel)
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_text(
                    message["data"].decode()
                    if isinstance(message["data"], bytes)
                    else message["data"]
                )
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()


@router.websocket("/ws/notifications")
async def notifications_socket(
    websocket: WebSocket,
    token: str = Query(...),
):
    """v0.6.9 · 单用户通知 WS：握手时校验 JWT，订阅 notify:{user_id}。

    DB 已持久化通知行；WS 用于在线推送，断线兜底走 30s 轮询。
    v0.7.0：使用共享 Redis ConnectionPool + 30s 心跳。
    """
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("missing sub")
        uuid.UUID(user_id)  # validate
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    r = aioredis.Redis(connection_pool=_get_redis_pool())
    pubsub = r.pubsub()
    channel = channel_for(user_id)
    await pubsub.subscribe(channel)

    heartbeat_task = asyncio.create_task(_heartbeat_loop(websocket))
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                data = message["data"]
                await websocket.send_text(
                    data.decode() if isinstance(data, bytes) else data
                )
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("notifications WS error user=%s err=%s", user_id, e)
    finally:
        heartbeat_task.cancel()
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
        except Exception:
            pass
