"""v0.10.28 · 项目级 data_type 媒体维度字段

projects / project_templates 各加 data_type (image / video / lidar)。type_key
继续编码媒体+任务子类型 (video-track vs video-mm), data_type 只到媒体粒度,
供展示 / 筛选 / 媒体维度分流消费。

回填规则 (按 type_key 推导):
  type_key LIKE 'video%'  → 'video'
  type_key = 'lidar'      → 'lidar'
  其余                    → 'image'

按 ctid 分批 UPDATE (参考 0072), 单批限锁时间。

Revision ID: 0082
Revises: 0081
Create Date: 2026-05-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0082"
down_revision = "0081"
branch_labels = None
depends_on = None

_BATCH_SIZE = 5000


def _chunked_backfill(bind, *, table: str, where_clause: str, value: str) -> None:
    """按 ctid 分批把符合 where_clause 的行 data_type 设为 value.

    新列 server_default='image', 历史行默认已是 image; 只需把 video / lidar
    子集翻一遍。单批限 _BATCH_SIZE 行, 持锁短。
    """
    last_ctid = "'(0,0)'::tid"
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
            sa.text(f"UPDATE {table} SET data_type = '{value}' WHERE ctid IN ({ctids})")
        )
        last_ctid = f"'{rows[-1].ctid}'::tid"
        if len(rows) < _BATCH_SIZE:
            break


def upgrade() -> None:
    for table in ("projects", "project_templates"):
        op.add_column(
            table,
            sa.Column(
                "data_type",
                sa.String(30),
                nullable=False,
                server_default="image",
            ),
        )

    bind = op.get_bind()
    for table in ("projects", "project_templates"):
        _chunked_backfill(
            bind,
            table=table,
            where_clause="type_key LIKE 'video%'",
            value="video",
        )
        _chunked_backfill(
            bind,
            table=table,
            where_clause="type_key = 'lidar'",
            value="lidar",
        )


def downgrade() -> None:
    op.drop_column("project_templates", "data_type")
    op.drop_column("projects", "data_type")
