from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class VideoExportSegmentSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["segments"] = "segments"
    start_segment_id: uuid.UUID
    end_segment_id: uuid.UUID


class VideoExportFrameSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["frames"] = "frames"
    from_frame: int = Field(ge=0)
    to_frame: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_order(self):
        if self.to_frame < self.from_frame:
            raise ValueError("to_frame must be greater than or equal to from_frame")
        return self


VideoExportSelection = Annotated[
    VideoExportSegmentSelection | VideoExportFrameSelection,
    Field(discriminator="kind"),
]


class VideoExportScopeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: uuid.UUID
    selection: VideoExportSelection


class ExportRequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: VideoExportScopeRequest | None = None
