from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MaskRepairBatch(Base):
    """Short-lived repair plan plus durable execution and rollback evidence."""

    __tablename__ = "mask_repair_batches"
    __table_args__ = (
        CheckConstraint(
            "status IN ('planned', 'pending', 'running', 'completed', 'partial', "
            "'failed', 'cancelled', 'rolling_back', 'rolled_back', "
            "'rollback_failed')",
            name="ck_mask_repair_batches_status",
        ),
        CheckConstraint(
            "plan_digest ~ '^[0-9a-f]{64}$'",
            name="ck_mask_repair_batches_plan_digest",
        ),
        Index(
            "ix_mask_repair_batches_project_created",
            "project_id",
            "created_at",
        ),
        Index("ix_mask_repair_batches_receipt_expires", "receipt_expires_at"),
        Index("ix_mask_repair_batches_rollback_expires", "rollback_expires_at"),
        Index("ix_mask_repair_batches_async_job", "async_job_id", unique=True),
        Index(
            "ix_mask_repair_batches_rollback_async_job",
            "rollback_async_job_id",
            unique=True,
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
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    async_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("async_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    rollback_async_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("async_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="planned", server_default="planned"
    )
    plan_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    request_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    plan_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    result_json: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    receipt_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    rollback_expires_at: Mapped[datetime | None] = mapped_column(
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
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    rolled_back_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
