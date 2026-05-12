from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class VideoChunkOut(BaseModel):
    chunk_id: int
    start_frame: int
    end_frame: int
    status: Literal["pending", "ready", "failed"]
    url: str | None = None
    byte_size: int | None = None
    retry_after: int | None = None
    error: str | None = None


class VideoChunksResponse(BaseModel):
    dataset_item_id: UUID
    task_id: UUID | None = None
    chunk_size_frames: int
    fallback_video_url: str | None = None
    chunks: list[VideoChunkOut]


class VideoFrameOut(BaseModel):
    frame_index: int
    width: int
    format: Literal["webp", "jpeg"]
    status: Literal["pending", "ready", "failed"]
    url: str | None = None
    retry_after: int | None = None
    error: str | None = None


class VideoFramePrefetchRequest(BaseModel):
    frame_indices: list[int] = Field(default_factory=list, min_length=1, max_length=500)
    width: int = Field(default=512, ge=1, le=4096)
    format: Literal["webp", "jpeg"] = "webp"


class VideoFramePrefetchResponse(BaseModel):
    dataset_item_id: UUID
    task_id: UUID | None = None
    frames: list[VideoFrameOut]


class VideoManifestV2Response(BaseModel):
    task_id: UUID | None = None
    dataset_item_id: UUID
    video_url: str
    poster_url: str | None = None
    fps: float | None = None
    frame_count: int | None = None
    duration_ms: int | None = None
    chunks_manifest_url: str
    frame_timetable_url: str
    frame_service_base: str
    chunk_size_frames: int
    frame_cache_formats: list[Literal["webp", "jpeg"]] = ["webp", "jpeg"]
    expires_in: int = 3600
