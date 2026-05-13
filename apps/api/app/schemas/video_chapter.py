from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class VideoChapterBase(BaseModel):
    start_frame: int = Field(ge=0)
    end_frame: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=200)
    color: str | None = Field(default=None, max_length=40)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("title")
    @classmethod
    def _strip_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("title must not be blank")
        return value

    @model_validator(mode="after")
    def _check_frame_order(self) -> "VideoChapterBase":
        if self.end_frame < self.start_frame:
            raise ValueError("end_frame must be >= start_frame")
        return self


class VideoChapterCreate(VideoChapterBase):
    pass


class VideoChapterUpdate(BaseModel):
    start_frame: int | None = Field(default=None, ge=0)
    end_frame: int | None = Field(default=None, ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    color: str | None = Field(default=None, max_length=40)
    metadata: dict[str, Any] | None = None

    @field_validator("title")
    @classmethod
    def _strip_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("title must not be blank")
        return value


class VideoChapterOut(BaseModel):
    id: UUID
    dataset_item_id: UUID
    start_frame: int
    end_frame: int
    title: str
    color: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class VideoChapterList(BaseModel):
    chapters: list[VideoChapterOut] = Field(default_factory=list)
