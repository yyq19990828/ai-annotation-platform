from __future__ import annotations

from dataclasses import dataclass
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import Dataset, Scene
from app.db.models.project import Project


@dataclass(frozen=True)
class ProjectKind:
    data_type: str
    scene_mode: bool


@dataclass(frozen=True)
class DatasetKind:
    data_type: str
    has_scenes: bool


def canonical_media_kind(data_type: str | None) -> str:
    if data_type in {"lidar", "point_cloud", "pointcloud"}:
        return "lidar"
    return data_type or "image"


def project_kind(project: Project) -> ProjectKind:
    return ProjectKind(
        data_type=canonical_media_kind(project.data_type),
        scene_mode=bool(project.scene_mode),
    )


def dataset_kind(dataset: Dataset, *, has_scenes: bool) -> DatasetKind:
    return DatasetKind(
        data_type=canonical_media_kind(dataset.data_type),
        has_scenes=has_scenes,
    )


def kind_matches(project: ProjectKind, dataset: DatasetKind) -> bool:
    return (
        project.data_type == dataset.data_type
        and project.scene_mode == dataset.has_scenes
    )


def scene_mode_allowed(data_type: str | None) -> bool:
    return canonical_media_kind(data_type) in {"image", "lidar"}


def kind_mismatch_detail(project: ProjectKind, dataset: DatasetKind) -> str | None:
    if project.data_type != dataset.data_type:
        return (
            "data_type 不匹配"
            f"(项目 {project.data_type} / 数据集 {dataset.data_type})"
        )
    if project.scene_mode != dataset.has_scenes:
        if project.scene_mode:
            return "scene 模式不匹配(scene 项目只能关联 has_scenes=true 的数据集)"
        return "scene 模式不匹配(普通项目只能关联 has_scenes=false 的数据集)"
    return None


async def dataset_has_scenes(db: AsyncSession, dataset_id: uuid.UUID) -> bool:
    row = await db.execute(
        select(Scene.id).where(Scene.dataset_id == dataset_id).limit(1)
    )
    return row.scalar_one_or_none() is not None
