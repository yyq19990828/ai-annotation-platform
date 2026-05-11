from pydantic import BaseModel
from uuid import UUID
from datetime import datetime

from app.schemas.user import UserBrief


class VideoMetadata(BaseModel):
    duration_ms: int | None = None
    fps: float | None = None
    frame_count: int | None = None
    width: int | None = None
    height: int | None = None
    codec: str | None = None
    poster_frame_path: str | None = None
    probe_error: str | None = None
    poster_error: str | None = None


class TaskOut(BaseModel):
    id: UUID
    project_id: UUID
    display_id: str
    file_name: str
    file_url: str | None = None
    file_type: str
    tags: list = []
    status: str
    assignee_id: UUID | None = None
    # v0.7.2 · 责任人可视化
    assignee: UserBrief | None = None
    reviewer: UserBrief | None = None
    is_labeled: bool = False
    overlap: int = 1
    total_annotations: int = 0
    total_predictions: int = 0
    batch_id: UUID | None = None
    sequence_order: int | None = None
    image_width: int | None = None
    image_height: int | None = None
    thumbnail_url: str | None = None
    blurhash: str | None = None
    video_metadata: VideoMetadata | None = None
    # v0.6.5 · 状态机锁定相关
    submitted_at: datetime | None = None
    reviewer_id: UUID | None = None
    reviewer_claimed_at: datetime | None = None
    reviewed_at: datetime | None = None
    reject_reason: str | None = None
    # v0.8.7 F7 · 任务跳过
    skip_reason: str | None = None
    skipped_at: datetime | None = None
    reopened_count: int = 0
    last_reopened_at: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class ReviewClaimResponse(BaseModel):
    task_id: UUID
    reviewer_id: UUID
    reviewer_claimed_at: datetime
    is_self: bool


class TaskFileUrlResponse(BaseModel):
    url: str
    expires_in: int


class TaskVideoManifestResponse(BaseModel):
    task_id: UUID
    video_url: str
    poster_url: str | None = None
    metadata: VideoMetadata
    expires_in: int = 3600


class TaskLockResponse(BaseModel):
    task_id: UUID
    user_id: UUID
    expire_at: datetime
    unique_id: UUID

    class Config:
        from_attributes = True


class TaskListResponse(BaseModel):
    items: list[TaskOut]
    total: int
    limit: int
    offset: int
    next_cursor: str | None = None


class UploadInitRequest(BaseModel):
    project_id: UUID
    file_name: str
    content_type: str = "image/jpeg"


class UploadInitResponse(BaseModel):
    task_id: UUID
    upload_url: str
    expires_in: int
