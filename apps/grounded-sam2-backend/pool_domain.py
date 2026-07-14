"""One lifecycle domain over Grounded-SAM2's independent image and video pools."""

from __future__ import annotations

from typing import Any, Literal

from model_pool import ModelPool
from video_pool import VideoPool

PoolId = Literal["image", "video"]


class GroundedSam2Pools:
    """Aggregate two logical LRUs without hiding either physical residency."""

    def __init__(self, image: ModelPool, video: VideoPool) -> None:
        self.image = image
        self.video = video

    async def snapshot_for(self, pool_id: PoolId) -> dict[str, Any]:
        if pool_id == "image":
            return await self.image.snapshot()
        if pool_id == "video":
            return await self.video.snapshot()
        raise ValueError(f"unsupported pool: {pool_id}")

    async def snapshot(self) -> dict[str, Any]:
        image = await self.image.snapshot()
        video = await self.video.snapshot()
        resident_values = (image["gpu_resident"], video["gpu_resident"])
        if True in resident_values:
            gpu_resident: bool | None = True
        elif resident_values == (False, False):
            gpu_resident = False
        else:
            gpu_resident = None

        devices = {
            value
            for value in (image.get("device"), video.get("device"))
            if value is not None
        }
        return {
            "cap": image["cap"] + video["cap"],
            "current_size": image["current_size"] + video["current_size"],
            "loaded_keys": [
                *(
                    {**item, "key": f"image:{item['key']}"}
                    for item in image["loaded_keys"]
                ),
                *(
                    {**item, "key": f"video:{item['key']}"}
                    for item in video["loaded_keys"]
                ),
            ],
            "last_evict": None,
            "builders": image["builders"] + video["builders"],
            "reserved_build_slots": (
                image["reserved_build_slots"] + video["reserved_build_slots"]
            ),
            "borrowers": image["borrowers"] + video["borrowers"],
            "waiters": image["waiters"] + video["waiters"],
            "cleanup_in_progress": (
                image["cleanup_in_progress"] or video["cleanup_in_progress"]
            ),
            "cleanup_failed": image["cleanup_failed"] or video["cleanup_failed"],
            "gpu_resident": gpu_resident,
            "device": next(iter(devices)) if len(devices) == 1 else None,
            "provider": None,
            "active_sessions": video["active_sessions"],
            "pools": {"image": image, "video": video},
        }

    async def unload_all(
        self,
        *,
        reason: str = "manual",
        force_cleanup: bool = False,
    ) -> int:
        count = 0
        errors: list[BaseException] = []
        for pool in (self.image, self.video):
            try:
                count += await pool.unload_all(
                    reason=reason,
                    force_cleanup=force_cleanup,
                )
            except BaseException as exc:
                errors.append(exc)
        if errors:
            raise errors[0]
        return count

    async def unload_legacy_image(self) -> tuple[bool, bool]:
        count = await self.image.unload_all(
            reason="manual",
            force_cleanup=True,
        )
        snapshot = await self.image.snapshot()
        return count > 0, snapshot["current_size"] > 0

    async def unload_idle(self, pool_id: PoolId, *, idle_before: float) -> int:
        if pool_id == "image":
            return await self.image.unload_idle(idle_before=idle_before)
        if pool_id == "video":
            return await self.video.unload_idle(idle_before=idle_before)
        raise ValueError(f"unsupported pool: {pool_id}")

    async def shutdown(self) -> None:
        errors: list[BaseException] = []
        for pool in (self.image, self.video):
            try:
                await pool.shutdown()
            except BaseException as exc:
                errors.append(exc)
        if errors:
            raise errors[0]


__all__ = ["GroundedSam2Pools", "PoolId"]
