from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


class AnnotationCreate(BaseModel):
    annotation_type: str = "bbox"
    class_name: str
    geometry: dict
    confidence: float | None = None
    parent_prediction_id: UUID | None = None
    lead_time: float | None = None


class AnnotationUpdate(BaseModel):
    geometry: dict | None = None
    class_name: str | None = None
    confidence: float | None = None


class AnnotationOut(BaseModel):
    id: UUID
    task_id: UUID
    project_id: UUID | None = None
    user_id: UUID | None = None
    source: str
    annotation_type: str
    class_name: str
    geometry: dict
    confidence: float | None = None
    parent_prediction_id: UUID | None = None
    parent_annotation_id: UUID | None = None
    lead_time: float | None = None
    is_active: bool
    ground_truth: bool = False
    created_at: datetime
    updated_at: datetime | None = None

    class Config:
        from_attributes = True
