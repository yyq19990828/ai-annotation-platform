from pydantic import BaseModel, Field, model_validator
from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from app.schemas._jsonb_types import (
    AttributeSchema,
    ClassesConfig,
    ProjectRenderingConfig,
)


class ProjectCreate(BaseModel):
    name: str
    type_label: str
    type_key: str
    classes: list[str] = []
    classes_config: ClassesConfig | None = None
    attribute_schema: AttributeSchema | None = None
    ai_enabled: bool = False
    ai_model: str | None = None
    # v0.8.6 F3 · 真实绑定 MLBackend；为 None 表示未绑定（ai_model 仍可作为 display hint）
    ml_backend_id: UUID | None = None
    # v0.9.7 · 从 wizard step 4 选一个全局已注册 backend, 后端复制 row 入新项目.
    # 与 ml_backend_id 互斥: 直接给 ml_backend_id 表示已存在本项目下的 backend (罕见);
    # 给 ml_backend_source_id 表示"从其它项目复用一份配置".
    ml_backend_source_id: UUID | None = None
    # v0.10.11 · "从已有项目复制配置" — 给定时, 用源项目的可克隆字段
    # (classes / classes_config / attribute_schema / ai 配置 / label_config /
    # rendering_config / sampling 等) 兜底当前 payload 未显式给出的字段;
    # 不复制 datasets / tasks / annotations / members / batches.
    # 调用者必须对源项目有 view 权限; 否则 404.
    source_project_id: UUID | None = None
    # v0.10.13 · E1 · 当 source_project_id 给定时, 是否同时复制 annotation_guide
    # + guide_assets. 默认 False; 复制时 guide_assets 共享原 storage key (不重新上传).
    copy_annotation_guide: bool = False
    # v0.10.14 · E2 · 从 ProjectTemplate 应用模板创建项目. 与 source_project_id
    # 互斥 (同时给则 400). 给定时, 后端从模板 deepcopy 模板载荷字段进 payload,
    # 并将模板 usage_count + 1.
    template_id: UUID | None = None
    due_date: date | None = None
    box_threshold: Annotated[float, Field(ge=0.0, le=1.0)] | None = None
    text_threshold: Annotated[float, Field(ge=0.0, le=1.0)] | None = None
    text_output_default: Literal["box", "mask", "both"] | None = None

    @model_validator(mode="after")
    def _validate_source_template_exclusive(self) -> "ProjectCreate":
        if self.template_id is not None and self.source_project_id is not None:
            raise ValueError(
                "template_id 与 source_project_id 互斥, 不能同时给"
            )
        if self.template_id is not None and self.copy_annotation_guide:
            # 模板自带 annotation_guide, copy_annotation_guide 只对 source_project_id 生效
            raise ValueError(
                "copy_annotation_guide 仅在 source_project_id 给定时有效"
            )
        return self


class ProjectUpdate(BaseModel):
    name: str | None = None
    type_label: str | None = None
    type_key: str | None = None
    status: str | None = None
    classes: list[str] | None = None
    classes_config: ClassesConfig | None = None
    attribute_schema: AttributeSchema | None = None
    ai_enabled: bool | None = None
    ai_model: str | None = None
    # v0.8.6 F3 · 显式 None 表示解绑（与 ProjectOut 序列化对齐；handler 区分 unset vs None）
    ml_backend_id: UUID | None = None
    due_date: date | None = None
    sampling: str | None = None
    maximum_annotations: int | None = None
    show_overlap_first: bool | None = None
    iou_dedup_threshold: Annotated[float, Field(ge=0.3, le=0.95)] | None = None
    # v0.9.2 · DINO 阈值项目级 override
    box_threshold: Annotated[float, Field(ge=0.0, le=1.0)] | None = None
    text_threshold: Annotated[float, Field(ge=0.0, le=1.0)] | None = None
    # v0.9.5 · 工作台 SamTextPanel 默认输出形态（None 走 type_key 智能默认）
    text_output_default: Literal["box", "mask", "both"] | None = None
    # v0.10.10 · I17.3 · 项目级渲染配置覆盖；空 dict / 字段缺省 = 沿用用户级偏好
    rendering_config: ProjectRenderingConfig | None = None
    # v0.10.13 · E1 · 标注指引 Markdown 原文; 显式 None 仅在 owner 主动清空时出现.
    # 单独 PATCH guide_assets 用 guide_assets 端点; 这里允许 owner 在异常情况下手动
    # 重置 list (例如批量删 orphan 后端 sync), 一般 UI 不直接写.
    annotation_guide: str | None = None
    guide_assets: list[dict] | None = None


class ProjectBatchSummary(BaseModel):
    total: int = 0
    assigned: int = 0
    in_review: int = 0


class ProjectOut(BaseModel):
    id: UUID
    organization_id: UUID | None = None
    display_id: str
    name: str
    type_label: str
    type_key: str
    owner_id: UUID
    owner_name: str | None = None
    member_count: int = 0
    status: str
    ai_enabled: bool
    ai_model: str | None
    ml_backend_id: UUID | None = None
    # v0.10.1 · 单项目可绑定的 ML backend 数量上限 (来自 settings.max_ml_backends_per_project).
    # 前端 ProjectSettings 据此渲染「+ 添加后端」按钮的禁用状态及 Modal 文案 (M3).
    ml_backend_limit: int = 1
    classes: list[str] = []
    classes_config: ClassesConfig = {}
    attribute_schema: AttributeSchema = AttributeSchema()
    label_config: dict = {}
    sampling: str = "sequence"
    maximum_annotations: int = 1
    show_overlap_first: bool = False
    iou_dedup_threshold: float = 0.7
    box_threshold: float = 0.35
    text_threshold: float = 0.25
    text_output_default: str | None = None
    # v0.10.10 · I17.3 · 项目级渲染配置覆盖；空 dict 表示项目不覆盖任何字段
    rendering_config: ProjectRenderingConfig = ProjectRenderingConfig()
    # v0.10.13 · E1 · 标注指引 Markdown 原文; None 表示未配置.
    annotation_guide: str | None = None
    # v0.10.13 · E1 · 已上传的指引图片资源元数据列表.
    guide_assets: list[dict] = []
    model_version: str | None = None
    task_lock_ttl_seconds: int = 300
    total_tasks: int
    completed_tasks: int
    review_tasks: int
    in_progress_tasks: int = 0
    ai_completed_tasks: int = 0
    batch_summary: ProjectBatchSummary = ProjectBatchSummary()
    due_date: date | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProjectStats(BaseModel):
    total_data: int
    completed: int
    ai_rate: float
    pending_review: int
    total_annotations: int = 0
    ai_derived_annotations: int = 0


class ProjectMemberOut(BaseModel):
    id: UUID
    user_id: UUID
    user_name: str
    user_email: str
    role: str
    assigned_at: datetime

    class Config:
        from_attributes = True


class ProjectMemberCreate(BaseModel):
    user_id: UUID
    role: Literal["annotator", "reviewer"]


class ProjectTransferRequest(BaseModel):
    new_owner_id: UUID
