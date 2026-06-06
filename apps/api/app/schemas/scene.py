"""v0.14.0 · Scene schemas

跨 task 帧序列地基的 Pydantic 表示。Scene = 一段被切成多个 task 的时序录像。
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class SceneOut(BaseModel):
    id: UUID
    display_id: str
    dataset_id: UUID
    name: str
    source_format: str | None = None
    source_metadata: dict = Field(default_factory=dict)
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SceneCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    source_format: str | None = Field(default=None, max_length=50)
    source_metadata: dict = Field(default_factory=dict)


class SceneUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    source_format: str | None = Field(default=None, max_length=50)
    source_metadata: dict | None = None


class NeighborInfo(BaseModel):
    task_id: UUID
    frame_index: int


class NeighborsResponse(BaseModel):
    """task 在所属 scene 内的前后 k 个邻居任务。

    prev / next 都按"距离 cur 的远近"排序——cur-1 在 prev[0],cur+1 在 next[0]。
    首/末帧的对应方向数组为空(不报错,前端兜底渲染)。
    """

    scene_id: UUID | None = None
    scene_name: str | None = None
    frame_index: int | None = None
    scene_total_frames: int
    prev: list[NeighborInfo] = Field(default_factory=list)
    next: list[NeighborInfo] = Field(default_factory=list)


class InferenceResult(BaseModel):
    """scene_inference.infer_and_apply 返回值;backfill 脚本 / API 共用。"""

    dataset_id: UUID
    created_scenes: int
    assigned_items: int
    skipped_items: int
    dry_run: bool
    notes: list[str] = Field(default_factory=list)
