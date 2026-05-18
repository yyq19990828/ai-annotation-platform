"""v0.10.16 · 统一异步任务表 async_jobs（ROADMAP §1.7 MVP）。

汇总索引层：所有长任务（batch_predict / video_tracker / audit_archive /
predictions_import 等）在 enqueue / progress / finish 三时点写入此表，
专表（prediction_jobs / video_tracker_jobs）保留为 domain 真值（双写双轨）。

前端任务铃铛只读此表；专表细节字段由各 domain 自己消费。
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AsyncJobKind(str, enum.Enum):
    """v0.10.16 · 异步任务类型枚举。新加 kind 时同时更新前端 i18n 与铃铛文案。"""

    BATCH_PREDICT = "batch_predict"  # 项目 / 批次预标
    VIDEO_TRACKER = "video_tracker"  # 视频追踪
    AUDIT_ARCHIVE = "audit_archive"  # 审计日志月分区归档
    PREDICTIONS_IMPORT = "predictions_import"  # 外部 prediction 导入


class AsyncJobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# 终态集合（service 层与 retention 都会用到）
ASYNC_JOB_TERMINAL_STATUSES = frozenset(
    {AsyncJobStatus.COMPLETED, AsyncJobStatus.FAILED, AsyncJobStatus.CANCELLED}
)


class AsyncJob(Base):
    __tablename__ = "async_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=AsyncJobStatus.PENDING.value
    )
    progress_pct: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # 输入摘要（不要塞大对象，仅放 batch_id / 文件数等元数据）
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # 完成后的结果摘要（success_count / failed_count / 路径等）
    result: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_async_jobs_user_status_created", "user_id", "status", "created_at"),
        Index("ix_async_jobs_project_kind_status", "project_id", "kind", "status"),
        Index("ix_async_jobs_celery_task", "celery_task_id"),
    )
