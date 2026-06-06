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
    per_camera: list[dict]
    agreement: float


# 侧 / 后方位词:出现任一即说明这不是「正对车头」的相机,sniff 假设会失真。
_SIDE_BACK_TOKENS = ("left", "right", "back", "rear")


def _is_front_role(role: str | None, item: DatasetItem) -> bool:
    """是否为 *canonical* 正前相机(光轴≈车头前向,sniff 唯一可信的相机)。

    必须含 front/forward 且 **不含** left/right/back/rear——否则像 nuScenes 的
    CAM_FRONT_LEFT / CAM_FRONT_RIGHT 也含 "front",会被误当正前,推断偏到错误约定
    (实测:CAM_FRONT_RIGHT 把 apollo 误判成 iso_8855)。
    """
    haystack = " ".join(
        part
        for part in [
            role or "",
            item.file_name or "",
            item.file_path or "",
        ]
        if part
    ).lower()
    if "front" not in haystack and "forward" not in haystack:
        return False
    return not any(tok in haystack for tok in _SIDE_BACK_TOKENS)


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

        # 逐相机评估(只有带标定 + 能推出约定的留下)。
        evaluated: list[tuple[AxisSniffObservation, dict]] = []
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
            evaluated.append((obs, result))
        if not evaluated:
            return None

        per_camera_entries = self._best_per_camera(evaluated)
        per_camera = [
            {
                "camera_role": obs.camera_role,
                "best": str(result["best"]),
                "score": float(result["score"]),
            }
            for obs, result in sorted(
                per_camera_entries,
                key=lambda e: (
                    not _is_front_role(e[0].camera_role, e[0].item),
                    -float(e[1]["score"]),
                    str(e[0].camera_role or ""),
                ),
            )
        ]

        # 全程确定性,与 DB 行序无关:每条观测一个稳定 key。
        def _stable_key(obs: AxisSniffObservation):
            return (obs.item.created_at, str(obs.item.id))

        fronts = [e for e in evaluated if _is_front_role(e[0].camera_role, e[0].item)]
        if fronts:
            # canonical 正前相机是唯一可信来源:多份(如多 scene 同 CAM_FRONT)装置一致、
            # 推断相同,取分最高、稳定 tiebreak。score 不打折。
            obs, result = min(
                fronts, key=lambda e: (-e[1]["score"], _stable_key(e[0]))
            )
            score_scale = 1.0
        else:
            # 无正前相机:不能只信任一个侧 / 后相机(实测会判错且随顺序漂)。
            # 跨所有相机按各自 best 约定投票取众数,确定性 tiebreak;score 打 0.75 折
            # 表示"非正前、置信偏低"。
            obs, result = self._vote(evaluated, _stable_key)
            score_scale = 0.75

        candidates = [
            {"convention": c["convention"], "score": c["score"] * score_scale}
            for c in result["candidates"]
        ]
        best = candidates[0]
        agreement = (
            sum(1 for row in per_camera if row["best"] == best["convention"])
            / len(per_camera)
        )
        return AxisSniffResult(
            best=str(best["convention"]),
            score=float(best["score"]),
            candidates=candidates,
            source=obs.source,
            camera_role=obs.camera_role,
            camera_item_id=obs.item.id,
            per_camera=per_camera,
            agreement=agreement,
        )

    @staticmethod
    def _best_per_camera(
        evaluated: list[tuple[AxisSniffObservation, dict]],
    ) -> list[tuple[AxisSniffObservation, dict]]:
        """Collapse repeated frame observations into one best row per camera role."""
        grouped: dict[str, tuple[AxisSniffObservation, dict]] = {}
        for obs, result in evaluated:
            key = obs.camera_role or str(obs.item.id)
            current = grouped.get(key)
            if current is None:
                grouped[key] = (obs, result)
                continue
            cur_obs, cur_result = current
            cur_key = (
                float(cur_result["score"]),
                cur_obs.item.created_at,
                str(cur_obs.item.id),
            )
            next_key = (
                float(result["score"]),
                obs.item.created_at,
                str(obs.item.id),
            )
            if next_key > cur_key:
                grouped[key] = (obs, result)
        return list(grouped.values())

    @staticmethod
    def _vote(
        evaluated: list[tuple[AxisSniffObservation, dict]],
        stable_key,
    ) -> tuple[AxisSniffObservation, dict]:
        """无正前相机时的确定性兜底:按 best 约定投票取众数。

        票数最多者胜;并列时取该组总分高者、再按约定名;最后在胜出约定内取分最高、
        稳定 tiebreak 的那条观测作代表。"""
        votes: dict[str, int] = {}
        score_sum: dict[str, float] = {}
        for obs, result in evaluated:
            conv = str(result["best"])
            votes[conv] = votes.get(conv, 0) + 1
            score_sum[conv] = score_sum.get(conv, 0.0) + float(result["score"])
        winner = min(
            votes, key=lambda c: (-votes[c], -score_sum[c], c)
        )
        return min(
            (e for e in evaluated if str(e[1]["best"]) == winner),
            key=lambda e: (-e[1]["score"], stable_key(e[0])),
        )

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
        # 仅看相机图（file_type=="image"）。点云项可能在 metadata 里带 lidar→ego
        # 外参，若混进来会被 sniff_convention_from_forward 当成相机光轴污染推断。
        # 与 _linked_camera_observations 仅取 role.startswith("camera_") 对齐。
        items = (
            (
                await self.db.execute(
                    select(DatasetItem)
                    .where(DatasetItem.dataset_id == dataset_id)
                    .where(DatasetItem.file_type == "image")
                    .order_by(DatasetItem.created_at)
                )
            )
            .scalars()
            .all()
        )
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
