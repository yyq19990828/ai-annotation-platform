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
from io import BytesIO

import httpx
import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from PIL import Image
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from embedding_cache import EmbeddingCache, compute_cache_key
from observability import (
    init_perfhud_collectors,
    record_cache,
    record_inference,
    sample_perfhud,
    shutdown_perfhud_collectors,
    update_cache_size,
)
from predictor import MODEL_VARIANT, SAM3Predictor
from schemas import BatchPredictResponse, PredictionResult

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


async def _ensure_predictor_loaded() -> SAM3Predictor:
    """懒加载: 若已被 unload, 在锁内重建. 锁避免并发请求并行加载导致 OOM."""
    global _predictor, _last_request_at
    if _predictor is not None:
        _last_request_at = time.monotonic()
        return _predictor
    async with _predictor_lock:
        if _predictor is None:
            logger.info("reloading SAM 3 on demand (after idle unload or manual unload)")
            loop = asyncio.get_running_loop()
            _predictor = await loop.run_in_executor(None, _build_predictor)
            logger.info("SAM 3 reloaded; device=%s", _predictor.device)
        _last_request_at = time.monotonic()
        return _predictor


async def _unload_predictor(reason: str) -> bool:
    """卸载模型释放显存. 返回是否真的执行了卸载 (已为 None 返回 False).

    embedding cache 中持有的 _features 张量指向 GPU 显存, 模型卸载后这些
    引用悬挂等同泄漏, 必须一起 clear (与 grounded-sam2-backend 同款处理).
    """
    global _predictor
    async with _predictor_lock:
        if _predictor is None:
            return False
        logger.info("unloading SAM 3: reason=%s", reason)
        _predictor = None
        _free_gpu_memory()
        _cache.clear()
        _free_gpu_memory()
        return True


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
    global _predictor, _idle_task, _last_request_at
    logger.info(
        "loading SAM 3 (variant=%s, cache_size=%d, idle_unload=%.0fs)",
        MODEL_VERSION, EMBEDDING_CACHE_SIZE, IDLE_UNLOAD_SECONDS,
    )
    loop = asyncio.get_running_loop()
    _predictor = await loop.run_in_executor(None, _build_predictor)
    _last_request_at = time.monotonic()
    logger.info("SAM 3 loaded; device=%s", _predictor.device)
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
    if available:
        try:
            free_b, total_b = torch.cuda.mem_get_info()
            gpu_info = {
                "device_name": torch.cuda.get_device_name(0),
                "memory_used_mb": int((total_b - free_b) / 1024**2),
                "memory_total_mb": int(total_b / 1024**2),
                "memory_free_mb": int(free_b / 1024**2),
            }
        except Exception:  # noqa: BLE001
            gpu_info = None
    perf = sample_perfhud()
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
        "loaded": _predictor is not None,
        "idle_unload_seconds": IDLE_UNLOAD_SECONDS,
        "last_request_age_seconds": round(time.monotonic() - _last_request_at, 2),
    }


@app.get("/setup")
def setup() -> dict:
    # v0.10.1 · /setup 标准化为 JSON Schema 自描述协议:
    # - name / version / model_version: 必填三元组, 前端用于诊断与兼容判断
    # - supported_prompts: 决定 ToolDock 哪些 AI 工具可用 (M2 ToolDock 重构消费)
    # - params: JSON Schema (Draft-07 子集) — 前端 schema-form 自动渲染参数面板
    return {
        "name": "sam3-backend",
        "version": BACKEND_VERSION,
        "model_version": MODEL_VERSION,
        "labels": [],
        "is_interactive": True,
        # v0.10.0 选项 A: 不暴露 "point" (Sam3Processor image API 不支持).
        # 单点交互项目挂 grounded-sam2-backend 兜底.
        "supported_prompts": ["bbox", "text", "exemplar"],
        "supported_text_outputs": ["box", "mask", "both"],
        # bbox / exemplar 走同一 add_geometric_prompt; state 同时产出 boxes/masks, 三档都支持.
        "supported_geometric_outputs": ["box", "mask", "both"],
        "params": {
            "type": "object",
            "properties": {
                "model_variant": {
                    "type": "string",
                    "default": MODEL_VERSION,
                    "title": "模型版本",
                    "readOnly": True,
                },
                "embedding_cache_size": {
                    "type": "integer",
                    "minimum": 0,
                    "default": EMBEDDING_CACHE_SIZE,
                    "title": "Embedding 缓存容量",
                    "readOnly": True,
                },
            },
        },
    }


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
    await _ensure_predictor_loaded()
    return {"ok": True, "loaded": True, "reloaded": not was_loaded}


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
    # 懒加载: 若已被 idle / 手动卸载, 此处 await 触发后台 executor 重建模型.
    p = await _ensure_predictor_loaded()
    body = await request.json()
    started = time.perf_counter()

    if isinstance(body, dict) and "task" in body and "context" in body:
        task = body["task"]
        ctx = body.get("context") or {}
        result, hit = _run_prompt(p, task["file_path"], ctx)
        elapsed_ms = _observe(ctx.get("type") or "unknown", hit, started)
        return PredictionResult(
            result=result,
            score=max((r.get("score") or 0.0) for r in result) if result else None,
            model_version=MODEL_VERSION,
            inference_time_ms=elapsed_ms,
        ).model_dump(exclude_none=True)

    if isinstance(body, dict) and "tasks" in body:
        tasks = body["tasks"]
        ctx = body.get("context") or {"type": "text", "text": body.get("text", "")}
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
                ).model_dump(exclude_none=True)
            )
        return BatchPredictResponse(results=results).model_dump(exclude_none=True)

    raise HTTPException(status_code=422, detail="body must contain 'task'+'context' or 'tasks'")
