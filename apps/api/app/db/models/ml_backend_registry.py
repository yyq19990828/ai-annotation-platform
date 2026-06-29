import uuid
from datetime import datetime
from sqlalchemy import (
    String,
    Boolean,
    Float,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class MLBackendRegistry(Base):
    """v0.19.0 · 全局 ML backend 注册表(ADR-0044)。

    backend 实例从「项目子资源」上提为「全局注册项」: 一个物理 backend(url) 注册一次,
    能力快照 health_meta.capabilities 单份真值,所有启用项目共享。

    auth_method / auth_token / extra_params 是「如何调用该 url」的端点固有属性,与项目无关,
    故随 url 进全局行(不做项目覆盖)。项目级覆盖只放真正业务相关的阈值/变体,见 ProjectMLBackend。
    """

    __tablename__ = "ml_backend_registry"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    state: Mapped[str] = mapped_column(String(30), default="disconnected")
    is_interactive: Mapped[bool] = mapped_column(Boolean, default=False)
    # 端点接入属性(上提到全局, 不做项目覆盖)
    auth_method: Mapped[str] = mapped_column(String(20), default="none")
    auth_token: Mapped[str | None] = mapped_column(String(500))
    extra_params: Mapped[dict] = mapped_column(JSONB, default=dict)
    # 能力快照单份真值: check_health 对注册项探测、写回此行
    health_meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # 'manual' = superadmin 在 ModelMarket 注册; 'env' = 启动钩子按 env URL 自动 upsert
    source: Mapped[str] = mapped_column(String(20), default="manual")
    error_message: Mapped[str | None] = mapped_column(String)
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProjectMLBackend(Base):
    """v0.19.0 · 项目 × 注册项关联(ADR-0044)。

    项目层退化为「启用开关 + 项目级覆盖」: enabled 控制该项目能否选用此全局 backend;
    box_threshold / text_threshold / default_variants 是项目级业务覆盖(可空,空=用全局默认)。
    预标 / DAG 下游 / backends>=2 门控读 enabled=true 集合。
    """

    __tablename__ = "project_ml_backend"
    __table_args__ = (
        UniqueConstraint("project_id", "registry_id", name="uq_project_ml_backend"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    registry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ml_backend_registry.id", ondelete="CASCADE"),
        index=True,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # 项目级业务覆盖(可空)
    box_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    text_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    default_variants: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
