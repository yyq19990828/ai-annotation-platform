from datetime import datetime

from pydantic import BaseModel, Field


# v0.10.13 · E1 · 允许的图片 MIME 类型. 单文件 5MB 上限.
ALLOWED_GUIDE_ASSET_TYPES = frozenset(
    {
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/svg+xml",
    }
)
MAX_GUIDE_ASSET_SIZE_BYTES = 5 * 1024 * 1024


class GuideAssetUploadInitRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    content_type: str
    size: int = Field(..., ge=1, le=MAX_GUIDE_ASSET_SIZE_BYTES)


class GuideAssetUploadInitResponse(BaseModel):
    key: str
    upload_url: str
    expires_in: int


class GuideAssetEntry(BaseModel):
    key: str
    original_name: str
    content_type: str
    size: int
    uploaded_at: datetime


class GuideAssetSignedUrlResponse(BaseModel):
    url: str
    expires_in: int
