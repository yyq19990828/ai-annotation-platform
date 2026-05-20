import uuid
from datetime import datetime, date
from sqlalchemy import (
    String,
    Boolean,
    Integer,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id")
    )
    display_id: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type_label: Mapped[str] = mapped_column(String(50), nullable=False)
    type_key: Mapped[str] = mapped_column(String(30), nullable=False)
    # v0.10.28 · 媒体维度数据类型 (image / video / lidar); type_key 继续编码
    # 媒体+任务子类型 (video-track vs video-mm 等), data_type 只到媒体粒度,
    # 用于展示/筛选/媒体维度分流. backfill 见 alembic 0082.
    data_type: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default="image"
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    status: Mapped[str] = mapped_column(String(30), default="in_progress")
    ai_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # v0.8.6 F3：保留 ai_model 为「display hint」，由 ml_backend_id 实际驱动行为
    ai_model: Mapped[str | None] = mapped_column(String(255))
    ml_backend_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ml_backends.id", ondelete="SET NULL")
    )
    label_config: Mapped[dict] = mapped_column(JSONB, default=dict)
    # v0.10.17 · 工具维度类别 / 属性绑定 (ROADMAP §A 新建向导通用化).
    # 形状: { tool_unit_id: { enabled, classes: [...], attribute_schema: {...} } }
    # v0.10.22 · 旧扁平 classes / classes_config / attribute_schema 列已删除,
    # tool_bindings 是唯一存储真值; 扁平视图由响应 schema / 导出读时派生.
    tool_bindings: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}", default=dict
    )
    sampling: Mapped[str] = mapped_column(String(30), default="sequence")
    maximum_annotations: Mapped[int] = mapped_column(Integer, default=1)
    show_overlap_first: Mapped[bool] = mapped_column(Boolean, default=False)
    iou_dedup_threshold: Mapped[float] = mapped_column(
        Float, nullable=False, server_default="0.7", default=0.7
    )
    # v0.9.2 · GroundingDINO 阈值项目级 override（默认对齐 backend env 0.35 / 0.25）
    box_threshold: Mapped[float] = mapped_column(
        Float, nullable=False, server_default="0.35", default=0.35
    )
    text_threshold: Mapped[float] = mapped_column(
        Float, nullable=False, server_default="0.25", default=0.25
    )
    # v0.9.5 · 工作台 SamTextPanel 默认输出形态 (None 走 type_key 智能默认)
    text_output_default: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # v0.10.10 · I17.3 · 项目级渲染配置覆盖；空 dict = 全部沿用用户级 preferences
    rendering_config: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}", default=dict
    )
    # v0.10.13 · E1 · CVAT-style 项目级 Markdown 标注指引；None = 未配置
    annotation_guide: Mapped[str | None] = mapped_column(Text, nullable=True)
    # v0.10.13 · E1 · 已上传的指引图片资源元数据列表
    # entry: {key, original_name, content_type, size, uploaded_at}
    guide_assets: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]", default=list
    )
    model_version: Mapped[str | None] = mapped_column(String(100))
    task_lock_ttl_seconds: Mapped[int] = mapped_column(Integer, default=300)
    total_tasks: Mapped[int] = mapped_column(Integer, default=0)
    completed_tasks: Mapped[int] = mapped_column(Integer, default=0)
    review_tasks: Mapped[int] = mapped_column(Integer, default=0)
    in_progress_tasks: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )
    # v0.10.25 · batch 聚合物化列 {total, assigned, in_review}; 由
    # batch._sync_project_counters 写时维护, 取代 list_projects 的实时 GROUP BY.
    batch_summary: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}", default=dict
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
