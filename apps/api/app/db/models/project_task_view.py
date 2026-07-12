import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProjectTaskView(Base):
    __tablename__ = "project_task_views"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    visibility: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="private", default="private"
    )
    entity_scope: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="tasks", default="tasks"
    )
    filter_json: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}", default=dict
    )
    sort_json: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]", default=list
    )
    columns_json: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]", default=list
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "owner_id",
            "entity_scope",
            "name",
            name="uq_project_task_views_private_owner_name",
        ),
        Index(
            "uq_project_task_views_project_name",
            "project_id",
            "entity_scope",
            "name",
            unique=True,
            postgresql_where=text("visibility = 'project'"),
        ),
        Index(
            "ix_project_task_views_visibility",
            "project_id",
            "visibility",
        ),
        Index(
            "ix_project_task_views_scope_visibility",
            "project_id",
            "entity_scope",
            "visibility",
        ),
        CheckConstraint(
            "visibility IN ('private', 'project')",
            "ck_project_task_views_visibility",
        ),
        CheckConstraint(
            "entity_scope IN ('tasks', 'objects', 'tracks')",
            "ck_project_task_views_entity_scope",
        ),
    )
