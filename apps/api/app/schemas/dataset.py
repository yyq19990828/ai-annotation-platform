from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Literal

from app.schemas._jsonb_types import DatasetItemMetadata, LidarAxisConvention


class DatasetCreate(BaseModel):
    name: str
    description: str = ""
    data_type: str = "image"
    # v0.13.11 · 点云数据集 lidar 坐标系约定，写进 Dataset.metadata_["axis_convention"]。
    axis_convention: LidarAxisConvention | None = None


class DatasetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    # v0.13.11 · 未传 = 不改；显式 None = 清除；具体值 = 覆盖。
    axis_convention: LidarAxisConvention | None = None


class DatasetOut(BaseModel):
    id: UUID
    display_id: str
    name: str
    description: str
    data_type: str
    file_count: int
    total_size: int = 0
    created_by: UUID
    project_count: int = 0
    # v0.13.11 · 派生自 metadata_["axis_convention"]，None = 视作 iso_8855。
    axis_convention: LidarAxisConvention | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DatasetItemOut(BaseModel):
    id: UUID
    dataset_id: UUID
    file_name: str
    file_path: str
    file_type: str
    file_size: int | None = None
    content_hash: str | None = None
    width: int | None = None
    height: int | None = None
    # v0.13.1 · 结构化视图: calibration 仅点云相机项有, extra="allow" 保留其它 key。
    metadata: DatasetItemMetadata = Field(default_factory=DatasetItemMetadata)
    file_url: str | None = None
    thumbnail_url: str | None = None
    blurhash: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class DatasetListResponse(BaseModel):
    items: list[DatasetOut]
    total: int
    limit: int
    offset: int


class DatasetItemListResponse(BaseModel):
    items: list[DatasetItemOut]
    total: int
    limit: int
    offset: int


class DatasetLinkRequest(BaseModel):
    project_id: UUID


class DatasetUploadInitRequest(BaseModel):
    file_name: str
    content_type: str = "image/jpeg"


class DatasetUploadInitResponse(BaseModel):
    item_id: UUID
    upload_url: str
    expires_in: int


class DatasetImportFromConnectionRequest(BaseModel):
    connection_id: UUID
    source_path: str = ""
    recursive: bool = True
    include_globs: list[str] | None = None


class DatasetImportFromConnectionResponse(BaseModel):
    job_id: UUID


class SniffAxisConventionCandidate(BaseModel):
    convention: LidarAxisConvention
    score: float


class SniffAxisConventionCamera(BaseModel):
    camera_role: str | None = None
    best: LidarAxisConvention
    score: float


class SniffAxisConventionResponse(BaseModel):
    best: LidarAxisConvention | None = None
    score: float | None = None
    candidates: list[SniffAxisConventionCandidate] = Field(default_factory=list)
    source: Literal["task_link", "dataset_item"] | None = None
    camera_role: str | None = None
    camera_item_id: UUID | None = None
    per_camera: list[SniffAxisConventionCamera] | None = None
    agreement: float | None = None
