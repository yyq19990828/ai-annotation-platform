from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import redis.asyncio as aioredis
from app.config import settings

log = logging.getLogger(__name__)


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


async def publish_batch_status_change(
    project_id: str,
    batch_id: str,
    from_status: str,
    to_status: str,
) -> None:
    """v0.9.13 · batch 状态变更广播 (B-15 / 多端实时刷新).

    由 BatchService.transition() 与 check_auto_transitions() 在 db.flush() 之后调用.
    频道: `project:{project_id}:batch`. 消费方: 前端 useBatchEventsSocket → invalidate
    ["batches", projectId]. 即便外层事务 commit 失败也只导致一次无效重拉, 不会数据
    不一致 (客户端拉到的是真实 DB 状态).

    复用 ProgressPublisher 一次性 instance + close 模式 (无连接池复用), 状态变更频率
    远低于预标进度帧, 这点开销可接受; 后续如压力上来再迁到 ws._get_redis_pool().
    """
    payload = {
        "type": "batch.status_changed",
        "batch_id": str(batch_id),
        "from": from_status,
        "to": to_status,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    redis = aioredis.from_url(settings.redis_url)
    try:
        await redis.publish(f"project:{project_id}:batch", json.dumps(payload))
    except Exception as e:
        # 广播失败不能阻塞业务事务; 客户端 30s 心跳 + 用户操作触发的查询会兜底
        log.warning(
            "publish_batch_status_change failed project=%s batch=%s err=%s",
            project_id,
            batch_id,
            e,
        )
    finally:
        try:
            await redis.close()
        except Exception:
            pass
