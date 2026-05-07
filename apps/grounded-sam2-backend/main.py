"""Grounded-SAM-2 ML Backend — FastAPI 入口.

实现 docs-site/dev/ml-backend-protocol.md 规定的 4 个端点:
    GET  /health     探活
    GET  /setup      模型配置
    GET  /versions   可用版本
    POST /predict    交互式 / 批量预测（同一端点按 body shape 分流）

prompt 类型:
    - context.type == "point"  → SAM 直接出 mask
    - context.type == "bbox"   → SAM 直接出 mask
    - context.type == "text"   → GroundingDINO 出 boxes → SAM 出 mask（可批量）
"""

from __future__ import annotations

import logging
import os
import time
from io import BytesIO

import httpx
import torch
from fastapi import FastAPI, HTTPException, Request
from PIL import Image

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

app = FastAPI(title="grounded-sam2-backend", version="0.9.0")
_predictor: GroundedSAM2Predictor | None = None


@app.on_event("startup")
def _load_models() -> None:
    global _predictor
    logger.info(
        "loading models: dino=%s sam=%s box_th=%.2f text_th=%.2f",
        DINO_VARIANT, SAM_VARIANT, BOX_THRESHOLD, TEXT_THRESHOLD,
    )
    _predictor = GroundedSAM2Predictor(
        sam_variant=SAM_VARIANT,
        dino_variant=DINO_VARIANT,
        box_threshold=BOX_THRESHOLD,
        text_threshold=TEXT_THRESHOLD,
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


def _run_prompt(image: Image.Image, ctx: dict) -> list[dict]:
    p = _ensure_predictor()
    ptype = ctx.get("type")
    if ptype == "point":
        points = ctx.get("points") or []
        labels = ctx.get("labels") or [1] * len(points)
        if not points:
            raise HTTPException(status_code=422, detail="context.points required for type=point")
        return p.predict_point(image, points, labels)
    if ptype == "bbox":
        bbox = ctx.get("bbox")
        if not bbox or len(bbox) != 4:
            raise HTTPException(status_code=422, detail="context.bbox=[x1,y1,x2,y2] required")
        return p.predict_bbox(image, bbox)
    if ptype == "text":
        text = (ctx.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="context.text required for type=text")
        return p.predict_text(image, text)
    raise HTTPException(status_code=422, detail=f"unsupported context.type: {ptype}")


@app.post("/predict")
async def predict(request: Request):
    body = await request.json()
    started = time.perf_counter()

    # 交互式: 单条 task + context
    if isinstance(body, dict) and "task" in body and "context" in body:
        task = body["task"]
        ctx = body.get("context") or {}
        image = _fetch_image(task["file_path"])
        result = _run_prompt(image, ctx)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
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
                image = _fetch_image(t["file_path"])
                result = _run_prompt(image, ctx)
            except HTTPException:
                raise
            except Exception as exc:  # noqa: BLE001 — 单图失败降级，不中断整批
                logger.exception("predict failed for task=%s: %s", t.get("id"), exc)
                result = []
            results.append(
                PredictionResult(
                    task=t.get("id"),
                    result=result,
                    score=max((r.get("score") or 0.0) for r in result) if result else None,
                    model_version=MODEL_VERSION,
                    inference_time_ms=int((time.perf_counter() - t_started) * 1000),
                ).model_dump(exclude_none=True)
            )
        return BatchPredictResponse(results=results).model_dump(exclude_none=True)

    raise HTTPException(status_code=422, detail="body must contain 'task'+'context' or 'tasks'")
