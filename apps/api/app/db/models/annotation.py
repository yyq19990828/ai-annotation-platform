import uuid
from datetime import datetime
from sqlalchemy import (
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
    # v0.10.25 · ADR-0006 Stage 2：predictions 改分区表后此列降级为软引用（无 DB FK）。
    # 业务侧已手动管理（删 prediction 前先 NULL），大表上重建复合 FK 收益低、锁表代价高。
    parent_prediction_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    parent_annotation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("annotations.id")
    )
    # v0.21.2 · ADR-0045 · 跨帧同一对象的通用标识 (几何类型无关), 格式 trk_<uuid.hex>.
    # 权威落点 (原分裂: video geometry 内 track_id + box_3d 借 group_id>=1e9, 编组下线后
    # group_id 列已删). 单一工厂 _new_track_id() 产出; propagate/interpolate/导出/3D 前端统一读本列.
    track_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    lead_time: Mapped[float | None] = mapped_column(Float)
    was_cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    ground_truth: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    attributes: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}", default=dict
    )
    # v0.20.10 · 属性级溯源 sidecar: 每个 attribute key 的来源标记
    # {key: {origin: "ai"|"human", model_ref?: {...}, confidence?: float, at?: iso}}.
    # 独立列 (不塞进 attributes 内, 避免污染值空间). 存量行为 {} → 读作全 human.
    # key 必须与 attributes 同步 (增删属性联动 meta), 见 AnnotationService。
    attributes_meta: Mapped[dict] = mapped_column(
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
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
