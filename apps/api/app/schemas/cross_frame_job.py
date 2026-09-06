"""3D Scene 跨帧异步任务合同。"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class CrossFrameJobCreate(BaseModel):
    operation: Literal["propagate"] = "propagate"
    scope: Literal["selected", "all"]
    annotation_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)
    direction: Literal["forward", "backward"]
    start_frame: int = Field(ge=0)
    end_frame: int = Field(ge=0)
    conflict_policy: Literal["skip_existing"] = "skip_existing"

    @model_validator(mode="after")
    def validate_scope_and_range(self):
        if self.end_frame < self.start_frame:
            raise ValueError("end_frame must be greater than or equal to start_frame")
        if self.end_frame - self.start_frame + 1 > 100:
            raise ValueError("cross-frame job range cannot exceed 100 frames")
        if self.scope == "selected" and not self.annotation_ids:
            raise ValueError("selected scope requires annotation_ids")
        if self.scope == "all" and self.annotation_ids:
            raise ValueError("all scope must not include annotation_ids")
        if len(set(self.annotation_ids)) != len(self.annotation_ids):
            raise ValueError("annotation_ids must be unique")
        return self


class CrossFrameJobListResponse(BaseModel):
    items: list["AsyncJobOut"]
    total: int


from app.schemas.async_job import AsyncJobOut  # noqa: E402

CrossFrameJobListResponse.model_rebuild()
