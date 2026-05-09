"""Prometheus 指标定义 (v0.9.1 / M1, v0.9.11 PerfHud 扩展).

风格对齐 apps/api/app/observability/metrics.py: raw prometheus_client,
集中注册 + 一组 record_* helper.

暴露的 metric:
    embedding_cache_hits_total{prompt_type}      Counter
    embedding_cache_misses_total{prompt_type}    Counter
    embedding_cache_size                         Gauge
    inference_latency_seconds{prompt_type,cache} Histogram
    # v0.9.11 PerfHud: NVML / psutil 实时指标
    gpu_utilization_percent                      Gauge
    gpu_temperature_celsius                      Gauge
    gpu_power_watts                              Gauge
    container_cpu_percent                        Gauge
    container_memory_percent                     Gauge

`/metrics` 端点在 main.py 注册, 用 prometheus_client.generate_latest().
"""

from __future__ import annotations

import logging

from prometheus_client import Counter, Gauge, Histogram

logger = logging.getLogger(__name__)


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


# v0.9.11 PerfHud · NVML / psutil 实时指标 (lifespan startup 初始化, /health + /metrics 共用)
GPU_UTILIZATION = Gauge("gpu_utilization_percent", "GPU SM 利用率 (%)")
GPU_TEMPERATURE = Gauge("gpu_temperature_celsius", "GPU 温度 (°C)")
GPU_POWER = Gauge("gpu_power_watts", "GPU 实时功耗 (W)")
CONTAINER_CPU = Gauge("container_cpu_percent", "容器 CPU 利用率 (cgroup 视角, %)")
CONTAINER_MEM = Gauge("container_memory_percent", "容器内存利用率 (%)")


def record_inference(prompt_type: str, cache_status: str, duration_seconds: float) -> None:
    INFERENCE_LATENCY.labels(prompt_type=prompt_type, cache=cache_status).observe(duration_seconds)


def record_cache(prompt_type: str, hit: bool) -> None:
    if hit:
        EMBEDDING_CACHE_HITS.labels(prompt_type=prompt_type).inc()
    else:
        EMBEDDING_CACHE_MISSES.labels(prompt_type=prompt_type).inc()


def update_cache_size(size: int) -> None:
    EMBEDDING_CACHE_SIZE.set(size)


# ── v0.9.11 PerfHud · pynvml + psutil 采样 ──────────────────────────────────

_pynvml_initialized = False
_pynvml_handle = None
_psutil = None


def init_perfhud_collectors() -> None:
    """lifespan startup 调用一次. 失败不阻塞 (无 GPU 环境降级)."""
    global _pynvml_initialized, _pynvml_handle, _psutil
    try:
        import pynvml  # type: ignore

        pynvml.nvmlInit()
        _pynvml_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        _pynvml_initialized = True
        logger.info("pynvml initialized for GPU 0")
    except Exception as exc:  # noqa: BLE001
        logger.warning("pynvml init failed (无 GPU 或 driver 不可用): %s", exc)
        _pynvml_initialized = False
    try:
        import psutil  # type: ignore

        _psutil = psutil
        # 第一次 cpu_percent 调用仅启采样窗口; 后续才返回真实值.
        psutil.cpu_percent(interval=None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("psutil 不可用: %s", exc)
        _psutil = None


def shutdown_perfhud_collectors() -> None:
    global _pynvml_initialized, _pynvml_handle
    if _pynvml_initialized:
        try:
            import pynvml  # type: ignore

            pynvml.nvmlShutdown()
        except Exception:  # noqa: BLE001
            pass
        _pynvml_initialized = False
        _pynvml_handle = None


def sample_perfhud() -> dict:
    """同步采样一次 GPU + 容器指标, 写入 Gauge 并返回 dict 供 /health 使用.

    返回字段 (任一不可用走 None):
      gpu_utilization_percent, gpu_temperature_celsius, gpu_power_watts,
      container_cpu_percent, container_memory_percent
    """
    out: dict = {
        "gpu_utilization_percent": None,
        "gpu_temperature_celsius": None,
        "gpu_power_watts": None,
        "container_cpu_percent": None,
        "container_memory_percent": None,
    }
    if _pynvml_initialized and _pynvml_handle is not None:
        try:
            import pynvml  # type: ignore

            util = pynvml.nvmlDeviceGetUtilizationRates(_pynvml_handle).gpu
            temp = pynvml.nvmlDeviceGetTemperature(
                _pynvml_handle, pynvml.NVML_TEMPERATURE_GPU
            )
            power = pynvml.nvmlDeviceGetPowerUsage(_pynvml_handle) / 1000.0
            out["gpu_utilization_percent"] = int(util)
            out["gpu_temperature_celsius"] = int(temp)
            out["gpu_power_watts"] = round(float(power), 1)
            GPU_UTILIZATION.set(out["gpu_utilization_percent"])
            GPU_TEMPERATURE.set(out["gpu_temperature_celsius"])
            GPU_POWER.set(out["gpu_power_watts"])
        except Exception as exc:  # noqa: BLE001
            logger.debug("pynvml sample failed: %s", exc)
    if _psutil is not None:
        try:
            cpu = _psutil.cpu_percent(interval=None)
            mem = _psutil.virtual_memory().percent
            out["container_cpu_percent"] = round(float(cpu), 1)
            out["container_memory_percent"] = round(float(mem), 1)
            CONTAINER_CPU.set(out["container_cpu_percent"])
            CONTAINER_MEM.set(out["container_memory_percent"])
        except Exception as exc:  # noqa: BLE001
            logger.debug("psutil sample failed: %s", exc)
    return out
