"""ML Backend 能力快照抽取 + 模态派生.

平台对 backend「能力 / 模态」的持久化感知统一在此派生:
- `extract_capabilities`: 从 backend `/setup` 响应抽出平台关心的能力快照。
- `derive_modalities`: 由能力快照派生平台视图概念「模态」(image / video / lidar)。

能力快照随 `services.ml_backend.check_health` 写入 `ml_backends.health_meta["capabilities"]`
(HealthMeta schema `extra="allow"`, 无 alembic 迁移)。

v0.14.9 · 能力声明协议 v2 (多模型目录 + infra):
- `/setup` 顶层新增 `infra` + `models[]`; 能力声明下沉到 model 粒度。
- 一个 backend 暴露 N 个 model 条目, 每个自带 task / infra / 几何 / variants。
- 向后兼容: 老 backend (无 `models[]`) 由顶层能力字段合成「隐式单 model」。
- 同时保留顶层「扁平并集」字段 (supported_prompts / ... / modalities),
  让现有消费方 (ToolDock / 绑定校验 / 列表展示) 零回归。
"""

from __future__ import annotations

# v0.14.11 · 受控词表与 task→默认几何统一由 capability_registry SSOT 派生,
# 协议元数据 (label / summary / suggested_backends) 同源, 供
# `GET /v1/ml-capabilities/protocol` 直接对外暴露。
from .capability_registry import (
    GEOMETRY_VALUES,
    INFRA_VALUES,
    TASK_DEFAULT_GEOMETRY as _TASK_DEFAULT_GEOMETRY,
    TASK_VALUES,
)

__all__ = [
    "INFRA_VALUES",
    "TASK_VALUES",
    "GEOMETRY_VALUES",
    "extract_capabilities",
    "derive_modalities",
]

# 模态规范顺序 (image < video < lidar)。
_MODALITY_ORDER = {"image": 0, "video": 1, "lidar": 2}
_LIDAR_GEOMETRY = {"lidar_box_3d", "point_mask_3d"}


def _normalize_infra(value: object) -> str:
    """空 → "unknown"; 受控值小写归一; 非受控但非空 → 原样小写 (前端容忍未知)。"""
    if not isinstance(value, str):
        return "unknown"
    v = value.strip().lower()
    return v or "unknown"


def _union(models: list[dict], key: str) -> list[str]:
    """按出现顺序去重合并各 model 的某个列表字段。"""
    out: list[str] = []
    for m in models:
        for v in m.get(key) or []:
            if v not in out:
                out.append(v)
    return out


def _model_modality(model: dict) -> str:
    """由单个 model 的 task / 几何派生模态。"""
    if model.get("task") == "tracker" or model.get("supported_trackers"):
        return "video"
    geo = model.get("supported_geometric_outputs") or []
    if any(g in _LIDAR_GEOMETRY for g in geo):
        return "lidar"
    return "image"


def _normalize_model(model: dict, backend_infra: str) -> dict:
    """规范化一个 `/setup.models[]` 条目, infra 缺省继承 backend 默认。"""
    task = model.get("task") or "unknown"
    geo = list(model.get("supported_geometric_outputs") or [])
    if not geo and task in _TASK_DEFAULT_GEOMETRY:
        geo = list(_TASK_DEFAULT_GEOMETRY[task])
    model_id = str(model.get("id") or model.get("name") or "default")
    out: dict = {
        "id": model_id,
        "display_name": model.get("display_name") or model.get("name") or model_id,
        "task": task,
        "model_family": model.get("model_family"),
        "infra": _normalize_infra(model.get("infra"))
        if model.get("infra")
        else backend_infra,
        "is_interactive": bool(model.get("is_interactive")),
        "supported_prompts": list(model.get("supported_prompts") or []),
        "supported_geometric_outputs": geo,
        "output_attribute_types": list(model.get("output_attribute_types") or []),
        "supported_text_outputs": list(model.get("supported_text_outputs") or []),
        "supported_trackers": list(model.get("supported_trackers") or []),
        "supported_variants": model.get("supported_variants") or [],
        "variant_combinations": list(model.get("variant_combinations") or []),
        "variants_shared_across_tasks": bool(model.get("variants_shared_across_tasks", False)),
        # v0.14.13 · backend 自报的默认 variant 组合 (dict[axis_key, value]).
        # 前端 VariantSelector 在用户未选时取此作初值, 优先级低于项目级 default_variants.
        "default_variants": dict(model.get("default_variants") or {}),
        "default_thresholds": model.get("default_thresholds") or {},
        "resource_profile": model.get("resource_profile") or {},
        "params": model.get("params") or {},
        # v0.14.17 · 闭集检测器的原生类别表 (yolo model.names, [{index,name}]); 供前端类别白名单.
        # 仅在该 task 模型已加载过 (warmup/predict) 时 backend /setup 才带, 否则为空。
        "classes": list(model.get("classes") or []),
    }
    out["modality"] = _model_modality(out)
    return out


def _synthesize_single_model(setup: dict, backend_infra: str) -> dict:
    """老 backend (无 `models[]`) 的向后兼容路径: 顶层能力字段合成「隐式单 model」。

    task 由现有信号推断:
    - `supported_trackers` 非空 ⇒ tracker
    - `supported_prompts` 含 point/bbox/text/exemplar ⇒ interactive_seg (SAM 类)
    - 否则 ⇒ detection
    """
    prompts = list(setup.get("supported_prompts") or [])
    trackers = list(setup.get("supported_trackers") or [])
    if trackers:
        task = "tracker"
    elif any(p in ("point", "bbox", "text", "exemplar") for p in prompts):
        task = "interactive_seg"
    else:
        task = "detection"
    model_id = str(setup.get("name") or "default")
    out: dict = {
        "id": model_id,
        "display_name": setup.get("name") or model_id,
        "task": task,
        "model_family": None,
        "infra": backend_infra,
        "is_interactive": bool(setup.get("is_interactive")),
        "supported_prompts": prompts,
        "supported_geometric_outputs": list(
            setup.get("supported_geometric_outputs") or []
        ),
        "output_attribute_types": [],
        "supported_text_outputs": list(setup.get("supported_text_outputs") or []),
        "supported_trackers": trackers,
        "supported_variants": setup.get("supported_variants") or [],
        "default_thresholds": {},
        "resource_profile": {},
        "params": setup.get("params") or {},
    }
    out["modality"] = _model_modality(out)
    return out


def extract_capabilities(setup: dict | None) -> dict | None:
    """从 `/setup` 响应抽能力快照; setup 为空返回 None。

    返回结构 (v0.14.9 协议 v2):
    - `infra`: backend 默认基础设施 (pytorch / onnx / paddle / ...)。
    - `models`: 规范化后的 model 条目数组 (老 backend 合成单条)。
    - 扁平并集字段 (`is_interactive` / `supported_prompts` / `supported_trackers` /
      `supported_text_outputs` / `supported_geometric_outputs`): 各 model 去重合并,
      供未迁移的消费方继续读, 保证向后兼容。
    - `modalities`: 派生视图 (image / video / lidar)。
    """
    if not setup:
        return None
    infra = _normalize_infra(setup.get("infra"))
    raw_models = setup.get("models")
    if isinstance(raw_models, list) and raw_models:
        models = [_normalize_model(m, infra) for m in raw_models if isinstance(m, dict)]
    else:
        models = [_synthesize_single_model(setup, infra)]

    caps: dict = {
        # v0.14.12 · 透传 backend 自报的 name (如 "grounded-sam2-backend"), 让前端
        # 能力目录显示「源 backend 名」而非用户取的项目别名 (如 "gsam2.1")。
        "name": setup.get("name"),
        "infra": infra,
        # v0.14.14 · backend 声明本端是否支持 POST /warmup (协议 §4.4); 前端模型市场
        # "⚡ 预热" 按钮据此置灰. 老 backend 缺字段 = False.
        "warmup_endpoint": bool(setup.get("warmup_endpoint", False)),
        "models": models,
        "is_interactive": any(m["is_interactive"] for m in models),
        "supported_prompts": _union(models, "supported_prompts"),
        "supported_trackers": _union(models, "supported_trackers"),
        "supported_text_outputs": _union(models, "supported_text_outputs"),
        "supported_geometric_outputs": _union(models, "supported_geometric_outputs"),
    }
    caps["modalities"] = derive_modalities(caps)
    return caps


def derive_modalities(caps: dict | None) -> list[str]:
    """由能力快照派生支持的模态。

    扁平规则 (向后兼容, 且让「image+video 双修」的 backend 两个模态都保留):
    - `supported_prompts` 非空 ⇒ image (point/bbox/text/exemplar/none 都是图片侧)。
    - `supported_trackers` 非空 ⇒ video。
    per-model 补充: 多模型 backend 的 lidar / 纯 video model 等由 model 条目补齐。
    """
    if not caps:
        return []
    mods: list[str] = []
    if caps.get("supported_prompts"):
        mods.append("image")
    if caps.get("supported_trackers"):
        mods.append("video")
    for m in caps.get("models") or []:
        mod = _model_modality(m)
        if mod not in mods:
            mods.append(mod)
    return sorted(set(mods), key=lambda m: _MODALITY_ORDER.get(m, 99))
