"""Dataset-level LiDAR axis convention sniffing."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import DatasetItem
from app.db.models.task_dataset_item_link import TaskDatasetItemLink
from app.schemas._jsonb_types import SensorCalibration
from app.services.axis_convention import sniff_convention_from_forward

SniffSource = Literal["task_link", "dataset_item"]


@dataclass(frozen=True)
class AxisSniffObservation:
    item: DatasetItem
    source: SniffSource
    camera_role: str | None


@dataclass(frozen=True)
class AxisSniffResult:
    best: str
    score: float
    candidates: list[dict]
    source: SniffSource
    camera_role: str | None
    camera_item_id: uuid.UUID


def _is_front_role(role: str | None, item: DatasetItem) -> bool:
    haystack = " ".join(
        part
        for part in [
            role or "",
            item.file_name or "",
            item.file_path or "",
        ]
        if part
    ).lower()
    return "front" in haystack or "camera_front" in haystack


def _camera_name_from_path(item: DatasetItem) -> str | None:
    parts = PurePosixPath(item.file_path or item.file_name).parts
    for i in range(len(parts) - 1, -1, -1):
        if parts[i] == "camera" and i + 1 < len(parts):
            return parts[i + 1]
    return None


def _calibration_for(item: DatasetItem) -> SensorCalibration | None:
    raw = (item.metadata_ or {}).get("calibration")
    if not raw:
        return None
    try:
        return SensorCalibration.model_validate(raw)
    except Exception:
        return None


class AxisSnifferService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def sniff_dataset(self, dataset_id: uuid.UUID) -> AxisSniffResult | None:
        observations = await self._linked_camera_observations(dataset_id)
        if not observations:
            observations = await self._dataset_item_observations(dataset_id)

        observations.sort(
            key=lambda obs: (
                0 if _is_front_role(obs.camera_role, obs.item) else 1,
                obs.item.created_at,
            )
        )
        for obs in observations:
            calib = _calibration_for(obs.item)
            if calib is None:
                continue
            result = sniff_convention_from_forward(
                float(calib.extrinsic[8]),
                float(calib.extrinsic[9]),
                float(calib.extrinsic[10]),
            )
            if result is None:
                continue
            front = _is_front_role(obs.camera_role, obs.item)
            score_scale = 1.0 if front else 0.75
            candidates = [
                {
                    "convention": c["convention"],
                    "score": c["score"] * score_scale,
                }
                for c in result["candidates"]
            ]
            best = candidates[0]
            return AxisSniffResult(
                best=str(best["convention"]),
                score=float(best["score"]),
                candidates=candidates,
                source=obs.source,
                camera_role=obs.camera_role,
                camera_item_id=obs.item.id,
            )
        return None

    async def _linked_camera_observations(
        self,
        dataset_id: uuid.UUID,
    ) -> list[AxisSniffObservation]:
        rows = (
            await self.db.execute(
                select(TaskDatasetItemLink, DatasetItem)
                .join(
                    DatasetItem,
                    DatasetItem.id == TaskDatasetItemLink.dataset_item_id,
                )
                .where(DatasetItem.dataset_id == dataset_id)
                .where(TaskDatasetItemLink.role.startswith("camera_"))
            )
        ).all()
        return [
            AxisSniffObservation(item=item, source="task_link", camera_role=link.role)
            for link, item in rows
        ]

    async def _dataset_item_observations(
        self,
        dataset_id: uuid.UUID,
    ) -> list[AxisSniffObservation]:
        items = (
            await self.db.execute(
                select(DatasetItem)
                .where(DatasetItem.dataset_id == dataset_id)
                .order_by(DatasetItem.created_at)
            )
        ).scalars().all()
        out: list[AxisSniffObservation] = []
        for item in items:
            if _calibration_for(item) is None:
                continue
            name = _camera_name_from_path(item)
            out.append(
                AxisSniffObservation(
                    item=item,
                    source="dataset_item",
                    camera_role=f"camera_{name}" if name else None,
                )
            )
        return out
