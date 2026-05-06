"""v0.8.4 · task_events 批量写入 schema。"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class TaskEventIn(BaseModel):
    """单条事件 payload。client_id 可选；若未传，后端用 uuid4 生成。"""

    task_id: UUID
    project_id: UUID
    kind: Literal["annotate", "review"]
    started_at: datetime
    ended_at: datetime
    duration_ms: int = Field(ge=0, le=4 * 60 * 60 * 1000)  # 单条上限 4 小时
    annotation_count: int = Field(default=0, ge=0)
    was_rejected: bool = False
    client_id: UUID | None = None  # 前端去重 / 重发幂等

    @field_validator("ended_at")
    @classmethod
    def ended_after_started(cls, v: datetime, info):
        started = info.data.get("started_at")
        if started and v < started:
            raise ValueError("ended_at must be >= started_at")
        return v


class TaskEventBatchIn(BaseModel):
    events: list[TaskEventIn] = Field(min_length=1, max_length=200)


class TaskEventBatchOut(BaseModel):
    accepted: int
    queued_async: bool
