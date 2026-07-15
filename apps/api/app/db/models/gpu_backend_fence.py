import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GPUBackendFence(Base):
    """Durable monotonic fencing high-water marks for one registry backend."""

    __tablename__ = "gpu_backend_fences"
    __table_args__ = (
        CheckConstraint(
            "generation_high_water >= 0",
            name="ck_gpu_backend_fences_generation_nonnegative",
        ),
        CheckConstraint(
            "control_epoch_high_water >= 0",
            name="ck_gpu_backend_fences_control_epoch_nonnegative",
        ),
        CheckConstraint(
            "runtime_epoch_high_water >= 0",
            name="ck_gpu_backend_fences_runtime_epoch_nonnegative",
        ),
    )

    backend_registry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
    )
    # Zero is a durable "not issued yet" sentinel. Wire values remain canonical
    # positive int64 decimal strings.
    generation_high_water: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    control_epoch_high_water: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    # Zero means this backend has never entered an enforce runtime epoch. Once
    # positive, direct claim/endpoint mutation is blocked until managed retirement.
    runtime_epoch_high_water: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    # Maximum expiry of any signed GPU capability, persisted before token signing.
    # Redis continuity loss may recover only after this horizon and post-horizon
    # live-idle evidence (or a stronger signed reset).
    token_expiry_high_water: Mapped[datetime | None] = mapped_column(
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
