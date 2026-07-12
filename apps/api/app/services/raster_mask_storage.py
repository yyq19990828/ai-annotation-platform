from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import DatasetItem
from app.db.models.task import Task
from app.services.storage import StorageService, storage_service
from app.utils.raster_mask_rle import validate_coco_rle

MAX_RLE_OBJECT_BYTES = 4 * 1024 * 1024
RLE_OBJECT_PREFIX = "raster-masks/sha256"


async def validate_mask_geometry_for_task(
    db: AsyncSession,
    task: Task,
    geometry: dict[str, Any],
) -> None:
    if geometry.get("type") != "video_track_mask":
        return
    if task.dataset_item_id is None:
        raise ValueError("video mask track requires a primary dataset item")
    item = await db.get(DatasetItem, task.dataset_item_id)
    if item is None or item.file_type != "video":
        raise ValueError("video mask track requires a video dataset item")
    video = (item.metadata_ or {}).get("video")
    video = video if isinstance(video, dict) else {}
    width = item.width or video.get("width")
    height = item.height or video.get("height")
    frame_count = video.get("frame_count")
    if not width or not height:
        raise ValueError("source video width / height metadata is required for mask tracks")
    expected_size = [int(height), int(width)]
    for keyframe in geometry.get("keyframes") or []:
        mask = keyframe.get("mask") or {}
        if list(mask.get("size") or []) != expected_size:
            raise ValueError(f"mask size must match source video {expected_size}")
        frame_index = keyframe.get("frame_index")
        if frame_count is not None and int(frame_index) >= int(frame_count):
            raise ValueError(f"mask frame_index must be < source frame_count {frame_count}")
    if frame_count is not None:
        for outside in geometry.get("outside") or []:
            if int(outside.get("to", 0)) >= int(frame_count):
                raise ValueError(f"outside range must be within source frame_count {frame_count}")


def canonical_rle_bytes(rle: dict[str, Any]) -> bytes:
    height, width, counts = validate_coco_rle(rle)
    payload = {
        "encoding": "coco_rle",
        "size": [height, width],
        "counts": counts,
    }
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    if len(data) > MAX_RLE_OBJECT_BYTES:
        raise ValueError("mask RLE canonical JSON must be <= 4 MiB")
    return data


def rle_object_key(digest: str) -> str:
    return f"{RLE_OBJECT_PREFIX}/{digest[:2]}/{digest[2:4]}/{digest}.json"


def build_rle_reference(rle: dict[str, Any]) -> dict[str, Any]:
    data = canonical_rle_bytes(rle)
    digest = hashlib.sha256(data).hexdigest()
    height, width, counts = validate_coco_rle(rle)
    return {
        "encoding": "coco_rle_ref",
        "size": [height, width],
        "object_key": rle_object_key(digest),
        "sha256": digest,
        "runs": len(counts),
        "bytes": len(data),
    }


def store_coco_rle(
    rle: dict[str, Any], *, storage: StorageService = storage_service
) -> dict[str, Any]:
    data = canonical_rle_bytes(rle)
    reference = build_rle_reference(rle)
    key = reference["object_key"]
    if storage.verify_upload(key) is None:
        storage.client.put_object(
            Bucket=storage.bucket,
            Key=key,
            Body=data,
            ContentType="application/json",
        )
    return reference


def load_coco_rle(
    reference: dict[str, Any], *, storage: StorageService = storage_service
) -> dict[str, Any]:
    key = str(reference["object_key"])
    response = storage.client.get_object(Bucket=storage.bucket, Key=key)
    try:
        data = response["Body"].read(MAX_RLE_OBJECT_BYTES + 1)
    finally:
        response["Body"].close()
    if len(data) > MAX_RLE_OBJECT_BYTES:
        raise ValueError("stored mask RLE exceeds 4 MiB")
    digest = hashlib.sha256(data).hexdigest()
    if digest != reference.get("sha256") or key != rle_object_key(digest):
        raise ValueError("stored mask RLE digest mismatch")
    if len(data) != reference.get("bytes"):
        raise ValueError("stored mask RLE byte count mismatch")
    payload = json.loads(data)
    height, width, counts = validate_coco_rle(payload)
    if [height, width] != list(reference.get("size") or []):
        raise ValueError("stored mask RLE size mismatch")
    if len(counts) != reference.get("runs"):
        raise ValueError("stored mask RLE run count mismatch")
    return payload
