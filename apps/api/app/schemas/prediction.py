from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class PredictionOut(BaseModel):
    id: UUID
    task_id: UUID
    project_id: UUID
    ml_backend_id: UUID | None = None
    model_version: str | None = None
    score: float | None = None
    result: list[dict]
    cluster: int | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class PredictionMetaOut(BaseModel):
    inference_time_ms: int | None = None
    total_tokens: int | None = None
    total_cost: float | None = None

    class Config:
        from_attributes = True
