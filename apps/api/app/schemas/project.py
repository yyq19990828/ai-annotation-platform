from pydantic import BaseModel, Field, field_validator
from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID
import re


_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_ATTR_TYPES = {"text", "number", "boolean", "select", "multiselect", "range"}


def _validate_attribute_schema(v: dict | None) -> dict | None:
    if v is None:
        return v
    if not isinstance(v, dict):
        raise ValueError("attribute_schema 必须是对象")
    fields = v.get("fields")
    if fields is None:
        return {"fields": []}
    if not isinstance(fields, list):
        raise ValueError("attribute_schema.fields 必须是数组")
    seen_keys: set[str] = set()
    seen_hotkeys: set[str] = set()
    for i, f in enumerate(fields):
        if not isinstance(f, dict):
            raise ValueError(f"fields[{i}] 必须是对象")
        key = f.get("key")
        if not isinstance(key, str) or not key:
            raise ValueError(f"fields[{i}].key 必填且为字符串")
        if key in seen_keys:
            raise ValueError(f"fields[{i}].key 重复: {key!r}")
        seen_keys.add(key)
        ftype = f.get("type")
        if ftype not in _ATTR_TYPES:
            raise ValueError(f"fields[{i}].type 必须是 {_ATTR_TYPES}")
        if ftype in {"select", "multiselect"}:
            opts = f.get("options")
            if not isinstance(opts, list) or not opts:
                raise ValueError(f"fields[{i}].options 必填且非空（{ftype} 类型）")
        # D.1：hotkey 字段 —— 仅支持 1-9 字符串，且全 schema 内唯一
        hk = f.get("hotkey")
        if hk is not None:
            if not isinstance(hk, str) or len(hk) != 1 or not ("1" <= hk <= "9"):
                raise ValueError(f"fields[{i}].hotkey 必须是单个数字字符 1-9")
            if ftype not in {"boolean", "select"}:
                raise ValueError(f"fields[{i}].hotkey 仅支持 boolean / select 字段")
            if hk in seen_hotkeys:
                raise ValueError(f"fields[{i}].hotkey 重复: {hk!r}")
            seen_hotkeys.add(hk)
        # description 用于 AttributeForm hover tooltip；存在时必须为字符串
        desc = f.get("description")
        if desc is not None and not isinstance(desc, str):
            raise ValueError(f"fields[{i}].description 必须是字符串")
    return v


def _validate_classes_config(v: dict | None) -> dict | None:
    if v is None:
        return v
    if not isinstance(v, dict):
        raise ValueError("classes_config 必须是对象")
    seen_orders: set[int] = set()
    for k, meta in v.items():
        if not isinstance(meta, dict):
            raise ValueError(f"classes_config[{k!r}] 必须是对象")
        color = meta.get("color")
        if color is not None and not _HEX_COLOR_RE.match(color):
            raise ValueError(f"classes_config[{k!r}].color 必须是 #RRGGBB")
        order = meta.get("order")
        if order is not None:
            if not isinstance(order, int) or order < 0:
                raise ValueError(f"classes_config[{k!r}].order 必须是非负整数")
            if order in seen_orders:
                raise ValueError(f"classes_config order 重复: {order}")
            seen_orders.add(order)
    return v


class ProjectCreate(BaseModel):
    name: str
    type_label: str
    type_key: str
    classes: list[str] = []
    ai_enabled: bool = False
    ai_model: str | None = None
    due_date: date | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    type_label: str | None = None
    type_key: str | None = None
    status: str | None = None
    classes: list[str] | None = None
    classes_config: dict | None = None
    attribute_schema: dict | None = None
    ai_enabled: bool | None = None
    ai_model: str | None = None
    due_date: date | None = None
    sampling: str | None = None
    maximum_annotations: int | None = None
    show_overlap_first: bool | None = None
    iou_dedup_threshold: Annotated[float, Field(ge=0.3, le=0.95)] | None = None

    @field_validator("attribute_schema")
    @classmethod
    def _check_schema(cls, v: dict | None) -> dict | None:
        return _validate_attribute_schema(v)

    @field_validator("classes_config")
    @classmethod
    def _check_classes_config(cls, v: dict | None) -> dict | None:
        return _validate_classes_config(v)


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
    classes: list
    classes_config: dict = {}
    attribute_schema: dict = {"fields": []}
    label_config: dict = {}
    sampling: str = "sequence"
    maximum_annotations: int = 1
    show_overlap_first: bool = False
    iou_dedup_threshold: float = 0.7
    model_version: str | None = None
    task_lock_ttl_seconds: int = 300
    total_tasks: int
    completed_tasks: int
    review_tasks: int
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
