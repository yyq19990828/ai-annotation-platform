from __future__ import annotations

import json
import redis.asyncio as aioredis
from app.config import settings


class ProgressPublisher:
    def __init__(self) -> None:
        self.redis = aioredis.from_url(settings.redis_url)

    async def publish(self, channel: str, data: dict) -> None:
        await self.redis.publish(channel, json.dumps(data))

    async def publish_prediction_progress(
        self,
        project_id: str,
        current: int,
        total: int,
        status: str = "running",
        error: str | None = None,
    ) -> None:
        await self.publish(
            f"project:{project_id}:preannotate",
            {"current": current, "total": total, "status": status, "error": error},
        )

    async def close(self) -> None:
        await self.redis.close()
