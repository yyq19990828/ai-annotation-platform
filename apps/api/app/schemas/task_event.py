"""Task-event ingestion contract used by the Workbench time collector."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class TaskEventIn(BaseModel):
    """A closed, client-deduplicated Workbench interval.

    ``project_id`` stays in the wire contract for old clients, but the API and
    worker always derive the stored project from ``task_id``.
    """

    task_id: UUID
    project_id: UUID
    kind: Literal["annotate", "review"]
    started_at: datetime
    ended_at: datetime
    duration_ms: int = Field(ge=0, le=4 * 60 * 60 * 1000)
    annotation_count: int = Field(default=0, ge=0, le=1_000_000)
    was_rejected: bool = False
    client_id: UUID | None = None
    collector_version: str | None = Field(default=None, max_length=32)

    @field_validator("started_at", "ended_at")
    @classmethod
    def require_timezone(cls, v: datetime) -> datetime:
        if v.tzinfo is None or v.utcoffset() is None:
            raise ValueError("timestamp must include a timezone")
        return v

    @model_validator(mode="after")
    def validate_interval(self) -> "TaskEventIn":
        if self.ended_at < self.started_at:
            raise ValueError("ended_at must be >= started_at")
        elapsed_ms = round((self.ended_at - self.started_at).total_seconds() * 1000)
        if abs(elapsed_ms - self.duration_ms) > 1:
            raise ValueError("duration_ms must match started_at and ended_at")
        return self


class TaskEventBatchIn(BaseModel):
    events: list[TaskEventIn] = Field(min_length=1, max_length=200)


class TaskEventBatchOut(BaseModel):
    accepted: int
    queued_async: bool
