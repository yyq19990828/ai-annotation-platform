import uuid
import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings

router = APIRouter()


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
