import logging
import uuid
import redis.asyncio as aioredis
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.config import settings
from app.core.security import decode_access_token
from app.services.notification import channel_for

router = APIRouter()
log = logging.getLogger(__name__)


@router.websocket("/ws/projects/{project_id}/preannotate")
async def preannotate_progress(websocket: WebSocket, project_id: uuid.UUID):
    await websocket.accept()
    r = aioredis.from_url(settings.redis_url)
    pubsub = r.pubsub()
    channel = f"project:{project_id}:preannotate"
    await pubsub.subscribe(channel)
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_text(message["data"].decode() if isinstance(message["data"], bytes) else message["data"])
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
        await r.close()


@router.websocket("/ws/notifications")
async def notifications_socket(
    websocket: WebSocket,
    token: str = Query(...),
):
    """v0.6.9 · 单用户通知 WS：握手时校验 JWT，订阅 notify:{user_id}。

    DB 已持久化通知行；WS 用于在线推送，断线兜底走 30s 轮询。
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
    r = aioredis.from_url(settings.redis_url)
    pubsub = r.pubsub()
    channel = channel_for(user_id)
    await pubsub.subscribe(channel)
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                data = message["data"]
                await websocket.send_text(data.decode() if isinstance(data, bytes) else data)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("notifications WS error user=%s err=%s", user_id, e)
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
        finally:
            await r.close()
