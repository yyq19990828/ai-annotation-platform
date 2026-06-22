"""v0.6.4 · 把所有 JSONB 字段的结构化 Pydantic 模型集中。

之前 ProjectOut/AnnotationOut/AnnotationCommentOut/AuditLogOut 里的 JSONB 列
被声明成 `dict` / `dict[str, Any]`，OpenAPI 自动生成的 TS 类型变成
`{ [key: string]: unknown }`，前端只能用 `Omit + 富类型` workaround 兜。

本文件把这些 shape 在后端用 Pydantic v2 声明出来：
- AttributeSchema / ClassesConfig（项目级）
- Geometry discriminated union（bbox / polygon）
- AnnotationAttributes（属性键值，限制元素类型）
- Mention / Attachment / CanvasDrawing（评论）
- AuditDetail（审计日志 detail_json，extra=allow + 已知字段可选）

Pydantic v2 的 discriminator 会让 codegen 在前端生成 sum type，删除全部
workaround。
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ── v0.13.11 · 点云 lidar 坐标系约定 ──────────────────────────────────

# 平台内部统一假设 ISO 8855 (+X 前 / +Y 左 / +Z 上)。LidarAxisConvention 描述
# 「数据源系 → ISO 系」的旋转关系；前端加载时做归一化，上层几何代码 (cameraAnchor /
# frontCameraForward / psrFromPoints / ...) 无需感知 convention 存在。
# 详见 docs/adr/0034-lidar-axis-convention.md。
LidarAxisConvention = Literal[
    "iso_8855",  # +X 前 / +Y 左 / +Z 上 (默认, ISO 8855 / SAE J670)
    "ros_rep103",  # 同 iso_8855 (ROS REP-103, 别名)
    "kitti_camera",  # +X 右 / +Y 下 / +Z 前 (KITTI camera-as-world)
    "opencv_camera",  # 同 kitti_camera (别名)
    "apollo",  # +X 右 / +Y 前 / +Z 上 (Apollo)
    "y_forward",  # 同 apollo (Velodyne raw 常见别名)
    "sustechpoints_demo",  # +X 车左 / +Y 车后 / +Z 天 (third-party/SUSTechPOINTS 自带示例)
    "raw",  # 不归一化, 平台不为该数据集承诺 ISO
]


# ── 项目级 attribute schema / classes config ────────────────────────

AttributeFieldType = Literal[
    "text", "number", "boolean", "select", "multiselect", "range"
]


class AttributeFieldOption(BaseModel):
    value: str
    label: str

    model_config = ConfigDict(extra="forbid")


class VisibleIfRule(BaseModel):
    """attribute field 的简单条件级联：当 other_key 等于 equals 时该字段才显示。"""

    key: str = Field(min_length=1)
    equals: Any | None = None

    model_config = ConfigDict(extra="forbid")


class AttributeField(BaseModel):
    key: str = Field(min_length=1)
    label: str
    type: AttributeFieldType
    required: bool | None = None
    default: Any | None = None
    options: list[AttributeFieldOption] | None = None
    min: float | None = None
    max: float | None = None
    regex: str | None = None
    applies_to: Literal["*"] | list[str] | None = None
    visible_if: VisibleIfRule | None = None
    hotkey: str | None = None
    description: str | None = None
    # v0.10.6 M4-γ · I13.2 · 仅视频任务消费：true 表示属性可逐 keyframe 覆盖
    # （CVAT 的 mutable / immutable 语义）。图片任务下忽略；前端展示「track 默认
    # 值 / 当前帧覆盖」双行，PATCH 走 keyframe override 路径。默认 false 向后兼容。
    mutable: bool | None = None
    # v0.11.27 · true 表示「该 boolean 属性=true 时，画布框渲染为虚线+半透（遮挡样式）」。
    # 仅图片任务消费；不影响导出（属性值照常进 attributes）。
    style_occluded: bool | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("hotkey")
    @classmethod
    def _check_hotkey(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if len(v) != 1 or not ("1" <= v <= "9"):
            raise ValueError("hotkey 必须是单个数字字符 1-9")
        return v


class AttributeSchema(BaseModel):
    fields: list[AttributeField] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _check_unique(self) -> "AttributeSchema":
        seen_keys: set[str] = set()
        seen_hotkeys: set[str] = set()
        for f in self.fields:
            if f.key in seen_keys:
                raise ValueError(f"attribute_schema.fields[].key 重复: {f.key!r}")
            seen_keys.add(f.key)
            if f.hotkey:
                if f.hotkey in seen_hotkeys:
                    raise ValueError(
                        f"attribute_schema.fields[].hotkey 重复: {f.hotkey!r}"
                    )
                seen_hotkeys.add(f.hotkey)
                if f.type not in {"boolean", "select"}:
                    raise ValueError(f"hotkey 仅支持 boolean / select 字段：{f.key}")
            if f.type in {"select", "multiselect"} and not f.options:
                raise ValueError(
                    f"fields[{f.key!r}].options 必填且非空（{f.type} 类型）"
                )
            if f.style_occluded and f.type != "boolean":
                raise ValueError(
                    f"fields[{f.key!r}].style_occluded 仅支持 boolean 字段"
                )
        return self


class ClassConfigEntry(BaseModel):
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    order: int | None = Field(default=None, ge=0)
    # v0.9.5 · 类别英文 alias，供 SAM 文本预标 prompt 下拉直填，避免运行时翻译。
    # ASCII-only：DINO 接受英文 + 数字 + 空格 + 逗号 + 下划线 + 连字符。
    # v0.9.6 · field_validator 自动 lower + trim + 折叠多重空格 / 多重逗号；
    # 用户输 "Person, , Worker" → "person ,worker"，DINO 召回更稳定。
    alias: str | None = Field(
        default=None,
        max_length=50,
        pattern=r"^[a-zA-Z0-9 ,_\-]+$",
    )

    model_config = ConfigDict(extra="forbid")

    @field_validator("alias", mode="before")
    @classmethod
    def _normalize_alias(cls, v: Any) -> Any:
        """v0.9.6 · 规范化:
        - lower (DINO 对 case-insensitive 但分布偏差; 全小写更稳)
        - strip 首尾空白
        - 折叠多重空格为单空格
        - 折叠多重逗号为单逗号
        - 折叠 ", ," / " ,," 等空白逗号混合 → 单 ","
        - 空字符串 / 仅空白 → None
        """
        if v is None or not isinstance(v, str):
            return v
        s = v.lower().strip()
        if not s:
            return None
        # 折叠 [空白+逗号]+ 序列为单 ","; 例 "a, , b" → "a,b"; "a , , b" → "a,b"
        s = re.sub(r"\s*,[\s,]*", ",", s)
        # 折叠多重空格
        s = re.sub(r"\s+", " ", s)
        # 去掉首尾遗留逗号 (用户输 ",foo," 视为 "foo")
        s = s.strip(",").strip()
        return s or None


# Pydantic dict-typed RootModel: codegen 出 Record<string, ClassConfigEntry>
ClassesConfig = dict[str, ClassConfigEntry]


# ── v0.10.17 · 工具维度类别 / 属性绑定 ──────────────────────────────
#
# 把原来的项目级扁平 classes_config + attribute_schema, 改为按"工具单位"
# (tool_unit) 嵌套. 五个稳定 enum 值; polyline / lidar_box_3d 当前为留位
# (前端工具未实现), 但后端 schema 已就位, 后续版本无需迁移.
#
# 旧 classes_config + attribute_schema 在 v0.10.17 期间仍由 service 层
# 从 tool_bindings 派生, 供未迁移的导出 / 聚合查询继续读, v0.10.18 删.

ToolUnitId = Literal[
    "bbox",
    "polyline",
    "region",
    "ai_interactive",
    "lidar_box_3d",
    "rotated_bbox",
    "keypoint",
    "point_mask_3d",
]
TOOL_UNIT_IDS: tuple[str, ...] = (
    "bbox",
    "polyline",
    "region",
    "ai_interactive",
    "lidar_box_3d",
    "rotated_bbox",
    "keypoint",
    "point_mask_3d",
)


class ClassRef(BaseModel):
    """v0.17.15 · 跨工具单位的类别引用 (alias_to 软关联链用).

    tool_unit_id 必须是合法 ToolUnitId; class_name 是目标 unit 内的类名.
    目标存在性不在此校验 (siblings 不可见), 由读时派生层解析时降级处理 (悬空 → 用自身值).
    """

    tool_unit_id: str = Field(min_length=1, max_length=30)
    class_name: str = Field(min_length=1, max_length=100)

    model_config = ConfigDict(extra="forbid")

    @field_validator("tool_unit_id")
    @classmethod
    def _check_unit(cls, v: str) -> str:
        if v not in TOOL_UNIT_IDS:
            raise ValueError(f"alias_to.tool_unit_id 非法: {v!r}")
        return v


class ToolClassEntry(BaseModel):
    """工具单位下的一条类别. name 必填且工具内唯一; color / alias 语义同 ClassConfigEntry."""

    name: str = Field(min_length=1, max_length=100)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    order: int | None = Field(default=None, ge=0)
    alias: str | None = Field(
        default=None,
        max_length=50,
        pattern=r"^[a-zA-Z0-9 ,_\-]+$",
    )
    # v0.17.15 · 跨工具单位颜色/alias 软关联 (ADR-0026 附录). 指向另一 unit 的类;
    # 本类 color/alias 为空时, 读时派生层 (services.project.resolve_class_visual)
    # 沿此链继承目标值. 仅显示层继承 —— 不改存储 / 不改标注归属 / 不进导出, 强隔离不变.
    alias_to: ClassRef | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("alias", mode="before")
    @classmethod
    def _normalize_alias(cls, v: Any) -> Any:
        if v is None or not isinstance(v, str):
            return v
        s = v.lower().strip()
        if not s:
            return None
        s = re.sub(r"\s*,[\s,]*", ",", s)
        s = re.sub(r"\s+", " ", s)
        s = s.strip(",").strip()
        return s or None


class KeypointNode(BaseModel):
    """关键点骨骼的一个节点（有序）。color 为可选 #RRGGBB。"""

    name: str = Field(min_length=1)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")

    model_config = ConfigDict(extra="forbid")


class KeypointSchema(BaseModel):
    """关键点骨骼拓扑（COCO 范式，类别级元数据，不进实例几何）。

    nodes 有序，edges 每条是 [i, j] 两个节点索引的骨骼连线。
    """

    nodes: list[KeypointNode] = Field(default_factory=list)
    edges: list[list[int]] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")

    @field_validator("edges")
    @classmethod
    def _check_edges(cls, v: list[list[int]]) -> list[list[int]]:
        for i, e in enumerate(v):
            if len(e) != 2:
                raise ValueError(f"edges[{i}] 必须是 [i, j] 两个节点索引")
            if e[0] < 0 or e[1] < 0:
                raise ValueError(f"edges[{i}] 节点索引必须 >= 0")
        return v


class VideoModesConfig(BaseModel):
    """v0.11.29 · 仅视频项目的 bbox 单位消费：控制「单帧框 / 轨迹框」是否各自可用。

    单帧框 = video_bbox 几何, 轨迹框 = video_track_bbox 几何, 共享同一套类别 / 属性绑定.
    仅用于工具栏可用性过滤; 不强制校验已存在的 annotation. None = 两者均可用 (向后兼容老项目).
    """

    box: bool = True
    track: bool = True

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _at_least_one_enabled(self) -> "VideoModesConfig":
        # 与前端 ClassesSection 语义一致：不允许 box / track 全 false，
        # 否则 bbox 单元 enabled=true 却什么都画不了。
        if not self.box and not self.track:
            raise ValueError("video_modes 必须至少保留 box / track 其一可用")
        return self


class ToolBinding(BaseModel):
    """单一工具单位下的 enable 状态 + 类别集合 + 属性 schema."""

    enabled: bool = False
    classes: list[ToolClassEntry] = Field(default_factory=list)
    attribute_schema: AttributeSchema = Field(default_factory=AttributeSchema)
    # v0.10.28 · 仅 keypoint 单元用：骨骼拓扑（节点名 / 连线）。其它单元留 None。
    keypoint_schema: KeypointSchema | None = None
    # v0.11.29 · 仅视频 bbox 单位消费：单帧框 / 轨迹框独立开关。None = 两者均可用。
    video_modes: VideoModesConfig | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _check_class_name_unique(self) -> "ToolBinding":
        seen: set[str] = set()
        for c in self.classes:
            if c.name in seen:
                raise ValueError(
                    f"tool_binding.classes[].name 在工具单位内重复: {c.name!r}"
                )
            seen.add(c.name)
        return self


# Key 必须是 ToolUnitId 枚举值之一; 用 dict 让 codegen 出 Record<string, ToolBinding>.
# Schema 层会用 ToolBindings 别名, 项目级校验在 _validate_tool_unit_id 完成.
ToolBindings = dict[str, ToolBinding]


def validate_tool_bindings_keys(value: dict[str, Any] | None) -> dict[str, Any] | None:
    """校验 ToolBindings 顶层 key 全在 TOOL_UNIT_IDS 内 (允许子集)."""
    if value is None:
        return value
    for k in value:
        if k not in TOOL_UNIT_IDS:
            raise ValueError(
                f"tool_bindings 顶层 key 必须是 {TOOL_UNIT_IDS} 之一, 收到: {k!r}"
            )
    return value


# ── 项目级渲染配置覆盖（v0.10.10 · I17.3） ─────────────────────────────
#
# 字段语义与 UserPreferences.workbench 同集（apps/api/app/schemas/user.py）。
# `None`/缺省 = 不覆盖，沿用用户级偏好。前端 useWorkbenchConfig 按
# `DEFAULTS → user prefs → project rendering_config` 合并。
# 不含 longTaskSampleRate：perf 取样属用户/环境层，不该被项目锁。


class ProjectRenderingConfig(BaseModel):
    smoothImage: bool | None = None
    cssImageFilter: str | None = Field(default=None, max_length=255)
    controlPointsSize: int | None = Field(default=None, ge=2, le=20)
    snapToGrid: bool | None = None
    box3dDefaultSize: tuple[float, float, float] | None = None
    propagateOverwrite: bool | None = None
    trackerDefaultModel: str | None = Field(default=None, max_length=128)

    model_config = ConfigDict(extra="forbid")

    @field_validator("box3dDefaultSize")
    @classmethod
    def _check_box3d_default_size(
        cls,
        v: tuple[float, float, float] | None,
    ) -> tuple[float, float, float] | None:
        if v is None:
            return v
        if any(size <= 0 for size in v):
            raise ValueError("box3dDefaultSize entries must be positive")
        return v


# ── Geometry discriminated union ────────────────────────────────────


class BboxGeometry(BaseModel):
    type: Literal["bbox"] = "bbox"
    x: float
    y: float
    w: float
    h: float

    model_config = ConfigDict(extra="allow")  # 允许 width/height 等历史别名


class VideoBboxGeometry(BaseModel):
    """v0.9.16 · 视频单帧 bbox。

    首版视频工作台只保存逐帧框，不表达 track/keyframe/interpolation。`frame_index`
    是唯一时间轴定位字段，展示层可自行换算 timecode。
    """

    type: Literal["video_bbox"] = "video_bbox"
    frame_index: int = Field(ge=0)
    x: float
    y: float
    w: float
    h: float

    model_config = ConfigDict(extra="forbid")


class VideoTrackBbox(BaseModel):
    x: float
    y: float
    w: float
    h: float

    model_config = ConfigDict(extra="forbid")


class VideoTrackKeyframe(BaseModel):
    frame_index: int = Field(ge=0)
    bbox: VideoTrackBbox
    source: Literal["manual", "interpolated", "prediction"] = "manual"
    occluded: bool = False
    # v0.10.6 M4-γ · I13.2 · mutable attribute 的逐帧覆盖。仅承载 schema 里
    # `mutable=true` 的属性键值；为 None 时表示该帧用 annotation.attributes
    # （track 默认值）。前端 PATCH 时只动这一字段，不污染 track 整体 attributes。
    attributes: dict[str, Any] | None = None

    model_config = ConfigDict(extra="forbid")


class VideoTrackOutsideRange(BaseModel):
    from_: int = Field(alias="from", ge=0)
    to: int = Field(ge=0)
    source: Literal["manual", "prediction"] = "manual"

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class VideoTrackGeometry(BaseModel):
    """v0.9.17 · 视频对象轨迹。

    轨迹以 compact JSON 保存，不逐帧展开写库。`track_id` 在一个 annotation 内稳定；
    `keyframes` 保存手工 / 预测关键帧，插值结果由前端按需计算。
    """

    type: Literal["video_track_bbox"] = "video_track_bbox"
    track_id: str = Field(min_length=1)
    # v0.10.30 · 2.1 用户可编辑的语义标签 (如 "car_3"), 仅作跨任务 Re-ID 心智,
    # 不参与主键、不强制唯一。track_number 由 derive_track_number 确定性派生, 不持久化。
    semantic_label: str | None = None
    keyframes: list[VideoTrackKeyframe] = Field(min_length=1)
    outside: list[VideoTrackOutsideRange] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class PolygonGeometry(BaseModel):
    """单连通域 polygon。

    v0.9.14 · holes 字段新增, 默认 [] 向后兼容。老存量 / 老前端写入仍走 type=polygon
    + 仅 points 路径; 新 prediction 在有 hole 时把 hole 顶点列表填进 holes, 多连通域
    走 MultiPolygonGeometry 分支。
    """

    type: Literal["polygon"] = "polygon"
    points: list[list[float]] = Field(min_length=3)
    holes: list[list[list[float]]] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")

    @field_validator("points")
    @classmethod
    def _check_points(cls, v: list[list[float]]) -> list[list[float]]:
        for i, pt in enumerate(v):
            if len(pt) != 2:
                raise ValueError(f"points[{i}] 必须是 [x, y]")
        return v

    @field_validator("holes")
    @classmethod
    def _check_holes(cls, v: list[list[list[float]]]) -> list[list[list[float]]]:
        for hi, hole in enumerate(v):
            if len(hole) < 3:
                raise ValueError(f"holes[{hi}] 顶点 < 3, 不构成有效环")
            for pi, pt in enumerate(hole):
                if len(pt) != 2:
                    raise ValueError(f"holes[{hi}][{pi}] 必须是 [x, y]")
        return v


class MultiPolygonGeometry(BaseModel):
    """多连通域 polygon 集合。每个 polygons[i] 内部仍是带 hole 的单连通 PolygonGeometry。

    v0.9.14 · 配合 mask_to_multi_polygon (apps/_shared/mask_utils) 输出。Predictor 在
    单连通无 hole 时仍输出 PolygonGeometry 兼容老前端; 多连通或带 hole 才走本分支。
    """

    type: Literal["multi_polygon"] = "multi_polygon"
    polygons: list[PolygonGeometry] = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


# ── v0.10.28 · rotated_bbox / polyline / keypoint 几何（坐标归一化 [0,1]） ──


class RotatedBboxGeometry(BaseModel):
    """旋转矩形。cx,cy 为中心点，w,h 为边长，angle 为顺时针旋转角度（度，[0,360)）。"""

    type: Literal["rotated_bbox"] = "rotated_bbox"
    cx: float
    cy: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    angle: float = Field(ge=0, lt=360)

    model_config = ConfigDict(extra="forbid")


class PolylineGeometry(BaseModel):
    """开放折线（不闭合）。points 至少 2 个 [x, y] 顶点。"""

    type: Literal["polyline"] = "polyline"
    points: list[list[float]] = Field(min_length=2)

    model_config = ConfigDict(extra="forbid")

    @field_validator("points")
    @classmethod
    def _check_points(cls, v: list[list[float]]) -> list[list[float]]:
        for i, pt in enumerate(v):
            if len(pt) != 2:
                raise ValueError(f"points[{i}] 必须是 [x, y]")
        return v


class Keypoint(BaseModel):
    """单个关键点。v 为 COCO 可见性：0 未标注 / 1 遮挡 / 2 可见。"""

    x: float
    y: float
    v: int

    model_config = ConfigDict(extra="forbid")

    @field_validator("v")
    @classmethod
    def _check_visibility(cls, v: int) -> int:
        if v not in {0, 1, 2}:
            raise ValueError("v 必须是 0(未标注)/1(遮挡)/2(可见) 之一")
        return v


class KeypointGeometry(BaseModel):
    """关键点集合实例几何。骨骼拓扑（节点名/连线）走类别级 ToolBinding.keypoint_schema。"""

    type: Literal["keypoint"] = "keypoint"
    points: list[Keypoint] = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


# ── v0.13.0 · 点云 3D 几何（box_3d / point_mask_3d） ──────────────────


class Box3DGeometry(BaseModel):
    """v0.13.0 · LiDAR 3D 框。center/size/rotation 各为长度 3 的列表
    (x,y,z 米 / 长宽高 / 绕各轴弧度)。extra="allow" 容纳标定/属性等扩展字段。"""

    type: Literal["box_3d"] = "box_3d"
    center: list[float] = Field(min_length=3, max_length=3)
    size: list[float] = Field(min_length=3, max_length=3)
    rotation: list[float] = Field(min_length=3, max_length=3)
    convention_at_create: LidarAxisConvention | None = None

    model_config = ConfigDict(extra="allow")


class PointMaskGeometry(BaseModel):
    """v0.13.0 · 3D 点云语义/实例分割掩码。point_indices 为指向点云的整数索引列表。"""

    type: Literal["point_mask_3d"] = "point_mask_3d"
    # 上界防止单条标注 geometry 膨胀到几 MB（jsonb / 列表序列化 / AAP 导出都会被放大）。
    # 前端渲染抽稀到 DECIMATE_THRESHOLD=500k 点，全选最多 ~500k 索引，600k 留足余量。
    point_indices: list[int] = Field(default_factory=list, max_length=600_000)
    convention_at_create: LidarAxisConvention | None = None
    decimate_stride: int | None = Field(default=None, ge=1)
    source_point_count: int | None = Field(default=None, ge=0)

    model_config = ConfigDict(extra="forbid")

    @field_validator("point_indices")
    @classmethod
    def _check_non_negative(cls, v: list[int]) -> list[int]:
        if any(i < 0 for i in v):
            raise ValueError("point_indices 必须全为非负整数")
        return v


Geometry = Annotated[
    BboxGeometry
    | VideoBboxGeometry
    | VideoTrackGeometry
    | PolygonGeometry
    | MultiPolygonGeometry
    | RotatedBboxGeometry
    | PolylineGeometry
    | KeypointGeometry
    | Box3DGeometry
    | PointMaskGeometry,
    Field(discriminator="type"),
]


def normalize_legacy_geometry(g: Any) -> Any:
    """旧 bbox 写入时不带 type，这里补 type='bbox' 兼容历史 DB 数据。

    在 from-DB 路径（AnnotationOut）和 from-API 路径（AnnotationCreate）的
    `field_validator(mode="before")` 都用一遍。
    """
    if (
        isinstance(g, dict)
        and g.get("type") is None
        and {"x", "y", "w", "h"}.issubset(g.keys())
    ):
        return {**g, "type": "bbox"}
    return g


# ── Annotation attributes（属性键值） ───────────────────────────────

# 属性值类型受限：基础标量 + None + 字符串列表（multiselect）
AnnotationAttributeValue = str | int | float | bool | None | list[str]
AnnotationAttributes = dict[str, AnnotationAttributeValue]


# ── 评论：mentions / attachments / canvas_drawing ──────────────────

ATTACHMENT_KEY_PREFIX = "comment-attachments/"


class Mention(BaseModel):
    user_id: UUID = Field(alias="userId")
    display_name: str = Field(alias="displayName", min_length=1, max_length=120)
    offset: int = Field(ge=0)
    length: int = Field(ge=1)

    model_config = ConfigDict(populate_by_name=True)


class Attachment(BaseModel):
    storage_key: str = Field(alias="storageKey", min_length=1, max_length=512)
    file_name: str = Field(alias="fileName", min_length=1, max_length=255)
    mime_type: str = Field(alias="mimeType", min_length=1, max_length=128)
    size: int = Field(ge=0)

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("storage_key")
    @classmethod
    def _validate_prefix(cls, v: str) -> str:
        if not v.startswith(ATTACHMENT_KEY_PREFIX):
            raise ValueError(
                f"attachments[].storageKey 必须以 {ATTACHMENT_KEY_PREFIX!r} 开头"
            )
        return v


CanvasShapeType = Literal["line", "arrow", "rect", "ellipse"]


class CanvasShape(BaseModel):
    type: CanvasShapeType
    points: list[float] = Field(min_length=2)
    stroke: str | None = None
    # v0.10.21 I4 · 笔画 timeline. 全 Optional, 旧记录缺字段时 UI 降级不渲染时间条.
    # id: client uuid; started_at/ended_at: ms epoch.
    id: str | None = None
    started_at: float | None = None
    ended_at: float | None = None

    model_config = ConfigDict(extra="forbid")


class CanvasDrawing(BaseModel):
    """Reviewer 端 Konva overlay 序列化的批注笔触集合（归一化坐标 [0,1]）。"""

    shapes: list[CanvasShape] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class CommentAnchor(BaseModel):
    """评论锚点。v0.9.35 起用于视频 review 的帧级定位。"""

    kind: Literal["video_frame"]
    frame_index: int = Field(ge=0, alias="frameIndex")
    track_id: str | None = Field(default=None, alias="trackId", max_length=120)
    source: Literal["manual", "prediction", "interpolated", "legacy"] | None = None

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


# ── AuditLog detail_json ────────────────────────────────────────────


class AuditDetail(BaseModel):
    """通用审计 detail：所有 23 种 action 的 detail_json shape。

    common：所有写请求都带 request_id（middleware 注入）
    业务字段：随 action 不同而不同；用 extra="allow" 容纳，
    几个高频字段单列出来好让 codegen 生成强类型 hint。

    后续按需要把高频 action 拆成自己的 BaseModel + discriminated union。
    """

    request_id: str | None = None

    # AnnotationAttributeChange（高频）
    task_id: str | None = None
    field_key: str | None = None
    before: Any | None = None
    after: Any | None = None

    # UserProfileUpdate
    old_name: str | None = None
    new_name: str | None = None

    model_config = ConfigDict(extra="allow")


# ── v0.13.1 · 点云相机标定（calibration）────────────────────────────


class SensorCalibration(BaseModel):
    """v0.13.1 · 相机标定。extrinsic row-major 4x4 外参(16), intrinsic row-major
    3x3 内参(9), rect 为 KITTI 可选矫正矩阵 4x4(16)。存进 DatasetItem.metadata_
    的 "calibration" key。投影: extrinsic·[x,y,z,1] → xyz → intrinsic·xyz → 透视除法。"""

    extrinsic: list[float] = Field(min_length=16, max_length=16)
    intrinsic: list[float] = Field(min_length=9, max_length=9)
    rect: list[float] | None = Field(default=None, min_length=16, max_length=16)

    model_config = ConfigDict(extra="forbid")


class DatasetItemMetadata(BaseModel):
    """v0.13.1 · DatasetItem.metadata_ 的结构化视图。calibration 仅点云相机项有;
    extra="allow" 保留其它历史/未来 metadata key 不丢。"""

    calibration: SensorCalibration | None = None

    model_config = ConfigDict(extra="allow")


class DatasetMetadata(BaseModel):
    """v0.13.11 · Dataset.metadata_ 的结构化视图 (extra="allow" 留给未来扩展)。"""

    axis_convention: LidarAxisConvention | None = None

    model_config = ConfigDict(extra="allow")
