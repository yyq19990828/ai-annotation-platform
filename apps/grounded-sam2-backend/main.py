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
from observability import record_cache, record_inference, update_cache_size
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

app = FastAPI(title="grounded-sam2-backend", version="0.9.1")
_predictor: GroundedSAM2Predictor | None = None
_cache = EmbeddingCache(capacity=EMBEDDING_CACHE_SIZE, sam_variant=SAM_VARIANT)


@app.on_event("startup")
def _load_models() -> None:
    global _predictor
    logger.info(
        "loading models: dino=%s sam=%s box_th=%.2f text_th=%.2f cache_size=%d",
        DINO_VARIANT, SAM_VARIANT, BOX_THRESHOLD, TEXT_THRESHOLD, EMBEDDING_CACHE_SIZE,
    )
    _predictor = GroundedSAM2Predictor(
        sam_variant=SAM_VARIANT,
        dino_variant=DINO_VARIANT,
        box_threshold=BOX_THRESHOLD,
        text_threshold=TEXT_THRESHOLD,
        embedding_cache=_cache,
    )
    logger.info("models loaded; device=%s", _predictor.device)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "gpu": torch.cuda.is_available(),
        "model_version": MODEL_VERSION,
        "loaded": _predictor is not None,
    }


@app.get("/setup")
def setup() -> dict:
    return {
        "name": "grounded-sam2",
        "labels": [],
        "is_interactive": True,
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

    if ptype == "point":
        points = ctx.get("points") or []
        labels = ctx.get("labels") or [1] * len(points)
        if not points:
            raise HTTPException(status_code=422, detail="context.points required for type=point")
        if not _cache.peek(cache_key):
            # miss: 拉图 + 让 predictor 内部 set_image + put
            image = _fetch_image(file_path)
            return p.predict_point(image, points, labels, cache_key=cache_key)
        # hit: 不拉图; predictor 走 restore_sam 路径
        return p.predict_point(None, points, labels, cache_key=cache_key)

    if ptype == "bbox":
        bbox = ctx.get("bbox")
        if not bbox or len(bbox) != 4:
            raise HTTPException(status_code=422, detail="context.bbox=[x1,y1,x2,y2] required")
        if not _cache.peek(cache_key):
            image = _fetch_image(file_path)
            return p.predict_bbox(image, bbox, cache_key=cache_key)
        return p.predict_bbox(None, bbox, cache_key=cache_key)

    if ptype == "text":
        text = (ctx.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="context.text required for type=text")
        # text 必须拿原图给 DINO; SAM 端仍走缓存
        # v0.9.2 · ctx 上的项目级阈值 override (None 时回退到 backend env 默认值)
        box_th = ctx.get("box_threshold")
        text_th = ctx.get("text_threshold")
        image = _fetch_image(file_path)
        return p.predict_text(
            image,
            text,
            cache_key=cache_key,
            box_threshold=box_th,
            text_threshold=text_th,
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
