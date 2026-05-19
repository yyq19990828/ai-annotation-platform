import uuid
from datetime import datetime
from sqlalchemy import (
    BigInteger,
    Integer,
    String,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    func,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id"), index=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    annotation_type: Mapped[str] = mapped_column(String(30), default="bbox")
    # v0.10.17 · 标注所属工具单位; 校验 class_name ∈ project.tool_bindings[unit].classes.
    # 默认 bbox 兼容旧数据; migration backfill 按 annotation_type 反推 (polygon/mask → region).
    tool_unit_id: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default="bbox", default="bbox"
    )
    class_name: Mapped[str] = mapped_column(String(100), nullable=False)
    geometry: Mapped[dict] = mapped_column(JSONB, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    parent_prediction_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("predictions.id")
    )
    parent_annotation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("annotations.id")
    )
    # I12 · 同 task 内分组序号; 与 parent_annotation_id 正交.
    # parent 表"车牌属于车"层级语义, group_id 表"平等成员同组" (Ctrl+G 形成).
    # 数值来源: tasks.next_group_seq 自增序号.
    group_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    lead_time: Mapped[float | None] = mapped_column(Float)
    was_cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    ground_truth: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    attributes: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}", default=dict
    )
    # v0.10.5 M4-β · CVAT 风格 shape 状态位（ROADMAP I15）。
    z_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    is_locked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    is_hidden: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    is_occluded: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
