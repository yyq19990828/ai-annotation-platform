"""v0.15.0 · Scene frame pose schemas

逐帧 ego pose(ego→global)的 Pydantic 表示;trajectory API / manifest 透出共用。
"""

from uuid import UUID

from pydantic import BaseModel, Field


class FramePose(BaseModel):
    frame_index: int = Field(..., ge=0)
    timestamp_us: int | None = None
    # ego→global:translation [x,y,z],rotation 四元数 [w,x,y,z](nuScenes 原样)
    ego_translation: list[float] = Field(..., min_length=3, max_length=3)
    ego_rotation: list[float] = Field(..., min_length=4, max_length=4)
    source_metadata: dict = Field(default_factory=dict)

    class Config:
        from_attributes = True


class TrajectoryResponse(BaseModel):
    """scene 的有序逐帧轨迹(按 frame_index 升序);无位姿 scene → poses=[]。"""

    scene_id: UUID
    poses: list[FramePose] = Field(default_factory=list)
