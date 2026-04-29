from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class GroupOut(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    member_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
