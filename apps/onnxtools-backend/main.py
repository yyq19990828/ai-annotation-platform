"""onnxtools-backend FastAPI 入口 —— 二阶段车辆属性预标注（ml-backend 协议 v2.2）。

端点：
    GET  /health    健康检查 + 句柄池状态 (pool)
    GET  /setup     协议 v2.2 model 目录（三个 model，自报 output_attribute_schema）
    GET  /versions  版本
    POST /predict   批量预测（按 context.model_id 路由一锅端 / 纯检测 / 纯分类）
    POST /warmup    预加载句柄到显存（ModelMarket 预热按钮，协议 §4.4）
    POST /unload    手动释放显存（运维侧用，ModelMarket 卸载按钮）

三个 model 分别架在各自单模型推理类上、按需懒加载：``vehicle-detect`` 直跑独立
``RtdetrORT`` 只做检测（多阶段编排上游，composition=atom）；``vehicle-attr-classify``
直跑独立 ``VehicleAttributeORT`` 只做分类（多阶段下游，atom）；``vehicle-attr`` 跑完整
``VehicleAttributePipeline``（一锅端检测+属性，composition=composite，过渡保留）。
detect-only 部署只加载检测器、classify-only 只加载分类器。无 variant 多轴；句柄池由
VehicleAttributePredictor 内部管理，支持 /warmup 预热 + /unload + idle-unload。
`/setup.supported_prompts=["none"]`：纯批量，平台只走「批量预标」入口。
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from aap_backend_runtime import versions_payload
from aap_protocol_v2 import (
    COMPAT_PROTOCOL_VERSIONS,
    PROTOCOL_VERSION,
    BatchPredictResponse,
    PredictionResult,
    WarmupResponse,
)
from fastapi import FastAPI, HTTPException

UTC = timezone.utc

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

# rtdetr 检测器 onnx metadata 为空，车辆类别按域知识静态自报（与 va 分类器 vehicle_type 取值域一致）。
VEHICLE_TYPES = ["car", "truck", "bus", "tanker", "slagcar", "fire engine", "mixer", "ambulance", "police car", "engineering truck", "hazardous_goods_vehicle", "manned_sweeping_vehicle", "school_bus"]

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
# claude[bot] P2 · per-handle 池统计 (loaded_at / last_used_at / hit_count), 替代
# /health.pool 此前对所有 handle 硬编码 hit_count=0 + last_used_at=loaded_at = 全局 _last_used。
# 旧实现让 AdminDashboard idle/stale 判定持续报"空闲", 触发假告警。
_handle_stats: dict[str, dict[str, Any]] = {}


def _handle_for(model_id: str | None) -> str:
    """model_id → handle 名 (与 VehicleAttributePredictor.warm/predict 内部路由一致)。"""
    if model_id == "vehicle-attr-classify":
        return "va"
    if model_id == "vehicle-detect":
        return "detector"
    return "pipeline"


def _touch_handle(name: str, *, hit: bool) -> None:
    """更新 handle 的 last_used_at / hit_count; 首见时同时写 loaded_at。

    hit=True (predict 完成) 才递增 hit_count; warmup 不算 hit (只更新 loaded_at)。
    """
    now = datetime.now(UTC).isoformat()
    rec = _handle_stats.get(name)
    if rec is None:
        _handle_stats[name] = {
            "loaded_at": now,
            "last_used_at": now,
            "hit_count": 1 if hit else 0,
        }
        return
    rec["last_used_at"] = now
    if hit:
        rec["hit_count"] = rec.get("hit_count", 0) + 1


def _forget_handles() -> None:
    """unload / idle-unload 释放后清零 (下次 warm/predict 重新建)。"""
    _handle_stats.clear()


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
                _forget_handles()
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


def _pool_status() -> dict[str, Any]:
    """协议 §4.3 PoolStatus: 句柄池状态, 供模型市场展示已加载 / 预热状态。

    onnxtools 无显存 LRU, 句柄按需懒加载 (≤3: pipeline/detector/va); cap=3,
    current_size=已加载句柄数, loaded_keys 列出各句柄名 (last_used 取末次推理时间)。
    """
    handles = _predictor.loaded_handles() if _predictor is not None else []
    fallback_iso = (
        datetime.fromtimestamp(_last_used, UTC).isoformat() if _last_used is not None else None
    )
    loaded_keys = []
    for name in handles:
        rec = _handle_stats.get(name)
        if rec is None:
            # 兜底: handle 已加载但 stats 未记 (理论上 warm/predict 都会 touch)。
            loaded_keys.append(
                {"key": f"onnxtools/{name}", "loaded_at": fallback_iso,
                 "last_used_at": fallback_iso, "hit_count": 0}
            )
        else:
            loaded_keys.append(
                {"key": f"onnxtools/{name}", "loaded_at": rec["loaded_at"],
                 "last_used_at": rec["last_used_at"], "hit_count": rec["hit_count"]}
            )
    return {
        "cap": 3,
        "current_size": len(handles),
        "loaded_keys": loaded_keys,
        "last_evict": None,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "onnxtools-backend",
        "version": BACKEND_VERSION,
        "model_version": MODEL_VERSION,
        "ready": _predictor is not None,
        "loaded_handles": _predictor.loaded_count() if _predictor is not None else 0,
        # v0.18.20 · 句柄池状态, 供模型市场「已加载 / 预热」展示 (此前缺 pool 字段)。
        "pool": _pool_status(),
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
        # 一锅端检测+属性: 整图 / 父框 crop 上跑。
        "supported_inputs": ["full_image", "crop"],
        "supported_geometric_outputs": ["bbox"],
        "classes": [{"index": i, "name": n} for i, n in enumerate(VEHICLE_TYPES)],
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
        # 纯检测: 整图 / 父框 crop 上检子物体 (crop-detect 下游)。
        "supported_inputs": ["full_image", "crop"],
        "supported_geometric_outputs": ["bbox"],
        "classes": [{"index": i, "name": n} for i, n in enumerate(VEHICLE_TYPES)],
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
        # 纯分类: 对裁好的 ROI(crop)分类, 也可整图。
        "supported_inputs": ["full_image", "crop"],
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
        # v0.18.20 · 声明支持 POST /warmup (协议 §4.4), 让模型市场「预热默认」按钮可用。
        "warmup_endpoint": True,
        "models": [_detect_model_entry(), _detect_only_model_entry(), _classify_model_entry()],
    }


@app.get("/versions")
def versions() -> dict[str, Any]:
    return versions_payload(MODEL_VERSION, BACKEND_VERSION)


@app.post("/warmup", response_model=WarmupResponse)
def warmup(body: dict[str, Any] | None = None) -> WarmupResponse:
    """协议 §4.4 · 预加载句柄到显存,不跑 forward(模型市场「预热默认」按钮)。

    body 可空(预热一锅端 pipeline)或带 ``model_id`` 选择性预热某句柄。重复预热返回
    cache_hit=true。onnxtools 无 LRU 淘汰,evicted 恒 null。
    """
    global _last_used
    if _predictor is None:
        raise HTTPException(status_code=503, detail="backend not ready")
    model_id = (body or {}).get("model_id")
    t0 = time.monotonic()
    cache_hit = _predictor.warm(model_id)
    load_ms = int((time.monotonic() - t0) * 1000)
    _last_used = time.time()
    # claude[bot] P2 · 把 warmup 反映到 per-handle 池统计 (hit=False, warmup 不算推理命中)。
    _touch_handle(_handle_for(model_id), hit=False)
    return WarmupResponse(ok=True, model_load_ms=load_ms, cache_hit=cache_hit, evicted=None)


@app.post("/unload")
def unload() -> dict[str, Any]:
    """手动卸载全部已加载句柄,释放显存(ModelMarket 卸载按钮 / 运维侧)。"""
    if _predictor is None:
        return {"ok": True, "unloaded": 0}
    n = _predictor.unload()
    _forget_handles()
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
        handle_name = "va"
    elif detect_only:
        model_version = DET_ONLY_MODEL_VERSION
        handle_name = "detector"
    else:
        model_version = MODEL_VERSION
        handle_name = "pipeline"

    results: list[PredictionResult] = []
    for t in req.tasks:
        try:
            if classify_only:
                items, infer_ms = _predictor.classify_one(t.file_path)
            elif detect_only:
                items, infer_ms = _predictor.detect_one(t.file_path)
            else:
                items, infer_ms = _predictor.predict_one(t.file_path)
            # claude[bot] P2 · 真实推理命中, 更新该 handle 的 last_used_at + hit_count。
            _touch_handle(handle_name, hit=True)
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
