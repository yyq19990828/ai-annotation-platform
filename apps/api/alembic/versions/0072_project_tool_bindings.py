"""v0.10.17 · 工具维度类别 / 属性绑定 (ROADMAP §A 新建向导通用化)

新增 projects.tool_bindings JSONB 与 annotations / predictions.tool_unit_id 列,
按 type_key (项目层) / annotation_type (标注层) 反推回填.

旧 projects.classes_config 与 attribute_schema 暂保留作 service 层派生兼容只读
(v0.10.18 起删除).

Revision ID: 0072
Revises: 0071
Create Date: 2026-05-19
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0072"
down_revision = "0071"
branch_labels = None
depends_on = None

# 分批 UPDATE 一批的行数. 经验值: 单批 5k 在中等规格 PG (4 vCPU / 16G) 上
# 一般 1 秒内能跑完, 持锁短, 不会阻塞业务读写; 业务低峰也可一次扫完.
_BATCH_SIZE = 5000


def _chunked_update_region(bind, *, table: str, where_clause: str) -> None:
    """按 ctid 分批把符合 where_clause 的行 tool_unit_id 改成 'region'.

    新列加入时 server_default='bbox', 所有历史行先默认 bbox; 只需把要变 region
    的子集翻一遍 (例如 annotation_type IN ('polygon','mask') 或
    prediction result[0].type IN ('polygonlabels',...)). 不需扫全表.

    单批限 _BATCH_SIZE 行, 持锁时间 < 1s 减小对在线业务的阻塞.
    用 ctid 而非 id (UUID) 做分页 key, 因 ctid 是物理位置, 增量推进无开销.
    """
    last_ctid = "'(0,0)'::tid"  # 起始 ctid 比所有真实 ctid 都小
    while True:
        rows = bind.execute(
            sa.text(
                f"SELECT ctid FROM {table} "
                f"WHERE ctid > {last_ctid} AND ({where_clause}) "
                f"ORDER BY ctid LIMIT {_BATCH_SIZE}"
            )
        ).fetchall()
        if not rows:
            break
        ctids = ", ".join(f"'{r.ctid}'::tid" for r in rows)
        bind.execute(
            sa.text(
                f"UPDATE {table} SET tool_unit_id = 'region' "
                f"WHERE ctid IN ({ctids})"
            )
        )
        last_ctid = f"'{rows[-1].ctid}'::tid"
        # 不到一批 → 已是最后一段.
        if len(rows) < _BATCH_SIZE:
            break


def _derive_tool_unit_from_type_key(type_key: str | None) -> str:
    """
    把旧 7 种 type_key 映射到 v0.10.17 的 tool_unit_id:
      image-seg          → region
      image-det / video-track / video-mm / mm / image-kp / lidar / 未知
                         → bbox  (占位; image-kp / lidar 等留位)
    """
    return "region" if type_key == "image-seg" else "bbox"


def upgrade() -> None:
    # ── DDL ──────────────────────────────────────────────────────────
    op.add_column(
        "projects",
        sa.Column(
            "tool_bindings",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "annotations",
        sa.Column(
            "tool_unit_id",
            sa.String(30),
            nullable=False,
            server_default=sa.text("'bbox'"),
        ),
    )
    op.add_column(
        "predictions",
        sa.Column(
            "tool_unit_id",
            sa.String(30),
            nullable=False,
            server_default=sa.text("'bbox'"),
        ),
    )

    # ── Data backfill: projects.tool_bindings ────────────────────────
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, type_key, classes_config, attribute_schema FROM projects"
        )
    ).fetchall()

    for row in rows:
        unit = _derive_tool_unit_from_type_key(row.type_key)
        classes_list: list[dict] = []
        cfg_map = row.classes_config or {}
        # 旧扁平 classes_config 形状: { name: {color?, order?, alias?} }; 也兼容空 dict.
        for cname, cfg in cfg_map.items():
            entry: dict = {"name": cname}
            if isinstance(cfg, dict):
                if cfg.get("color"):
                    entry["color"] = cfg["color"]
                if cfg.get("order") is not None:
                    entry["order"] = cfg["order"]
                if cfg.get("alias"):
                    entry["alias"] = cfg["alias"]
            classes_list.append(entry)

        # order 字段缺失时按出现顺序补 0..N-1, 保证迁移后顺序稳定.
        for i, entry in enumerate(classes_list):
            entry.setdefault("order", i)

        # 同步把同一份 classes / attribute_schema 复制到 ai_interactive,
        # 避免老项目升级后 SAM / Magic Box / Exemplar 等 AI 工具左侧调色板为空
        # (强隔离仍成立: ai_interactive 与 bbox/region 是各自独立的记录, 后续编辑互不影响).
        ai_classes_list = [dict(entry) for entry in classes_list]
        tool_bindings = {
            unit: {
                "enabled": True,
                "classes": classes_list,
                "attribute_schema": row.attribute_schema or {"fields": []},
            },
            "ai_interactive": {
                "enabled": True,
                "classes": ai_classes_list,
                "attribute_schema": row.attribute_schema or {"fields": []},
            },
        }
        bind.execute(
            sa.text(
                "UPDATE projects SET tool_bindings = CAST(:tb AS jsonb) WHERE id = :id"
            ),
            {"tb": json.dumps(tool_bindings), "id": row.id},
        )

    # ── Data backfill: annotations.tool_unit_id (chunked) ────────────
    # 新列 server_default='bbox', 所有历史行默认已是 bbox; 这里只把
    # polygon / mask 翻成 region. 不动其它行, 单批 _BATCH_SIZE 限锁时间.
    _chunked_update_region(
        bind,
        table="annotations",
        where_clause="annotation_type IN ('polygon', 'mask')",
    )

    # ── Data backfill: predictions.tool_unit_id (chunked) ────────────
    # 按 result[0].type 派生, 与运行时 derive_tool_unit_from_ls_type 严格一致:
    #   polygonlabels / brushlabels / multi_polygon → region
    #   其它 (rectanglelabels / keypointlabels / 未知) → 保持默认 bbox
    # 避免 image-det 项目挂分割 backend 的历史 prediction 被错回填成 bbox.
    _chunked_update_region(
        bind,
        table="predictions",
        where_clause="result->0->>'type' IN ('polygonlabels', 'brushlabels', 'multi_polygon')",
    )


def downgrade() -> None:
    op.drop_column("predictions", "tool_unit_id")
    op.drop_column("annotations", "tool_unit_id")
    op.drop_column("projects", "tool_bindings")
