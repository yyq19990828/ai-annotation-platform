"""v0.10.25 · Worker 心跳。

每个 worker 在自身进程内周期把「当前 worker node 名 + unix 时间戳」写进 Redis，
key = celery:hb:{worker_name}，SETEX TTL = 间隔 × 3（死 worker 的 key 不会永久残留）。
/health/celery 侧读同一 key，用 now - ts 算心跳新鲜度。

v0.11.18 · 实现从「beat 派发的 Celery 任务」改为「worker bootstep + 内部定时器」。
原方案靠 beat 发一条任务，多 worker 拆队列后只有订阅 default 的 worker 抢到、其余 worker
心跳恒「未知」被误判降级；改广播队列又因 Redis broker 的 fanout 投递不可靠而失败。
bootstep 让每个 worker 进程在自身 timer 里直接写心跳，与 worker 数 / 队列拆分无关，
node 名取 worker.hostname（与 inspect.ping() 同源），是真正每 worker 自治的稳健实现。
"""

from __future__ import annotations

import logging
import time

from celery import bootsteps

from app.config import settings

log = logging.getLogger(__name__)

HEARTBEAT_KEY_PREFIX = "celery:hb:"


def _publish_heartbeat(worker_name: str) -> None:
    """把单个 worker 的心跳时间戳写进 Redis（同步、容错）。"""
    import redis  # noqa: PLC0415

    now = int(time.time())
    ttl = max(1, settings.worker_heartbeat_interval_seconds * 3)
    try:
        r = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=3)
        r.setex(f"{HEARTBEAT_KEY_PREFIX}{worker_name}", ttl, now)
        r.close()
    except Exception as e:  # 心跳写失败不应影响 worker 正常消费任务
        log.warning("publish_worker_heartbeat failed: %s", e)


class HeartbeatStep(bootsteps.StartStopStep):
    """v0.11.18 · worker 启动后用内部 timer 周期写自身心跳。

    requires Timer bootstep 以拿到 worker.timer；start 时立即写一次再周期续写，
    stop 时取消定时器。运行在 worker 主进程（非 prefork 子进程），故每个 worker
    node 每周期只写一次自己的 key。
    """

    requires = {"celery.worker.components:Timer"}

    def __init__(self, worker, **kwargs):
        super().__init__(worker, **kwargs)
        self._tref = None

    def start(self, worker):
        interval = max(1, settings.worker_heartbeat_interval_seconds)
        _publish_heartbeat(worker.hostname)
        self._tref = worker.timer.call_repeatedly(
            interval, _publish_heartbeat, (worker.hostname,)
        )

    def stop(self, worker):
        if self._tref is not None:
            self._tref.cancel()
            self._tref = None
