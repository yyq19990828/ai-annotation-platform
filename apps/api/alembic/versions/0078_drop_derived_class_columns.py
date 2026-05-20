"""v0.10.22 · 删除派生扁平列 classes / classes_config / attribute_schema

ADR-0026 收口: tool_bindings 成为类别 / 属性配置的唯一存储真值. v0.10.17 起旧扁平
列由 service 层写时双写派生兜底, v0.10.22 完成所有读端切换 (响应序列化 / 导出读时
从 tool_bindings 派生) 后删除这三列. projects 与 project_templates 两表同步处理.

downgrade 重建三列并从 tool_bindings 回填, 保持可逆.

Revision ID: 0078
Revises: 0077
Create Date: 2026-05-20
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0078"
down_revision = "0077"
branch_labels = None
depends_on = None

_TABLES = ("projects", "project_templates")


def upgrade() -> None:
    for table in _TABLES:
        op.drop_column(table, "classes")
        op.drop_column(table, "classes_config")
        op.drop_column(table, "attribute_schema")


def _derive_from_tool_bindings(tool_bindings: dict | None) -> tuple[list, dict, dict]:
    """从 tool_bindings union 派生 (classes_list, classes_config, attribute_schema).

    与 app/services/project.py 的 derive_* 同规则: 跨 unit 同名类 / 同 key 字段
    以最先出现的 enabled binding 为准.
    """
    if not tool_bindings:
        return [], {}, {"fields": []}

    cfg: dict[str, dict] = {}
    order_seen: dict[str, int | None] = {}
    fields: list[dict] = []
    field_keys: set[str] = set()

    for binding in tool_bindings.values():
        if not isinstance(binding, dict) or not binding.get("enabled"):
            continue
        for cls in binding.get("classes") or []:
            if not isinstance(cls, dict):
                continue
            name = cls.get("name")
            if not name or name in cfg:
                continue
            entry: dict = {}
            if cls.get("color"):
                entry["color"] = cls["color"]
            if cls.get("order") is not None:
                entry["order"] = cls["order"]
            if cls.get("alias"):
                entry["alias"] = cls["alias"]
            cfg[name] = entry
            order_seen[name] = cls.get("order")
        schema = binding.get("attribute_schema") or {}
        for field in schema.get("fields") or []:
            if not isinstance(field, dict):
                continue
            key = field.get("key")
            if not key or key in field_keys:
                continue
            field_keys.add(key)
            fields.append(field)

    classes_list = sorted(
        order_seen.keys(),
        key=lambda n: (order_seen[n] is None, order_seen[n] or 0, n),
    )
    return classes_list, cfg, {"fields": fields}


def downgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column(
                "classes",
                postgresql.JSONB,
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )
        op.add_column(
            table,
            sa.Column(
                "classes_config",
                postgresql.JSONB,
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
        )
        op.add_column(
            table,
            sa.Column(
                "attribute_schema",
                postgresql.JSONB,
                nullable=False,
                server_default=sa.text("""'{"fields": []}'::jsonb"""),
            ),
        )

    bind = op.get_bind()
    for table in _TABLES:
        rows = bind.execute(
            sa.text(f"SELECT id, tool_bindings FROM {table}")
        ).fetchall()
        for row in rows:
            classes_list, cfg, attr_schema = _derive_from_tool_bindings(
                row.tool_bindings
            )
            bind.execute(
                sa.text(
                    f"UPDATE {table} SET classes = CAST(:c AS jsonb), "
                    "classes_config = CAST(:cc AS jsonb), "
                    "attribute_schema = CAST(:a AS jsonb) WHERE id = :id"
                ),
                {
                    "c": json.dumps(classes_list),
                    "cc": json.dumps(cfg),
                    "a": json.dumps(attr_schema),
                    "id": row.id,
                },
            )
