from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


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
    is_labeled: bool = False
    overlap: int = 1
    total_annotations: int = 0
    total_predictions: int = 0
    sequence_order: int | None = None
    image_width: int | None = None
    image_height: int | None = None
    created_at: datetime
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class TaskFileUrlResponse(BaseModel):
    url: str
    expires_in: int


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
