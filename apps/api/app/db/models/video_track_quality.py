from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VideoTrackQualityRun(Base):
    __tablename__ = "video_track_quality_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','completed','empty_overlap','accepted','failed','stale')",
            name="ck_video_track_quality_runs_status",
        ),
        Index("ix_video_track_quality_runs_task_created", "task_id", "created_at"),
        Index(
            "ix_video_track_quality_runs_boundary",
            "left_segment_id",
            "right_segment_id",
            "created_at",
        ),
        Index("ix_video_track_quality_runs_async_job", "async_job_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    left_segment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("video_segments.id", ondelete="CASCADE"),
        nullable=False,
    )
    right_segment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("video_segments.id", ondelete="CASCADE"),
        nullable=False,
    )
    async_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("async_jobs.id", ondelete="SET NULL")
    )
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending", server_default="pending"
    )
    progress_pct: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    input_snapshot: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)
    input_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    sampling_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    metrics: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    pairs: Mapped[list[dict]] = mapped_column(
        JSONB, nullable=False, default=list, server_default="[]"
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    accepted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stale_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class VideoTrackQualityIssue(Base):
    __tablename__ = "video_track_quality_issues"
    __table_args__ = (
        CheckConstraint(
            "code IN ('false_positive','false_negative','id_switch','fragmentation','geometry_mismatch','unsupported_geometry')",
            name="ck_video_track_quality_issues_code",
        ),
        CheckConstraint(
            "frame_start >= 0 AND frame_end >= frame_start",
            name="ck_video_track_quality_issues_frames",
        ),
        Index(
            "ix_video_track_quality_issues_run_frames",
            "run_id",
            "frame_start",
            "frame_end",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("video_track_quality_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    left_annotation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("annotations.id", ondelete="SET NULL")
    )
    right_annotation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("annotations.id", ondelete="SET NULL")
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    frame_start: Mapped[int] = mapped_column(Integer, nullable=False)
    frame_end: Mapped[int] = mapped_column(Integer, nullable=False)
    metric: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
