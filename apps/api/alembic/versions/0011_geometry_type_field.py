"""補全 annotations.geometry / predictions 的 type 字段（v0.5.3 多边形工具铺路）

把存量 bbox 形状从 {x,y,w,h} 升级为 {type:"bbox",x,y,w,h}；polygon 后续以
{type:"polygon",points:[[x,y],...]} 写入。downgrade 反向移除 type 字段。

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-30
"""

from alembic import op


revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 注意：predictions.result 是 list[shape]，每个 shape 自带 geometry
    # 用 jsonb_set + 数组遍历比较繁琐；这里直接 server-side 写一个轻量函数。
    op.execute("""
        UPDATE annotations
        SET geometry = geometry || '{"type":"bbox"}'::jsonb
        WHERE geometry ? 'x' AND NOT geometry ? 'type';
    """)
    # predictions.result 是 jsonb 数组：每个元素的 geometry 字段升级
    # 用一次性 SQL：解构 → 处理 → 重组
    op.execute("""
        UPDATE predictions
        SET result = sub.new_result
        FROM (
            SELECT id, jsonb_agg(
                CASE
                  WHEN (elem->'geometry') ? 'x' AND NOT (elem->'geometry') ? 'type'
                    THEN jsonb_set(elem, '{geometry}', (elem->'geometry') || '{"type":"bbox"}'::jsonb)
                  ELSE elem
                END
                ORDER BY ord
            ) AS new_result
            FROM predictions, jsonb_array_elements(result) WITH ORDINALITY AS arr(elem, ord)
            GROUP BY id
        ) sub
        WHERE predictions.id = sub.id
          AND predictions.result @? '$[*].geometry ? (!exists(@.type))';
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE annotations
        SET geometry = geometry - 'type'
        WHERE geometry ? 'type' AND geometry->>'type' = 'bbox';
    """)
    op.execute("""
        UPDATE predictions
        SET result = sub.new_result
        FROM (
            SELECT id, jsonb_agg(
                CASE
                  WHEN (elem->'geometry') ? 'type' AND (elem->'geometry'->>'type') = 'bbox'
                    THEN jsonb_set(elem, '{geometry}', (elem->'geometry') - 'type')
                  ELSE elem
                END
                ORDER BY ord
            ) AS new_result
            FROM predictions, jsonb_array_elements(result) WITH ORDINALITY AS arr(elem, ord)
            GROUP BY id
        ) sub
        WHERE predictions.id = sub.id;
    """)
