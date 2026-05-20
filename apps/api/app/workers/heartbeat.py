"""v0.10.25 · Worker 心跳。

beat 周期触发 publish_worker_heartbeat，worker 在自身进程内把
「当前 worker node 名 + unix 时间戳」写进 Redis，key = celery:hb:{worker_name}，
SETEX TTL = 间隔 × 3（死 worker 的 key 不会永久残留）。

/health/celery 侧读同一 key，用 now - ts 算心跳新鲜度。worker 名取
task.request.hostname（bound task），与 inspect.ping() 返回的 worker 名同源，
保证写入 / 读取 key 能对上（即使运维用 -n 自定义 node 名）。
"""

from __future__ import annotations

import logging
import socket
import time

from app.config import settings
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)

HEARTBEAT_KEY_PREFIX = "celery:hb:"


@celery_app.task(name="app.workers.heartbeat.publish_worker_heartbeat", bind=True)
def publish_worker_heartbeat(self) -> dict:
    import redis  # noqa: PLC0415

    # bound task 的 request.hostname 即 worker node 名（celery@host），与
    # inspect.ping() 的 key 同源；fallback 到 socket 拼接以防 hostname 缺失。
    worker_name = getattr(self.request, "hostname", None) or f"celery@{socket.gethostname()}"
    now = int(time.time())
    ttl = max(1, settings.worker_heartbeat_interval_seconds * 3)
    try:
        r = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=3)
        r.setex(f"{HEARTBEAT_KEY_PREFIX}{worker_name}", ttl, now)
        r.close()
    except Exception as e:
        log.warning("publish_worker_heartbeat failed: %s", e)
        return {"worker": worker_name, "ts": now, "published": False}
    return {"worker": worker_name, "ts": now, "published": True}
