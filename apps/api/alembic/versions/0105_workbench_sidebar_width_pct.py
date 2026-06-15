"""边栏宽度从 layout 像素键迁移到 common 百分比键（数据迁移）

schemas/user.py 同步改动：WorkbenchLayoutPreferences 删除 leftWidth/rightWidth
（像素），WorkbenchCommonPreferences 新增 leftWidthPct/rightWidthPct（占工作台宽度
百分比，10..35，默认 15）。

WorkbenchLayoutPreferences 是 extra="forbid"：存量行只要还残留
preferences.workbench.layout.leftWidth / rightWidth，GET /me/preferences 的
model_validate 就会 422。故本迁移必须从所有行剥除这两个旧键（强制，非可选）。

转换：旧像素按 1440 名义参考宽度换算 pct = clamp(round(px/1440*100), 10, 35)，
写入 workbench.common.leftWidthPct / rightWidthPct；随后删 layout 旧键。
无旧键的行不写 common pct（schema 默认 15 覆盖读取）。

逐行加载 (id, preferences)，Python 改字典后写回（参考 0103 读写 preferences JSONB
的做法，但这里整字段换算用 Python 更直观）。

Revision ID: 0105
Revises: 0104
Create Date: 2026-06-15
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "0105"
down_revision = "0104"
branch_labels = None
depends_on = None

REF_WIDTH = 1440


def _clamp(value: float, lo: int, hi: int) -> int:
    return max(lo, min(hi, round(value)))


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, preferences FROM users")).fetchall()
    for row_id, prefs in rows:
        if not isinstance(prefs, dict):
            continue
        workbench = prefs.get("workbench")
        if not isinstance(workbench, dict):
            continue
        layout = workbench.get("layout")
        if not isinstance(layout, dict):
            continue
        if "leftWidth" not in layout and "rightWidth" not in layout:
            continue

        common = workbench.get("common")
        if not isinstance(common, dict):
            common = {}

        left_px = layout.pop("leftWidth", None)
        right_px = layout.pop("rightWidth", None)
        if isinstance(left_px, (int, float)):
            common["leftWidthPct"] = _clamp(left_px / REF_WIDTH * 100, 10, 35)
        if isinstance(right_px, (int, float)):
            common["rightWidthPct"] = _clamp(right_px / REF_WIDTH * 100, 10, 35)

        workbench["common"] = common
        workbench["layout"] = layout
        prefs["workbench"] = workbench
        bind.execute(
            sa.text(
                "UPDATE users SET preferences = CAST(:p AS jsonb) WHERE id = :id"
            ),
            {"p": json.dumps(prefs), "id": row_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, preferences FROM users")).fetchall()
    for row_id, prefs in rows:
        if not isinstance(prefs, dict):
            continue
        workbench = prefs.get("workbench")
        if not isinstance(workbench, dict):
            continue
        common = workbench.get("common")
        if not isinstance(common, dict):
            continue
        if "leftWidthPct" not in common and "rightWidthPct" not in common:
            continue

        layout = workbench.get("layout")
        if not isinstance(layout, dict):
            layout = {}

        left_pct = common.pop("leftWidthPct", None)
        right_pct = common.pop("rightWidthPct", None)
        if isinstance(left_pct, (int, float)):
            layout["leftWidth"] = _clamp(left_pct / 100 * REF_WIDTH, 200, 560)
        if isinstance(right_pct, (int, float)):
            layout["rightWidth"] = _clamp(right_pct / 100 * REF_WIDTH, 220, 600)

        workbench["common"] = common
        workbench["layout"] = layout
        prefs["workbench"] = workbench
        bind.execute(
            sa.text(
                "UPDATE users SET preferences = CAST(:p AS jsonb) WHERE id = :id"
            ),
            {"p": json.dumps(prefs), "id": row_id},
        )
