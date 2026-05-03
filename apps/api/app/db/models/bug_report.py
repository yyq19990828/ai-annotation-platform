import uuid
from datetime import datetime
from sqlalchemy import Integer, String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class BugReport(Base):
    __tablename__ = "bug_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    display_id: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    reporter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    route: Mapped[str] = mapped_column(String(256), nullable=False)
    user_role: Mapped[str] = mapped_column(String(32), nullable=False)
    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id"))
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="new", index=True)
    duplicate_of_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("bug_reports.id"))
    browser_ua: Mapped[str | None] = mapped_column(Text)
    viewport: Mapped[str | None] = mapped_column(String(20))
    recent_api_calls: Mapped[dict | None] = mapped_column(JSONB)
    recent_console_errors: Mapped[dict | None] = mapped_column(JSONB)
    screenshot_url: Mapped[str | None] = mapped_column(String(512))
    resolution: Mapped[str | None] = mapped_column(Text)
    fixed_in_version: Mapped[str | None] = mapped_column(String(20))
    assigned_to_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    triaged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fixed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reopen_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_reopened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BugComment(Base):
    __tablename__ = "bug_comments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bug_report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("bug_reports.id"), index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
