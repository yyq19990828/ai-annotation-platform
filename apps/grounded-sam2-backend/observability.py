"""Prometheus 指标定义 (v0.9.1 / M1).

风格对齐 apps/api/app/observability/metrics.py: raw prometheus_client,
集中注册 + 一组 record_* helper.

暴露的 metric:
    embedding_cache_hits_total{prompt_type}      Counter
    embedding_cache_misses_total{prompt_type}    Counter
    embedding_cache_size                         Gauge
    inference_latency_seconds{prompt_type,cache} Histogram

`/metrics` 端点在 main.py 注册, 用 prometheus_client.generate_latest().
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram


EMBEDDING_CACHE_HITS = Counter(
    "embedding_cache_hits_total",
    "SAM 2 image embedding 缓存命中次数",
    labelnames=("prompt_type",),
)

EMBEDDING_CACHE_MISSES = Counter(
    "embedding_cache_misses_total",
    "SAM 2 image embedding 缓存未命中次数",
    labelnames=("prompt_type",),
)

EMBEDDING_CACHE_SIZE = Gauge(
    "embedding_cache_size",
    "SAM 2 image embedding 缓存当前条目数",
)

INFERENCE_LATENCY = Histogram(
    "inference_latency_seconds",
    "/predict 端到端耗时 (秒)",
    labelnames=("prompt_type", "cache"),
    buckets=(0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)


def record_inference(prompt_type: str, cache_status: str, duration_seconds: float) -> None:
    INFERENCE_LATENCY.labels(prompt_type=prompt_type, cache=cache_status).observe(duration_seconds)


def record_cache(prompt_type: str, hit: bool) -> None:
    if hit:
        EMBEDDING_CACHE_HITS.labels(prompt_type=prompt_type).inc()
    else:
        EMBEDDING_CACHE_MISSES.labels(prompt_type=prompt_type).inc()


def update_cache_size(size: int) -> None:
    EMBEDDING_CACHE_SIZE.set(size)
