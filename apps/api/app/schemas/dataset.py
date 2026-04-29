from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class DatasetCreate(BaseModel):
    name: str
    description: str = ""
    data_type: str = "image"


class DatasetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


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
    metadata: dict = {}
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
