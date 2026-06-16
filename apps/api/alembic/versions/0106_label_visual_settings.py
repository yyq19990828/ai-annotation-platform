"""标签显隐从 image.showBoxLabels(bool) 迁移到 common.labelVisibility(enum)（数据迁移）

schemas/user.py 同步改动：WorkbenchImagePreferences 删除 showBoxLabels；
WorkbenchCommonPreferences 新增 6 个标注视觉字段（labelFontSize / labelVisibility /
labelContent / strokeWidth / fillOpacity / fillOpacitySelected）。

WorkbenchImagePreferences 是 extra="forbid"：存量行只要还残留
preferences.workbench.image.showBoxLabels，GET /me/preferences 的 model_validate
就会 422。故本迁移必须从所有行剥除该旧键（强制，非可选）。

转换：showBoxLabels === False → common.labelVisibility = "none"；为 True（或缺失）
时不写 common（schema 默认 "always" 覆盖读取）。随后删 image.showBoxLabels。

down：common.labelVisibility != "none" → image.showBoxLabels = True，否则 False；
"selected" 无 bool 等价 → 映射 True（up→down 非双射）。同时剥除本版新增的 6 个 common
键（旧 schema extra="forbid"，残留会 422）。

逐行加载 (id, preferences)，Python 改字典后写回（沿用 0105 读写 preferences JSONB 做法）。

Revision ID: 0106
Revises: 0105
Create Date: 2026-06-16
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "0106"
down_revision = "0105"
branch_labels = None
depends_on = None

# 本版在 common 子树新增的视觉字段键名；down 时整体剥除。
_NEW_COMMON_KEYS = (
    "labelFontSize",
    "labelVisibility",
    "labelContent",
    "strokeWidth",
    "fillOpacity",
    "fillOpacitySelected",
)


def _upgrade_prefs(prefs):
    """单行 up 转换：image.showBoxLabels(bool) → common.labelVisibility，剥除旧键。

    无 showBoxLabels 旧键（或结构不符）时返回 None，表示该行无需更新。
    就地改 prefs 后返回（纯逻辑，与 op/bind 解耦，供 upgrade() 与单测复用）。"""
    if not isinstance(prefs, dict):
        return None
    workbench = prefs.get("workbench")
    if not isinstance(workbench, dict):
        return None
    image = workbench.get("image")
    if not isinstance(image, dict) or "showBoxLabels" not in image:
        return None

    show = image.pop("showBoxLabels")
    if show is False:
        common = workbench.get("common")
        if not isinstance(common, dict):
            common = {}
        common["labelVisibility"] = "none"
        workbench["common"] = common

    workbench["image"] = image
    prefs["workbench"] = workbench
    return prefs


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, preferences FROM users")).fetchall()
    for row_id, prefs in rows:
        new_prefs = _upgrade_prefs(prefs)
        if new_prefs is None:
            continue
        bind.execute(
            sa.text("UPDATE users SET preferences = CAST(:p AS jsonb) WHERE id = :id"),
            {"p": json.dumps(new_prefs), "id": row_id},
        )


def _downgrade_prefs(prefs):
    """单行 down 转换：common.labelVisibility → image.showBoxLabels，剥除本版新增 common 键。

    无本版任何新增 common 键（或结构不符）时返回 None。"selected"→True 使 round-trip
    非双射。就地改 prefs 后返回（供 downgrade() 与单测复用）。"""
    if not isinstance(prefs, dict):
        return None
    workbench = prefs.get("workbench")
    if not isinstance(workbench, dict):
        return None
    common = workbench.get("common")
    if not isinstance(common, dict):
        return None
    if not any(k in common for k in _NEW_COMMON_KEYS):
        return None

    visibility = common.get("labelVisibility")
    for key in _NEW_COMMON_KEYS:
        common.pop(key, None)

    if visibility is not None:
        image = workbench.get("image")
        if not isinstance(image, dict):
            image = {}
        image["showBoxLabels"] = visibility != "none"
        workbench["image"] = image

    workbench["common"] = common
    prefs["workbench"] = workbench
    return prefs


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, preferences FROM users")).fetchall()
    for row_id, prefs in rows:
        new_prefs = _downgrade_prefs(prefs)
        if new_prefs is None:
            continue
        bind.execute(
            sa.text("UPDATE users SET preferences = CAST(:p AS jsonb) WHERE id = :id"),
            {"p": json.dumps(new_prefs), "id": row_id},
        )
