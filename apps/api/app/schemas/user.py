from typing import Any, Literal
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


class FloatingPanelState(BaseModel):
    """v0.13.10 · 工作台浮窗状态。像素默认由前端按窗口计算。"""

    model_config = {"extra": "forbid"}

    detached: bool = False
    x: int | None = None
    y: int | None = None
    w: int | None = Field(default=None, ge=48, le=720)
    h: int | None = Field(default=None, ge=120, le=900)


class TriViewFloatState(BaseModel):
    """v0.13.10 · 3D 三视图浮层位置、尺寸与折叠态。"""

    model_config = {"extra": "forbid"}

    collapsed: bool = False
    x: int | None = None
    y: int | None = None
    w: int | None = Field(default=None, ge=200, le=480)
    h: int | None = Field(default=None, ge=240, le=720)


class CameraPanelState(BaseModel):
    """v0.15.x · 3D 悬浮相机面板的位置 + 折叠态。按相机 role 分桶存。

    位置像素由前端按视图计算后落库;无该 role 键 = 用默认贴边位置 + 自动折叠态。
    """

    model_config = {"extra": "forbid"}

    x: float | None = None
    y: float | None = None
    collapsed: bool = False


class PointcloudCameraState(BaseModel):
    """v0.15.x · 点云主视角快照。由前端 OrbitControls 写入/恢复。"""

    model_config = {"extra": "forbid"}

    position: tuple[float, float, float]
    target: tuple[float, float, float]
    up: tuple[float, float, float]
    mode: Literal["orbit", "bev"] = "orbit"


class WorkbenchLayoutPreferences(BaseModel):
    """v0.13.10 · 工作台布局偏好。

    后端只校验结构；默认值和 PATCH 全量 workbench 契约由前端维护。
    """

    model_config = {"extra": "forbid", "populate_by_name": True}

    left_open: bool | None = Field(default=None, alias="leftOpen")
    right_open: bool | None = Field(default=None, alias="rightOpen")
    left_width: int | None = Field(default=None, alias="leftWidth", ge=200, le=560)
    right_width: int | None = Field(default=None, alias="rightWidth", ge=220, le=600)
    floating_task_queue: FloatingPanelState | None = Field(
        default=None,
        alias="floatingTaskQueue",
    )
    floating_class_palette: FloatingPanelState | None = Field(
        default=None,
        alias="floatingClassPalette",
    )
    floating_inspector: FloatingPanelState | None = Field(
        default=None,
        alias="floatingInspector",
    )
    floating_discussion: FloatingPanelState | None = Field(
        default=None,
        alias="floatingDiscussion",
    )
    tri_view_float: TriViewFloatState | None = Field(default=None, alias="triViewFloat")
    camera_panels: dict[str, CameraPanelState] = Field(
        default_factory=dict, alias="cameraPanels"
    )
    pointcloud_camera: PointcloudCameraState | None = Field(
        default=None, alias="pointcloudCamera"
    )


class WorkbenchCommonPreferences(BaseModel):
    """v0.15.3 · 跨模态通用偏好（性能观测等）。"""

    model_config = {"extra": "forbid"}

    longTaskSampleRate: float = Field(default=0.05, ge=0.0, le=1.0)
    confirmDelete: Literal["never", "multi_only", "always"] = "never"
    recentClassesLimit: int = Field(default=5, ge=3, le=20)
    # v0.15.6 · 邻帧叠加 K（0=关）。当前 3D 点云消费（迁自旧全局 localStorage 键）；
    # 放 common 供视频侧后续复用。档位与前端 CrossFrameOverlayToggle OPTIONS 一致。
    crossFrameOverlayK: Literal[0, 1, 3, 5, 7] = 0
    performanceTier: Literal["light", "standard", "aggressive"] = "standard"


class WorkbenchImagePreferences(BaseModel):
    """v0.15.3 · 图像模态偏好（2D 画布渲染 / 顶点手柄）。"""

    model_config = {"extra": "forbid"}

    smoothImage: bool = True
    cssImageFilter: str = Field(default="", max_length=255)
    controlPointsSize: int = Field(default=6, ge=2, le=20)
    autoFitOnResize: bool = True
    snapToGrid: bool = False
    afterBoxCreate: Literal["pick_class", "reuse_active"] = "pick_class"
    snapThresholdPx: int = Field(default=8, ge=4, le=16)
    zoomStepFactor: Literal[1.05, 1.1, 1.15, 1.2] = 1.1
    fadedOpacity: float = Field(default=0.35, ge=0.1, le=0.8)
    showBoxLabels: bool = True
    maskOverlayOpacity: float = Field(default=0.45, ge=0.2, le=0.8)


class WorkbenchVideoPreferences(BaseModel):
    """v0.15.5 · 视频模态偏好（播放 / 步进）。"""

    model_config = {"extra": "forbid"}

    defaultPlaybackRate: Literal[0.25, 0.5, 1, 2, 4] = 1
    largeFrameStep: Literal[5, 10, 30, "grid"] = 10


class WorkbenchPointcloudPreferences(BaseModel):
    """v0.15.3 · 点云模态偏好。v0.15.6 填充渲染 / 导航字段（默认值 = 拆分前现状值）。"""

    model_config = {"extra": "forbid"}

    pointSize: float = Field(default=0.06, ge=0.01, le=0.3)
    persistCameraView: bool = False
    colorizeWithCamera: bool = False
    colorizeContrast: float = Field(default=1, ge=0.5, le=2.5)
    colorizeBrightness: float = Field(default=0, ge=-0.5, le=0.5)
    colorizeGamma: float = Field(default=1, ge=0.5, le=3)
    showDepthHint: bool = False
    pointMaskSelectMode: Literal["rect", "lasso", "polygon"] = "rect"
    showGrid: bool = True
    showAxisGizmo: bool = True
    # OrbitControls dampingFactor：值越小惯性越强（前端文案「相机灵敏度」）。
    cameraDamping: float = Field(default=0.1, ge=0.05, le=0.3)


class WorkbenchPreferences(BaseModel):
    """v0.9.41 · 标注工作台渲染偏好（I17 Configuration）。
    v0.13.10 · 增加 layout 子树承载跨设备布局偏好。
    v0.15.3 · 平铺字段拆为 common/image/video/pointcloud 四子树；layout 保持顶层。"""

    model_config = {"extra": "forbid"}

    common: WorkbenchCommonPreferences = Field(
        default_factory=WorkbenchCommonPreferences
    )
    image: WorkbenchImagePreferences = Field(default_factory=WorkbenchImagePreferences)
    video: WorkbenchVideoPreferences = Field(default_factory=WorkbenchVideoPreferences)
    pointcloud: WorkbenchPointcloudPreferences = Field(
        default_factory=WorkbenchPointcloudPreferences
    )
    layout: WorkbenchLayoutPreferences = Field(
        default_factory=WorkbenchLayoutPreferences
    )


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
    # v0.12.0 · 邮箱验证时间戳；None = 未验证。仅开放注册 + 验证开关打开时作登录 gate。
    email_verified_at: datetime | None = None
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
