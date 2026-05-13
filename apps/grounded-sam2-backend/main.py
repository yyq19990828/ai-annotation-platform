"""Grounded-SAM-2 ML Backend — FastAPI 入口.

实现 docs-site/dev/ml-backend-protocol.md 规定的 4 个端点 + v0.9.1 新增 2 个观测端点:
    GET  /health        探活
    GET  /setup         模型配置
    GET  /versions      可用版本
    POST /predict       交互式 / 批量预测（同一端点按 body shape 分流）
    GET  /metrics       Prometheus exposition (v0.9.1)
    GET  /cache/stats   embedding cache 当前状态 (v0.9.1)

prompt 类型:
    - context.type == "point"  → SAM 直接出 mask
    - context.type == "bbox"   → SAM 直接出 mask
    - context.type == "text"   → GroundingDINO 出 boxes → SAM 出 mask（可批量）

v0.9.1 (M1) 加入 SAM 2 image embedding LRU 缓存:
    cache_key = sha1(url_path|sam_variant); 同图二次操作跳过 ~1.5s 的 image encoder.
    point/bbox 命中可同时跳过 _fetch_image; text 仅省 set_image (DINO 仍需原图).
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
from predictor import GroundedSAM2Predictor
from schemas import BatchPredictResponse, PredictionResult

logger = logging.getLogger("grounded-sam2-backend")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())

SAM_VARIANT = os.getenv("SAM_VARIANT", "tiny")
DINO_VARIANT = os.getenv("DINO_VARIANT", "T")
BOX_THRESHOLD = float(os.getenv("BOX_THRESHOLD", "0.35"))
TEXT_THRESHOLD = float(os.getenv("TEXT_THRESHOLD", "0.25"))
MODEL_VERSION = f"grounded-sam2-dino{DINO_VARIANT}-sam2.1{SAM_VARIANT}"
IMAGE_DOWNLOAD_TIMEOUT = float(os.getenv("IMAGE_DOWNLOAD_TIMEOUT", "30"))
EMBEDDING_CACHE_SIZE = int(os.getenv("EMBEDDING_CACHE_SIZE", "16"))
# B-28+ · idle 自动卸载. 0 / 负数 关闭定时卸载, 仍可通过 POST /unload 手动卸载.
IDLE_UNLOAD_SECONDS = float(os.getenv("IDLE_UNLOAD_SECONDS", "600"))
IDLE_CHECK_INTERVAL = float(os.getenv("IDLE_CHECK_INTERVAL", "60"))

app = FastAPI(title="grounded-sam2-backend", version="0.9.1")
_predictor: GroundedSAM2Predictor | None = None
_cache = EmbeddingCache(capacity=EMBEDDING_CACHE_SIZE, sam_variant=SAM_VARIANT)
_last_request_at: float = time.monotonic()
_predictor_lock = asyncio.Lock()
_idle_task: asyncio.Task | None = None


def _build_predictor() -> GroundedSAM2Predictor:
    return GroundedSAM2Predictor(
        sam_variant=SAM_VARIANT,
        dino_variant=DINO_VARIANT,
        box_threshold=BOX_THRESHOLD,
        text_threshold=TEXT_THRESHOLD,
        embedding_cache=_cache,
    )


def _free_gpu_memory() -> None:
    """显式释放 CUDA caching allocator 持有的显存, 让 nvidia-smi 立刻可见下降."""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        try:
            torch.cuda.ipc_collect()
        except Exception:  # noqa: BLE001
            pass


async def _ensure_predictor_loaded() -> GroundedSAM2Predictor:
    """懒加载: 若已被 unload, 在锁内重建. 锁避免并发请求并行加载导致 OOM."""
    global _predictor, _last_request_at
    if _predictor is not None:
        _last_request_at = time.monotonic()
        return _predictor
    async with _predictor_lock:
        if _predictor is None:
            logger.info("reloading models on demand (after idle unload or manual unload)")
            loop = asyncio.get_running_loop()
            _predictor = await loop.run_in_executor(None, _build_predictor)
            logger.info("models reloaded; device=%s", _predictor.device)
        _last_request_at = time.monotonic()
        return _predictor


async def _unload_predictor(reason: str) -> bool:
    """卸载模型释放显存. 返回是否真的执行了卸载 (已为 None 返回 False)."""
    global _predictor
    async with _predictor_lock:
        if _predictor is None:
            return False
        logger.info("unloading models: reason=%s", reason)
        _predictor = None
        _free_gpu_memory()
        # embedding cache 持有的 _features 张量也跟着没用了, 清空避免悬挂引用占显存
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
        "loading models: dino=%s sam=%s box_th=%.2f text_th=%.2f cache_size=%d idle_unload=%.0fs",
        DINO_VARIANT, SAM_VARIANT, BOX_THRESHOLD, TEXT_THRESHOLD, EMBEDDING_CACHE_SIZE,
        IDLE_UNLOAD_SECONDS,
    )
    loop = asyncio.get_running_loop()
    _predictor = await loop.run_in_executor(None, _build_predictor)
    _last_request_at = time.monotonic()
    logger.info("models loaded; device=%s", _predictor.device)
    # v0.9.11 PerfHud · pynvml + psutil 初始化 (无 GPU 环境会降级, 不阻塞 startup)
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
    """v0.9.5 · 加 GPU 显存 + cache 指标，便于运维实时观察。

    旧前端字段保留：`gpu` 仍是 truthy（True/False），`model_version` / `loaded` 不变；
    新增 `gpu_info` / `cache` 子对象，老前端忽略。
    """
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
        except Exception:  # noqa: BLE001 — 显存查询失败不阻塞 /health
            gpu_info = None
    # v0.9.11 PerfHud · 同步采样 GPU util/温度/功耗 + 容器 CPU/RAM (无 GPU 环境字段为 None)
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
    return {
        "name": "grounded-sam2",
        "labels": [],
        "is_interactive": True,
        # v0.9.4 phase 2 · 自描述协议: 平台前端按此驱动子工具栏渲染.
        # 老前端不消费此字段; 老 backend 缺此字段时前端走兜底 ["point","bbox","text"] 路径.
        "supported_prompts": ["point", "bbox", "text"],
        # v0.9.4 phase 2 · text 路径输出形态选择 (box=DINO 直出, mask=DINO+SAM, both=配对返回).
        "supported_text_outputs": ["box", "mask", "both"],
        "params": {
            "box_threshold": BOX_THRESHOLD,
            "text_threshold": TEXT_THRESHOLD,
            "sam_variant": SAM_VARIANT,
            "dino_variant": DINO_VARIANT,
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


def _ensure_predictor() -> GroundedSAM2Predictor:
    if _predictor is None:
        raise HTTPException(status_code=503, detail="models still loading")
    return _predictor


def _run_prompt(file_path: str, ctx: dict) -> tuple[list[dict], bool]:
    """返回 (results, cache_hit). 命中时 point/bbox 跳过 image fetch."""
    p = _ensure_predictor()
    ptype = ctx.get("type")
    cache_key = compute_cache_key(file_path, SAM_VARIANT)

    # v0.9.4 phase 3 · simplify_tolerance 单次请求级覆盖 (None 时 predictor 用 DEFAULT_SIMPLIFY_TOLERANCE)
    simplify_tol = ctx.get("simplify_tolerance")
    if simplify_tol is not None:
        try:
            simplify_tol = float(simplify_tol)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=422,
                detail=f"context.simplify_tolerance must be float, got {simplify_tol!r}",
            )
        if simplify_tol < 0:
            raise HTTPException(
                status_code=422, detail="context.simplify_tolerance must be >= 0"
            )

    if ptype == "point":
        points = ctx.get("points") or []
        labels = ctx.get("labels") or [1] * len(points)
        if not points:
            raise HTTPException(status_code=422, detail="context.points required for type=point")
        if not _cache.peek(cache_key):
            # miss: 拉图 + 让 predictor 内部 set_image + put
            image = _fetch_image(file_path)
            return p.predict_point(
                image, points, labels, cache_key=cache_key, simplify_tolerance=simplify_tol
            )
        # hit: 不拉图; predictor 走 restore_sam 路径
        return p.predict_point(
            None, points, labels, cache_key=cache_key, simplify_tolerance=simplify_tol
        )

    if ptype == "bbox":
        bbox = ctx.get("bbox")
        if not bbox or len(bbox) != 4:
            raise HTTPException(status_code=422, detail="context.bbox=[x1,y1,x2,y2] required")
        if not _cache.peek(cache_key):
            image = _fetch_image(file_path)
            return p.predict_bbox(
                image, bbox, cache_key=cache_key, simplify_tolerance=simplify_tol
            )
        return p.predict_bbox(
            None, bbox, cache_key=cache_key, simplify_tolerance=simplify_tol
        )

    if ptype == "text":
        text = (ctx.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="context.text required for type=text")
        # text 必须拿原图给 DINO; SAM 端仍走缓存 (mask/both 路径)
        # v0.9.2 · ctx 上的项目级阈值 override (None 时回退到 backend env 默认值)
        box_th = ctx.get("box_threshold")
        text_th = ctx.get("text_threshold")
        # v0.9.4 phase 2 · 输出形态; 默认 mask 兼容老前端.
        output_mode = ctx.get("output", "mask")
        if output_mode not in ("box", "mask", "both"):
            raise HTTPException(
                status_code=422,
                detail=f"context.output must be one of box|mask|both, got {output_mode!r}",
            )
        image = _fetch_image(file_path)
        return p.predict_text(
            image,
            text,
            output=output_mode,
            cache_key=cache_key,
            box_threshold=box_th,
            text_threshold=text_th,
            simplify_tolerance=simplify_tol,
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
    # 懒加载: 若已被 idle / 手动卸载, 此处 await 触发后台 executor 重建模型.
    await _ensure_predictor_loaded()
    started = time.perf_counter()

    # 交互式: 单条 task + context
    if isinstance(body, dict) and "task" in body and "context" in body:
        task = body["task"]
        ctx = body.get("context") or {}
        result, hit = _run_prompt(task["file_path"], ctx)
        elapsed_ms = _observe(ctx.get("type") or "unknown", hit, started)
        return PredictionResult(
            result=result,
            score=max((r.get("score") or 0.0) for r in result) if result else None,
            model_version=MODEL_VERSION,
            inference_time_ms=elapsed_ms,
        ).model_dump(exclude_none=True)

    # 批量: tasks 数组（M0 仅支持顶层 context.text 时整批同 prompt）
    if isinstance(body, dict) and "tasks" in body:
        tasks = body["tasks"]
        ctx = body.get("context") or {"type": "text", "text": body.get("text", "")}
        results = []
        for t in tasks:
            t_started = time.perf_counter()
            try:
                result, hit = _run_prompt(t["file_path"], ctx)
            except HTTPException:
                raise
            except Exception as exc:  # noqa: BLE001 — 单图失败降级，不中断整批
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
