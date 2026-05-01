from pydantic import BaseModel, Field, field_validator
from typing import Any
from uuid import UUID
from datetime import datetime


# 附件 storageKey 必须以此前缀开头，防止任意 key 注入读其它桶资源
ATTACHMENT_KEY_PREFIX = "comment-attachments/"


class Mention(BaseModel):
    user_id: UUID = Field(alias="userId")
    display_name: str = Field(alias="displayName", min_length=1, max_length=120)
    offset: int = Field(ge=0)
    length: int = Field(ge=1)

    class Config:
        populate_by_name = True


class Attachment(BaseModel):
    storage_key: str = Field(alias="storageKey", min_length=1, max_length=512)
    file_name: str = Field(alias="fileName", min_length=1, max_length=255)
    mime_type: str = Field(alias="mimeType", min_length=1, max_length=128)
    size: int = Field(ge=0)

    class Config:
        populate_by_name = True

    @field_validator("storage_key")
    @classmethod
    def _validate_prefix(cls, v: str) -> str:
        if not v.startswith(ATTACHMENT_KEY_PREFIX):
            raise ValueError(f"attachments[].storageKey 必须以 {ATTACHMENT_KEY_PREFIX!r} 开头")
        return v


class AnnotationCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    mentions: list[Mention] = Field(default_factory=list)
    attachments: list[Attachment] = Field(default_factory=list)
    canvas_drawing: dict[str, Any] | None = None


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
    mentions: list[dict[str, Any]] = []
    attachments: list[dict[str, Any]] = []
    canvas_drawing: dict[str, Any] | None = None
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
