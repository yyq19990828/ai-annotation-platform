import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GPUBackendCancelIntent(Base):
    """Last durable drain-cancel generation prepared for one GPU backend."""

    __tablename__ = "gpu_backend_cancel_intents"
    __table_args__ = (
        CheckConstraint(
            "membership_epoch > 0",
            name="ck_gpu_backend_cancel_intents_membership_epoch",
        ),
        CheckConstraint(
            "drain_generation > 0 AND generation > drain_generation",
            name="ck_gpu_backend_cancel_intents_generation",
        ),
        CheckConstraint(
            "source_generation > 0 AND drain_generation > source_generation",
            name="ck_gpu_backend_cancel_intents_source_generation",
        ),
        CheckConstraint(
            "control_epoch > 0 AND runtime_epoch > 0",
            name="ck_gpu_backend_cancel_intents_epochs",
        ),
        CheckConstraint(
            "operation = 'evict'",
            name="ck_gpu_backend_cancel_intents_operation",
        ),
        CheckConstraint(
            "owner_hard_deadline_ms > 0",
            name="ck_gpu_backend_cancel_intents_owner_deadline",
        ),
        CheckConstraint(
            "gpu_resource_id <> '' AND boot_id <> '' AND owner_id <> '' AND jti <> ''",
            name="ck_gpu_backend_cancel_intents_nonempty",
        ),
        CheckConstraint(
            "jsonb_typeof(pool_ids) = 'array' AND jsonb_array_length(pool_ids) > 0",
            name="ck_gpu_backend_cancel_intents_pool_ids",
        ),
        CheckConstraint(
            "subject_fingerprint ~ '^[0-9a-f]{64}$'",
            name="ck_gpu_backend_cancel_intents_fingerprint",
        ),
    )

    backend_registry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "gpu_backend_fences.backend_registry_id",
            name="fk_gpu_backend_cancel_intents_fence",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )
    gpu_resource_id: Mapped[str] = mapped_column(String(512), nullable=False)
    membership_epoch: Mapped[int] = mapped_column(BigInteger, nullable=False)
    boot_id: Mapped[str] = mapped_column(String(128), nullable=False)
    control_epoch: Mapped[int] = mapped_column(BigInteger, nullable=False)
    runtime_epoch: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source_generation: Mapped[int] = mapped_column(BigInteger, nullable=False)
    drain_generation: Mapped[int] = mapped_column(BigInteger, nullable=False)
    generation: Mapped[int] = mapped_column(BigInteger, nullable=False)
    owner_id: Mapped[str] = mapped_column(String(256), nullable=False)
    operation: Mapped[str] = mapped_column(String(64), nullable=False)
    owner_hard_deadline_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    drain_token_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    token_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    jti: Mapped[str] = mapped_column(String(256), nullable=False)
    pool_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    subject_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
