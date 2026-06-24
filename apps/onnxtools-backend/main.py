"""onnxtools-backend FastAPI 入口 —— 二阶段车辆属性预标注（ml-backend 协议 v2.2）。

端点：
    GET  /health    健康检查
    GET  /setup     协议 v2.2 model 目录（三个 model，自报 output_attribute_schema）
    GET  /versions  版本
    POST /predict   批量预测（按 context.model_id 路由一锅端 / 纯检测 / 纯分类）
    POST /unload    手动释放显存（运维侧用，ModelMarket 卸载按钮）

三个 model 分别架在各自单模型推理类上、按需懒加载：``vehicle-detect`` 直跑独立
``RtdetrORT`` 只做检测（多阶段编排上游，composition=atom）；``vehicle-attr-classify``
直跑独立 ``VehicleAttributeORT`` 只做分类（多阶段下游，atom）；``vehicle-attr`` 跑完整
``VehicleAttributePipeline``（一锅端检测+属性，composition=composite，过渡保留）。
detect-only 部署只加载检测器、classify-only 只加载分类器。无 variant / pool / warmup。
`/setup.supported_prompts=["none"]`：纯批量，平台只走「批量预标」入口。
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
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

BACKEND_VERSION = "0.4.0"
MODEL_VERSION = "onnxtools-rtdetr+va"
# 纯分类(跳过 rtdetr)的 model_version,与完整 pipeline 区分,便于历史 job 溯源。
VA_MODEL_VERSION = "onnxtools-va"
# 纯检测(只 rtdetr,跳过 va)的 model_version。
DET_ONLY_MODEL_VERSION = "onnxtools-rtdetr"

# 协议 v2 多模型路由:平台把下游阶段卡的 model_id 写进 context["model_id"]。
DETECT_MODEL_ID = "vehicle-attr"  # 一锅端:rtdetr 检测 + va 分类(internal,不对外选用)
DETECT_ONLY_MODEL_ID = "vehicle-detect"  # 纯检测:只 rtdetr 出框,属性交下游(public,多阶段上游)
CLASSIFY_MODEL_ID = "vehicle-attr-classify"  # 纯分类:整图当一辆车,跳过 rtdetr(public,多阶段下游)

MODEL_DIR = os.environ.get("ONNXTOOLS_MODEL_DIR", "/app/models")
DET_MODEL = os.environ.get("ONNXTOOLS_DET_MODEL", "rtdetr-2024080100.onnx")
VA_MODEL = os.environ.get("ONNXTOOLS_VA_MODEL", "va_260612.onnx")
CONF_THRES = float(os.environ.get("ONNXTOOLS_CONF_THRES", "0.5"))

# idle-unload: 末次推理后空闲超 IDLE_UNLOAD_SECONDS 自动卸载(<=0 关闭)。与 yolo 对齐。
IDLE_UNLOAD_SECONDS = float(os.environ.get("ONNXTOOLS_IDLE_UNLOAD_SECONDS", "600"))
IDLE_CHECK_INTERVAL = float(os.environ.get("ONNXTOOLS_IDLE_CHECK_INTERVAL", "60"))

_predictor: VehicleAttributePredictor | None = None
_idle_task: asyncio.Task | None = None
_last_used: float | None = None


def _make_detector() -> Any:
    """构造独立 rtdetr 检测器(RtdetrORT),只给检测权重。"""
    from onnxtools import create_detector

    return create_detector(
        model_type="rtdetr",
        onnx_path=os.path.join(MODEL_DIR, DET_MODEL),
        conf_thres=CONF_THRES,
    )


def _make_va_classifier() -> Any:
    """构造独立车辆属性分类器(VehicleAttributeORT),只给分类权重(type/color map 用包内默认)。"""
    from onnxtools import VehicleAttributeORT

    return VehicleAttributeORT(os.path.join(MODEL_DIR, VA_MODEL), conf_thres=CONF_THRES)


def _make_pipeline() -> Any:
    """构造一锅端 composite(VehicleAttributePipeline,内部自建 detector + va)。"""
    from onnxtools.pipeline import VehicleAttributePipeline

    return VehicleAttributePipeline(
        model_type="rtdetr",
        model_path=os.path.join(MODEL_DIR, DET_MODEL),
        va_model_path=os.path.join(MODEL_DIR, VA_MODEL),
        conf_thres=CONF_THRES,
    )


async def _idle_watcher() -> None:
    """周期检查:末次推理后空闲超 IDLE_UNLOAD_SECONDS 则卸载全部句柄。"""
    while True:
        try:
            await asyncio.sleep(IDLE_CHECK_INTERVAL)
            if IDLE_UNLOAD_SECONDS <= 0 or _predictor is None or _last_used is None:
                continue
            if _predictor.loaded_count() == 0:
                continue
            idle = time.time() - _last_used
            if idle >= IDLE_UNLOAD_SECONDS:
                n = _predictor.unload()
                logger.info("idle unloaded %d handles (idle=%.0fs)", n, idle)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("idle_watcher error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _predictor, _idle_task
    # 懒加载:不在启动时加载模型,首次 predict 按 model_id 构造对应句柄。
    _predictor = VehicleAttributePredictor(
        detector_factory=_make_detector,
        va_factory=_make_va_classifier,
        pipeline_factory=_make_pipeline,
    )
    _idle_task = asyncio.create_task(_idle_watcher())
    logger.info(
        "onnxtools-backend ready (lazy): model_dir=%s det=%s va=%s conf=%.2f idle_unload=%.0fs",
        MODEL_DIR, DET_MODEL, VA_MODEL, CONF_THRES, IDLE_UNLOAD_SECONDS,
    )
    try:
        yield
    finally:
        if _idle_task is not None:
            _idle_task.cancel()
            try:
                await _idle_task
            except (asyncio.CancelledError, BaseException):
                pass
        if _predictor is not None:
            _predictor.unload()


app = FastAPI(title="onnxtools-backend", version=BACKEND_VERSION, lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "onnxtools-backend",
        "version": BACKEND_VERSION,
        "model_version": MODEL_VERSION,
        "ready": _predictor is not None,
        "loaded_handles": _predictor.loaded_count() if _predictor is not None else 0,
    }


def _detect_model_entry() -> dict[str, Any]:
    """一锅端 model:rtdetr 检测 + va 车辆属性（自报 output_attribute_schema）。

    单 backend「一锅端」场景:既出检测框又写车型/颜色属性。

    composition=composite:一个 model 内部串 rtdetr(检测)+ va(属性分类),内部编排复合。
    平台据此把它挡在「编排下游 stage」选择器外(编排只组合 atom),但单阶段可直接选用(开箱即用)。
    """
    return {
        "id": DETECT_MODEL_ID,
        "display_name": "[专用]车辆检测+属性",
        "task": "detection",
        "model_family": "rtdetr-v1",
        "infra": "onnx",
        # 一个 model 内部串 rtdetr(检测)+ va(属性分类),内部编排复合。
        "composition": "composite",
        "is_interactive": False,
        "supported_prompts": ["none"],
        "supported_geometric_outputs": ["bbox"],
        # 协议③：输出属性类型 + 取值域自描述，供平台一键导入项目 attribute_schema
        "output_attribute_types": ["class"],
        "output_attribute_schema": OUTPUT_ATTRIBUTE_SCHEMA,
        "default_thresholds": {"conf": CONF_THRES},
        "resource_profile": {"device": "gpu", "batchable": True},
    }


def _detect_only_model_entry() -> dict[str, Any]:
    """纯检测 model:只跑 rtdetr 检测出框,跳过 va 属性分类。

    多阶段编排的上游阶段——只产 bbox,车型/颜色属性交给下游纯分类原子。
    与一锅端 vehicle-attr 区别:不写 attributes,故不声明 output_attribute_schema。
    """
    return {
        "id": DETECT_ONLY_MODEL_ID,
        "display_name": "[专用]车辆检测",
        "task": "detection",
        "model_family": "rtdetr-v1",
        "infra": "onnx",
        # 单跑 rtdetr 检测,原子。多阶段编排上游检测阶段直接选用。
        "composition": "atom",
        "is_interactive": False,
        "supported_prompts": ["none"],
        "supported_geometric_outputs": ["bbox"],
        # 纯检测不写属性,不声明 output_attribute_*（属性交下游纯分类原子）。
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
        "display_name": "[专用]车辆属性分类",
        "task": "classification",
        "model_family": "PP-lcnet",
        "infra": "onnx",
        # 单跑 va 属性分类,原子。多阶段编排下游分类阶段直接选用。
        "composition": "atom",
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
    """协议 v2.2 模型目录:广播三个 model —— 一锅端检测+属性(composite,单阶段可选)
    + 纯检测原子(atom,多阶段上游)+ 纯分类原子(atom,多阶段下游)。predict 对三者路由均支持。"""
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
        "models": [_detect_model_entry(), _detect_only_model_entry(), _classify_model_entry()],
    }


@app.get("/versions")
def versions() -> dict[str, Any]:
    return {"versions": [MODEL_VERSION], "backend_version": BACKEND_VERSION}


@app.post("/unload")
def unload() -> dict[str, Any]:
    """手动卸载全部已加载句柄,释放显存(ModelMarket 卸载按钮 / 运维侧)。"""
    if _predictor is None:
        return {"ok": True, "unloaded": 0}
    n = _predictor.unload()
    return {"ok": True, "unloaded": n}


@app.post("/predict", response_model=BatchPredictResponse)
def predict(req: BatchPredictRequest) -> BatchPredictResponse:
    global _last_used
    if _predictor is None:
        raise HTTPException(status_code=503, detail="backend not ready")
    _last_used = time.time()

    # 协议 v2 多模型路由(按 context.model_id):纯分类 → 只跑 va;纯检测 → 只跑 rtdetr;
    # 否则(一锅端 vehicle-attr)走完整 pipeline。
    model_id = req.context.get("model_id")
    classify_only = model_id == CLASSIFY_MODEL_ID
    detect_only = model_id == DETECT_ONLY_MODEL_ID
    if classify_only:
        model_version = VA_MODEL_VERSION
    elif detect_only:
        model_version = DET_ONLY_MODEL_VERSION
    else:
        model_version = MODEL_VERSION

    results: list[PredictionResult] = []
    for t in req.tasks:
        try:
            if classify_only:
                items, infer_ms = _predictor.classify_one(t.file_path)
            elif detect_only:
                items, infer_ms = _predictor.detect_one(t.file_path)
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
