from pydantic import BaseModel
from datetime import date, datetime
from uuid import UUID


class ProjectCreate(BaseModel):
    name: str
    type_label: str
    type_key: str
    classes: list[str] = []
    ai_enabled: bool = False
    ai_model: str | None = None
    due_date: date | None = None


class ProjectOut(BaseModel):
    id: UUID
    display_id: str
    name: str
    type_label: str
    type_key: str
    status: str
    ai_enabled: bool
    ai_model: str | None
    classes: list
    total_tasks: int
    completed_tasks: int
    review_tasks: int
    due_date: date | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProjectStats(BaseModel):
    total_data: int
    completed: int
    ai_rate: float
    pending_review: int
