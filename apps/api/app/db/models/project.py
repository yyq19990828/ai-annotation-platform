import uuid
from datetime import datetime, date
from sqlalchemy import String, Boolean, Integer, Date, DateTime, Float, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id"))
    display_id: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type_label: Mapped[str] = mapped_column(String(50), nullable=False)
    type_key: Mapped[str] = mapped_column(String(30), nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(30), default="in_progress")
    ai_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_model: Mapped[str | None] = mapped_column(String(255))
    classes: Mapped[dict] = mapped_column(JSONB, default=list)
    classes_config: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}", default=dict)
    label_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    attribute_schema: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default='{"fields": []}', default=lambda: {"fields": []})
    sampling: Mapped[str] = mapped_column(String(30), default="sequence")
    maximum_annotations: Mapped[int] = mapped_column(Integer, default=1)
    show_overlap_first: Mapped[bool] = mapped_column(Boolean, default=False)
    iou_dedup_threshold: Mapped[float] = mapped_column(Float, nullable=False, server_default="0.7", default=0.7)
    model_version: Mapped[str | None] = mapped_column(String(100))
    task_lock_ttl_seconds: Mapped[int] = mapped_column(Integer, default=300)
    total_tasks: Mapped[int] = mapped_column(Integer, default=0)
    completed_tasks: Mapped[int] = mapped_column(Integer, default=0)
    review_tasks: Mapped[int] = mapped_column(Integer, default=0)
    due_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
