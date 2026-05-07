"""v0.8.7 F2 · Prometheus 指标集中注册。

- `ml_backend_request_duration_seconds` Histogram(backend_id, outcome)：
  ML backend predict / interactive 调用耗时；outcome ∈ {"success","error"}。
- `celery_queue_length` Gauge(queue)：active + reserved 数量之和。
- `celery_worker_heartbeat_seconds` Gauge(worker)：上次心跳距今秒数。

后两者按需在 /health/celery 端点采样填充（懒采样，避免 beat 高频抓取 broker）。
"""

from __future__ import annotations

from prometheus_client import Histogram, Gauge


ML_BACKEND_REQUEST_DURATION = Histogram(
    "ml_backend_request_duration_seconds",
    "ML backend predict/interactive 单次调用耗时（秒）",
    labelnames=("backend_id", "outcome"),
    buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0),
)

CELERY_QUEUE_LENGTH = Gauge(
    "celery_queue_length",
    "Celery 队列待处理 + 在执行任务数",
    labelnames=("queue",),
)

CELERY_WORKER_HEARTBEAT_SECONDS = Gauge(
    "celery_worker_heartbeat_seconds",
    "Celery worker 上次心跳距今秒数（越小越新鲜）",
    labelnames=("worker",),
)


def observe_ml_backend(
    backend_id: str | None, outcome: str, duration_seconds: float
) -> None:
    ML_BACKEND_REQUEST_DURATION.labels(
        backend_id=backend_id or "unknown",
        outcome=outcome,
    ).observe(duration_seconds)
