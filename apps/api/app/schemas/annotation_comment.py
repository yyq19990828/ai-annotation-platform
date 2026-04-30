from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime


class AnnotationCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


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
    created_at: datetime
    updated_at: datetime | None = None

    class Config:
        from_attributes = True
