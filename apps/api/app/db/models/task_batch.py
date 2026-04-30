import uuid
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class TaskBatch(Base):
    __tablename__ = "task_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True, index=True)
    display_id: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, server_default="")
    status: Mapped[str] = mapped_column(String(30), nullable=False, server_default="draft")
    priority: Mapped[int] = mapped_column(Integer, server_default="50")
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    assigned_user_ids: Mapped[list] = mapped_column(JSONB, server_default="[]")
    total_tasks: Mapped[int] = mapped_column(Integer, server_default="0")
    completed_tasks: Mapped[int] = mapped_column(Integer, server_default="0")
    review_tasks: Mapped[int] = mapped_column(Integer, server_default="0")
    approved_tasks: Mapped[int] = mapped_column(Integer, server_default="0")
    rejected_tasks: Mapped[int] = mapped_column(Integer, server_default="0")
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
