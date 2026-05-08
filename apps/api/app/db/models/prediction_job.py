import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PredictionJobStatus(str, enum.Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class PredictionJob(Base):
    __tablename__ = "prediction_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("task_batches.id", ondelete="CASCADE"),
        nullable=True,
    )
    ml_backend_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ml_backends.id", ondelete="RESTRICT"),
        nullable=False,
    )
    prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    output_mode: Mapped[str] = mapped_column(
        String(30), nullable=False, default="mask"
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=PredictionJobStatus.RUNNING.value
    )
    total_tasks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    success_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    failed_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_cost: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 4), nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
