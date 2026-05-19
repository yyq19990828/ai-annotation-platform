"""AAP JSON v1.0 — 平台原生无损中间格式 (v0.10.15).

为「跨实例迁移 / SDK / Plugin / dataset snapshot」服务的稳定锚点。与 COCO/YOLO/VOC
并列, 但**包含**它们丢失的字段: attribute_schema 值、prediction.confidence、
annotation.source、annotation_guide、classes_config 等。

关键决策 (对照 ROADMAP §6 决策底线):
- schema_version 必备; breaking change 升 major; 1.x → 2.0 不可静默解析.
- annotations[] / predictions[] **双数组分开**, 不混 type 字段
  (CVAT 部分格式踩过坑).
- 导出严格写满 null, 导入 lenient (extra="ignore") 忽略未知字段 + 缺失按默认值.
- geometry 使用平台**内部格式** (与 annotation.geometry JSONB 对齐),
  不走 LabelStudio shape 的 {type, value: {...}} 嵌套.
- task_match oneof: display_id 优先 (全局唯一最稳); 都给则 display_id 胜出.

本期 (v0.10.15) 实际**只消费 predictions[]**; annotations[] 字段在导入端只警告
日志不入库 (annotations import 留后续 epic).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ── schema 常量 ─────────────────────────────────────────────────────

AAP_SCHEMA_MAJOR = 1
# v0.10.17 · 升 1.1: envelope 增加 project.tool_bindings (工具维度类别/属性绑定)
# 与 annotations/predictions 数组每条 tool_unit_id. 1.0 reader 仍能读 (extra=ignore).
AAP_SCHEMA_VERSION = "1.1"


# ── task_match (oneof) ───────────────────────────────────────────────


class AAPTaskMatch(BaseModel):
    """跨实例匹配 task 的稳定键: display_id (全局唯一) + file_path (项目内)."""

    display_id: str | None = None
    file_path: str | None = None

    model_config = ConfigDict(extra="ignore")


# ── annotations / predictions entry ──────────────────────────────────


class AAPAnnotationEntry(BaseModel):
    """导出严格写满 null; 导入 lenient.

    本期不消费导入侧 (annotations import 留后续 epic), 字段保留供导出用.
    """

    geometry: dict[str, Any]
    class_name: str | None = None
    # v0.10.17 · 工具维度绑定 (1.1+). 老 1.0 reader 走 extra=ignore 容忍缺失.
    tool_unit_id: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    confidence: float | None = None
    source: str | None = None  # manual / prediction_based / prediction / interpolated
    user_id: UUID | None = None
    created_at: datetime | None = None
    external_id: str | None = None  # 留 forward compat

    model_config = ConfigDict(extra="ignore")


class AAPPredictionEntry(BaseModel):
    geometry: dict[str, Any]
    class_name: str | None = None
    # v0.10.17 · 工具维度绑定 (1.1+).
    tool_unit_id: str | None = None
    confidence: float | None = None
    model_version: str | None = None
    score: float | None = None  # 模型整体置信度 (与 prediction.score 对齐)
    source: str | None = None  # ml_backend / external_import
    created_at: datetime | None = None
    external_id: str | None = None  # 留 forward compat

    model_config = ConfigDict(extra="ignore")


# ── task block ───────────────────────────────────────────────────────


class AAPTaskBlock(BaseModel):
    task_match: AAPTaskMatch
    file_path: str | None = None
    external_id: str | None = None
    annotations: list[AAPAnnotationEntry] = Field(default_factory=list)
    predictions: list[AAPPredictionEntry] = Field(default_factory=list)

    model_config = ConfigDict(extra="ignore")


# ── project / exported_from / envelope ──────────────────────────────


class AAPExportedFrom(BaseModel):
    platform: Literal["aap"] = "aap"
    platform_version: str | None = None
    project_display_id: str | None = None
    batch_display_id: str | None = None

    model_config = ConfigDict(extra="ignore")


class AAPProjectMeta(BaseModel):
    name: str | None = None
    type_key: str | None = None
    # v0.10.17 · classes_config / attribute_schema 在 1.x 期间继续保留 (老 reader 派生用);
    # tool_bindings 是 1.1+ 真值字段, 1.0 reader 走 extra=ignore 容忍.
    classes_config: dict[str, Any] = Field(default_factory=dict)
    attribute_schema: dict[str, Any] = Field(default_factory=lambda: {"fields": []})
    tool_bindings: dict[str, Any] = Field(default_factory=dict)
    rendering_config: dict[str, Any] = Field(default_factory=dict)
    annotation_guide: str | None = None

    model_config = ConfigDict(extra="ignore")


class AAPJsonV1Envelope(BaseModel):
    """AAP JSON v1.0 envelope.

    导出端用 model_dump(mode="json") 严格写满 null; 导入端 model_validate()
    走 extra="ignore" 实现 lenient.
    """

    schema_version: str = AAP_SCHEMA_VERSION
    exported_at: datetime | None = None
    exported_from: AAPExportedFrom = Field(default_factory=AAPExportedFrom)
    project: AAPProjectMeta = Field(default_factory=AAPProjectMeta)
    tasks: list[AAPTaskBlock] = Field(default_factory=list)

    model_config = ConfigDict(extra="ignore")


# ── ImportResult (predictions/import 端点响应) ──────────────────────


class AAPImportErrorEntry(BaseModel):
    task_match: dict[str, Any] = Field(default_factory=dict)
    reason: str


class AAPImportResult(BaseModel):
    imported: int = 0
    skipped: int = 0
    errors: list[AAPImportErrorEntry] = Field(default_factory=list)
    dry_run: bool = False


# ── helper ──────────────────────────────────────────────────────────


def check_schema_major(version: str) -> None:
    """schema_version > 当前 major 时拒绝解析, 避免静默吃下未知 breaking change."""

    try:
        major_str = version.split(".", 1)[0]
        major = int(major_str)
    except (ValueError, IndexError):
        raise ValueError(f"schema_version {version!r} 格式非法, 应形如 '1.0'")
    if major > AAP_SCHEMA_MAJOR:
        raise ValueError(
            f"AAP JSON schema_version {version!r} 超出本平台支持范围 "
            f"(当前最大支持 major={AAP_SCHEMA_MAJOR}); 请升级平台"
        )
