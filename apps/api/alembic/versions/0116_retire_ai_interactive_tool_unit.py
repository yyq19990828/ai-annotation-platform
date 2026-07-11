"""退役 ai_interactive 工具单位的存量清理 (承接 0115)

0115 把 annotations.tool_unit_id 里的 'ai_interactive' 归位到了 region/bbox, 但刻意
未碰另外两处存量。本迁移与「从 ToolUnitId 字面量移除 'ai_interactive'」同批落地, 负责
把这两处也清干净, 使字面量删除后不会有存量数据在响应序列化时炸 ValidationError:

1. predictions.tool_unit_id: 若有 'ai_interactive' 残留, 按其 result 首个 shape 的几何
   类型归位 (polygon 系 -> region, 其余 -> bbox), 与 0115 的 annotations 归位同规则。
   predictions 是**分区表** (0080), 用 (id, created_at) 复合 PK; 分批走
   `LIMIT :batch_size FOR UPDATE` 游标 (同 0115 写法), 单批只锁一批行, 转换完的行不再
   命中 WHERE, 循环到 rowcount<1 收尾。该列无索引, 分批避免全表扫单事务长持锁。

2. projects.tool_bindings / project_templates.tool_bindings 里的 'ai_interactive' key:
   **不直接删** —— 直接删会丢掉该 binding 下用户配的 classes / attribute_schema。改为把它
   携带的 classes / attributes 合并进 geometry 单位 (region / bbox, 见
   merge_ai_interactive_binding 纯函数), 冲突时保留目标单位的、跳过来源的, 再删除该 key。
   ai_interactive 退役前是 region+bbox 的共享 AI 调色板, 故复制进两者。两张表 (0072 建
   projects 列 / 0073 建 templates 列) 都可能有该 key (create/update schema 会按新 SSOT
   校验 tool_bindings 顶层 key, 残留会致 422), 数量小, 逐行改写即可 (只命中含该 key 的行)。

零存量时全程空跑: predictions 首批 rowcount=0 即 break; 没有含 ai_interactive key 的
项目时循环体不执行。

downgrade 为 no-op: 数据迁移不可逆 —— 归位后无法区分哪些 region/bbox 原本是
ai_interactive, 且归入 region/bbox 本就是语义正确归属, 无需 (也无法) 回滚。

Revision ID: 0116
Revises: 0115
Create Date: 2026-07-09
"""

from __future__ import annotations

import copy
import json

import sqlalchemy as sa
from alembic import op

revision = "0116"
down_revision = "0115"
branch_labels = None
depends_on = None

BATCH_SIZE = 5000

# predictions.tool_unit_id 归位: 与 0115 的 annotations CASE 同规则 (polygon 系 -> region)。
# predictions 存 LS 标准 result 数组, 首个 shape 的几何类型两种表达都覆盖:
#   - 内部形态: result[0].geometry.type ∈ {polygon, multi_polygon, mask, video_polygon, video_track_polygon}
#   - LS 标准形态: result[0].type ∈ {polygonlabels, brushlabels, multi_polygon}
# 命中任一即 region, 否则 bbox (与运行时 derive_tool_unit_from_ls_type 一致)。
RETIRE_PREDICTIONS_BATCH_SQL = """
WITH batch AS (
    SELECT id, created_at FROM predictions
    WHERE tool_unit_id = 'ai_interactive'
    LIMIT :batch_size
    FOR UPDATE
)
UPDATE predictions p
SET tool_unit_id = CASE
    WHEN COALESCE(p.result->0->'geometry'->>'type', '') IN (
        'polygon', 'multi_polygon', 'mask',
        'video_polygon', 'video_track_polygon'
    ) OR COALESCE(p.result->0->>'type', '') IN (
        'polygonlabels', 'brushlabels', 'multi_polygon'
    ) THEN 'region'
    ELSE 'bbox'
END
FROM batch b
WHERE p.id = b.id AND p.created_at = b.created_at
"""

_REGION_TARGET = "region"
_BBOX_TARGET = "bbox"
_AI_INTERACTIVE_KEY = "ai_interactive"


def merge_ai_interactive_binding(tool_bindings: dict) -> dict:
    """把退役的 ai_interactive 工具单位折叠进 geometry 单位, 返回新 dict (不改入参)。

    - 目标单位 = tool_bindings 里**已存在**的 {region, bbox} 子集; 两者都不存在时回落到
      新建一个 disabled 的 bbox 单位承接 (避免给项目凭空加激活工具)。
    - classes 按 name、attribute_schema.fields 按 key 去重: 目标单位已有同名/同 key 的,
      保留目标单位的、跳过来源的 (不覆盖用户在 geometry 单位里的配置)。
    - ai_interactive 无独有几何, 退役前是 region+bbox 共享调色板, 故其 classes/attributes
      复制进所有目标单位。
    - 处理完删除 ai_interactive key。无该 key 时原样返回。
    """
    if not isinstance(tool_bindings, dict) or _AI_INTERACTIVE_KEY not in tool_bindings:
        return tool_bindings

    out = copy.deepcopy(
        {k: v for k, v in tool_bindings.items() if k != _AI_INTERACTIVE_KEY}
    )
    src = tool_bindings.get(_AI_INTERACTIVE_KEY) or {}
    src_classes = src.get("classes") or []
    src_fields = (src.get("attribute_schema") or {}).get("fields") or []

    targets = [t for t in (_REGION_TARGET, _BBOX_TARGET) if t in out]
    if not targets:
        out[_BBOX_TARGET] = {
            "enabled": False,
            "classes": [],
            "attribute_schema": {"fields": []},
        }
        targets = [_BBOX_TARGET]

    for t in targets:
        tgt = out[t]
        classes = list(tgt.get("classes") or [])
        seen_names = {c.get("name") for c in classes}
        for c in src_classes:
            if c.get("name") not in seen_names:
                classes.append(copy.deepcopy(c))
                seen_names.add(c.get("name"))
        tgt["classes"] = classes

        schema = dict(tgt.get("attribute_schema") or {"fields": []})
        fields = list(schema.get("fields") or [])
        seen_keys = {f.get("key") for f in fields}
        for f in src_fields:
            if f.get("key") not in seen_keys:
                fields.append(copy.deepcopy(f))
                seen_keys.add(f.get("key"))
        schema["fields"] = fields
        tgt["attribute_schema"] = schema

    return out


def _run_prediction_batches() -> None:
    bind = op.get_bind()
    while True:
        result = bind.execute(
            sa.text(RETIRE_PREDICTIONS_BATCH_SQL), {"batch_size": BATCH_SIZE}
        )
        if result.rowcount < 1:
            break


def _merge_tool_bindings(table: str) -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            f"SELECT id, tool_bindings FROM {table} "
            "WHERE jsonb_exists(tool_bindings, 'ai_interactive')"
        )
    ).fetchall()
    for row in rows:
        new_tb = merge_ai_interactive_binding(row.tool_bindings or {})
        bind.execute(
            sa.text(
                f"UPDATE {table} SET tool_bindings = CAST(:tb AS jsonb) WHERE id = :id"
            ),
            {"tb": json.dumps(new_tb), "id": row.id},
        )


def upgrade() -> None:
    _run_prediction_batches()
    _merge_tool_bindings("projects")
    _merge_tool_bindings("project_templates")


def downgrade() -> None:
    # no-op: 数据迁移不可逆 (见模块 docstring)。归位/合并后无从还原 ai_interactive 存量。
    pass
