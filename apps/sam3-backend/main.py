"""SAM 3 ML Backend — FastAPI 入口 (v0.10.0 / M0).

实现 docs-site/dev/reference/ml-backend-protocol.md 规定的 4 个端点 + 2 个观测端点 +
2 个运维端点 (与 grounded-sam2-backend 对齐):
    GET  /health        探活 (含 GPU / cache / PerfHud / idle 状态)
    GET  /setup         模型配置 (supported_prompts: point/interactive_box/text/exemplar)
    GET  /versions      可用版本
    POST /predict       交互式 / 批量预测 (懒加载: idle unload 后自动重建)
    GET  /metrics       Prometheus exposition (sam3_* 指标)
    GET  /cache/stats   embedding cache 当前状态
    POST /unload        主动卸载模型释放显存
    POST /reload        主动重载模型

prompt 类型 (v0.18.17 选项 B — 启用 inst_interactivity):
    - context.type == "text"            → Sam3Processor.set_text_prompt → 全图所有匹配概念的 masks
    - context.type == "exemplar"        → Sam3Processor.add_geometric_prompt → 全图相似实例 (PCS)
    - context.type == "point"           → model.predict_inst(point_coords) → 单实例点交互 (SAM-style)
    - context.type == "interactive_box" → model.predict_inst(box) → 单框单 mask (SAM-style)

"point" / "interactive_box" 与 "exemplar" 语义不同: 前两者是「点/框精修出单实例 mask」,
后者是 PCS「找全图与示例框相似的所有实例」. "bbox" 已于 v0.18.17 退出交互 prompt 命名空间
(仅作几何形状), 旧 type=bbox 请求落到 422.

Idle Unload (双 backend 并存场景的显存让渡机制):
    SAM 3.1 FP16 ~6-7GB 常驻显存; 3090 单卡若同时常驻 grounded-sam2 (~2GB) + sam3 (~7GB),
    与平台其他 GPU 任务争用容易紧张. SAM3_IDLE_UNLOAD_SECONDS 触发自动卸载 (默认 600s
    无 /predict 即卸); 下次请求懒重载 (冷启动 ~8-12s). 端到端运维侧可通过 POST /unload
    /reload 显式控制.
"""

from __future__ import annotations

import asyncio
import functools
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import torch
from aap_backend_runtime import fetch_image, free_gpu_memory, versions_payload
from aap_protocol_v2 import (
    COMPAT_PROTOCOL_VERSIONS,
    PROTOCOL_VERSION,
    PlatformRole,
    VariantNotSupportedError,
    log_deprecated_model_variant_fields,
    normalize_context_model_variants,
)
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel

from embedding_cache import EmbeddingCache, compute_cache_key
from observability import (
    init_perfhud_collectors,
    record_cache,
    record_inference,
    sample_perfhud,
    shutdown_perfhud_collectors,
    update_cache_size,
)
from predictor import (
    DEFAULT_SCORE_THRESHOLD,
    DEFAULT_SIMPLIFY_TOLERANCE,
    MODEL_VARIANT,
    SAM3Predictor,
)
from video_predictor import SAM3MultiplexVideoTracker
from schemas import BatchPredictResponse, PredictionResult, WarmupResponse

UTC = timezone.utc

logger = logging.getLogger("sam3-backend")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())

MODEL_VERSION = MODEL_VARIANT  # "sam3" (图像模型即 facebook/sam3 单档)
# v0.21.x · 视频追踪权重 (sam3.1_multiplex) 的展示名, 供前端「视频权重」条目 (与图像「SAM 3」对称)。
_VIDEO_MODEL_VERSION = "SAM 3.1"
# v0.10.1 · /setup 协议标准化暴露 backend 镜像版本 (与 FastAPI app.version 同源).
BACKEND_VERSION = os.getenv("BACKEND_VERSION", "0.10.1")
IMAGE_DOWNLOAD_TIMEOUT = float(os.getenv("IMAGE_DOWNLOAD_TIMEOUT", "30"))
EMBEDDING_CACHE_SIZE = int(os.getenv("SAM3_EMBEDDING_CACHE_SIZE", "32"))

# 与 grounded-sam2-backend 的 IDLE_UNLOAD_SECONDS 区分开, 让两个 backend 可独立调.
# sam3 默认与 sam2 一致 (600s/60s); sam3 显存占用大, 默认值偏积极也可由用户改更短.
# 0 / 负数 关闭定时卸载, 仍可通过 POST /unload 手动卸载.
IDLE_UNLOAD_SECONDS = float(os.getenv("SAM3_IDLE_UNLOAD_SECONDS", "600"))
IDLE_CHECK_INTERVAL = float(os.getenv("SAM3_IDLE_CHECK_INTERVAL", "60"))

app = FastAPI(title="sam3-backend", version=BACKEND_VERSION)


@app.exception_handler(ValueError)
async def _value_error_to_400(_request: Request, exc: ValueError):
    # aap_backend_runtime.fetch_image 对 unsupported scheme 抛 ValueError;此 handler
    # 把它包成 HTTPException(400) 的等价响应,恢复抽取前 _fetch_image 的 400 语义,并防止
    # 原生 traceback / 内部路径泄露到响应体。
    from fastapi.responses import JSONResponse  # noqa: PLC0415

    return JSONResponse(status_code=400, content={"detail": str(exc)})


_predictor: SAM3Predictor | None = None
_cache = EmbeddingCache(capacity=EMBEDDING_CACHE_SIZE, sam_variant=MODEL_VERSION)
_last_request_at: float = time.monotonic()
_predictor_lock = asyncio.Lock()
_idle_task: asyncio.Task | None = None
# v0.21.19 §PR3 · sam3.1_multiplex 视频追踪模型 (单档, 无变体)。
# v0.21.x · 取消与图像模型的互斥常驻: 24GB 卡容得下 image(~5.8GB) + video(~3.2GB) 并存,
# 二者各自独立懒加载 / idle 卸载, 加载其一不再卸另一。小显存部署若不需视频,
# 设 SAM3_DOWNLOAD_VIDEO=0 不加载视频模型即可。
_video_tracker: SAM3MultiplexVideoTracker | None = None
_video_lock = asyncio.Lock()
_video_last_request_at: float = time.monotonic()
# v0.14.14: PoolStatus 元数据 (sam3 图像模型单档, cap 永远 1).
_pool_loaded_at: datetime | None = None
_pool_last_used_at: datetime | None = None
_pool_hit_count: int = 0
_pool_last_evict: dict[str, Any] | None = None
_POOL_KEY: str = MODEL_VERSION  # opaque key, 协议 §4.3 sam3 用 model_variant 字符串


def _build_predictor() -> SAM3Predictor:
    return SAM3Predictor(embedding_cache=_cache)


async def _ensure_predictor_loaded(
    *, count_as_hit: bool = True,
) -> tuple[SAM3Predictor, bool, int | None]:
    """v0.14.14: 懒加载 + 运行时观测.

    返回 `(predictor, cache_hit, model_load_ms)`:
      - cache_hit=True 时 load_ms=None (模型在内存, 复用); count_as_hit=True 时增 hit_count
      - cache_hit=False 时 load_ms 是本次 build 毫秒 (冷启动 / idle unload 后 / manual reload 后)
      - count_as_hit=False 走 warmup 路径, 不增 hit_count
    """
    global _predictor, _last_request_at
    global _pool_loaded_at, _pool_last_used_at, _pool_hit_count
    if _predictor is not None:
        _last_request_at = time.monotonic()
        _pool_last_used_at = datetime.now(UTC)
        if count_as_hit:
            _pool_hit_count += 1
        return _predictor, True, None
    # v0.21.x · 取消互斥: 加载图像模型不再卸视频追踪模型, 二者可并存常驻。
    async with _predictor_lock:
        if _predictor is not None:
            # 锁内 double-check: 等锁期间别的协程可能已加载完.
            _last_request_at = time.monotonic()
            _pool_last_used_at = datetime.now(UTC)
            if count_as_hit:
                _pool_hit_count += 1
            return _predictor, True, None
        logger.info("reloading SAM 3 on demand (after idle unload or manual unload)")
        loop = asyncio.get_running_loop()
        t0 = time.monotonic()
        _predictor = await loop.run_in_executor(None, _build_predictor)
        load_ms = int((time.monotonic() - t0) * 1000)
        now = datetime.now(UTC)
        _pool_loaded_at = now
        _pool_last_used_at = now
        _pool_hit_count = 0  # 新加载, 命中计数重置
        logger.info("SAM 3 reloaded; device=%s; load_ms=%d", _predictor.device, load_ms)
        _last_request_at = time.monotonic()
        return _predictor, False, load_ms


async def _unload_predictor(reason: str) -> bool:
    """卸载模型释放显存. 返回是否真的执行了卸载 (已为 None 返回 False).

    embedding cache 中持有的 _features 张量指向 GPU 显存, 模型卸载后这些
    引用悬挂等同泄漏, 必须一起 clear (与 grounded-sam2-backend 同款处理).

    v0.14.14: 记录 _pool_last_evict 供 PoolStatus.last_evict 输出.
    """
    global _predictor, _pool_loaded_at, _pool_last_used_at, _pool_hit_count, _pool_last_evict
    async with _predictor_lock:
        if _predictor is None:
            return False
        logger.info("unloading SAM 3: reason=%s", reason)
        _predictor = None
        free_gpu_memory()
        _cache.clear()
        free_gpu_memory()
        # 归类 evict reason: idle_* / manual / 其他 → manual
        evict_reason = "idle_timeout" if reason.startswith("idle") else "manual"
        _pool_last_evict = {
            "key": _POOL_KEY,
            "at": datetime.now(UTC),
            "reason": evict_reason,
        }
        _pool_loaded_at = None
        _pool_last_used_at = None
        _pool_hit_count = 0
        return True


# ── v0.21.19 §PR3 · 视频追踪模型 (与图像模型互斥常驻) ──────────────────


def _build_video_tracker() -> SAM3MultiplexVideoTracker:
    return SAM3MultiplexVideoTracker()


async def _unload_video_tracker(reason: str) -> bool:
    """卸载视频追踪模型释放显存。返回是否真的卸载。"""
    global _video_tracker
    async with _video_lock:
        if _video_tracker is None:
            return False
        logger.info("unloading sam3 video tracker: reason=%s", reason)
        _video_tracker = None
        free_gpu_memory()
        return True


async def _ensure_video_tracker_loaded() -> SAM3MultiplexVideoTracker:
    """懒加载视频追踪模型。v0.21.x 起与图像模型可并存常驻 (取消互斥), 加载视频不再卸图像。"""
    global _video_tracker, _video_last_request_at
    if _video_tracker is not None:
        _video_last_request_at = time.monotonic()
        return _video_tracker
    async with _video_lock:
        if _video_tracker is not None:
            _video_last_request_at = time.monotonic()
            return _video_tracker
        logger.info("building sam3 video tracker on demand")
        loop = asyncio.get_running_loop()
        _video_tracker = await loop.run_in_executor(None, _build_video_tracker)
        _video_last_request_at = time.monotonic()
        logger.info("sam3 video tracker built; device=%s", _video_tracker.device)
        return _video_tracker


def _pool_status() -> dict[str, Any]:
    """v0.14.14 协议 §4.3 PoolStatus: cap=1, current_size 0/1, loaded_keys, last_evict.

    sam3 图像模型单档, cap 永远 1; current_size = 1 表示已加载, 0 表示未加载或 idle unload 后.
    """
    loaded_keys: list[dict[str, Any]] = []
    if _predictor is not None and _pool_loaded_at is not None:
        loaded_keys.append({
            "key": _POOL_KEY,
            "loaded_at": _pool_loaded_at.isoformat(),
            "last_used_at": (_pool_last_used_at or _pool_loaded_at).isoformat(),
            "hit_count": _pool_hit_count,
        })
    last_evict: dict[str, Any] | None = None
    if _pool_last_evict is not None:
        last_evict = {
            "key": _pool_last_evict["key"],
            "at": _pool_last_evict["at"].isoformat(),
            "reason": _pool_last_evict["reason"],
        }
    return {
        "cap": 1,
        "current_size": 1 if _predictor is not None else 0,
        "loaded_keys": loaded_keys,
        "last_evict": last_evict,
    }


def _video_pool_status() -> dict[str, Any]:
    """v0.21.x · 视频追踪池状态 (sam3.1_multiplex 单档, cap=1)。与图像池独立、可并存常驻;
    前端「视频追踪变体」区据此显示已加载 / 预热。key 用 tracker 名 sam3_video。"""
    loaded = _video_tracker is not None
    return {
        "cap": 1,
        "current_size": 1 if loaded else 0,
        "loaded_keys": [{"key": "sam3_video"}] if loaded else [],
        "loaded_variants": ["sam3_video"] if loaded else [],
        "active_sessions": _video_tracker.active_sessions if loaded else 0,
    }


def _normalize_predict_context(ctx: dict) -> dict:
    try:
        normalized, deprecated = normalize_context_model_variants(ctx)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    log_deprecated_model_variant_fields(logger, deprecated)
    model_variants = normalized.get("model_variants") or {}
    model_variant = model_variants.get("model_variant")
    if model_variant is not None and model_variant != MODEL_VERSION:
        raise VariantNotSupportedError("model_variant", model_variant, [MODEL_VERSION])
    return normalized


async def _idle_watcher() -> None:
    """周期检查最近请求时间; 超过 IDLE_UNLOAD_SECONDS 触发自动卸载."""
    while True:
        try:
            await asyncio.sleep(IDLE_CHECK_INTERVAL)
            if IDLE_UNLOAD_SECONDS <= 0:
                continue
            if _predictor is not None:
                idle_for = time.monotonic() - _last_request_at
                if idle_for >= IDLE_UNLOAD_SECONDS:
                    await _unload_predictor(reason=f"idle {idle_for:.0f}s")
            # v0.21.19 §PR3 · 视频追踪模型同样 idle 卸载 (无活跃会话时)。
            if _video_tracker is not None and _video_tracker.active_sessions == 0:
                v_idle = time.monotonic() - _video_last_request_at
                if v_idle >= IDLE_UNLOAD_SECONDS:
                    await _unload_video_tracker(reason=f"idle {v_idle:.0f}s")
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("idle watcher loop error; continuing")


@app.on_event("startup")
async def _load_models() -> None:
    global _idle_task, _last_request_at
    # 不再启动急加载: 未注册 / 无流量时白占 ~3.6GB 显存. 改纯懒加载 — 首个推理 / 预热请求
    # 经 _ensure_predictor_loaded 触发冷启; 需暖启点模型市场「预热默认」。
    logger.info(
        "SAM 3 backend ready (lazy load; variant=%s, cache_size=%d, idle_unload=%.0fs)",
        MODEL_VERSION, EMBEDDING_CACHE_SIZE, IDLE_UNLOAD_SECONDS,
    )
    _last_request_at = time.monotonic()
    init_perfhud_collectors()
    if IDLE_UNLOAD_SECONDS > 0:
        _idle_task = asyncio.create_task(_idle_watcher())


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _idle_task
    if _idle_task is not None:
        _idle_task.cancel()
        try:
            await _idle_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        _idle_task = None
    shutdown_perfhud_collectors()


@app.get("/health")
def health() -> dict:
    """与 grounded-sam2 /health 字段对齐, 让 AdminDashboard 卡片直接复用渲染."""
    available = torch.cuda.is_available()
    gpu_info: dict | None = None
    perf = sample_perfhud()
    if available:
        try:
            free_b, total_b = torch.cuda.mem_get_info()
            # 显存以 pynvml (sample_perfhud) 的设备全局视角为准, 与 yolo-backend 对齐;
            # torch.cuda.mem_get_info() 只反映当前 CUDA 上下文的 free/total, 多进程共享
            # 同一张卡时会系统性低报已用显存. pynvml 不可用时才回落 torch。
            used_mb = perf.get("gpu_memory_used_mb")
            total_mb = perf.get("gpu_memory_total_mb")
            if used_mb is None or total_mb is None:
                used_mb = int((total_b - free_b) / 1024**2)
                total_mb = int(total_b / 1024**2)
            # 本容器自身视角: 占用的物理卡号 + 本进程 torch 已保留显存 (caching allocator,
            # 不含 ~数百 MB CUDA 上下文). memory_used_mb 仍是整卡全局。
            # CUDA_VISIBLE_DEVICES 把物理卡重映射为逻辑 0..N-1: 物理卡号 = 列表中第「逻辑 current
            # device」项 (单卡 "2"→2; 多卡 "2,3"+逻辑1→3); 列表缺失/非法时回落逻辑号。
            _vis = os.environ.get("CUDA_VISIBLE_DEVICES", "").strip()
            _logical = torch.cuda.current_device()
            _ids = [p.strip() for p in _vis.split(",") if p.strip().isdigit()]
            device_index = int(_ids[_logical]) if _logical < len(_ids) else _logical
            gpu_info = {
                "device_name": torch.cuda.get_device_name(0),
                "device_index": device_index,
                "memory_used_mb": used_mb,
                "memory_total_mb": total_mb,
                "memory_free_mb": max(total_mb - used_mb, 0),
                "process_memory_mb": int(torch.cuda.memory_reserved() / 1024**2),
            }
        except Exception:  # noqa: BLE001
            gpu_info = None
    if gpu_info is not None:
        gpu_info["gpu_utilization_percent"] = perf["gpu_utilization_percent"]
        gpu_info["gpu_temperature_celsius"] = perf["gpu_temperature_celsius"]
        gpu_info["gpu_power_watts"] = perf["gpu_power_watts"]
    host = {
        "container_cpu_percent": perf["container_cpu_percent"],
        "container_memory_percent": perf["container_memory_percent"],
    }
    return {
        "ok": True,
        "gpu": available,
        "gpu_info": gpu_info,
        "host": host,
        "cache": _cache.stats(),
        "model_version": MODEL_VERSION,
        "loaded": _predictor is not None,  # 老字段, 兼容前端 AdminDashboard
        # v0.14.14: 协议 §4.3 PoolStatus 统一格式; sam3 cap 永远 1.
        "pool": _pool_status(),
        # v0.21.x · 视频追踪池 (与图像池并存常驻); 前端据此显示视频追踪已加载 / 预热。
        "video_pool": _video_pool_status(),
        "idle_unload_seconds": IDLE_UNLOAD_SECONDS,
        "last_request_age_seconds": round(time.monotonic() - _last_request_at, 2),
    }


@app.get("/setup")
def setup() -> dict:
    # v0.10.1 · /setup 标准化为 JSON Schema 自描述协议:
    # - name / version / model_version: 必填三元组, 前端用于诊断与兼容判断
    # - supported_prompts: 决定 ToolDock 哪些 AI 工具可用 (M2 ToolDock 重构消费)
    # - params: JSON Schema (Draft-07 子集) — 前端 schema-form 自动渲染参数面板
    base = {
        "protocol_version": PROTOCOL_VERSION,
        "compat_protocol_versions": COMPAT_PROTOCOL_VERSIONS,
        "name": "sam3-backend",
        "version": BACKEND_VERSION,
        "model_version": MODEL_VERSION,
        # v0.21.x · 视频追踪权重展示名 (sam3.1_multiplex → "SAM 3.1"), 前端「视频权重」条目用。
        "video_model_version": _VIDEO_MODEL_VERSION,
        # v0.14.14: 声明本 backend 支持 POST /warmup (协议 §4.4).
        "warmup_endpoint": True,
        "labels": [],
        "is_interactive": True,
        # v0.18.17 选项 B: 开 inst_interactivity 后宣称 point + interactive_box (SAM-style 单实例
        # 点/框交互, 走 model.predict_inst). "bbox" 已退出交互 prompt 命名空间 (仅几何形状);
        # PCS「找全图相似」统一走 "exemplar" (add_geometric_prompt). text = PCS 文本概念.
        "supported_prompts": ["point", "interactive_box", "text", "exemplar"],
        # v0.18.19 · exemplar 升级为多正负框 + text 组合 + per-request 阈值重过滤的迭代会话.
        # 前端据此把 exemplar 工具从「一发」升级为 refine 会话 (加正框/负框/拖阈值/叠 text).
        "exemplar_capabilities": {
            "multi_box": True,
            "negative_box": True,
            "text_combination": True,
            "threshold_refilter": True,
        },
        "supported_text_outputs": ["box", "mask", "both"],
        # exemplar 走 add_geometric_prompt; state 同时产出 boxes/masks, 三档都支持.
        "supported_geometric_outputs": ["box", "mask", "both"],
        # v0.21.19 §PR3 · sam3.1_multiplex 视频文本追踪 (text-driven, 每帧按文本检测目标)。
        # 平台据 supported_trackers 判 backend 支持视频追踪; text_driven_trackers 让其区分
        # seed-bbox tracker(sam2) 与文本驱动 tracker(sam3, 需 text)。
        "supported_trackers": ["sam3_video"],
        "text_driven_trackers": ["sam3_video"],
        # v0.14.12 · 显式暴露单档 variant, 让模型市场能展示该具体权重 (此前 [] 导致
        # 卡片/列表无法显示「该 backend 加载的是 sam3」). 三个 task 共享同一份权重,
        # variants_shared_across_tasks 在每个 model 上设 True 让列表合并到 1 行。
        "supported_variants": [
            {
                "key": "model_variant",
                "title": "模型版本",
                "description": "SAM 3 图像模型权重 (facebook/sam3, 即 image + inst 交互所用).",
                "variants": [
                    {
                        "value": MODEL_VARIANT,
                        "label": "SAM 3" if MODEL_VARIANT == "sam3" else MODEL_VARIANT,
                        "recommended": True,
                    },
                ],
            },
        ],
        "params": {
            "type": "object",
            "properties": {
                # 可调: PCS 置信度阈值 (text / exemplar 路径)。前端工作台 AI 面板据此渲染滑块,
                # 每位标注员可独立调整; per-request 经 context.score_threshold 覆盖 backend 默认值。
                "score_threshold": {
                    "type": "number",
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "default": DEFAULT_SCORE_THRESHOLD,
                    "title": "置信度阈值",
                    "x-platform-role": PlatformRole.CONFIDENCE.value,
                    "description": "只保留置信度高于此值的实例。调高=更少更准的框，调低=更多但可能含误检。",
                },
                "simplify_tolerance": {
                    "type": "number",
                    "minimum": 0.0,
                    "maximum": 10.0,
                    "default": DEFAULT_SIMPLIFY_TOLERANCE,
                    "title": "轮廓简化容差(像素)",
                    "x-platform-role": PlatformRole.SIMPLIFY_TOLERANCE.value,
                    "description": "多边形轮廓抽稀强度（像素）。调大=顶点更少、边更直更轻量；调小=更贴合细节但顶点更多。仅影响 mask 输出。",
                },
                "model_variant": {
                    "type": "string",
                    "default": MODEL_VERSION,
                    "title": "模型版本",
                    "x-platform-role": PlatformRole.MODEL_VARIANT.value,
                    "readOnly": True,
                    "description": "当前部署的 SAM 3 模型版本，由后端固定，不可在前端切换。",
                },
                "embedding_cache_size": {
                    "type": "integer",
                    "minimum": 0,
                    "default": EMBEDDING_CACHE_SIZE,
                    "title": "图像缓存容量",
                    "readOnly": True,
                    "description": "后端缓存的图像 embedding 数量上限，启动时设定。命中缓存可跳过重复编码、加速同图多次交互。",
                },
            },
        },
    }
    # v0.14.9 · 协议 v2: 顶层 infra + 多模型目录 (models[])。
    # v0.14.11 · 把 SAM 3 的 3 条实际能力 (PCS 路径) 拆成独立 model 条目, 让平台
    # 「协议能力目录」按 task 正确归类:
    #   - detection       (text → bbox, PCS 全图找类相似实例)
    #   - segmentation    (text → mask/polygon, PCS 出 mask 转 polygon)
    #   - interactive_seg (exemplar → bbox/polygon, 示例框 PCS 同类实例)
    # `/predict` 协议不变 (依旧由 context.type / supported_prompts 路径自路由),
    # 顶层 supported_prompts / supported_geometric_outputs 全部保留, 供未迁移平台
    # 向后兼容 (合成隐式单 model 路径)。
    base["infra"] = "pytorch"
    # v0.14.13 · `default_variants`: 跨 backend 对称声明 (sam3 图像模型只有单档).
    # 即便单值, 前端 VariantSelector 仍按统一规则消费 model.default_variants 拿初值,
    # 避免对"单档 backend"再走特殊分支.
    _default_variants = {"model_variant": MODEL_VARIANT}
    base["models"] = [
        {
            "id": "sam3-detection",
            "display_name": "SAM 3 · 文本检测 (PCS)",
            "task": "detection",
            "model_family": "sam3",
            "infra": "pytorch",
            "is_interactive": False,
            # v0.18.12 · 纯文本检测, 原子单元。
            "composition": "atom",
            "supported_prompts": ["text"],
            # 文本检测器: 整图 / 父框 crop 上检子物体 (crop-detect 下游)。
            "supported_inputs": ["full_image", "crop"],
            "supported_geometric_outputs": ["bbox"],
            "output_attribute_types": ["class"],
            "resource_profile": {"device": "gpu", "batchable": True},
            "supported_text_outputs": ["box"],
            "supported_variants": base["supported_variants"],
            "variants_shared_across_tasks": True,
            "default_variants": _default_variants,
            "params": base["params"],
        },
        {
            "id": "sam3-segmentation",
            "display_name": "SAM 3 · 文本分割 (PCS)",
            "task": "segmentation",
            "model_family": "sam3",
            "infra": "pytorch",
            "is_interactive": False,
            # v0.18.12 · 文本→检测→分割一体的内置流程, 非原子。
            "composition": "composite",
            "supported_prompts": ["text"],
            # 文本→分割: 整图 / 父框 crop 上跑 (文本驱动, 内置流程)。
            "supported_inputs": ["full_image", "crop"],
            "supported_geometric_outputs": ["polygon"],
            "output_attribute_types": ["class"],
            "resource_profile": {"device": "gpu", "batchable": True},
            "supported_text_outputs": ["mask", "both"],
            "supported_variants": base["supported_variants"],
            "variants_shared_across_tasks": True,
            "default_variants": _default_variants,
            "params": base["params"],
        },
        {
            "id": "sam3-interactive-seg",
            "display_name": "SAM 3 · 交互分割 (点/框/Exemplar)",
            "task": "interactive_seg",
            "model_family": "sam3",
            "infra": "pytorch",
            "is_interactive": True,
            # v0.18.12 · 单步交互分割, 原子单元。
            # v0.18.17 · 开 inst 后并入 SAM-style point / interactive_box 单实例交互 (与 exemplar 的
            # PCS 全图相似并列; 三者均走整图、出 polygon)。
            "composition": "atom",
            "supported_prompts": ["point", "interactive_box", "exemplar"],
            # 交互分割: 点/框/exemplar 提示驱动, 整图 (不作批量 crop/框下游)。
            "supported_inputs": ["full_image"],
            "supported_geometric_outputs": ["polygon"],
            # 交互分割: 单实例逐次推理, 不作批量。output_attribute_types 留空 (无类别/置信度产出)。
            "resource_profile": {"device": "gpu", "batchable": False},
            "supported_variants": base["supported_variants"],
            "variants_shared_across_tasks": True,
            "default_variants": _default_variants,
            "params": base["params"],
        },
        {
            # v0.21.19 §PR3 · 文本驱动视频追踪 (sam3.1_multiplex)。
            "id": "sam3-video-tracker",
            "display_name": "SAM 3.1 · 视频文本追踪 (Multiplex)",
            "task": "tracker",
            "model_family": "sam3",
            "infra": "pytorch",
            "is_interactive": True,
            # 跨帧有状态 + 文本每帧检测, 内部编排复合。
            "composition": "composite",
            # text-driven: 以文本 query 初始化 (非 bbox 种子)。
            "supported_prompts": ["text"],
            "supported_inputs": ["full_image"],
            "supported_geometric_outputs": ["polygon"],
            "output_attribute_types": ["class"],
            "resource_profile": {"device": "gpu", "batchable": False},
            "supported_trackers": ["sam3_video"],
            "text_driven_trackers": ["sam3_video"],
            "supported_variants": base["supported_variants"],
            "variants_shared_across_tasks": True,
            "default_variants": _default_variants,
            "params": base["params"],
        },
    ]
    return base


@app.get("/versions")
def versions() -> dict:
    return versions_payload(MODEL_VERSION, BACKEND_VERSION)


@app.get("/metrics", include_in_schema=False)
def metrics() -> Response:
    update_cache_size(_cache.size())
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/cache/stats")
def cache_stats() -> dict:
    return _cache.stats()


@app.post("/unload")
async def unload() -> dict:
    """主动卸载模型释放显存 (图像 + 视频). 已为空闲状态时返回 ok=true, unloaded=false."""
    unloaded_img = await _unload_predictor(reason="manual")
    unloaded_vid = await _unload_video_tracker(reason="manual")
    return {
        "ok": True,
        "unloaded": unloaded_img or unloaded_vid,
        "loaded": _predictor is not None,
        "video_loaded": _video_tracker is not None,
    }


@app.post("/reload")
async def reload() -> dict:
    """主动 (重新) 加载模型. 已加载时是 noop."""
    was_loaded = _predictor is not None
    await _ensure_predictor_loaded(count_as_hit=False)
    return {"ok": True, "loaded": True, "reloaded": not was_loaded}


# v0.14.14 协议 §4.4 · /warmup 端点 (sam3 单档, body 可空).


class WarmupRequest(BaseModel):
    """图像: variants 可选 {model_variant: "sam3"}, 仅校验。
    视频: task="tracker" 预热视频追踪模型 (sam3.1_multiplex, 单档无变体)。"""

    variants: dict[str, str] = {}
    # v0.21.x · 平台按 taskType=video 下发 {task:"tracker"} → 预热视频追踪模型。
    task: str | None = None


@app.post("/warmup", response_model=WarmupResponse)
async def warmup(req: WarmupRequest | None = None) -> WarmupResponse:
    """v0.14.14: 加载权重到 GPU 不跑 forward。

    默认预热图像模型 (SAM 3 单档, variants.model_variant 必须等于 sam3 或缺省);
    task="tracker" 预热视频追踪模型 (sam3.1_multiplex)。v0.21.x 起图像 / 视频并存,
    预热其一不再卸另一。重复预热返回 cache_hit=true。
    """
    if req is not None and req.task == "tracker":
        loaded_before = _video_tracker is not None
        t0 = time.monotonic()
        await _ensure_video_tracker_loaded()
        load_ms = None if loaded_before else int((time.monotonic() - t0) * 1000)
        return WarmupResponse(
            ok=True, model_load_ms=load_ms, cache_hit=loaded_before, evicted=None
        )
    if req is not None and req.variants:
        mv = req.variants.get("model_variant")
        if mv is not None and mv != MODEL_VERSION:
            raise VariantNotSupportedError("model_variant", mv, [MODEL_VERSION])
    _predictor_obj, cache_hit, load_ms = await _ensure_predictor_loaded(count_as_hit=False)
    return WarmupResponse(
        ok=True,
        model_load_ms=load_ms,
        cache_hit=cache_hit,
        evicted=None,
    )


def _coerce_simplify_tolerance(ctx: dict) -> float | None:
    raw = ctx.get("simplify_tolerance")
    if raw is None:
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=422,
            detail=f"context.simplify_tolerance must be float, got {raw!r}",
        )
    if val < 0:
        raise HTTPException(status_code=422, detail="context.simplify_tolerance must be >= 0")
    return val


def _coerce_output(ctx: dict) -> str:
    mode = ctx.get("output", "mask")
    if mode not in ("box", "mask", "both"):
        raise HTTPException(
            status_code=422,
            detail=f"context.output must be one of box|mask|both, got {mode!r}",
        )
    return mode


def _coerce_exemplars(ctx: dict) -> list[dict]:
    """v0.18.19 · 归一 type=exemplar 的几何输入为 [{bbox, label}] 列表。

    优先读多框 `exemplars[]`; 缺省退化单 `bbox` 正框 (旧路径兼容)。每框 bbox 必须长度 4。
    """
    raw = ctx.get("exemplars")
    if raw:
        out: list[dict] = []
        for i, ex in enumerate(raw):
            bbox = ex.get("bbox") if isinstance(ex, dict) else None
            if not bbox or len(bbox) != 4:
                raise HTTPException(
                    status_code=422,
                    detail=f"context.exemplars[{i}].bbox=[x1,y1,x2,y2] required (length 4)",
                )
            out.append({"bbox": bbox, "label": bool(ex.get("label", True))})
        return out

    bbox = ctx.get("bbox")
    if not bbox or len(bbox) != 4:
        raise HTTPException(
            status_code=422,
            detail="type=exemplar requires context.exemplars[] or context.bbox=[x1,y1,x2,y2]",
        )
    return [{"bbox": bbox, "label": True}]


def _run_prompt(p: SAM3Predictor, file_path: str, ctx: dict) -> tuple[list[dict], bool, str | None]:
    """返回 (results, cache_hit, mask_input_next). 命中时 point/bbox/exemplar 跳过 image fetch.

    mask_input_next (v0.18.18) 仅 point 精修单 mask 阶段非空, 其余 prompt 恒 None。
    """
    ptype = ctx.get("type")
    cache_key = compute_cache_key(file_path, MODEL_VERSION)
    simplify_tol = _coerce_simplify_tolerance(ctx)
    score_th = ctx.get("score_threshold")

    if ptype == "point":
        # v0.18.17 · inst 单实例点交互 (累加正负点; multimask 候选).
        points = ctx.get("points") or []
        if not points:
            raise HTTPException(status_code=422, detail="context.points required for type=point")
        labels = ctx.get("labels") or [1] * len(points)
        multimask = bool(ctx.get("multimask_output", False))
        image = None if _cache.peek(cache_key) else fetch_image(file_path, timeout=IMAGE_DOWNLOAD_TIMEOUT)
        return p.predict_interactive(
            image, points=points, labels=labels, multimask_output=multimask,
            mask_input=ctx.get("mask_input"),
            cache_key=cache_key, simplify_tolerance=simplify_tol,
        )

    if ptype == "interactive_box":
        # v0.18.17 · inst 单框单 mask (≠ exemplar 的全图相似; bbox prompt 已退役).
        box = ctx.get("bbox")
        if not box or len(box) != 4:
            raise HTTPException(
                status_code=422, detail="context.bbox=[x1,y1,x2,y2] required for type=interactive_box"
            )
        multimask = bool(ctx.get("multimask_output", False))
        image = None if _cache.peek(cache_key) else fetch_image(file_path, timeout=IMAGE_DOWNLOAD_TIMEOUT)
        return p.predict_interactive(
            image, box=box, multimask_output=multimask,
            cache_key=cache_key, simplify_tolerance=simplify_tol,
        )

    if ptype == "text":
        text = (ctx.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="context.text required for type=text")
        output_mode = _coerce_output(ctx)
        # SAM 3 PCS text 走 image predictor + 缓存; 与 grounded-sam2 (DINO 原图必拉) 不同,
        # 缓存命中时可省 fetch_image. text/exemplar 不回灌 mask_input → 第 3 项恒 None.
        image = None if _cache.peek(cache_key) else fetch_image(file_path, timeout=IMAGE_DOWNLOAD_TIMEOUT)
        results, hit = p.predict_text(
            image,
            text,
            output=output_mode,
            cache_key=cache_key,
            simplify_tolerance=simplify_tol,
            score_threshold=score_th,
        )
        return results, hit, None

    if ptype == "exemplar":
        # v0.18.19 · 多正负框 exemplars[] (+ 可选 text 组合) 优先; 缺省退化单 bbox 正框.
        exemplars = _coerce_exemplars(ctx)
        text = (ctx.get("text") or "").strip() or None
        output_mode = _coerce_output(ctx)
        image = None if _cache.peek(cache_key) else fetch_image(file_path, timeout=IMAGE_DOWNLOAD_TIMEOUT)
        results, hit = p.predict_exemplars(
            image,
            exemplars,
            text=text,
            output=output_mode,
            cache_key=cache_key,
            simplify_tolerance=simplify_tol,
            score_threshold=score_th,
        )
        return results, hit, None

    raise HTTPException(status_code=422, detail=f"unsupported context.type: {ptype}")


def _observe(prompt_type: str, hit: bool, started: float) -> int:
    elapsed = time.perf_counter() - started
    cache_status = "hit" if hit else "miss"
    record_cache(prompt_type, hit)
    record_inference(prompt_type, cache_status, elapsed)
    update_cache_size(_cache.size())
    return int(elapsed * 1000)


# ── v0.21.19 §PR3 · video_tracker 分支 (text-driven sam3_video) ────────


def _seed_bbox_from_video_ctx(ctx: dict) -> dict[str, float] | None:
    """从 video_tracker context 取归一化 seed bbox (仅用于 multiplex 多目标里挑目标)。

    支持 source_geometry / prompt.geometry 为 video_track_bbox / video_track_polygon /
    bbox / polygon。取不到返回 None (text-driven 无种子时退最高分目标)。
    """

    def _from_points(points: list) -> dict[str, float] | None:
        xs = [float(p[0]) for p in points if len(p) >= 2]
        ys = [float(p[1]) for p in points if len(p) >= 2]
        if not xs or not ys:
            return None
        return {"x": min(xs), "y": min(ys), "w": max(xs) - min(xs), "h": max(ys) - min(ys)}

    def _extract(geom: Any) -> dict[str, float] | None:
        if not isinstance(geom, dict):
            return None
        gtype = geom.get("type")
        if gtype in {"video_track_bbox", "video_track_polygon"}:
            kfs = sorted(geom.get("keyframes") or [],
                         key=lambda k: int(k.get("frame_index", 0)))
            if not kfs:
                return None
            first = kfs[0]
            if gtype == "video_track_polygon":
                return _from_points(first.get("points") or [])
            b = first.get("bbox") or {}
            return {"x": float(b.get("x", 0)), "y": float(b.get("y", 0)),
                    "w": float(b.get("w", 0)), "h": float(b.get("h", 0))}
        if gtype == "polygon":
            return _from_points(geom.get("points") or [])
        if gtype in {"bbox", "video_bbox"} or any(k in geom for k in ("x", "y", "w", "width")):
            return {"x": float(geom.get("x", 0)), "y": float(geom.get("y", 0)),
                    "w": float(geom.get("w", geom.get("width", 0))),
                    "h": float(geom.get("h", geom.get("height", 0)))}
        return None

    prompt = ctx.get("prompt")
    if isinstance(prompt, dict):
        seed = _extract(prompt.get("geometry"))
        if seed is not None:
            return seed
    return _extract(ctx.get("source_geometry"))


def _video_local_path(file_path: str) -> str:
    """video_tracker 的 file_path → OpenCV 可打开的源 (http(s) 先整段下载到临时文件)。"""
    if file_path.startswith(("http://", "https://")):
        from urllib.parse import urlsplit

        suffix = os.path.splitext(urlsplit(file_path).path)[-1] or ".mp4"
        fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="sam3vid_src_")
        try:
            with os.fdopen(fd, "wb") as fh, httpx.Client(
                timeout=IMAGE_DOWNLOAD_TIMEOUT, follow_redirects=True
            ) as client, client.stream("GET", file_path) as resp:
                resp.raise_for_status()
                for chunk in resp.iter_bytes():
                    fh.write(chunk)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
        return tmp_path
    if os.path.isfile(file_path):
        return file_path
    raise HTTPException(status_code=400, detail=f"unsupported video file_path: {file_path[:64]}")


async def _run_video_tracker(file_path: str, ctx: dict) -> list[dict]:
    """sam3_video: 按 text 在窗内检测+追踪目标, 返回逐帧几何 (polygon/bbox)。"""
    try:
        from_frame = int(ctx["from_frame"])
        to_frame = int(ctx["to_frame"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422,
                            detail="video_tracker requires integer from_frame / to_frame") from exc
    direction = ctx.get("direction") or "forward"
    if direction not in ("forward", "backward"):
        raise HTTPException(status_code=422,
                            detail=f"video_tracker direction must be forward|backward, got {direction!r}")
    text = (ctx.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=422,
                            detail="sam3_video tracker requires context.text (text-driven detection)")
    output_geometry = ctx.get("output_geometry") or "bbox"
    if output_geometry not in ("bbox", "polygon"):
        raise HTTPException(status_code=422,
                            detail=f"output_geometry must be bbox|polygon, got {output_geometry!r}")
    seed_bbox = _seed_bbox_from_video_ctx(ctx)

    tracker = await _ensure_video_tracker_loaded()
    local_path = _video_local_path(file_path)
    cleanup = local_path != file_path
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            functools.partial(
                tracker.propagate, local_path, from_frame, to_frame, direction,
                text, seed_bbox, output_geometry,
            ),
        )
    finally:
        if cleanup:
            try:
                os.unlink(local_path)
            except OSError:
                pass
    return result


@app.post("/predict")
async def predict(request: Request):
    body = await request.json()
    started = time.perf_counter()

    if isinstance(body, dict) and "task" in body and "context" in body:
        task = body["task"]
        ctx = _normalize_predict_context(body.get("context") or {})
        # v0.21.19 §PR3 · video_tracker 走独立视频模型分支 (与图像 prompt 路径分流)。
        if ctx.get("type") == "video_tracker":
            result = await _run_video_tracker(task["file_path"], ctx)
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            return PredictionResult(
                result=result,
                score=None,
                model_version=MODEL_VERSION,
                inference_time_ms=elapsed_ms,
                cache_hit=False,
                model_load_ms=None,
            ).model_dump(exclude_none=True)
        # 懒加载: 若已被 idle / 手动卸载, 此处 await 触发后台 executor 重建模型.
        p, pool_cache_hit, model_load_ms = await _ensure_predictor_loaded()
        result, hit, mask_input_next = _run_prompt(p, task["file_path"], ctx)
        elapsed_ms = _observe(ctx.get("type") or "unknown", hit, started)
        return PredictionResult(
            result=result,
            score=max((r.get("score") or 0.0) for r in result) if result else None,
            model_version=MODEL_VERSION,
            inference_time_ms=elapsed_ms,
            cache_hit=pool_cache_hit,
            model_load_ms=model_load_ms,
            mask_input_next=mask_input_next,
        ).model_dump(exclude_none=True)

    if isinstance(body, dict) and "tasks" in body:
        tasks = body["tasks"]
        ctx = _normalize_predict_context(
            body.get("context") or {"type": "text", "text": body.get("text", "")}
        )
        # v0.18.12 · 文本批量按 model_id 路由输出形态 (统一 wire): detection→box, segmentation→
        # ctx.output||mask。无 model_id 回落 ctx.output (老 wire 兼容)。type 强制 text 走文本分支。
        _mid = ctx.get("model_id")
        if _mid == "sam3-detection":
            ctx = {**ctx, "type": "text", "output": "box"}
        elif _mid == "sam3-segmentation":
            ctx = {**ctx, "type": "text", "output": ctx.get("output", "mask")}
        p, pool_cache_hit, model_load_ms = await _ensure_predictor_loaded()
        results = []
        for t in tasks:
            t_started = time.perf_counter()
            try:
                # 文本批量不回灌 mask_input → 丢弃 mask_input_next.
                result, hit, _ = _run_prompt(p, t["file_path"], ctx)
            except HTTPException:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.exception("predict failed for task=%s: %s", t.get("id"), exc)
                result, hit = [], False
            elapsed_ms = _observe(ctx.get("type") or "unknown", hit, t_started)
            results.append(
                PredictionResult(
                    task=t.get("id"),
                    result=result,
                    score=max((r.get("score") or 0.0) for r in result) if result else None,
                    model_version=MODEL_VERSION,
                    inference_time_ms=elapsed_ms,
                    # 整批共享同一懒加载结果: 第一条 task 触发, 后续都是 True/None.
                    cache_hit=pool_cache_hit,
                    model_load_ms=model_load_ms,
                ).model_dump(exclude_none=True)
            )
        return BatchPredictResponse(results=results).model_dump(exclude_none=True)

    raise HTTPException(status_code=422, detail="body must contain 'task'+'context' or 'tasks'")
