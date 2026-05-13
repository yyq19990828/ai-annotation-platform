"""v0.8.7 F2 · Prometheus 指标集中注册。

- `ml_backend_request_duration_seconds` Histogram(backend_id, outcome)：
  ML backend predict / interactive 调用耗时；outcome ∈ {"success","error"}。
- `celery_queue_length` Gauge(queue)：active + reserved 数量之和。
- `celery_worker_heartbeat_seconds` Gauge(worker)：上次心跳距今秒数。

后两者按需在 /health/celery 端点采样填充（懒采样，避免 beat 高频抓取 broker）。
"""

from __future__ import annotations

from prometheus_client import Counter, Histogram, Gauge


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

VIDEO_CHUNK_REQUESTS_TOTAL = Counter(
    "video_chunk_requests_total",
    "视频 chunk 请求次数",
    labelnames=("status",),
)

VIDEO_CHUNK_GENERATION_SECONDS = Histogram(
    "video_chunk_generation_seconds",
    "视频 chunk 生成耗时（秒）",
    labelnames=("outcome",),
    buckets=(0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0),
)

VIDEO_FRAME_CACHE_TOTAL = Counter(
    "video_frame_cache_total",
    "视频单帧缓存命中情况",
    labelnames=("result", "format"),
)

VIDEO_FRAME_EXTRACTION_SECONDS = Histogram(
    "video_frame_extraction_seconds",
    "视频单帧抽取耗时（秒）",
    labelnames=("outcome", "format"),
    buckets=(0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
)

VIDEO_FRAME_ASSET_BYTES = Gauge(
    "video_frame_asset_bytes",
    "视频帧服务已缓存对象字节数",
    labelnames=("asset_type",),
)


def observe_ml_backend(
    backend_id: str | None, outcome: str, duration_seconds: float
) -> None:
    ML_BACKEND_REQUEST_DURATION.labels(
        backend_id=backend_id or "unknown",
        outcome=outcome,
    ).observe(duration_seconds)
