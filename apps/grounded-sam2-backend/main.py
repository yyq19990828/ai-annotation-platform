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
from model_pool import ModelPool
from observability import (
    init_perfhud_collectors,
    record_cache,
    record_inference,
    sample_perfhud,
    shutdown_perfhud_collectors,
    update_cache_size,
)
from predictor import DINO_CONFIGS, SAM2_CONFIGS, GroundedSAM2Predictor
from schemas import BatchPredictResponse, PredictionResult

logger = logging.getLogger("grounded-sam2-backend")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())

SAM_VARIANT = os.getenv("SAM_VARIANT", "tiny")
DINO_VARIANT = os.getenv("DINO_VARIANT", "T")
BOX_THRESHOLD = float(os.getenv("BOX_THRESHOLD", "0.35"))
TEXT_THRESHOLD = float(os.getenv("TEXT_THRESHOLD", "0.25"))
IMAGE_DOWNLOAD_TIMEOUT = float(os.getenv("IMAGE_DOWNLOAD_TIMEOUT", "30"))
EMBEDDING_CACHE_SIZE = int(os.getenv("EMBEDDING_CACHE_SIZE", "16"))
# B-28+ · idle 自动卸载. 0 / 负数 关闭定时卸载, 仍可通过 POST /unload 手动卸载.
IDLE_UNLOAD_SECONDS = float(os.getenv("IDLE_UNLOAD_SECONDS", "600"))
IDLE_CHECK_INTERVAL = float(os.getenv("IDLE_CHECK_INTERVAL", "60"))
# v0.10.23 · ModelPool 配置. CAP=1 保持现有"单变体常驻"行为; 大显存卡可调高并存多变体.
MODEL_POOL_CAP = int(os.getenv("MODEL_POOL_CAP", "1"))
MODEL_POOL_BUILD_TIMEOUT = float(os.getenv("MODEL_POOL_BUILD_TIMEOUT", "30"))

# v0.10.1 · /setup 协议标准化暴露 backend 镜像版本 (与 FastAPI app.version 同源).
BACKEND_VERSION = os.getenv("BACKEND_VERSION", "0.10.1")

app = FastAPI(title="grounded-sam2-backend", version=BACKEND_VERSION)
_last_request_at: float = time.monotonic()
_idle_task: asyncio.Task | None = None
# v0.10.23 · 额外变体 checkpoint 后台预拉状态 (主变体已由 entrypoint 阻塞下好).
# status: idle(无额外变体) | downloading | ready | partial(部分失败) | error.
_prefetch_task: asyncio.Task | None = None
_provisioning: dict = {"status": "idle", "detail": ""}


async def _prefetch_extras() -> None:
    """后台 subprocess 跑 download_checkpoints.py prefetch, 把额外变体边服务边补下来."""
    global _provisioning
    _provisioning = {"status": "downloading", "detail": "fetching prefetch variants"}
    try:
        proc = await asyncio.create_subprocess_exec(
            "python",
            os.path.join(os.path.dirname(__file__), "scripts", "download_checkpoints.py"),
            "prefetch",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        out, _ = await proc.communicate()
        tail = (out or b"").decode(errors="replace").strip().splitlines()
        last = tail[-1] if tail else ""
        if proc.returncode == 0:
            # 脚本对额外变体是 best-effort (失败仅 warn); 有 [warn] 即 partial.
            partial = any("[warn]" in line for line in tail)
            _provisioning = {"status": "partial" if partial else "ready", "detail": last}
        else:
            _provisioning = {"status": "error", "detail": last or f"exit {proc.returncode}"}
    except Exception as exc:  # noqa: BLE001
        logger.exception("prefetch extras failed")
        _provisioning = {"status": "error", "detail": str(exc)}
    logger.info("prefetch extras done: %s", _provisioning)


def _free_gpu_memory() -> None:
    """显式释放 CUDA caching allocator 持有的显存, 让 nvidia-smi 立刻可见下降."""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        try:
            torch.cuda.ipc_collect()
        except Exception:  # noqa: BLE001
            pass


def _build_predictor(
    sam_variant: str, dino_variant: str, cache: EmbeddingCache
) -> GroundedSAM2Predictor:
    """pool 的 build 回调 (在 executor 内同步执行)."""
    return GroundedSAM2Predictor(
        sam_variant=sam_variant,
        dino_variant=dino_variant,
        box_threshold=BOX_THRESHOLD,
        text_threshold=TEXT_THRESHOLD,
        embedding_cache=cache,
    )


_pool = ModelPool(
    cap=MODEL_POOL_CAP,
    build_predictor=_build_predictor,
    free_gpu_memory=_free_gpu_memory,
    embedding_cache_size=EMBEDDING_CACHE_SIZE,
    build_timeout=MODEL_POOL_BUILD_TIMEOUT,
)


def _model_version(sam_variant: str, dino_variant: str) -> str:
    return f"grounded-sam2-dino{dino_variant}-sam2.1{sam_variant}"


# 默认变体的 model_version, 供 /setup / /versions 等"无请求上下文"的端点使用.
MODEL_VERSION = _model_version(SAM_VARIANT, DINO_VARIANT)


def _resolve_variant(ctx: dict) -> tuple[str, str]:
    """从 context 读请求级变体, 缺省回退全局 env 默认; 非法值 422."""
    sv = ctx.get("sam_variant") or SAM_VARIANT
    dv = ctx.get("dino_variant") or DINO_VARIANT
    if sv not in SAM2_CONFIGS:
        raise HTTPException(
            status_code=422,
            detail=f"unsupported sam_variant: {sv!r}; allowed={sorted(SAM2_CONFIGS)}",
        )
    if dv not in DINO_CONFIGS:
        raise HTTPException(
            status_code=422,
            detail=f"unsupported dino_variant: {dv!r}; allowed={sorted(DINO_CONFIGS)}",
        )
    return sv, dv


async def _get_predictor(sam_variant: str, dino_variant: str) -> GroundedSAM2Predictor:
    """从 pool 取 predictor; pool 满 + 排队超时, 或变体 checkpoint 未预置, 翻成 503."""
    global _last_request_at
    try:
        predictor = await _pool.get(sam_variant, dino_variant)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        # 该变体的 checkpoint 未落盘 (entrypoint 只预拉了 PREFETCH 列表内的变体).
        raise HTTPException(
            status_code=503,
            detail=(
                f"variant ({sam_variant}, {dino_variant}) checkpoint not provisioned: {exc}; "
                "把该变体加入 PREFETCH_SAM_VARIANTS / PREFETCH_DINO_VARIANTS 后重建容器, "
                "或手动下载 checkpoint 到 CHECKPOINT_DIR."
            ),
        ) from exc
    _last_request_at = time.monotonic()
    return predictor


async def _idle_watcher() -> None:
    """周期检查最近请求时间; 超过 IDLE_UNLOAD_SECONDS 清空整池."""
    while True:
        try:
            await asyncio.sleep(IDLE_CHECK_INTERVAL)
            if not _pool.loaded or IDLE_UNLOAD_SECONDS <= 0:
                continue
            idle_for = time.monotonic() - _last_request_at
            if idle_for >= IDLE_UNLOAD_SECONDS:
                logger.info("idle %0.fs; clearing pool", idle_for)
                _pool.clear_all()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("idle watcher loop error; continuing")


@app.on_event("startup")
async def _load_models() -> None:
    global _idle_task, _last_request_at, _prefetch_task
    logger.info(
        "loading default variant: dino=%s sam=%s box_th=%.2f text_th=%.2f "
        "cache_size=%d pool_cap=%d idle_unload=%.0fs",
        DINO_VARIANT,
        SAM_VARIANT,
        BOX_THRESHOLD,
        TEXT_THRESHOLD,
        EMBEDDING_CACHE_SIZE,
        MODEL_POOL_CAP,
        IDLE_UNLOAD_SECONDS,
    )
    # 预热默认变体进 pool (保持"单变体常驻"不破坏).
    predictor = await _pool.get(SAM_VARIANT, DINO_VARIANT)
    _last_request_at = time.monotonic()
    logger.info("default variant loaded; device=%s", predictor.device)
    # v0.9.11 PerfHud · pynvml + psutil 初始化 (无 GPU 环境会降级, 不阻塞 startup)
    init_perfhud_collectors()
    if IDLE_UNLOAD_SECONDS > 0:
        _idle_task = asyncio.create_task(_idle_watcher())
    # 主变体已就绪可服务; 额外 PREFETCH 变体后台补 (不阻塞 uvicorn / /health).
    _prefetch_task = asyncio.create_task(_prefetch_extras())


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _idle_task, _prefetch_task
    for task_name in ("_idle_task", "_prefetch_task"):
        task = globals()[task_name]
        if task is not None:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            globals()[task_name] = None
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
        "cache": _pool.aggregate_cache_stats(),
        "model_version": MODEL_VERSION,
        "loaded": _pool.loaded,
        "pool": _pool.health(),
        "provisioning": _provisioning,
        "idle_unload_seconds": IDLE_UNLOAD_SECONDS,
        "last_request_age_seconds": round(time.monotonic() - _last_request_at, 2),
    }


@app.get("/setup")
def setup() -> dict:
    # v0.10.1 · /setup 标准化为 JSON Schema 自描述协议 (与 sam3-backend 同构):
    # - name / version / model_version: 必填三元组, 前端用于诊断与兼容判断
    # - supported_prompts: 决定 ToolDock 哪些 AI 工具可用 (M2 ToolDock 重构消费)
    # - params: JSON Schema (Draft-07 子集) — 前端 schema-form 自动渲染参数面板
    return {
        "name": "grounded-sam2",
        "version": BACKEND_VERSION,
        "model_version": MODEL_VERSION,
        "labels": [],
        "is_interactive": True,
        "supported_prompts": ["point", "bbox", "text"],
        # v0.9.4 phase 2 · text 路径输出形态选择 (box=DINO 直出, mask=DINO+SAM, both=配对返回).
        "supported_text_outputs": ["box", "mask", "both"],
        "params": {
            "type": "object",
            "properties": {
                "box_threshold": {
                    "type": "number",
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "default": BOX_THRESHOLD,
                    "title": "Box 置信度阈值",
                },
                "text_threshold": {
                    "type": "number",
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "default": TEXT_THRESHOLD,
                    "title": "Text 置信度阈值",
                },
                "sam_variant": {
                    "type": "string",
                    "enum": ["tiny", "small", "base_plus", "large"],
                    "default": SAM_VARIANT,
                    "title": "SAM 2 变体",
                },
                "dino_variant": {
                    "type": "string",
                    "enum": ["T", "B"],
                    "default": DINO_VARIANT,
                    "title": "GroundingDINO 变体",
                },
            },
        },
    }


@app.get("/versions")
def versions() -> dict:
    return {"versions": [MODEL_VERSION]}


@app.get("/metrics", include_in_schema=False)
def metrics() -> Response:
    update_cache_size(_pool.total_cache_size())
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/cache/stats")
def cache_stats() -> dict:
    return _pool.aggregate_cache_stats()


@app.post("/unload")
async def unload() -> dict:
    """主动卸载整池释放显存. 已为空闲状态时返回 ok=true, unloaded=false."""
    unloaded = _pool.clear_all()
    _free_gpu_memory()
    return {"ok": True, "unloaded": unloaded, "loaded": _pool.loaded}


@app.post("/reload")
async def reload() -> dict:
    """主动 (重新) 加载默认变体进 pool. 已加载时是 noop."""
    was_loaded = _pool.loaded
    await _get_predictor(SAM_VARIANT, DINO_VARIANT)
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


async def _run_prompt(file_path: str, ctx: dict) -> tuple[list[dict], bool, str, str]:
    """返回 (results, cache_hit, sam_variant, dino_variant). 命中时 point/bbox 跳过 image fetch.

    请求级变体: 从 ctx 解析 (缺省回退 env 默认), 经 pool 取对应 predictor,
    cache_key / cache 桶都按该变体隔离。
    """
    sv, dv = _resolve_variant(ctx)
    p = await _get_predictor(sv, dv)
    cache = _pool.cache_for(sv, dv)
    ptype = ctx.get("type")
    cache_key = compute_cache_key(file_path, sv)

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
            raise HTTPException(status_code=422, detail="context.simplify_tolerance must be >= 0")

    if ptype == "point":
        points = ctx.get("points") or []
        labels = ctx.get("labels") or [1] * len(points)
        if not points:
            raise HTTPException(status_code=422, detail="context.points required for type=point")
        if not cache.peek(cache_key):
            # miss: 拉图 + 让 predictor 内部 set_image + put
            image = _fetch_image(file_path)
            results, hit = p.predict_point(
                image, points, labels, cache_key=cache_key, simplify_tolerance=simplify_tol
            )
        else:
            # hit: 不拉图; predictor 走 restore_sam 路径
            results, hit = p.predict_point(
                None, points, labels, cache_key=cache_key, simplify_tolerance=simplify_tol
            )
        return results, hit, sv, dv

    if ptype == "bbox":
        bbox = ctx.get("bbox")
        if not bbox or len(bbox) != 4:
            raise HTTPException(status_code=422, detail="context.bbox=[x1,y1,x2,y2] required")
        if not cache.peek(cache_key):
            image = _fetch_image(file_path)
            results, hit = p.predict_bbox(
                image, bbox, cache_key=cache_key, simplify_tolerance=simplify_tol
            )
        else:
            results, hit = p.predict_bbox(
                None, bbox, cache_key=cache_key, simplify_tolerance=simplify_tol
            )
        return results, hit, sv, dv

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
        results, hit = p.predict_text(
            image,
            text,
            output=output_mode,
            cache_key=cache_key,
            box_threshold=box_th,
            text_threshold=text_th,
            simplify_tolerance=simplify_tol,
        )
        return results, hit, sv, dv

    raise HTTPException(status_code=422, detail=f"unsupported context.type: {ptype}")


def _observe(prompt_type: str, hit: bool, started: float) -> int:
    elapsed = time.perf_counter() - started
    cache_status = "hit" if hit else "miss"
    record_cache(prompt_type, hit)
    record_inference(prompt_type, cache_status, elapsed)
    update_cache_size(_pool.total_cache_size())
    return int(elapsed * 1000)


@app.post("/predict")
async def predict(request: Request):
    body = await request.json()
    started = time.perf_counter()

    # 交互式: 单条 task + context
    if isinstance(body, dict) and "task" in body and "context" in body:
        task = body["task"]
        ctx = body.get("context") or {}
        # _run_prompt 内部经 pool 取请求级变体 predictor (miss 触发冷启).
        result, hit, sv, dv = await _run_prompt(task["file_path"], ctx)
        elapsed_ms = _observe(ctx.get("type") or "unknown", hit, started)
        return PredictionResult(
            result=result,
            score=max((r.get("score") or 0.0) for r in result) if result else None,
            model_version=_model_version(sv, dv),
            inference_time_ms=elapsed_ms,
        ).model_dump(exclude_none=True)

    # 批量: tasks 数组（M0 仅支持顶层 context.text 时整批同 prompt）
    if isinstance(body, dict) and "tasks" in body:
        tasks = body["tasks"]
        ctx = body.get("context") or {"type": "text", "text": body.get("text", "")}
        results = []
        for t in tasks:
            t_started = time.perf_counter()
            sv, dv = SAM_VARIANT, DINO_VARIANT
            try:
                result, hit, sv, dv = await _run_prompt(t["file_path"], ctx)
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
                    model_version=_model_version(sv, dv),
                    inference_time_ms=elapsed_ms,
                ).model_dump(exclude_none=True)
            )
        return BatchPredictResponse(results=results).model_dump(exclude_none=True)

    raise HTTPException(status_code=422, detail="body must contain 'task'+'context' or 'tasks'")
