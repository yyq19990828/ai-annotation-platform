from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PointCloudQualityRun(Base):
    __tablename__ = "point_cloud_quality_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','completed','failed','cancelled','stale')",
            name="ck_point_cloud_quality_runs_status",
        ),
        CheckConstraint(
            "progress_pct >= 0 AND progress_pct <= 100",
            name="ck_point_cloud_quality_runs_progress",
        ),
        CheckConstraint(
            "config_revision >= 1",
            name="ck_point_cloud_quality_runs_config_revision",
        ),
        Index(
            "ix_point_cloud_quality_runs_project_status_created",
            "project_id",
            "status",
            "created_at",
        ),
        Index("ix_point_cloud_quality_runs_async_job", "async_job_id", unique=True),
        Index(
            "uq_point_cloud_quality_runs_active_singleflight",
            "project_id",
            "singleflight_key",
            unique=True,
            postgresql_where=text("status IN ('pending','running')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    async_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("async_jobs.id", ondelete="SET NULL")
    )
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    progress_pct: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    scope_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    config_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    config_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    config_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    source_snapshot: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)
    source_snapshot_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    singleflight_key: Mapped[str] = mapped_column(String(64), nullable=False)
    summary: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    error_message: Mapped[str | None] = mapped_column(Text)
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


class PointCloudQualityIssue(Base):
    __tablename__ = "point_cloud_quality_issues"
    __table_args__ = (
        CheckConstraint(
            "status IN ('open','resolved','wont_fix','stale')",
            name="ck_point_cloud_quality_issues_status",
        ),
        CheckConstraint(
            "(severity = 'blocker' AND severity_rank = 0) OR "
            "(severity = 'warning' AND severity_rank = 1) OR "
            "(severity = 'info' AND severity_rank = 2)",
            name="ck_point_cloud_quality_issues_severity_rank",
        ),
        CheckConstraint(
            "(frame_start IS NULL AND frame_end IS NULL) OR "
            "(frame_start >= 0 AND frame_end >= frame_start)",
            name="ck_point_cloud_quality_issues_frames",
        ),
        UniqueConstraint(
            "project_id", "dedupe_key", name="uq_point_cloud_quality_issues_dedupe"
        ),
        Index(
            "ix_point_cloud_quality_issues_project_page",
            "project_id",
            "status",
            "severity_rank",
            "created_at",
            "id",
        ),
        Index(
            "ix_point_cloud_quality_issues_scene_frame",
            "scene_id",
            "frame_start",
            "frame_end",
        ),
        Index(
            "ix_point_cloud_quality_issues_task_page",
            "task_id",
            "status",
            "severity_rank",
        ),
        Index(
            "ix_point_cloud_quality_issues_annotation_version",
            "annotation_id",
            "annotation_version",
        ),
        Index(
            "ix_point_cloud_quality_issues_track_revision",
            "scene_track_id",
            "track_revision",
        ),
        Index("ix_point_cloud_quality_issues_last_seen", "last_seen_run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("point_cloud_quality_runs.id", ondelete="SET NULL"),
    )
    last_seen_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("point_cloud_quality_runs.id", ondelete="SET NULL"),
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE")
    )
    scene_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scenes.id", ondelete="CASCADE")
    )
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL")
    )
    annotation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    annotation_version: Mapped[int | None] = mapped_column(Integer)
    scene_track_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scene_tracks.id", ondelete="SET NULL")
    )
    track_revision: Mapped[int | None] = mapped_column(Integer)
    related_annotation_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list, server_default="{}"
    )
    source_versions: Mapped[dict] = mapped_column(JSONB, nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    rule_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    severity: Mapped[str] = mapped_column(String(10), nullable=False)
    severity_rank: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, default="open", server_default="open"
    )
    frame_start: Mapped[int | None] = mapped_column(Integer)
    frame_end: Mapped[int | None] = mapped_column(Integer)
    metric: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    threshold: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    evidence: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    locator: Mapped[dict] = mapped_column(JSONB, nullable=False)
    suggested_command: Mapped[str | None] = mapped_column(Text)
    dedupe_key: Mapped[str] = mapped_column(String(64), nullable=False)
    resolution_reason: Mapped[str | None] = mapped_column(Text)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
