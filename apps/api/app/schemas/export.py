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


class LidarExportOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kitti_camera_role: str | None = Field(
        default=None,
        min_length=1,
        max_length=50,
        pattern=r"^camera_[A-Za-z0-9_.-]+$",
    )


class LidarExportPreflightRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    targets: list[str] = Field(min_length=1)
    lidar: LidarExportOptions | None = None


class LidarExportIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    task_id: uuid.UUID | None = None
    task_display_id: str | None = None
    frame_key: str | None = None
    camera_role: str | None = None


class LidarExportPreflightResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready: bool
    camera_roles: list[str]
    selected_camera_role: str | None = None
    checked_tasks: int
    issue_count: int
    issues_truncated: bool = False
    issues: list[LidarExportIssue]


class ExportRequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: VideoExportScopeRequest | None = None
    lidar: LidarExportOptions | None = None
