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


# ── Geometry discriminated union ────────────────────────────────────


class BboxGeometry(BaseModel):
    type: Literal["bbox"] = "bbox"
    x: float
    y: float
    w: float
    h: float

    model_config = ConfigDict(extra="allow")  # 允许 width/height 等历史别名


class PolygonGeometry(BaseModel):
    type: Literal["polygon"] = "polygon"
    points: list[list[float]] = Field(min_length=3)

    model_config = ConfigDict(extra="forbid")

    @field_validator("points")
    @classmethod
    def _check_points(cls, v: list[list[float]]) -> list[list[float]]:
        for i, pt in enumerate(v):
            if len(pt) != 2:
                raise ValueError(f"points[{i}] 必须是 [x, y]")
        return v


Geometry = Annotated[
    BboxGeometry | PolygonGeometry,
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

    model_config = ConfigDict(extra="forbid")


class CanvasDrawing(BaseModel):
    """Reviewer 端 Konva overlay 序列化的批注笔触集合（归一化坐标 [0,1]）。"""

    shapes: list[CanvasShape] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


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
