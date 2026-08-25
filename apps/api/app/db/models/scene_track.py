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
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SceneTrack(Base):
    """Scene-scoped temporal object identity and lifecycle revision."""

    __tablename__ = "scene_tracks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    scene_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scenes.id", ondelete="CASCADE"),
        nullable=False,
    )
    track_id: Mapped[str] = mapped_column(String(64), nullable=False)
    class_name: Mapped[str] = mapped_column(String(100), nullable=False)
    presence_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="inferred", default="inferred"
    )
    attributes: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}", default=dict
    )
    attributes_meta: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}", default=dict
    )
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1", default=1
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    retired_at: Mapped[datetime | None] = mapped_column(
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

    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "scene_id",
            "track_id",
            name="uq_scene_tracks_project_scene_track",
        ),
        CheckConstraint("revision >= 1", name="ck_scene_tracks_revision"),
        CheckConstraint(
            "presence_mode IN ('inferred','explicit')",
            name="ck_scene_tracks_presence_mode",
        ),
        Index(
            "ix_scene_tracks_scene_class_track",
            "scene_id",
            "class_name",
            "track_id",
        ),
        Index("ix_scene_tracks_project_scene", "project_id", "scene_id"),
    )


class SceneTrackOperation(Base):
    """Durable, idempotent and reversible journal for Scene Track commands."""

    __tablename__ = "scene_track_operations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    scene_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scenes.id", ondelete="CASCADE"),
        nullable=False,
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    snapshot_token: Mapped[str] = mapped_column(String(64), nullable=False)
    source_revisions: Mapped[dict] = mapped_column(JSONB, nullable=False)
    result_revisions: Mapped[dict] = mapped_column(JSONB, nullable=False)
    before_state: Mapped[dict] = mapped_column(JSONB, nullable=False)
    after_state: Mapped[dict] = mapped_column(JSONB, nullable=False)
    inverse_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    response_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="committed", default="committed"
    )
    reverted_by_operation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scene_track_operations.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "kind IN ('split','merge','mark_absent','resume','terminate','revert')",
            name="ck_scene_track_operations_kind",
        ),
        CheckConstraint(
            "status IN ('committed','reverted')",
            name="ck_scene_track_operations_status",
        ),
        UniqueConstraint(
            "scene_id",
            "actor_id",
            "idempotency_key",
            name="uq_scene_track_operations_scene_actor_key",
        ),
        Index(
            "ix_scene_track_operations_scene_created",
            "scene_id",
            "created_at",
        ),
    )


class SceneTrackInterval(Base):
    """Closed frame interval in which one Scene Track is declared present."""

    __tablename__ = "scene_track_intervals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    scene_track_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scene_tracks.id", ondelete="CASCADE"),
        nullable=False,
    )
    start_frame: Mapped[int] = mapped_column(Integer, nullable=False)
    end_frame: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1", default=1
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    operation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scene_track_operations.id", ondelete="SET NULL"),
        nullable=True,
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

    __table_args__ = (
        CheckConstraint(
            "start_frame >= 0 AND (end_frame IS NULL OR end_frame >= start_frame)",
            name="ck_scene_track_intervals_frames",
        ),
        CheckConstraint("version >= 1", name="ck_scene_track_intervals_version"),
        CheckConstraint(
            "source IN ('legacy_envelope','manual','imported','derived')",
            name="ck_scene_track_intervals_source",
        ),
        ExcludeConstraint(
            ("scene_track_id", "="),
            (func.int4range(start_frame, end_frame, "[]"), "&&"),
            using="gist",
            name="ex_scene_track_intervals_no_overlap",
        ),
        Index(
            "ix_scene_track_intervals_track_frames",
            "scene_track_id",
            "start_frame",
            "end_frame",
        ),
    )
