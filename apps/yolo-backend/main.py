"""yolo-backend FastAPI 入口 (v0.14.12).

端点 (ml-backend 协议 v2):
    GET  /health          健康检查 + provisioning 元信息 + 池状态
    GET  /setup           协议 v2 多模型目录 (4 task × series × size variants)
    GET  /versions        当前部署的 backend / ultralytics 版本
    POST /predict         批量预测 (单 task / 多 task 共享同 context)
    POST /unload          手动释放显存 (运维侧用)
    GET  /metrics         Prometheus

`/setup.supported_prompts = ["none"]`: yolo 是纯批量, 无交互式 prompt;
平台 ToolDock 据此把 yolo 排除出工作台交互工具栏, 只走「批量预标」入口.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import torch
from aap_protocol_v2 import (
    COMPAT_PROTOCOL_VERSIONS,
    PROTOCOL_VERSION,
    BatchPredictResponse,
    ModelUnavailableError,
    PlatformRole,
    PredictionResult,
    VariantNotSupportedError,
)
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from model_pool import ModelPool
from model_registry import (
    MODEL_MATRIX,
    OPENVOCAB_DEFAULT_WORLD,
    OPENVOCAB_DEFAULT_YOLOE,
    OPENVOCAB_SERIES_LABEL,
    OPENVOCAB_WORLD_SERIES,
    OPENVOCAB_YOLOE_SERIES,
    POOL_TASK_OPENVOCAB,
    RECOMMENDED_SERIES,
    RECOMMENDED_SIZE,
    SERIES_LABEL,
    SIZE_META,
    UnsupportedVariantError,
    is_openvocab_series,
    is_openvocab_supported,
    openvocab_family,
    resolve_openvocab_weight_filename,
    resolve_weight_filename,
)
from observability import (
    init_perfhud_collectors,
    sample_perfhud,
    shutdown_perfhud_collectors,
    update_pool_size,
)
from predictor import YoloPredictor
from schemas import (
    BatchPredictRequest,
    Context,
    InteractiveRequest,
    WarmupRequest,
    WarmupResponse,
)

logger = logging.getLogger("yolo-backend")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

BACKEND_VERSION = "0.1.0"  # backend 仓自身版本, 与 ultralytics 版本独立
MODEL_VERSION = "ultralytics-8.4.x"

DEVICE = os.environ.get("YOLO_DEVICE", "cuda:0")
MODEL_POOL_CAP = int(os.environ.get("YOLO_MODEL_POOL_CAP", "2"))
BUILD_TIMEOUT = float(os.environ.get("YOLO_BUILD_TIMEOUT", "30"))
IDLE_UNLOAD_SECONDS = float(os.environ.get("YOLO_IDLE_UNLOAD_SECONDS", "600"))
IDLE_CHECK_INTERVAL = float(os.environ.get("YOLO_IDLE_CHECK_INTERVAL", "60"))
STRICT_OFFLINE = os.environ.get("YOLO_STRICT_OFFLINE", "0") not in ("0", "", "false", "False")
CHECKPOINTS_DIR = Path(os.environ.get("YOLO_CHECKPOINTS_DIR", "/app/checkpoints"))


def _free_gpu_memory() -> None:
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _build_model(task: str, series: str, size: str):
    """同步构建 ultralytics 模型实例. 走 run_in_executor.

    开集 series (world/yoloe) 用 YOLOWorld/YOLOE 类加载; 闭集用 YOLO. 文件名按各自规则解析.
    """
    from ultralytics import YOLO  # noqa: PLC0415, 延迟到首次 build 避免 import 阻塞启动

    if is_openvocab_series(series):
        filename = resolve_openvocab_weight_filename(series, size)
        if openvocab_family(series) == "world":
            from ultralytics import YOLOWorld  # noqa: PLC0415
            model_cls = YOLOWorld
        else:
            from ultralytics import YOLOE  # noqa: PLC0415
            model_cls = YOLOE
    else:
        filename = resolve_weight_filename(task, series, size)
        model_cls = YOLO
    weight_path = CHECKPOINTS_DIR / filename
    if not weight_path.exists():
        if STRICT_OFFLINE:
            raise FileNotFoundError(
                f"weight {filename} not found in {CHECKPOINTS_DIR} (STRICT_OFFLINE=1)"
            )
        # 让 ultralytics 自己去 GH release 拉; YOLO("yolo11s.pt") 在 cwd 下载.
        # cd 到 checkpoints 目录, 让下载产物落对地方.
        cwd = os.getcwd()
        try:
            os.chdir(CHECKPOINTS_DIR)
            model = model_cls(filename)
        finally:
            os.chdir(cwd)
    else:
        model = model_cls(str(weight_path))

    if torch.cuda.is_available():
        try:
            model.to(DEVICE)
        except Exception as exc:  # noqa: BLE001
            logger.warning("model.to(%s) failed: %s; fallback CPU", DEVICE, exc)
    return model


_model_pool: ModelPool | None = None
_predictor: YoloPredictor | None = None
_idle_task: asyncio.Task | None = None


async def _idle_watcher() -> None:
    """周期检查池空闲, 超 IDLE_UNLOAD_SECONDS 触发 unload_all."""
    assert _model_pool is not None
    while True:
        try:
            await asyncio.sleep(IDLE_CHECK_INTERVAL)
            if IDLE_UNLOAD_SECONDS <= 0:
                continue
            if len(_model_pool) == 0:
                continue
            last = _model_pool.last_used_at()
            if last is None:
                continue
            idle = time.time() - last
            if idle >= IDLE_UNLOAD_SECONDS:
                n = await _model_pool.unload_all(reason="idle")
                logger.info("idle unloaded %d models (idle=%.0fs)", n, idle)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("idle_watcher error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model_pool, _predictor, _idle_task
    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)
    # v0.18.21 · 创建文本编码器权重目录 (Dockerfile 软链 /app/weights → 此处持久卷子目录).
    # ultralytics WEIGHTS_DIR 相对 "weights" 落 /app/weights → 经软链入卷; 目录须先存在,
    # 否则首个开集文本 /predict 时 clip.load(download_root="weights/clip") makedirs 失败.
    (CHECKPOINTS_DIR / "weights").mkdir(parents=True, exist_ok=True)
    init_perfhud_collectors()
    _model_pool = ModelPool(
        cap=MODEL_POOL_CAP,
        build_model=_build_model,
        free_gpu_memory=_free_gpu_memory,
        build_timeout=BUILD_TIMEOUT,
    )
    update_pool_size(0)
    _predictor = YoloPredictor(_model_pool)
    _idle_task = asyncio.create_task(_idle_watcher())
    logger.info(
        "yolo-backend startup: device=%s pool_cap=%d strict_offline=%s checkpoints=%s",
        DEVICE, MODEL_POOL_CAP, STRICT_OFFLINE, CHECKPOINTS_DIR,
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
        if _model_pool is not None:
            await _model_pool.unload_all(reason="shutdown")
        shutdown_perfhud_collectors()


app = FastAPI(title="yolo-backend", version=BACKEND_VERSION, lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    perf = sample_perfhud()
    # 平台 PerfHud / 观测面板读顶层 gpu_info + host (见 api/app/workers/ml_health.py
    # _PERFHUD_META_KEYS, gsam2 参考实现). sample_perfhud() 是扁平形, 这里映射成协议标准的
    # 嵌套结构, 否则平台拿不到指标 → 面板四条 bar 全显示 "—".
    used = perf.get("gpu_memory_used_mb")
    total = perf.get("gpu_memory_total_mb")
    # 本容器自身视角: 物理卡号 (多卡部署按容器绑卡, CUDA_VISIBLE_DEVICES 固定单卡时取该号)
    # + 本进程 torch 已保留显存 (不含 ~数百 MB CUDA 上下文). memory_used_mb 仍是整卡全局。
    _cuda = torch.cuda.is_available()
    _vis = os.environ.get("CUDA_VISIBLE_DEVICES", "").strip()
    gpu_info = {
        "device_name": perf.get("gpu_device_name"),
        "device_index": (int(_vis) if _vis.isdigit() else torch.cuda.current_device()) if _cuda else None,
        "memory_used_mb": used,
        "memory_total_mb": total,
        "memory_free_mb": (total - used) if (used is not None and total is not None) else None,
        "process_memory_mb": int(torch.cuda.memory_reserved() / 1024**2) if _cuda else None,
        "gpu_utilization_percent": perf.get("gpu_utilization_percent"),
        "gpu_temperature_celsius": perf.get("gpu_temperature_celsius"),
        "gpu_power_watts": perf.get("gpu_power_watts"),
    }
    host = {
        "container_cpu_percent": perf.get("container_cpu_percent"),
        "container_memory_percent": perf.get("container_memory_percent"),
    }
    # NOTE: ModelPool 实现了 __len__, 用 `if pool` 会因 __len__()==0 退化为 False;
    # 必须用 `is not None`.
    pool_ready = _model_pool is not None
    return {
        "status": "ok",
        "service": "yolo-backend",
        "version": BACKEND_VERSION,
        "model_version": MODEL_VERSION,
        "provisioning": {
            "device": DEVICE,
            "strict_offline": STRICT_OFFLINE,
            "checkpoints_dir": str(CHECKPOINTS_DIR),
        },
        "pool": _model_pool.pool_status() if pool_ready else {
            "cap": 0, "current_size": 0, "loaded_keys": [], "last_evict": None,
        },
        "gpu_info": gpu_info,
        "host": host,
    }


def _build_size_variants_for(task: str, series: str) -> list[dict[str, Any]]:
    sizes = MODEL_MATRIX.get(task, {}).get(series, ())
    out: list[dict[str, Any]] = []
    for sz in sizes:
        meta = SIZE_META.get(sz, {})
        item: dict[str, Any] = {"value": sz, "label": meta.get("label", sz)}
        if "vram_gb" in meta:
            item["vram_gb"] = meta["vram_gb"]
        if "tier" in meta:
            item["tier"] = meta["tier"]
        if sz == RECOMMENDED_SIZE and series == RECOMMENDED_SERIES:
            item["recommended"] = True
        out.append(item)
    return out


def _build_series_variants_for(task: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    series_options = list(MODEL_MATRIX.get(task, {}).keys())
    for series in series_options:
        item: dict[str, Any] = {
            "value": series,
            "label": SERIES_LABEL.get(series, series),
        }
        if series == RECOMMENDED_SERIES:
            item["recommended"] = True
        out.append(item)
    return out


def _supported_variants_for(task: str) -> list[dict[str, Any]]:
    """协议 v2 §4.1.6 形态: 两轴 series × size, 每轴 variants 严格按预训练矩阵.

    yolo 这版 size 选项与 series 共生 (v9 在 seg 只有 c/e), 所以 size 轴的 variants
    实际上不是「全 series 共享」而是「按 series 子集合并」. 这里取**该 task 下所有
    series 用过的 size 的并集**, 前端选了 series 后再以 model_pool 的 400 兜底.
    更优做法是 protocol 支持 conditional variants (size depends on series), 留待
    协议 v3 扩展; 这版 yolo 取并集 + 服务端校验.
    """
    series_axis = {
        "key": "series",
        "title": "版本系列",
        "variants": _build_series_variants_for(task),
    }
    # 该 task 下所有 series 出现过的 size 并集 (顺序按 SIZE_META).
    used_sizes: set[str] = set()
    for series, sizes in MODEL_MATRIX.get(task, {}).items():
        used_sizes.update(sizes)
    size_variants: list[dict[str, Any]] = []
    for sz in ("n", "t", "s", "m", "b", "c", "l", "e", "x"):
        if sz not in used_sizes:
            continue
        meta = SIZE_META.get(sz, {})
        item: dict[str, Any] = {"value": sz, "label": meta.get("label", sz)}
        if "vram_gb" in meta:
            item["vram_gb"] = meta["vram_gb"]
        if "tier" in meta:
            item["tier"] = meta["tier"]
        if sz == RECOMMENDED_SIZE:
            item["recommended"] = True
        size_variants.append(item)
    size_axis = {"key": "size", "title": "尺寸 / 精度档", "variants": size_variants}
    return [series_axis, size_axis]


_PARAMS_SCHEMA = {
    "type": "object",
    "properties": {
        "conf": {
            "type": "number", "minimum": 0.0, "maximum": 1.0, "default": 0.25,
            "title": "置信度阈值",
            "x-platform-role": PlatformRole.CONFIDENCE.value,
            "description": "保留置信度高于此值的检测/分割结果. 调高=更少更准, 调低=更多但含噪.",
        },
        "iou": {
            "type": "number", "minimum": 0.0, "maximum": 1.0, "default": 0.70,
            "title": "NMS IoU 阈值",
            "x-platform-role": PlatformRole.IOU.value,
            "description": "非极大值抑制重叠阈值. 调高保留更多重叠框, 调低更严格去重.",
        },
        "max_det": {
            "type": "integer", "minimum": 1, "maximum": 1000, "default": 300,
            "title": "单图最大检出数",
            "x-platform-role": PlatformRole.MAX_DET.value,
        },
    },
}

# v0.18.24 · exemplar (YOLOE 视觉提示) 专属 params: 用 `score_threshold` 替代 conf 作为置信度
# 旋钮 (与 sam3 字段名对齐, 平台 exemplar 阈值滑块读 model.params.score_threshold.default)。
# 默认 0.25 而非闭集 0.25→实测 YOLOE VP 相似度分天然打得保守 (相似小目标多框命中也仅 ~0.5),
# 沿用闭集 0.5 会把正确候选挡在门外; 0.25 是召回与噪声的平衡点 (大目标仍 >0.9, 不受影响)。
_EXEMPLAR_DEFAULT_SCORE_THRESHOLD = 0.25
_EXEMPLAR_PARAMS_SCHEMA = {
    "type": "object",
    "properties": {
        "score_threshold": {
            "type": "number", "minimum": 0.0, "maximum": 1.0,
            "default": _EXEMPLAR_DEFAULT_SCORE_THRESHOLD,
            "title": "置信度阈值",
            "x-platform-role": PlatformRole.CONFIDENCE.value,
            "description": "只保留相似度高于此值的候选。YOLOE 视觉提示对相似目标打分偏保守, 阈值不宜过高; 调低=更多候选但可能含误检。",
        },
        "iou": {
            "type": "number", "minimum": 0.0, "maximum": 1.0, "default": 0.70,
            "title": "NMS IoU 阈值",
            "x-platform-role": PlatformRole.IOU.value,
            "description": "非极大值抑制重叠阈值. 调高保留更多重叠框, 调低更严格去重.",
        },
        "max_det": {
            "type": "integer", "minimum": 1, "maximum": 1000, "default": 300,
            "title": "单图最大检出数",
            "x-platform-role": PlatformRole.MAX_DET.value,
        },
    },
}


def _variant_combinations_for(task: str) -> list[list[str]]:
    """该 task 下所有合法 (series, size) 组合, 与 supported_variants 轴顺序一致.

    协议 v2 字段 `variant_combinations` (可选): 当 backend 的多个 axis 不是真笛卡尔积
    (yolo 的 v9 在 detection 只支持 t/s/m/c/e, 不能与 size=n 组合) 时, 用这个字段显式
    列出合法组合; 前端目录展示时严格按列表展开. 若字段缺省, 前端默认按 axes 笛卡尔积.
    """
    out: list[list[str]] = []
    matrix = MODEL_MATRIX.get(task, {})
    for series, sizes in matrix.items():
        for size in sizes:
            out.append([series, size])
    return out


def _default_variants_for(task: str) -> dict[str, str]:
    """协议 v2.1 字段 `default_variants`: backend 自报该 task 的默认 variant 组合,
    供前端在用户未选择时作为初值 (优先级低于项目级 default_variants, 高于 backend env).

    优先用 RECOMMENDED_SERIES + RECOMMENDED_SIZE (yolo11/s); 若该组合在 task 内无
    预训练权重 (理论不会发生, yolo11/s 4 task 全覆盖), 回退到该 task 第一个合法组合.
    """
    matrix = MODEL_MATRIX.get(task, {})
    if RECOMMENDED_SERIES in matrix and RECOMMENDED_SIZE in matrix[RECOMMENDED_SERIES]:
        return {"series": RECOMMENDED_SERIES, "size": RECOMMENDED_SIZE}
    for series, sizes in matrix.items():
        if sizes:
            return {"series": series, "size": sizes[0]}
    return {}  # 不应发生 (task 至少一个合法权重), 留 {} 让前端走"无默认"逻辑


def _build_model_entry(
    model_id: str, display_name: str, task: str,
    geometric_outputs: list[str],
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": model_id,
        "display_name": display_name,
        "task": task,
        "model_family": "yolo",
        "infra": "pytorch",
        "is_interactive": False,
        # YOLO 各 task 均单次推理,原子(协议 v2.2)。
        "composition": "atom",
        "supported_prompts": ["none"],
        # 纯批量检测/分割: 整图, 也可在父框 crop 上跑 (crop-detect 下游)。
        "supported_inputs": ["full_image", "crop"],
        "supported_geometric_outputs": geometric_outputs,
        "output_attribute_types": ["class"],
        # YOLO 各 task 均 GPU 批量推理。
        "resource_profile": {"device": "gpu", "batchable": True},
        "supported_variants": _supported_variants_for(task),
        "variant_combinations": _variant_combinations_for(task),
        "default_variants": _default_variants_for(task),
        "params": _PARAMS_SCHEMA,
    }
    # v0.14.17: 模型原生类别表 (model.names), 供前端渲染类别白名单. 仅在该 task 模型已加载过
    # (warmup / 首次 predict 后) 时有值; 未加载时省略, 前端回退"不按类筛选". 读自权重 metadata,
    # 不硬编码 (官方权重与自训练一视同仁).
    if _model_pool is not None:
        classes = _model_pool.class_names(task)
        if classes:
            entry["classes"] = classes
    return entry


def _build_openvocab_variants(
    series_matrix: dict[str, tuple[str, ...]], default: tuple[str, str],
) -> list[dict[str, Any]]:
    """开集 model 的 series × size 两轴 (series 来自该条目自身的 series 子集)."""
    default_series, default_size = default
    series_variants: list[dict[str, Any]] = []
    for series in series_matrix:
        item: dict[str, Any] = {
            "value": series,
            "label": OPENVOCAB_SERIES_LABEL.get(series, series),
        }
        if series == default_series:
            item["recommended"] = True
        series_variants.append(item)
    used_sizes: set[str] = set()
    for sizes in series_matrix.values():
        used_sizes.update(sizes)
    size_variants: list[dict[str, Any]] = []
    for sz in ("n", "t", "s", "m", "b", "c", "l", "e", "x"):
        if sz not in used_sizes:
            continue
        meta = SIZE_META.get(sz, {})
        item = {"value": sz, "label": meta.get("label", sz)}
        if "tier" in meta:
            item["tier"] = meta["tier"]
        if sz == default_size:
            item["recommended"] = True
        size_variants.append(item)
    return [
        {"key": "series", "title": "版本系列", "variants": series_variants},
        {"key": "size", "title": "尺寸 / 精度档", "variants": size_variants},
    ]


def _openvocab_variant_combinations(
    series_matrix: dict[str, tuple[str, ...]],
) -> list[list[str]]:
    return [[series, size] for series, sizes in series_matrix.items() for size in sizes]


def _build_openvocab_model_entry(
    model_id: str, display_name: str,
    series_matrix: dict[str, tuple[str, ...]], default: tuple[str, str],
    *,
    task: str = "detection",
    geometric_outputs: list[str] | None = None,
    supported_text_outputs: list[str] | None = None,
) -> dict[str, Any]:
    """开集文本 model 条目 (v0.18.21 检测 / v0.18.22 分割). 与闭集结构一致, 但
    supported_prompts=['text']; task/几何输出/文本输出形态按条目区分.

    supported_text_outputs (协议: 文本批量路径的输出形态选项, 与 gsam2 同形) 决定前端文本面板
    是否展示 box/mask/both 三选: 检测条目 ['box'] 锁框, 分割条目 ['mask','both'] 出掩膜。
    """
    default_series, default_size = default
    entry: dict[str, Any] = {
        "id": model_id,
        "display_name": display_name,
        "task": task,
        "model_family": "yolo",
        "infra": "pytorch",
        "is_interactive": False,  # 文本=批量, 不进交互工具栏.
        "composition": "atom",
        "supported_prompts": ["text"],
        "supported_inputs": ["full_image", "crop"],
        "supported_geometric_outputs": geometric_outputs or ["bbox"],
        "output_attribute_types": ["class"],
        "resource_profile": {"device": "gpu", "batchable": True},
        "supported_variants": _build_openvocab_variants(series_matrix, default),
        "variant_combinations": _openvocab_variant_combinations(series_matrix),
        "default_variants": {"series": default_series, "size": default_size},
        "params": _PARAMS_SCHEMA,
    }
    if supported_text_outputs is not None:
        entry["supported_text_outputs"] = supported_text_outputs
    return entry


def _build_exemplar_model_entry() -> dict[str, Any]:
    """v0.18.23 · YOLOE visual prompt exemplar 交互模型条目.

    is_interactive=True + supported_prompts=["exemplar"] → 平台 useBackendRouting 据此把
    yolo-backend 视为交互 backend, 工作台 ExemplarTool 启用 (与 sam3 exemplar 同列, 路由由
    用户选定的当前交互 backend 决定)。框样例找全图同类, 输出 box/mask/both。仅 yoloe series。
    """
    default_series, default_size = OPENVOCAB_DEFAULT_YOLOE
    return {
        "id": "exemplar-yoloe",
        "display_name": "YOLOE 视觉提示 (框样例找同类)",
        "task": "interactive_seg",
        "model_family": "yolo",
        "infra": "pytorch",
        "is_interactive": True,
        "composition": "atom",
        "supported_prompts": ["exemplar"],
        # v0.18.23 · exemplar 能力声明 (字段与 sam3 对齐, 供前端按能力渲染控件):
        # YOLOE 支持多正框 + per-request 阈值, 但**无负框** (negative_box=False) /
        # MVP 不叠 text (text_combination=False) → 前端据此隐藏负极性按钮与 text 输入。
        "exemplar_capabilities": {
            "multi_box": True,
            "negative_box": False,
            "text_combination": False,
            "threshold_refilter": True,
        },
        # 交互: 框样例驱动整图相似 (不作批量 crop 下游)。
        "supported_inputs": ["full_image"],
        # VPSeg 同时产出 box + mask → 三档输出皆可。
        "supported_geometric_outputs": ["bbox", "polygon"],
        "output_attribute_types": ["class"],
        # 单次交互推理, 不作批量。
        "resource_profile": {"device": "gpu", "batchable": False},
        "supported_variants": _build_openvocab_variants(
            OPENVOCAB_YOLOE_SERIES, OPENVOCAB_DEFAULT_YOLOE
        ),
        "variant_combinations": _openvocab_variant_combinations(OPENVOCAB_YOLOE_SERIES),
        "default_variants": {"series": default_series, "size": default_size},
        # exemplar 专属 params: score_threshold 默认 0.25 (前端阈值滑块初值由此而来)。
        "params": _EXEMPLAR_PARAMS_SCHEMA,
    }


@app.get("/setup")
def setup() -> dict[str, Any]:
    """协议 v2 多模型目录. 详见 docs-site/dev/reference/ml-backend-protocol.md §4.1.6."""
    return {
        "protocol_version": PROTOCOL_VERSION,
        "compat_protocol_versions": COMPAT_PROTOCOL_VERSIONS,
        "name": "yolo-backend",
        "version": BACKEND_VERSION,
        "model_version": MODEL_VERSION,
        "labels": [],  # 顶层 hint 留空; v0.14.17 起类别表逐 model 暴露 (models[].classes) 供前端
        #               类别白名单 UI. 平台仍不做"模型类→项目标签"映射 (NG6 保留, 由 alias 配置 + 采纳时人选承担).
        # v0.18.23 · 顶层 hint; 平台实际按 models[] 并集派生 (is_interactive=any(model)),
        # exemplar 模型令本 backend 整体成为交互 backend。顶层仍报 false 仅为兼容旧消费方。
        "is_interactive": False,
        # v0.18.21/23 · 闭集四 task 纯批量(none) + 开集文本检测/分割(text) + 视觉提示(exemplar).
        # 顶层为各 model 并集 hint; 平台按 models[].supported_prompts 逐 model 路由
        # (text → 批量文本面板; exemplar → 工作台交互工具)。
        "supported_prompts": ["none", "text", "exemplar"],
        "supported_geometric_outputs": ["bbox", "polygon", "keypoint", "rotated_bbox"],
        "supported_variants": [],  # 顶层留空, 由 models[].supported_variants 各自声明.
        "infra": "pytorch",
        "warmup_endpoint": True,  # v0.14.14: 声明本 backend 支持 POST /warmup (协议 §4.4)
        "params": _PARAMS_SCHEMA,
        "models": [
            _build_model_entry(
                "detect", "YOLO 目标检测",
                "detection", ["bbox"],
            ),
            _build_model_entry(
                "segment", "YOLO 实例分割",
                "segmentation", ["polygon"],
            ),
            _build_model_entry(
                "pose", "YOLO 人体关键点",
                "keypoint", ["keypoint"],
            ),
            _build_model_entry(
                "obb", "YOLO 朝向框",
                "obb", ["rotated_bbox"],
            ),
            # v0.18.21 · 开集文本检测 (批量文本面板, 与 gsam2 text 同列).
            _build_openvocab_model_entry(
                "detect-world", "YOLO-World 开集文本检测",
                OPENVOCAB_WORLD_SERIES, OPENVOCAB_DEFAULT_WORLD,
                task="detection", geometric_outputs=["bbox"],
                supported_text_outputs=["box"],
            ),
            _build_openvocab_model_entry(
                "detect-yoloe", "YOLOE 开集文本检测",
                OPENVOCAB_YOLOE_SERIES, OPENVOCAB_DEFAULT_YOLOE,
                task="detection", geometric_outputs=["bbox"],
                supported_text_outputs=["box"],
            ),
            # v0.18.22 · YOLOE 开集文本分割 (同 -seg 权重出 mask, 与 detect-yoloe 共用句柄).
            _build_openvocab_model_entry(
                "segment-yoloe", "YOLOE 开集文本分割",
                OPENVOCAB_YOLOE_SERIES, OPENVOCAB_DEFAULT_YOLOE,
                task="segmentation", geometric_outputs=["polygon"],
                supported_text_outputs=["mask", "both"],
            ),
            # v0.18.23 · YOLOE visual prompt exemplar (交互工具, is_interactive=true).
            _build_exemplar_model_entry(),
        ],
    }


@app.get("/versions")
def versions() -> dict[str, Any]:
    try:
        from ultralytics import __version__ as ul_ver
    except Exception:  # noqa: BLE001
        ul_ver = "unknown"
    return {
        "versions": [MODEL_VERSION],
        "backend_version": BACKEND_VERSION,
        "ultralytics": ul_ver,
    }


async def _run_predict(req: BatchPredictRequest) -> list[PredictionResult]:
    """核心: 校验组合 + 逐 task 推理, 产出 PredictionResult 列表。响应形态由调用方按 wire 决定。"""
    if _predictor is None or _model_pool is None:
        raise HTTPException(status_code=503, detail="backend not ready")
    ctx: Context = req.context
    if not _is_supported_combo(ctx):
        raise _unsupported_combo_error(ctx.type, ctx.variants.series, ctx.variants.size)
    results: list[PredictionResult] = []
    for t in req.tasks:
        try:
            result_items, cache_hit, load_ms, infer_ms = await _predictor.predict_one(
                t.file_path, ctx
            )
            score = max((r.get("score", 0.0) for r in result_items), default=0.0)
            results.append(
                PredictionResult(
                    task=t.id,
                    result=result_items,
                    score=score,
                    model_version=f"{ctx.variants.series}{ctx.variants.size}",
                    inference_time_ms=infer_ms,
                    cache_hit=cache_hit,
                    model_load_ms=load_ms,
                )
            )
        except UnsupportedVariantError as exc:
            raise VariantNotSupportedError("model_variants", str(exc), []) from exc
        except FileNotFoundError as exc:
            raise ModelUnavailableError(
                _pool_key(ctx.type, ctx.variants.series, ctx.variants.size),
                str(exc),
            ) from exc
        except Exception as exc:  # noqa: BLE001
            logger.exception("predict failed for task %s", t.id)
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    return results


@app.post("/predict")
async def predict(request: Request) -> dict[str, Any]:
    """批量 (复数 tasks[]) 与交互 (单数 task) 共用端点, 按 wire 形态回不同响应:

    - 单数 ``{task, context}`` (平台 predict_interactive 的 exemplar / 交互调用) → **单数**
      ``PredictionResult`` (顶层 ``result``); 平台交互客户端读 ``data["result"]``, 必须单数。
    - 复数 ``{tasks, context}`` (批量预标) → ``BatchPredictResponse`` (``results[]``)。

    与 gsam2/sam3 的 /predict 双形态契约一致。
    """
    body = await request.json()
    is_single = isinstance(body, dict) and "task" in body and "tasks" not in body
    req = BatchPredictRequest.model_validate(body)
    results = await _run_predict(req)
    if is_single:
        return results[0].model_dump(exclude_none=True)
    return BatchPredictResponse(results=results).model_dump(exclude_none=True)


@app.post("/predict/interactive")
async def predict_interactive(req: InteractiveRequest) -> dict[str, Any]:
    """交互式单 task 路由 (兼容旧路径): 返回单数 PredictionResult, 与 /predict 单数 wire 一致。"""
    results = await _run_predict(BatchPredictRequest(tasks=[req.task], context=req.context))
    return results[0].model_dump(exclude_none=True)


def _is_supported_combo(ctx: Context) -> bool:
    series = ctx.variants.series
    size = ctx.variants.size
    if ctx.type == "text" or is_openvocab_series(series):
        return is_openvocab_supported(series, size)
    return size in MODEL_MATRIX.get(ctx.type, {}).get(series, ())


def _unsupported_combo_error(task: str, series: str, size: str) -> VariantNotSupportedError:
    if is_openvocab_series(series) or task == "text":
        from model_registry import openvocab_sizes  # noqa: PLC0415
        return VariantNotSupportedError("size", size, openvocab_sizes(series))
    task_matrix = MODEL_MATRIX.get(task, {})
    if series not in task_matrix:
        return VariantNotSupportedError("series", series, tuple(task_matrix))
    return VariantNotSupportedError("size", size, tuple(task_matrix.get(series, ())))


def _pool_key(task: str, series: str, size: str) -> str:
    return f"{series}/{size}/{task}"


@app.post("/unload")
async def unload() -> dict[str, Any]:
    if _model_pool is None:
        return {"ok": True, "unloaded": 0}
    n = await _model_pool.unload_all(reason="manual")
    return {"ok": True, "unloaded": n}


@app.post("/warmup", response_model=WarmupResponse)
async def warmup(req: WarmupRequest) -> WarmupResponse:
    """v0.14.14 协议 §4.4: 加载指定 (task, series, size) 权重到 pool, 不跑 forward.

    重复预热同 variant 返回 cache_hit=true. pool 满时按 LRU 淘汰最旧的 key, evicted 字段
    回填被淘汰的 key 名供前端 toast 提示.
    """
    if _model_pool is None:
        raise HTTPException(status_code=503, detail="backend not ready")
    series, size = req.variants.series, req.variants.size
    # 开集 series: 校验 + 预热走 openvocab pool task (与 /predict 文本路径同 key).
    if is_openvocab_series(series):
        if not is_openvocab_supported(series, size):
            raise _unsupported_combo_error(req.task, series, size)
        pool_task = POOL_TASK_OPENVOCAB
    else:
        if size not in MODEL_MATRIX.get(req.task, {}).get(series, ()):
            raise _unsupported_combo_error(req.task, series, size)
        pool_task = req.task
    try:
        cache_hit, load_ms, evicted = await _model_pool.warmup(pool_task, series, size)
    except FileNotFoundError as exc:
        raise ModelUnavailableError(_pool_key(pool_task, series, size), str(exc)) from exc
    return WarmupResponse(
        ok=True,
        model_load_ms=load_ms,
        cache_hit=cache_hit,
        evicted=evicted,
    )


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
