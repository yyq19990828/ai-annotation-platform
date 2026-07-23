"""video_tracker_jobs.staged_result (候选/接受流)

v0.21.28 · 视频 AI 追踪「候选/接受」交互: 追踪完成后逐帧结果不再直接落 annotation, 而是
暂存到本列 (list[{frame_index, geometry, confidence, outside, instance_id, primary}]);
用户「接受」时才 _persist_tracker_results 落库、「丢弃」时清空。committed annotations 在
接受前零污染。status 新增 pending_review / accepted / discarded (status 是 String(20) 非
DB 枚举, 故无需枚举迁移, 仅本列)。

nullable: 缺省 None = 老的直接落库路径 / 无结果的 job, 与既有行完全兼容。
downgrade 仅删列 (未接受的候选一并丢弃, 无数据可逆需求)。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0117"
down_revision = "0116"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "video_tracker_jobs",
        sa.Column(
            "staged_result", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
    )


def downgrade() -> None:
    # v0.21.28 新增的 status (pending_review/accepted/discarded) 不在旧代码的
    # TrackerJobStatus Literal 中, 回滚后读取现有行会在 Pydantic 层 422。先把它们归位到
    # 旧枚举再删列: 已接受 → completed (结果已落库), 待审/丢弃 → cancelled (未落库)。
    op.execute(
        "UPDATE video_tracker_jobs SET status = 'completed' WHERE status = 'accepted'"
    )
    op.execute(
        "UPDATE video_tracker_jobs SET status = 'cancelled' "
        "WHERE status IN ('pending_review', 'discarded')"
    )
    op.drop_column("video_tracker_jobs", "staged_result")
