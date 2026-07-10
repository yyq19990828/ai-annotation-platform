import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VideoTrackerJobStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    # v0.21.28 · 候选/接受流: 追踪完成后结果暂存 (staged_result), 待用户接受/丢弃后才落库。
    # PENDING_REVIEW = 追踪完、结果已暂存、annotation 未改; ACCEPTED = 已应用到 annotation;
    # DISCARDED = 用户丢弃、annotation 零改动。CANCELLED 亦可携带 staged_result (部分结果可审)。
    PENDING_REVIEW = "pending_review"
    ACCEPTED = "accepted"
    DISCARDED = "discarded"


class VideoTrackerJob(Base):
    __tablename__ = "video_tracker_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    dataset_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dataset_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    annotation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("annotations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    segment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("video_segments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=VideoTrackerJobStatus.QUEUED.value
    )
    model_key: Mapped[str] = mapped_column(String(80), nullable=False)
    direction: Mapped[str] = mapped_column(String(20), nullable=False)
    from_frame: Mapped[int] = mapped_column(Integer, nullable=False)
    to_frame: Mapped[int] = mapped_column(Integer, nullable=False)
    prompt: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # v0.21.28 · 候选/接受流: 追踪完成后逐帧结果暂存于此 (list[{frame_index, geometry,
    # confidence, outside, instance_id, primary}]), 用户接受时才 _persist_tracker_results
    # 落库、丢弃时清空。缺省 None = 老直接落库路径 / 未产出结果。
    staged_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    event_channel: Mapped[str] = mapped_column(String(160), nullable=False)
    celery_task_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cancel_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_video_tracker_jobs_task_status", "task_id", "status"),
        Index(
            "ix_video_tracker_jobs_dataset_frames",
            "dataset_item_id",
            "from_frame",
            "to_frame",
        ),
    )
