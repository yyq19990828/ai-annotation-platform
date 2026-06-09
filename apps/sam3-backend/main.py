"""SAM 3 ML Backend — FastAPI 入口 (v0.10.0 / M0).

实现 docs-site/dev/reference/ml-backend-protocol.md 规定的 4 个端点 + 2 个观测端点 +
2 个运维端点 (与 grounded-sam2-backend 对齐):
    GET  /health        探活 (含 GPU / cache / PerfHud / idle 状态)
    GET  /setup         模型配置 (supported_prompts 含 exemplar)
    GET  /versions      可用版本
    POST /predict       交互式 / 批量预测 (懒加载: idle unload 后自动重建)
    GET  /metrics       Prometheus exposition (sam3_* 指标)
    GET  /cache/stats   embedding cache 当前状态
    POST /unload        主动卸载模型释放显存
    POST /reload        主动重载模型

prompt 类型 (v0.10.0 选项 A — 不启用 inst_interactivity, 放弃 point):
    - context.type == "text"     → Sam3Processor.set_text_prompt → 全图所有匹配概念的 masks
    - context.type == "bbox"     → Sam3Processor.add_geometric_prompt(label=True) → 全图相似实例
    - context.type == "exemplar" → 与 bbox 同底层; 协议层语义不同
    - context.type == "point"    → 返回 400. SAM 3 image API 没有点 prompt;
                                    需 enable_inst_interactivity=True 才有, v0.10.0 选项 A 放弃.
                                    workbench 单点交互让 grounded-sam2-backend 兜底.

⚠️ SAM 3 image API 的 bbox 与 SAM 2 行为不同: 它不是「这个 box 内出一个 mask」,
而是「找全图与 box 内对象相似的所有实例」(SAM 3 PCS 视觉示例语义). 用户想要
单框单 mask 走 grounded-sam2 backend.

Idle Unload (双 backend 并存场景的显存让渡机制):
    SAM 3.1 FP16 ~6-7GB 常驻显存; 3090 单卡若同时常驻 grounded-sam2 (~2GB) + sam3 (~7GB),
    与平台其他 GPU 任务争用容易紧张. SAM3_IDLE_UNLOAD_SECONDS 触发自动卸载 (默认 600s
    无 /predict 即卸); 下次请求懒重载 (冷启动 ~8-12s). 端到端运维侧可通过 POST /unload
    /reload 显式控制.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import os
import time
from datetime import datetime, timezone
from io import BytesIO
from typing import Any

import httpx
import torch
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
from PIL import Image
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
from schemas import BatchPredictResponse, PredictionResult, WarmupResponse

UTC = timezone.utc

logger = logging.getLogger("sam3-backend")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())

MODEL_VERSION = MODEL_VARIANT  # "sam3.1"; 路线图 §1.1 明确 SAM 3 仅一档
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
_predictor: SAM3Predictor | None = None
_cache = EmbeddingCache(capacity=EMBEDDING_CACHE_SIZE, sam_variant=MODEL_VERSION)
_last_request_at: float = time.monotonic()
_predictor_lock = asyncio.Lock()
_idle_task: asyncio.Task | None = None
# v0.14.14: PoolStatus 元数据 (sam3 是单档 sam3.1, cap 永远 1).
_pool_loaded_at: datetime | None = None
_pool_last_used_at: datetime | None = None
_pool_hit_count: int = 0
_pool_last_evict: dict[str, Any] | None = None
_POOL_KEY: str = MODEL_VERSION  # opaque key, 协议 §4.3 sam3 用 model_variant 字符串


def _build_predictor() -> SAM3Predictor:
    return SAM3Predictor(embedding_cache=_cache)


def _free_gpu_memory() -> None:
    """显式释放 CUDA caching allocator 持有的显存, 让 nvidia-smi 立刻可见下降."""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        try:
            torch.cuda.ipc_collect()
        except Exception:  # noqa: BLE001
            pass


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
        _free_gpu_memory()
        _cache.clear()
        _free_gpu_memory()
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


def _pool_status() -> dict[str, Any]:
    """v0.14.14 协议 §4.3 PoolStatus: cap=1, current_size 0/1, loaded_keys, last_evict.

    sam3 是单档 sam3.1, cap 永远 1; current_size = 1 表示已加载, 0 表示未加载或 idle unload 后.
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
            if _predictor is None or IDLE_UNLOAD_SECONDS <= 0:
                continue
            idle_for = time.monotonic() - _last_request_at
            if idle_for >= IDLE_UNLOAD_SECONDS:
                await _unload_predictor(reason=f"idle {idle_for:.0f}s")
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
            # 本容器自身视角: 占用的物理卡号 (多卡部署按容器绑卡, CUDA_VISIBLE_DEVICES
            # 固定单卡时取该号; 否则回落 current_device) + 本进程 torch 已保留显存
            # (caching allocator, 不含 ~数百 MB CUDA 上下文). memory_used_mb 仍是整卡全局。
            _vis = os.environ.get("CUDA_VISIBLE_DEVICES", "").strip()
            device_index = int(_vis) if _vis.isdigit() else torch.cuda.current_device()
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
        # v0.14.14: 声明本 backend 支持 POST /warmup (协议 §4.4).
        "warmup_endpoint": True,
        "labels": [],
        "is_interactive": True,
        # v0.10.0 选项 A: 不暴露 "point" (Sam3Processor image API 不支持).
        # 也不暴露 "bbox": 选项 A 下 sam3 的 bbox 物理上走 add_geometric_prompt (PCS 找全图
        # 相似实例), 不是 SAM2 式「框内单物体单 mask」。前端的 smart-box / magic-box 工具语义
        # 是单物体框, 与 PCS 不符, 故不宣称 bbox, 让 ToolDock 把这两个工具与 point 一起置灰;
        # 想用「找相似」的用户走 exemplar 工具 (同底层, 协议层语义明确)。
        # 单物体框 / 单点交互需挂 grounded-sam2-backend, 或在大显存卡上开 inst_interactivity 后
        # 由该 build 重新宣称 point/bbox (按 build 真实能力声明)。
        "supported_prompts": ["text", "exemplar"],
        "supported_text_outputs": ["box", "mask", "both"],
        # exemplar 走 add_geometric_prompt; state 同时产出 boxes/masks, 三档都支持.
        "supported_geometric_outputs": ["box", "mask", "both"],
        # v0.14.12 · 显式暴露单档 variant, 让模型市场能展示该具体权重 (此前 [] 导致
        # 卡片/列表无法显示「该 backend 加载的是 sam3.1」). 三个 task 共享同一份权重,
        # variants_shared_across_tasks 在每个 model 上设 True 让列表合并到 1 行。
        "supported_variants": [
            {
                "key": "model_variant",
                "title": "模型版本",
                "description": "SAM 3 当前仅有一档官方权重 (facebook/sam3.1).",
                "variants": [
                    {
                        "value": MODEL_VARIANT,
                        "label": "SAM 3.1" if MODEL_VARIANT == "sam3.1" else MODEL_VARIANT,
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
    # v0.14.13 · `default_variants`: 跨 backend 对称声明 (sam3 当前只有单档 sam3.1).
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
            "supported_prompts": ["text"],
            "supported_geometric_outputs": ["bbox"],
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
            "supported_prompts": ["text"],
            "supported_geometric_outputs": ["polygon"],
            "supported_text_outputs": ["mask", "both"],
            "supported_variants": base["supported_variants"],
            "variants_shared_across_tasks": True,
            "default_variants": _default_variants,
            "params": base["params"],
        },
        {
            "id": "sam3-interactive-seg",
            "display_name": "SAM 3 · 交互分割 (Exemplar)",
            "task": "interactive_seg",
            "model_family": "sam3",
            "infra": "pytorch",
            "is_interactive": True,
            "supported_prompts": ["exemplar"],
            "supported_geometric_outputs": ["polygon"],
            "supported_variants": base["supported_variants"],
            "variants_shared_across_tasks": True,
            "default_variants": _default_variants,
            "params": base["params"],
        },
    ]
    return base


@app.get("/versions")
def versions() -> dict:
    return {"versions": [MODEL_VERSION]}


@app.get("/metrics", include_in_schema=False)
def metrics() -> Response:
    update_cache_size(_cache.size())
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/cache/stats")
def cache_stats() -> dict:
    return _cache.stats()


@app.post("/unload")
async def unload() -> dict:
    """主动卸载模型释放显存. 已为空闲状态时返回 ok=true, unloaded=false."""
    unloaded = await _unload_predictor(reason="manual")
    return {"ok": True, "unloaded": unloaded, "loaded": _predictor is not None}


@app.post("/reload")
async def reload() -> dict:
    """主动 (重新) 加载模型. 已加载时是 noop."""
    was_loaded = _predictor is not None
    await _ensure_predictor_loaded(count_as_hit=False)
    return {"ok": True, "loaded": True, "reloaded": not was_loaded}


# v0.14.14 协议 §4.4 · /warmup 端点 (sam3 单档, body 可空).


class WarmupRequest(BaseModel):
    """sam3 是单档 sam3.1; variants 可选 {model_variant: "sam3.1"}, 仅校验."""

    variants: dict[str, str] = {}


@app.post("/warmup", response_model=WarmupResponse)
async def warmup(req: WarmupRequest | None = None) -> WarmupResponse:
    """v0.14.14: 加载 SAM 3 权重到 GPU 不跑 forward.

    sam3 单档, variants.model_variant 必须等于 sam3.1 (或缺省). 重复预热返回 cache_hit=true.
    """
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


def _fetch_image(file_path: str) -> Image.Image:
    if file_path.startswith(("http://", "https://")):
        with httpx.Client(timeout=IMAGE_DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
            resp = client.get(file_path)
            resp.raise_for_status()
            return Image.open(BytesIO(resp.content)).convert("RGB")
    if os.path.isfile(file_path):
        return Image.open(file_path).convert("RGB")
    raise HTTPException(status_code=400, detail=f"unsupported file_path scheme: {file_path[:64]}")


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


def _run_prompt(p: SAM3Predictor, file_path: str, ctx: dict) -> tuple[list[dict], bool]:
    """返回 (results, cache_hit). 命中时 point/bbox/exemplar 跳过 image fetch."""
    ptype = ctx.get("type")
    cache_key = compute_cache_key(file_path, MODEL_VERSION)
    simplify_tol = _coerce_simplify_tolerance(ctx)
    score_th = ctx.get("score_threshold")

    if ptype == "point":
        # v0.10.0 选项 A: sam3-backend 不支持 point. workbench 应该挂 grounded-sam2 兜底.
        raise HTTPException(
            status_code=400,
            detail="sam3-backend does not support point prompts. "
            "Use grounded-sam2-backend for point interactivity, "
            "or send type=bbox/text/exemplar to this backend.",
        )

    if ptype == "bbox":
        bbox = ctx.get("bbox")
        if not bbox or len(bbox) != 4:
            raise HTTPException(status_code=422, detail="context.bbox=[x1,y1,x2,y2] required")
        output_mode = _coerce_output(ctx)
        if not _cache.peek(cache_key):
            image = _fetch_image(file_path)
            return p.predict_bbox(
                image, bbox, output=output_mode, cache_key=cache_key,
                simplify_tolerance=simplify_tol, score_threshold=score_th,
            )
        return p.predict_bbox(
            None, bbox, output=output_mode, cache_key=cache_key,
            simplify_tolerance=simplify_tol, score_threshold=score_th,
        )

    if ptype == "text":
        text = (ctx.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="context.text required for type=text")
        output_mode = _coerce_output(ctx)
        # SAM 3 PCS text 走 image predictor + 缓存; 与 grounded-sam2 (DINO 原图必拉) 不同,
        # 缓存命中时可省 _fetch_image.
        if not _cache.peek(cache_key):
            image = _fetch_image(file_path)
            return p.predict_text(
                image,
                text,
                output=output_mode,
                cache_key=cache_key,
                simplify_tolerance=simplify_tol,
                score_threshold=score_th,
            )
        return p.predict_text(
            None,
            text,
            output=output_mode,
            cache_key=cache_key,
            simplify_tolerance=simplify_tol,
            score_threshold=score_th,
        )

    if ptype == "exemplar":
        exemplar_bbox = ctx.get("bbox")
        if not exemplar_bbox or len(exemplar_bbox) != 4:
            raise HTTPException(
                status_code=422,
                detail="context.bbox=[x1,y1,x2,y2] required for type=exemplar",
            )
        output_mode = _coerce_output(ctx)
        if not _cache.peek(cache_key):
            image = _fetch_image(file_path)
            return p.predict_exemplar(
                image,
                exemplar_bbox,
                output=output_mode,
                cache_key=cache_key,
                simplify_tolerance=simplify_tol,
                score_threshold=score_th,
            )
        return p.predict_exemplar(
            None,
            exemplar_bbox,
            output=output_mode,
            cache_key=cache_key,
            simplify_tolerance=simplify_tol,
            score_threshold=score_th,
        )

    raise HTTPException(status_code=422, detail=f"unsupported context.type: {ptype}")


def _observe(prompt_type: str, hit: bool, started: float) -> int:
    elapsed = time.perf_counter() - started
    cache_status = "hit" if hit else "miss"
    record_cache(prompt_type, hit)
    record_inference(prompt_type, cache_status, elapsed)
    update_cache_size(_cache.size())
    return int(elapsed * 1000)


@app.post("/predict")
async def predict(request: Request):
    body = await request.json()
    started = time.perf_counter()

    if isinstance(body, dict) and "task" in body and "context" in body:
        task = body["task"]
        ctx = _normalize_predict_context(body.get("context") or {})
        # 懒加载: 若已被 idle / 手动卸载, 此处 await 触发后台 executor 重建模型.
        p, pool_cache_hit, model_load_ms = await _ensure_predictor_loaded()
        result, hit = _run_prompt(p, task["file_path"], ctx)
        elapsed_ms = _observe(ctx.get("type") or "unknown", hit, started)
        return PredictionResult(
            result=result,
            score=max((r.get("score") or 0.0) for r in result) if result else None,
            model_version=MODEL_VERSION,
            inference_time_ms=elapsed_ms,
            cache_hit=pool_cache_hit,
            model_load_ms=model_load_ms,
        ).model_dump(exclude_none=True)

    if isinstance(body, dict) and "tasks" in body:
        tasks = body["tasks"]
        ctx = _normalize_predict_context(
            body.get("context") or {"type": "text", "text": body.get("text", "")}
        )
        p, pool_cache_hit, model_load_ms = await _ensure_predictor_loaded()
        results = []
        for t in tasks:
            t_started = time.perf_counter()
            try:
                result, hit = _run_prompt(p, t["file_path"], ctx)
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
