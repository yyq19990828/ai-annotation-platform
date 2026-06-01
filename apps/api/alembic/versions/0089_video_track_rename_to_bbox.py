"""v0.11.29 · 视频几何 type 命名规范化: video_track → video_track_bbox

「轨迹」是时序维度, 几何仍是矩形。原 type 值 `video_track` 缺几何信息, 为未来
`video_polygon` / `video_track_polygon` 留位, 统一为 `video_[track_]<几何>` 结构:
单帧矩形 `video_bbox` 已符合 (不动), 轨迹矩形 `video_track` → `video_track_bbox`。

搬迁两处存量: annotations.annotation_type 列 + geometry->>'type' 字段。
注意: 仅改几何 type 数据值, 不涉及「轨迹」领域操作 / AI 任务 (video_tracker_job
等标识符)。

Revision ID: 0089
Revises: 0088
Create Date: 2026-06-01
"""

import sqlalchemy as sa
from alembic import op


revision = "0089"
down_revision = "0088"
branch_labels = None
depends_on = None


def _rewrite_geometry_type(bind, old: str, new: str) -> None:
    # 只改顶层 type 字段, jsonb_set 一条批量 SQL 即可, 大表上不必逐行 Python 循环。
    # 注意: 用 cast(:new AS text) 而非 :new::text —— asyncpg 驱动下 SQLAlchemy text()
    # 的 ::cast 会与 :name 绑定参数语法冲突 (:new 不被识别 → "syntax error at :")。
    bind.execute(
        sa.text(
            "UPDATE annotations "
            "SET geometry = jsonb_set(geometry, '{type}', to_jsonb(cast(:new AS text))) "
            "WHERE geometry->>'type' = :old"
        ),
        {"old": old, "new": new},
    )


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE annotations SET annotation_type = 'video_track_bbox' "
            "WHERE annotation_type = 'video_track'"
        )
    )
    _rewrite_geometry_type(bind, "video_track", "video_track_bbox")


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE annotations SET annotation_type = 'video_track' "
            "WHERE annotation_type = 'video_track_bbox'"
        )
    )
    _rewrite_geometry_type(bind, "video_track_bbox", "video_track")
