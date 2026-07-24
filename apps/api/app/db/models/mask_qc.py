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


class MaskQCRun(Base):
    __tablename__ = "mask_qc_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed', 'cancelled')",
            name="ck_mask_qc_runs_status",
        ),
        CheckConstraint(
            "progress_pct >= 0 AND progress_pct <= 100",
            name="ck_mask_qc_runs_progress",
        ),
        CheckConstraint(
            "config_revision >= 1",
            name="ck_mask_qc_runs_config_revision",
        ),
        CheckConstraint(
            "config_digest ~ '^[0-9a-f]{64}$' AND "
            "source_snapshot_digest ~ '^[0-9a-f]{64}$' AND "
            "singleflight_key ~ '^[0-9a-f]{64}$'",
            name="ck_mask_qc_runs_digests",
        ),
        Index(
            "ix_mask_qc_runs_project_status_created",
            "project_id",
            "status",
            "created_at",
        ),
        Index("ix_mask_qc_runs_async_job", "async_job_id", unique=True),
        Index(
            "uq_mask_qc_runs_active_singleflight",
            "project_id",
            "singleflight_key",
            unique=True,
            postgresql_where=text("status IN ('pending', 'running')"),
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
        UUID(as_uuid=True),
        ForeignKey("async_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
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
    task_snapshot_digests: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    singleflight_key: Mapped[str] = mapped_column(String(64), nullable=False)
    summary: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class MaskQCIssue(Base):
    __tablename__ = "mask_qc_issues"
    __table_args__ = (
        CheckConstraint(
            "status IN ('open', 'resolved', 'wont_fix', 'stale')",
            name="ck_mask_qc_issues_status",
        ),
        CheckConstraint(
            "(severity = 'blocker' AND severity_rank = 0) OR "
            "(severity = 'warning' AND severity_rank = 1) OR "
            "(severity = 'info' AND severity_rank = 2)",
            name="ck_mask_qc_issues_severity_rank",
        ),
        CheckConstraint(
            "dedupe_key ~ '^[0-9a-f]{64}$' AND "
            "(region_digest IS NULL OR region_digest ~ '^[0-9a-f]{64}$')",
            name="ck_mask_qc_issues_digests",
        ),
        CheckConstraint(
            "(frame_start IS NULL AND frame_end IS NULL) OR "
            "(frame_start >= 0 AND frame_end >= frame_start)",
            name="ck_mask_qc_issues_frames",
        ),
        CheckConstraint(
            "annotation_version >= 1",
            name="ck_mask_qc_issues_annotation_version",
        ),
        UniqueConstraint("project_id", "dedupe_key", name="uq_mask_qc_issues_dedupe"),
        Index(
            "ix_mask_qc_issues_project_page",
            "project_id",
            "status",
            "severity_rank",
            "created_at",
            "id",
        ),
        Index(
            "ix_mask_qc_issues_project_order",
            "project_id",
            "severity_rank",
            "created_at",
            "id",
        ),
        Index(
            "ix_mask_qc_issues_task_page",
            "task_id",
            "status",
            "severity_rank",
            "created_at",
            "id",
        ),
        Index(
            "ix_mask_qc_issues_annotation_version",
            "annotation_id",
            "annotation_version",
        ),
        Index("ix_mask_qc_issues_last_seen_run", "last_seen_run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("mask_qc_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_seen_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("mask_qc_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    annotation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    annotation_version: Mapped[int] = mapped_column(Integer, nullable=False)
    related_annotation_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list, server_default="{}"
    )
    source_versions: Mapped[dict] = mapped_column(JSONB, nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(10), nullable=False)
    severity_rank: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, default="open", server_default="open"
    )
    frame_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    frame_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metric: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    threshold: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    region_bbox: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    region_mask_ref: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    region_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dedupe_key: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    suggestion: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
