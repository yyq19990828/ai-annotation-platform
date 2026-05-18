"""v0.10.14 · E2 · 项目可克隆字段白名单 + 通用 deep-merge.

迁出自 ``apps/api/app/api/v1/projects.py``. v0.10.11 已落地的 "从已有项目复制配置"
与 v0.10.14 "从模板创建" 共享同一份白名单 — 两者都把白名单内字段从 source 复制
进新项目, 不在白名单的字段 (id / display_id / owner_id / status / created_at /
updated_at / total_tasks 等运行时状态, datasets / tasks / members / batches 等
关联数据) 一律不复制.
"""

from __future__ import annotations

import copy
from typing import Any


# v0.10.14 · E2 · 与 ProjectTemplate 模板载荷列对齐.
# 历史: v0.10.11 引入, 原位于 app.api.v1.projects.
CLONEABLE_PROJECT_FIELDS: tuple[str, ...] = (
    "type_label",
    "type_key",
    "classes",
    "classes_config",
    "attribute_schema",
    "ai_enabled",
    "ai_model",
    "label_config",
    "sampling",
    "maximum_annotations",
    "show_overlap_first",
    "iou_dedup_threshold",
    "box_threshold",
    "text_threshold",
    "text_output_default",
    "rendering_config",
)


def merge_from_source(payload: dict[str, Any], source: object) -> dict[str, Any]:
    """用 source 的可克隆字段兜底 payload 中缺失的项. payload 显式给出的字段优先.

    JSONB/dict/list 字段深拷贝, 避免新对象与 source 共享底层引用 (后续 mutate
    污染 source).
    """
    for field in CLONEABLE_PROJECT_FIELDS:
        if field in payload:
            continue
        if not hasattr(source, field):
            continue
        value = getattr(source, field)
        if value is None:
            continue
        if isinstance(value, (dict, list)):
            value = copy.deepcopy(value)
        payload[field] = value
    return payload
