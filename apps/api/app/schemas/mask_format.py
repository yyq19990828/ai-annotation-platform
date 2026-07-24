from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


MaskFormatDirection = Literal["import", "export"]
MaskFormatLossClass = Literal["lossless", "lossy", "unsupported"]


class MaskFormatCapability(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supported: bool
    verified: bool = False
    enabled_for_ui: bool = False


class MaskFormatDescriptorOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format_id: str
    label: str
    adapter_version: str
    manifest_version: str
    media_types: list[str]
    import_capability: MaskFormatCapability
    export_capability: MaskFormatCapability
    option_schema: dict[str, Any] = Field(default_factory=dict)


class MaskFormatCode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    detail: dict[str, Any] = Field(default_factory=dict)


class MaskFormatPlanItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: str
    task_id: uuid.UUID | None = None
    media_path: str | None = None
    source_index: int | None = None
    loss_class: MaskFormatLossClass
    estimated_objects: int = Field(ge=0)
    estimated_files: int = Field(ge=0)
    estimated_bytes: int = Field(ge=0)
    losses: list[MaskFormatCode] = Field(default_factory=list)
    skips: list[MaskFormatCode] = Field(default_factory=list)
    warnings: list[MaskFormatCode] = Field(default_factory=list)


class MaskFormatPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format_id: str
    direction: MaskFormatDirection
    adapter_version: str
    manifest_version: str
    media_type: str
    loss_class: MaskFormatLossClass
    staged_object_key: str | None = None
    staged_sha256: str | None = None
    mapping_digest: str
    options_digest: str
    items: list[MaskFormatPlanItem] = Field(default_factory=list)
    unknown_labels: list[str] = Field(default_factory=list)
    size_conflicts: list[dict[str, Any]] = Field(default_factory=list)
    overlap_conflicts: list[dict[str, Any]] = Field(default_factory=list)
    id_mapping: dict[str, Any] = Field(default_factory=dict)
    frame_mapping: dict[str, Any] = Field(default_factory=dict)
    estimated_objects: int = Field(ge=0)
    estimated_files: int = Field(ge=0)
    estimated_bytes: int = Field(ge=0)
    losses: list[MaskFormatCode] = Field(default_factory=list)
    skips: list[MaskFormatCode] = Field(default_factory=list)
    warnings: list[MaskFormatCode] = Field(default_factory=list)
    plan_digest: str


class MaskFormatExportPreflightRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    targets: list[str] = Field(min_length=1, max_length=20)
    include_attributes: bool = True
    video_frame_mode: Literal["keyframes", "all_frames"] = "keyframes"
    axis_frame: Literal["iso", "source"] = "iso"
    options: dict[str, Any] = Field(default_factory=dict)


class MaskFormatExportPreflightResponse(BaseModel):
    plans: list[MaskFormatPlan]
    loss_class: MaskFormatLossClass
    estimated_objects: int = Field(ge=0)
    estimated_files: int = Field(ge=0)
    estimated_bytes: int = Field(ge=0)
    losses: list[MaskFormatCode] = Field(default_factory=list)
    warnings: list[MaskFormatCode] = Field(default_factory=list)
    preflight_digest: str


class MaskFormatUploadInitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="application/octet-stream", max_length=255)

    @field_validator("file_name")
    @classmethod
    def validate_file_name(cls, value: str) -> str:
        if value != value.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]:
            raise ValueError("file_name must not contain path components")
        if value in {".", ".."} or "\x00" in value:
            raise ValueError("invalid file_name")
        return value


class MaskFormatUploadInitResponse(BaseModel):
    object_key: str
    upload_url: str
    expires_in: int


class MaskFormatImportPreflightRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format_id: str = Field(min_length=1, max_length=80)
    staged_object_key: str = Field(min_length=1, max_length=500)
    staged_sha256: str = Field(pattern="^[0-9a-f]{64}$")
    mapping: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)


class MaskFormatImportPreflightResponse(BaseModel):
    import_id: uuid.UUID
    receipt: str
    receipt_expires_at: datetime
    plan: MaskFormatPlan


class MaskFormatImportExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    receipt: str = Field(min_length=16, max_length=256)
    plan_digest: str = Field(pattern="^[0-9a-f]{64}$")
    confirm_lossy: bool = False


class MaskFormatImportBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    async_job_id: uuid.UUID | None
    format_id: str
    adapter_version: str
    manifest_version: str
    staged_sha256: str
    plan_digest: str
    status: str
    result: dict[str, Any]
    receipt_expires_at: datetime
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
