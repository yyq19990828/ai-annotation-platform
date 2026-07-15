import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, func
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
    )

    backend_registry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ml_backend_registry.id", ondelete="CASCADE"),
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
