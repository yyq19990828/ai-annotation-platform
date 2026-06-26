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
    PROMPT_VALUES,
    PROMPTS_REQUIRES_INPUT,
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

# v0.18.29 · 交互式 prompt 集合统一由 capability_registry SSOT 派生 (PROMPTS_REQUIRES_INPUT,
# 等价旧硬编码 8 元组)。语义不变: 含这类 prompt 的模型不默认走 crop 投递。


def _synthesize_supported_inputs(prompts: list[str]) -> list[str]:
    """v0.18.15 · 老 backend 缺 supported_inputs 时, 按 supported_prompts 合成兼容默认。

    受控词表: ``full_image | crop | bbox_prompt | point_prompt``。
    - bbox/point prompt → 对应 ``bbox_prompt`` / ``point_prompt`` (box-seg 类走 geometry-prompt)。
    - 一律含 ``full_image`` (任何模型都能吃整图)。
    - 非交互模型 (纯检测/分类/OCR…) 额外含 ``crop`` (平台可裁父框 ROI 喂入), 让其能作几何/属性下游。
    """
    out: list[str] = []
    if "interactive_box" in prompts or "bbox" in prompts:
        out.append("bbox_prompt")
    if "point" in prompts:
        out.append("point_prompt")
    out.append("full_image")
    if not any(p in PROMPTS_REQUIRES_INPUT for p in prompts):
        out.append("crop")
    return list(dict.fromkeys(out))


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
        # v0.18.15 · 一等输入契约 (与 supported_prompts 解耦): 模型能吃哪些投递形态
        # (full_image | crop | bbox_prompt | point_prompt)。缺省按 prompts 合成兼容默认。
        "supported_inputs": list(model.get("supported_inputs") or [])
        or _synthesize_supported_inputs(list(model.get("supported_prompts") or [])),
        "supported_geometric_outputs": geo,
        "output_attribute_types": list(model.get("output_attribute_types") or []),
        # 协议③ · backend 自报的属性 schema (含 select options), 供平台一键导入项目 attribute_schema.
        "output_attribute_schema": list(model.get("output_attribute_schema") or []),
        "supported_text_outputs": list(model.get("supported_text_outputs") or []),
        "supported_trackers": list(model.get("supported_trackers") or []),
        "supported_variants": model.get("supported_variants") or [],
        "variant_combinations": list(model.get("variant_combinations") or []),
        "variants_shared_across_tasks": bool(
            model.get("variants_shared_across_tasks", False)
        ),
        # v0.14.13 · backend 自报的默认 variant 组合 (dict[axis_key, value]).
        # 前端 VariantSelector 在用户未选时取此作初值, 优先级低于项目级 default_variants.
        "default_variants": dict(model.get("default_variants") or {}),
        "default_thresholds": model.get("default_thresholds") or {},
        "resource_profile": model.get("resource_profile") or {},
        # 协议 v2.2 · 原子 vs 内部编排维度。缺省 atom（绝大多数 model 是单次推理；
        # 现存复合都在自管 backend 显式标）。编排下游 stage 据此过滤（只组合 atom）。
        "composition": model.get("composition") or "atom",
        "params": model.get("params") or {},
        # v0.14.17 · 闭集检测器的原生类别表 (yolo model.names, [{index,name}]); 供前端类别白名单.
        # 仅在该 task 模型已加载过 (warmup/predict) 时 backend /setup 才带, 否则为空。
        "classes": list(model.get("classes") or []),
        # v0.18.23 · exemplar 模型的能力声明 (multi_box / negative_box / text_combination /
        # threshold_refilter); 前端工作台据此渲染 exemplar 控件 (YOLOE 无负框 → 隐藏负极性)。
        # 缺字段 = None, 前端按「全支持」向后兼容。
        "exemplar_capabilities": model.get("exemplar_capabilities") or None,
    }
    out["modality"] = _model_modality(out)
    return out


def _synthesize_single_model(setup: dict, backend_infra: str) -> dict:
    """老 backend (无 `models[]`) 的向后兼容路径: 顶层能力字段合成「隐式单 model」。

    task 由现有信号推断:
    - `supported_trackers` 非空 ⇒ tracker
    - `supported_prompts` 含 point/interactive_box/text/exemplar ⇒ interactive_seg (SAM 类)
    - 否则 ⇒ detection
    """
    prompts = list(setup.get("supported_prompts") or [])
    trackers = list(setup.get("supported_trackers") or [])
    if trackers:
        task = "tracker"
    elif any(p in ("point", "interactive_box", "bbox", "text", "exemplar") for p in prompts):
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
        # v0.18.15 · 老 backend 无 supported_inputs, 按 prompts 合成兼容默认 (零退化)。
        "supported_inputs": _synthesize_supported_inputs(prompts),
        "supported_geometric_outputs": list(
            setup.get("supported_geometric_outputs") or []
        ),
        "output_attribute_types": [],
        "supported_text_outputs": list(setup.get("supported_text_outputs") or []),
        "supported_trackers": trackers,
        "supported_variants": setup.get("supported_variants") or [],
        # 老 backend 均为单次推理原子（协议 v2.2）。
        "composition": "atom",
        "default_thresholds": {},
        "resource_profile": {},
        "params": setup.get("params") or {},
        # v0.18.23 · 老 backend (sam3) 的 exemplar 能力在顶层声明, 透传供前端 exemplar 控件渲染。
        "exemplar_capabilities": setup.get("exemplar_capabilities") or None,
    }
    out["modality"] = _model_modality(out)
    return out


def _collect_warnings(models: list[dict]) -> list[dict]:
    """校验规范化后各 model 的受控值, 越界即记 warning (只诊断、不改写)。

    v0.18.29 · 把「字段拼错 / 值越界致工具静默不亮」变成模型市场可见信号。只校验受控值
    (task / infra / supported_prompts / supported_geometric_outputs); 派生缺省
    (task / infra == "unknown") 跳过 — 那是 backend 没声明、平台已兜底, 非越界。未知键检测
    从简不做 (避免维护键白名单 + 噪音), 留后续。
    """
    out: list[dict] = []

    def warn(
        model_id: str, field: str, value: str, message: str, level: str = "warning"
    ) -> None:
        out.append(
            {
                "level": level,
                "model_id": model_id,
                "field": field,
                "value": value,
                "message": message,
            }
        )

    for m in models:
        mid = str(m.get("id") or "?")
        task = m.get("task")
        if task and task != "unknown" and task not in TASK_VALUES:
            warn(
                mid, "task", task,
                f"未知 task「{task}」不在受控词表; 平台无法据此派生默认几何/模态。",
            )
        infra = m.get("infra")
        if infra and infra != "unknown" and infra not in INFRA_VALUES:
            warn(mid, "infra", infra, f"未知 infra「{infra}」不在受控词表。", level="info")
        for p in m.get("supported_prompts") or []:
            if p not in PROMPT_VALUES:
                warn(
                    mid, "supported_prompts", p,
                    f"未知 prompt「{p}」; 前端工具门控不识别, 该提示将静默失效。",
                )
        for g in m.get("supported_geometric_outputs") or []:
            if g not in GEOMETRY_VALUES:
                warn(mid, "supported_geometric_outputs", g, f"未知几何输出「{g}」不在受控词表。")
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
        "supported_inputs": _union(models, "supported_inputs"),
        "supported_trackers": _union(models, "supported_trackers"),
        "supported_text_outputs": _union(models, "supported_text_outputs"),
        "supported_geometric_outputs": _union(models, "supported_geometric_outputs"),
        # v0.18.29 · 受控词表校验诊断 (越界 task/infra/prompt/geometry); 空 = 全合法。
        "warnings": _collect_warnings(models),
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
