"""onnxtools-backend FastAPI 入口 —— 二阶段车辆属性预标注（ml-backend 协议 v2.1）。

端点：
    GET  /health    健康检查
    GET  /setup     协议 v2.1 model 目录（两个 model，自报 output_attribute_schema）
    GET  /versions  版本
    POST /predict   批量预测（按 context.model_id 路由检测 / 纯分类）

启动时加载一次 VehicleAttributePipeline 常驻（rtdetr 检测 + va 分类），暴露两个 model：
``vehicle-attr`` 跑完整 pipeline；``vehicle-attr-classify`` 复用同一常驻 pipeline 内的
``va_classifier`` 只做分类、跳过 rtdetr（供「检测→分类」多阶段编排的下游阶段）。无 variant /
pool / warmup。`/setup.supported_prompts=["none"]`：纯批量，平台只走「批量预标」入口。
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

BACKEND_VERSION = "0.2.0"
MODEL_VERSION = "onnxtools-rtdetr+va"
# 纯分类(跳过 rtdetr)的 model_version,与完整 pipeline 区分,便于历史 job 溯源。
VA_MODEL_VERSION = "onnxtools-va"

# 协议 v2 多模型路由:平台把下游阶段卡的 model_id 写进 context["model_id"]。
DETECT_MODEL_ID = "vehicle-attr"  # 完整 pipeline:rtdetr 检测 + va 分类
CLASSIFY_MODEL_ID = "vehicle-attr-classify"  # 纯分类:整图当一辆车,跳过 rtdetr

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


def _detect_model_entry() -> dict[str, Any]:
    """完整 pipeline model:rtdetr 检测 + va 车辆属性（自报 output_attribute_schema）。

    单 backend「一锅端」场景:既出检测框又写车型/颜色属性。
    """
    return {
        "id": DETECT_MODEL_ID,
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


def _classify_model_entry() -> dict[str, Any]:
    """纯分类 model:只跑 va 车辆属性,跳过 rtdetr 检测。

    用于「检测→分类」多阶段编排的下游阶段——上游检测器(如 gsam2)裁好单车 ROI 后,
    本 model 直接对整张 ROI 分类,免去冗余检测、不受 rtdetr 紧 crop 域偏移漏检影响。
    """
    return {
        "id": CLASSIFY_MODEL_ID,
        "display_name": "车型/颜色属性分类（纯分类·吃 ROI）",
        "task": "classification",
        "model_family": "va",
        "infra": "onnx",
        "is_interactive": False,
        "supported_prompts": ["none"],
        # 纯分类不产几何(整图框仅占位,平台 merge 丢弃),不声明几何输出能力。
        "supported_geometric_outputs": [],
        "output_attribute_types": ["class"],
        "output_attribute_schema": OUTPUT_ATTRIBUTE_SCHEMA,
        "default_thresholds": {"conf": CONF_THRES},
        "resource_profile": {"device": "gpu", "batchable": True},
    }


@app.get("/setup")
def setup() -> dict[str, Any]:
    """协议 v2.1 多模型目录:完整检测+分类 / 纯分类 两个 model。"""
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
        "models": [_detect_model_entry(), _classify_model_entry()],
    }


@app.get("/versions")
def versions() -> dict[str, Any]:
    return {"versions": [MODEL_VERSION], "backend_version": BACKEND_VERSION}


@app.post("/predict", response_model=BatchPredictResponse)
def predict(req: BatchPredictRequest) -> BatchPredictResponse:
    if _predictor is None:
        raise HTTPException(status_code=503, detail="backend not ready")

    # 协议 v2 多模型路由:context.model_id == 纯分类 → 跳过 rtdetr 只跑 va;否则走完整 pipeline。
    classify_only = req.context.get("model_id") == CLASSIFY_MODEL_ID
    model_version = VA_MODEL_VERSION if classify_only else MODEL_VERSION

    results: list[PredictionResult] = []
    for t in req.tasks:
        try:
            if classify_only:
                items, infer_ms = _predictor.classify_one(t.file_path)
            else:
                items, infer_ms = _predictor.predict_one(t.file_path)
            score = max((r.get("score", 0.0) for r in items), default=0.0)
            results.append(
                PredictionResult(
                    task=t.id,
                    result=items,
                    score=score,
                    model_version=model_version,
                    inference_time_ms=infer_ms,
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("predict failed for task %s", t.id)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return BatchPredictResponse(results=results)
