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
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MaskReviewScope(Base):
    """Immutable evidence for one regional Tracker review decision."""

    __tablename__ = "mask_review_scopes"
    __table_args__ = (
        CheckConstraint(
            "decision IN ('accept', 'reject')",
            name="ck_mask_review_scopes_decision",
        ),
        CheckConstraint(
            "source_annotation_version >= 1 AND result_annotation_version >= 1",
            name="ck_mask_review_scopes_versions",
        ),
        CheckConstraint(
            "frame_start >= 0 AND frame_end >= frame_start",
            name="ck_mask_review_scopes_frames",
        ),
        CheckConstraint(
            "region_digest ~ '^[0-9a-f]{64}$' AND "
            "candidate_digest ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_mask_review_scopes_digests",
        ),
        Index(
            "ix_mask_review_scopes_current_range",
            "annotation_id",
            "result_annotation_version",
            "frame_start",
            "frame_end",
        ),
        Index("ix_mask_review_scopes_source_job", "source_job_id"),
        Index("ix_mask_review_scopes_issue", "qc_issue_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
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
    qc_issue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("mask_qc_issues.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("video_tracker_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    source_annotation_version: Mapped[int] = mapped_column(Integer, nullable=False)
    result_annotation_version: Mapped[int] = mapped_column(Integer, nullable=False)
    source_job_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    frame_start: Mapped[int] = mapped_column(Integer, nullable=False)
    frame_end: Mapped[int] = mapped_column(Integer, nullable=False)
    region_mask_ref: Mapped[dict] = mapped_column(JSONB, nullable=False)
    region_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    candidate_digest: Mapped[str] = mapped_column(String(71), nullable=False)
    decision: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
