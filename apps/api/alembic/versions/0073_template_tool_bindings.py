"""v0.10.17 · ProjectTemplate.tool_bindings (与 Project 对齐)

新增 project_templates.tool_bindings JSONB 列, 按 type_key + classes_config
反向派生填充 (同 migration 0072 规则).

Revision ID: 0073
Revises: 0072
Create Date: 2026-05-19
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0073"
down_revision = "0072"
branch_labels = None
depends_on = None


def _derive_tool_unit(type_key: str | None) -> str:
    return "region" if type_key == "image-seg" else "bbox"


def upgrade() -> None:
    op.add_column(
        "project_templates",
        sa.Column(
            "tool_bindings",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, type_key, classes_config, attribute_schema FROM project_templates"
        )
    ).fetchall()

    for row in rows:
        unit = _derive_tool_unit(row.type_key)
        cfg_map = row.classes_config or {}
        classes_list: list[dict] = []
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
                "UPDATE project_templates SET tool_bindings = CAST(:tb AS jsonb) "
                "WHERE id = :id"
            ),
            {"tb": json.dumps(tool_bindings), "id": row.id},
        )


def downgrade() -> None:
    op.drop_column("project_templates", "tool_bindings")
