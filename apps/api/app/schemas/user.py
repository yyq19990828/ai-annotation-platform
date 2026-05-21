from typing import Any
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


class WorkbenchPreferences(BaseModel):
    """v0.9.41 · 标注工作台渲染偏好（I17 Configuration）。
    所有字段都有默认值，前端缺省可直接落库；schema 用严格 forbid 防脏写入。"""

    model_config = {"extra": "forbid"}

    smoothImage: bool = True
    cssImageFilter: str = Field(default="", max_length=255)
    controlPointsSize: int = Field(default=6, ge=2, le=20)
    snapToGrid: bool = False
    longTaskSampleRate: float = Field(default=0.05, ge=0.0, le=1.0)


class AIToolPreferences(BaseModel):
    """每用户的 AI 工具推理参数偏好，按 ML backend id 分桶。

    不同 backend 的 /setup.params schema 不同（gsam2 有 box/text_threshold，sam3 有
    score_threshold 等），故按 backend id 各存一份，互不污染；多用户各自一份 preferences，
    天然隔离不打架。值为 /setup.params 对应的自由 dict，平台只做存取不强校验字段。"""

    model_config = {"extra": "forbid"}

    params_by_backend: dict[str, dict[str, Any]] = Field(default_factory=dict)


class UserPreferences(BaseModel):
    """User.preferences JSONB root. 仅声明已知子树；未来按 epic 追加。"""

    model_config = {"extra": "forbid"}

    workbench: WorkbenchPreferences = Field(default_factory=WorkbenchPreferences)
    ai: AIToolPreferences = Field(default_factory=AIToolPreferences)


class UserCreate(BaseModel):
    email: str
    name: str
    password: str
    role: str = "annotator"


class UserOut(BaseModel):
    id: UUID
    email: str
    name: str
    role: str
    group_name: str | None
    group_id: UUID | None = None
    status: str
    is_active: bool = True
    last_login_at: datetime | None = None
    # v0.8.3 · 心跳机制：最近一次活跃时间（登录 / POST /me/heartbeat / 关键操作）
    last_seen_at: datetime | None = None
    # v0.8.1 · 非空 = 管理员刚重置密码，前端登录后跳「强制改密」页
    password_admin_reset_at: datetime | None = None
    # v0.8.1 · 自助注销冷静期信息（已申请时返回 scheduled_at）；未申请均为 None
    deactivation_requested_at: datetime | None = None
    deactivation_scheduled_at: datetime | None = None
    # v0.9.41 · 标注偏好（workbench 渲染配置等）。空对象 = 用客户端默认。
    preferences: dict = Field(default_factory=dict)
    created_at: datetime

    class Config:
        from_attributes = True


class UserBrief(BaseModel):
    """v0.7.2 · 责任人可视化用：列表 / 卡片侧 inline 渲染头像 + 名字 + 角色。"""

    id: UUID
    name: str
    email: str
    role: str | None = None
    avatar_initial: str

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: str
    password: str
    # v0.9.3 · progressive CAPTCHA：同 IP 失败 ≥ 阈值后必填；前端从 401 响应头
    # X-Login-Failed-Count 拿到当前 count，达阈值时渲染 <Captcha>。
    captcha_token: str | None = None
