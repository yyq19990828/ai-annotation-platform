"""YOLO 预训练权重矩阵 + 文件名解析.

矩阵基于 ultralytics/assets release v8.3.0 + v8.4.0 (2026-06-08 核对). 与协议 v2
`/setup` 的 `models[].supported_variants` 严格对应:
- 每个 task (det/seg/pose/obb) 一份 series → sizes 映射
- /setup 生成 variants 时按此过滤, 前端只看到能加载的组合
- /predict 校验 (task, series, size) ∈ matrix, 否则 400

文件名解析约定:
- yolov8 系: yolov8{n,s,m,l,x}[-task].pt
- yolov9 系: yolov9{t,s,m,c,e}[-seg].pt (注意 t 仅 det, seg 仅 c/e)
- yolov10 系: yolov10{n,s,m,b,l,x}.pt (仅 det)
- yolo11 系: yolo11{n,s,m,l,x}[-task].pt
- yolo12 系: yolo12{n,s,m,l,x}.pt (仅 det)
- yolo26 系: yolo26{n,s,m,l,x}[-task].pt
- rtdetr 系: rtdetr-{l,x}.pt (仅 det, size 用 l/x 而非 nsmlx)
"""

from __future__ import annotations

from typing import Final

# 协议 v2 task id (与 capability_registry / aap_protocol_v2.vocab.TASK_VALUES 对齐).
TASK_DETECTION: Final[str] = "detection"
TASK_SEGMENTATION: Final[str] = "segmentation"
TASK_KEYPOINT: Final[str] = "keypoint"
TASK_OBB: Final[str] = "obb"

# task → series → sizes (按 ultralytics/assets v8.3.0 + v8.4.0 实际有的预训练权重).
# 维护规则: ultralytics 发布新权重时, 改本表 + 协议 /setup 输出会自动跟随.
MODEL_MATRIX: Final[dict[str, dict[str, tuple[str, ...]]]] = {
    TASK_DETECTION: {
        "yolov8":  ("n", "s", "m", "l", "x"),
        "yolov9":  ("t", "s", "m", "c", "e"),
        "yolov10": ("n", "s", "m", "b", "l", "x"),
        "yolo11":  ("n", "s", "m", "l", "x"),
        "yolo12":  ("n", "s", "m", "l", "x"),
        "yolo26":  ("n", "s", "m", "l", "x"),
        "rtdetr":  ("l", "x"),
    },
    TASK_SEGMENTATION: {
        "yolov8": ("n", "s", "m", "l", "x"),
        # yolov9-seg 官方仅放出 c/e 两档.
        "yolov9": ("c", "e"),
        "yolo11": ("n", "s", "m", "l", "x"),
        "yolo26": ("n", "s", "m", "l", "x"),
    },
    TASK_KEYPOINT: {
        "yolov8": ("n", "s", "m", "l", "x"),
        "yolo11": ("n", "s", "m", "l", "x"),
        "yolo26": ("n", "s", "m", "l", "x"),
    },
    TASK_OBB: {
        "yolov8": ("n", "s", "m", "l", "x"),
        "yolo11": ("n", "s", "m", "l", "x"),
        "yolo26": ("n", "s", "m", "l", "x"),
    },
}

# series 推荐选项 (UI 默认选中). 选 yolo11 因为兼顾精度 / 速度 / 任务覆盖.
RECOMMENDED_SERIES: Final[str] = "yolo11"
RECOMMENDED_SIZE: Final[str] = "s"

# size 元信息. tier 按 size 字母分档为「快速 / 均衡 / 精度」, 协议中性, 跨 series 通用。
# v0.14.12 移除 vram_gb: 之前是粗估占位 (n=2GB 等), 但 yolov8n .pt 实际加载 ~300MB,
# yolov8x ~500MB, 推理峰值还取决于 batch / 输入分辨率 / FP16/32, 暴露统一数字会误导。
# 等真有按 (series, size, task) 维度的官方 params/FLOPs 表再补。
SIZE_META: Final[dict[str, dict[str, object]]] = {
    "n": {"label": "nano",     "tier": "fast"},
    "t": {"label": "tiny",     "tier": "fast"},
    "s": {"label": "small",    "tier": "balanced"},
    "m": {"label": "medium",   "tier": "balanced"},
    "b": {"label": "balanced", "tier": "balanced"},
    "c": {"label": "compact",  "tier": "balanced"},
    "l": {"label": "large",    "tier": "accurate"},
    "e": {"label": "extreme",  "tier": "accurate"},
    "x": {"label": "xlarge",   "tier": "accurate"},
}

# series 元信息. label 是 UI 展示名.
SERIES_LABEL: Final[dict[str, str]] = {
    "yolov8":  "YOLOv8",
    "yolov9":  "YOLOv9",
    "yolov10": "YOLOv10",
    "yolo11":  "YOLO11",
    "yolo12":  "YOLO12",
    "yolo26":  "YOLO26",
    "rtdetr":  "RT-DETR",
}

# task → ultralytics 权重文件名后缀. detection 无后缀.
_TASK_SUFFIX: Final[dict[str, str]] = {
    TASK_DETECTION: "",
    TASK_SEGMENTATION: "-seg",
    TASK_KEYPOINT: "-pose",
    TASK_OBB: "-obb",
}


class UnsupportedVariantError(ValueError):
    """(task, series, size) 组合不在 MODEL_MATRIX 内."""


def is_supported(task: str, series: str, size: str) -> bool:
    return size in MODEL_MATRIX.get(task, {}).get(series, ())


def resolve_weight_filename(task: str, series: str, size: str) -> str:
    """返回 ultralytics 期望的权重文件名 (如 yolo11s-seg.pt / rtdetr-l.pt).

    缺失组合抛 UnsupportedVariantError. 文件名规则 (来自 ultralytics/assets release):
    - rtdetr 系列特殊: `rtdetr-{l,x}.pt`, 不带后缀 (RT-DETR 只有 detection)
    - 其它: `{series}{size}{task_suffix}.pt`, e.g. yolov8s.pt / yolo11l-pose.pt
    """
    if not is_supported(task, series, size):
        raise UnsupportedVariantError(
            f"task={task} series={series} size={size} not in MODEL_MATRIX"
        )
    if series == "rtdetr":
        return f"rtdetr-{size}.pt"
    suffix = _TASK_SUFFIX[task]
    return f"{series}{size}{suffix}.pt"


def iter_supported_combinations() -> list[tuple[str, str, str]]:
    """全部 (task, series, size) 组合扁平列表, 用于冒烟测试覆盖."""
    out: list[tuple[str, str, str]] = []
    for task, by_series in MODEL_MATRIX.items():
        for series, sizes in by_series.items():
            for size in sizes:
                out.append((task, series, size))
    return out


def series_options_for_task(task: str) -> list[str]:
    """该 task 下有预训练的全部 series, 顺序与 MODEL_MATRIX 一致 (= 协议 /setup 输出顺序)."""
    return list(MODEL_MATRIX.get(task, {}).keys())


def sizes_for(task: str, series: str) -> list[str]:
    """该 (task, series) 下有预训练的全部 size."""
    return list(MODEL_MATRIX.get(task, {}).get(series, ()))
