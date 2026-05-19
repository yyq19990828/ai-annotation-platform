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

        tool_bindings = {
            unit: {
                "enabled": True,
                "classes": classes_list,
                "attribute_schema": row.attribute_schema or {"fields": []},
            }
        }
        bind.execute(
            sa.text(
                "UPDATE projects SET tool_bindings = CAST(:tb AS jsonb) WHERE id = :id"
            ),
            {"tb": json.dumps(tool_bindings), "id": row.id},
        )

    # ── Data backfill: annotations.tool_unit_id ──────────────────────
    # polygon / mask → region; 其它 (bbox / video_bbox / video_track / point / line)
    # → bbox 占位 (本版 polyline / keypoint 工具未实现).
    op.execute(
        """
        UPDATE annotations
        SET tool_unit_id = CASE
            WHEN annotation_type IN ('polygon', 'mask') THEN 'region'
            ELSE 'bbox'
        END
        """
    )

    # ── Data backfill: predictions.tool_unit_id ──────────────────────
    # 按所属 project.type_key 推断 (与 projects backfill 同规则).
    op.execute(
        """
        UPDATE predictions p
        SET tool_unit_id = CASE
            WHEN pr.type_key = 'image-seg' THEN 'region'
            ELSE 'bbox'
        END
        FROM projects pr
        WHERE p.project_id = pr.id
        """
    )


def downgrade() -> None:
    op.drop_column("predictions", "tool_unit_id")
    op.drop_column("annotations", "tool_unit_id")
    op.drop_column("projects", "tool_bindings")
