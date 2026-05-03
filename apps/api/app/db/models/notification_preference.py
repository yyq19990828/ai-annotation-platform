import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, func, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class NotificationPreference(Base):
    """v0.7.0 · 用户级通知偏好（按 type 静音）。

    PK = (user_id, type)。channels JSONB 形如 `{"in_app": true, "email": false}`；
    无记录默认 in_app=true（向后兼容现网用户）。email 字段保留待 LLM 聚类 + SMTP 落地。
    """

    __tablename__ = "notification_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True,
    )
    type: Mapped[str] = mapped_column(String(60), primary_key=True)
    channels: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{\"in_app\": true, \"email\": false}'::jsonb"),
        default=lambda: {"in_app": True, "email": False},
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
