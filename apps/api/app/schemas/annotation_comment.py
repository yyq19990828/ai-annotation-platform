from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime

from app.schemas._jsonb_types import (
    ATTACHMENT_KEY_PREFIX,
    Attachment,
    CanvasDrawing,
    Mention,
)


# 兼容旧导入路径
__all__ = [
    "ATTACHMENT_KEY_PREFIX",
    "Mention",
    "Attachment",
    "CanvasDrawing",
    "AnnotationCommentCreate",
    "AnnotationCommentUpdate",
    "AnnotationCommentOut",
    "CommentAttachmentUploadInitRequest",
    "CommentAttachmentUploadInitResponse",
]


class AnnotationCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    mentions: list[Mention] = Field(default_factory=list)
    attachments: list[Attachment] = Field(default_factory=list)
    canvas_drawing: CanvasDrawing | None = None


class AnnotationCommentUpdate(BaseModel):
    body: str | None = Field(default=None, min_length=1, max_length=4000)
    is_resolved: bool | None = None


class AnnotationCommentOut(BaseModel):
    id: UUID
    annotation_id: UUID
    project_id: UUID | None = None
    author_id: UUID
    author_name: str | None = None
    body: str
    is_resolved: bool
    is_active: bool
    mentions: list[Mention] = []
    attachments: list[Attachment] = []
    canvas_drawing: CanvasDrawing | None = None
    created_at: datetime
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class CommentAttachmentUploadInitRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="application/octet-stream", min_length=1, max_length=128)


class CommentAttachmentUploadInitResponse(BaseModel):
    storage_key: str
    upload_url: str
    expires_in: int
