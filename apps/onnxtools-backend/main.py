"""onnxtools-backend FastAPI 入口 —— 二阶段车辆属性预标注（ml-backend 协议 v2.1）。

端点：
    GET  /health    健康检查
    GET  /setup     协议 v2.1 model 目录（单 model: vehicle-attr，自报 output_attribute_schema）
    GET  /versions  版本
    POST /predict   批量预测

单一固定 pipeline（rtdetr 检测 + va 车辆属性），无 variant / pool / warmup —— 与
yolo-backend 的多模型多变体不同，本 backend 启动时加载一次 pipeline 常驻。
`/setup.supported_prompts=["none"]`：纯批量，平台只走「批量预标」入口。
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from aap_protocol_v2 import (
    COMPAT_PROTOCOL_VERSIONS,
    PROTOCOL_VERSION,
    BatchPredictResponse,
    PredictionResult,
)
from fastapi import FastAPI, HTTPException

from attribute_schema import OUTPUT_ATTRIBUTE_SCHEMA
from predictor import VehicleAttributePredictor
from schemas import BatchPredictRequest

logger = logging.getLogger("onnxtools-backend")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

BACKEND_VERSION = "0.1.0"
MODEL_VERSION = "onnxtools-rtdetr+va"

MODEL_DIR = os.environ.get("ONNXTOOLS_MODEL_DIR", "/app/models")
DET_MODEL = os.environ.get("ONNXTOOLS_DET_MODEL", "rtdetr-2024080100.onnx")
VA_MODEL = os.environ.get("ONNXTOOLS_VA_MODEL", "va_260612.onnx")
CONF_THRES = float(os.environ.get("ONNXTOOLS_CONF_THRES", "0.5"))

_predictor: VehicleAttributePredictor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _predictor
    from onnxtools.pipeline import VehicleAttributePipeline  # 延迟到启动，避免 import 阻塞

    pipeline = VehicleAttributePipeline(
        model_type="rtdetr",
        model_path=os.path.join(MODEL_DIR, DET_MODEL),
        va_model_path=os.path.join(MODEL_DIR, VA_MODEL),
        conf_thres=CONF_THRES,
    )
    _predictor = VehicleAttributePredictor(pipeline)
    logger.info("onnxtools-backend ready: model_dir=%s det=%s va=%s conf=%.2f", MODEL_DIR, DET_MODEL, VA_MODEL, CONF_THRES)
    yield


app = FastAPI(title="onnxtools-backend", version=BACKEND_VERSION, lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "onnxtools-backend",
        "version": BACKEND_VERSION,
        "model_version": MODEL_VERSION,
        "ready": _predictor is not None,
    }


def _model_entry() -> dict[str, Any]:
    """协议 v2.1 单 model 条目：检测 + 车辆属性（自报 output_attribute_schema）。"""
    return {
        "id": "vehicle-attr",
        "display_name": "车辆检测 + 车型/颜色属性",
        "task": "detection",
        "model_family": "rtdetr",
        "infra": "onnx",
        "is_interactive": False,
        "supported_prompts": ["none"],
        "supported_geometric_outputs": ["bbox"],
        # 协议③：输出属性类型 + 取值域自描述，供平台一键导入项目 attribute_schema
        "output_attribute_types": ["class"],
        "output_attribute_schema": OUTPUT_ATTRIBUTE_SCHEMA,
        "default_thresholds": {"conf": CONF_THRES},
        "resource_profile": {"device": "gpu", "batchable": True},
    }


@app.get("/setup")
def setup() -> dict[str, Any]:
    """协议 v2.1 多模型目录（本 backend 单 model）。"""
    return {
        "protocol_version": PROTOCOL_VERSION,
        "compat_protocol_versions": COMPAT_PROTOCOL_VERSIONS,
        "name": "onnxtools-backend",
        "version": BACKEND_VERSION,
        "model_version": MODEL_VERSION,
        "is_interactive": False,
        "supported_prompts": ["none"],
        "supported_geometric_outputs": ["bbox"],
        "infra": "onnx",
        "models": [_model_entry()],
    }


@app.get("/versions")
def versions() -> dict[str, Any]:
    return {"versions": [MODEL_VERSION], "backend_version": BACKEND_VERSION}


@app.post("/predict", response_model=BatchPredictResponse)
def predict(req: BatchPredictRequest) -> BatchPredictResponse:
    if _predictor is None:
        raise HTTPException(status_code=503, detail="backend not ready")

    results: list[PredictionResult] = []
    for t in req.tasks:
        try:
            items, infer_ms = _predictor.predict_one(t.file_path)
            score = max((r.get("score", 0.0) for r in items), default=0.0)
            results.append(
                PredictionResult(
                    task=t.id,
                    result=items,
                    score=score,
                    model_version=MODEL_VERSION,
                    inference_time_ms=infer_ms,
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("predict failed for task %s", t.id)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return BatchPredictResponse(results=results)
