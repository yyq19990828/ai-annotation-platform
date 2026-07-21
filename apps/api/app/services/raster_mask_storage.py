from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import DatasetItem
from app.db.models.task import Task
from app.services.storage import StorageService, storage_service
from app.utils.raster_mask_gzip import (
    MAX_COMPRESSED_BYTES,
    compress_mask_gzip,
    decompress_mask_gzip,
)
from app.utils.raster_mask_rle import validate_coco_rle

MAX_RLE_OBJECT_BYTES = 4 * 1024 * 1024
RLE_OBJECT_PREFIX = "raster-masks/sha256"

# v0.23.5 · ADR-0052 §D6 · encoding markers carried inside ``coco_rle_ref``
# (additive — legacy uncompressed ``.json`` refs keep ``encoding="coco_rle_ref"``).
COCO_RLE_REF_ENCODING = "coco_rle_ref"
COCO_RLE_GZIP_ENCODING = "coco_rle_gzip"


def _mask_references(value: Any) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = []
    if isinstance(value, dict):
        key = value.get("object_key")
        if isinstance(key, str) and key.startswith(f"{RLE_OBJECT_PREFIX}/"):
            references.append(value)
        for child in value.values():
            references.extend(_mask_references(child))
    elif isinstance(value, list):
        for child in value:
            references.extend(_mask_references(child))
    return references


async def lock_raster_mask_references(
    db: AsyncSession,
    value: Any,
    *,
    verify: bool = True,
) -> list[str]:
    """Serialize reference commits with GC until the current DB transaction ends."""
    references = {
        str(reference["object_key"]): reference for reference in _mask_references(value)
    }
    for key in sorted(references):
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"aap:raster-mask:{key}"},
        )
        if verify:
            await load_coco_rle(references[key])
    return sorted(references)


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
        raise ValueError(
            "source video width / height metadata is required for mask tracks"
        )
    expected_size = [int(height), int(width)]
    for keyframe in geometry.get("keyframes") or []:
        mask = keyframe.get("mask") or {}
        if list(mask.get("size") or []) != expected_size:
            raise ValueError(f"mask size must match source video {expected_size}")
        frame_index = keyframe.get("frame_index")
        if frame_count is not None and int(frame_index) >= int(frame_count):
            raise ValueError(
                f"mask frame_index must be < source frame_count {frame_count}"
            )
    if frame_count is not None:
        for outside in geometry.get("outside") or []:
            if int(outside.get("to", 0)) >= int(frame_count):
                raise ValueError(
                    f"outside range must be within source frame_count {frame_count}"
                )


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


def canonical_rle_bytes_gzip(rle: dict[str, Any]) -> tuple[bytes, bytes]:
    """v0.23.5 · ADR-0052 §D6 · canonical bytes + gzip wrapper.

    SHA-256 is taken over the **uncompressed canonical bytes** (``data``) so
    that the digest matches the legacy uncompressed ``.json`` path; only the
    stored bytes are gzipped (``gzip_bytes``). Returning both keeps callers
    from re-deriving either side and lets the byte-count / sha checks in
    ``load_coco_rle`` operate on identical canonical content regardless of
    transport.
    """
    data = canonical_rle_bytes(rle)
    gzip_bytes = compress_mask_gzip(data)
    if len(gzip_bytes) > MAX_COMPRESSED_BYTES:
        # Compressed bytes are capped so a decompressor never has to read more
        # than ``MAX_COMPRESSED_BYTES`` before it can reject a payload.
        raise ValueError("mask RLE gzip payload exceeds MAX_COMPRESSED_BYTES")
    return data, gzip_bytes


def rle_object_key(digest: str) -> str:
    return f"{RLE_OBJECT_PREFIX}/{digest[:2]}/{digest[2:4]}/{digest}.json"


def rle_gzip_object_key(digest: str) -> str:
    """v0.23.5 · ADR-0052 §D6 · ``.json.gz`` content-addressed key (same digest)."""
    return f"{RLE_OBJECT_PREFIX}/{digest[:2]}/{digest[2:4]}/{digest}.json.gz"


def build_rle_reference(rle: dict[str, Any]) -> dict[str, Any]:
    data = canonical_rle_bytes(rle)
    digest = hashlib.sha256(data).hexdigest()
    height, width, counts = validate_coco_rle(rle)
    return {
        "encoding": COCO_RLE_REF_ENCODING,
        "size": [height, width],
        "object_key": rle_object_key(digest),
        "sha256": digest,
        "runs": len(counts),
        "bytes": len(data),
    }


def build_rle_gzip_reference(rle: dict[str, Any]) -> dict[str, Any]:
    """v0.23.5 · ADR-0052 §D6 · gzip variant of :func:`build_rle_reference`.

    ``object_key`` ends in ``.json.gz`` and ``encoding`` flips to
    ``coco_rle_gzip``; ``sha256`` / ``bytes`` / ``runs`` / ``size`` are
    identical to the uncompressed reference (the digest is over the
    **uncompressed** canonical bytes, ``bytes`` is the uncompressed length).
    """
    data, _gzip_bytes = canonical_rle_bytes_gzip(rle)
    digest = hashlib.sha256(data).hexdigest()
    height, width, counts = validate_coco_rle(rle)
    return {
        "encoding": COCO_RLE_GZIP_ENCODING,
        "size": [height, width],
        "object_key": rle_gzip_object_key(digest),
        "sha256": digest,
        "runs": len(counts),
        "bytes": len(data),
    }


def _put_object_sync(
    storage: StorageService, *, key: str, body: bytes, content_type: str
) -> None:
    """Sync boto3 put wrapped so both the async and sync helpers share one path."""
    if storage.verify_upload(key) is None:
        storage.client.put_object(
            Bucket=storage.bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
        )


def _get_object_sync(
    storage: StorageService, *, key: str
) -> bytes:
    """Sync boto3 get; reads up to ``MAX_RLE_OBJECT_BYTES + 1`` to bound memory."""
    response = storage.client.get_object(Bucket=storage.bucket, Key=key)
    try:
        data = response["Body"].read(MAX_RLE_OBJECT_BYTES + 1)
    finally:
        response["Body"].close()
    return data


def store_coco_rle_sync(
    rle: dict[str, Any], *, storage: StorageService = storage_service
) -> dict[str, Any]:
    """Sync storage path retained for non-async callers (workers / sync imports).

    Most call sites are async and should ``await store_coco_rle(...)`` instead;
    the async wrapper delegates the heavy lifting here through ``to_thread``.
    """
    data = canonical_rle_bytes(rle)
    reference = build_rle_reference(rle)
    _put_object_sync(
        storage,
        key=reference["object_key"],
        body=data,
        content_type="application/json",
    )
    return reference


async def store_coco_rle(
    rle: dict[str, Any], *, storage: StorageService = storage_service
) -> dict[str, Any]:
    """Async wrapper of :func:`store_coco_rle_sync` (boto3 I/O in ``to_thread``)."""
    return await asyncio.to_thread(store_coco_rle_sync, rle, storage=storage)


def store_coco_rle_gzip_sync(
    rle: dict[str, Any], *, storage: StorageService = storage_service
) -> dict[str, Any]:
    """Sync gzip storage path (see ``store_coco_rle_gzip`` for the async entry)."""
    data, gzip_bytes = canonical_rle_bytes_gzip(rle)
    reference = build_rle_gzip_reference(rle)
    _put_object_sync(
        storage,
        key=reference["object_key"],
        body=gzip_bytes,
        content_type="application/gzip",
    )
    # ``bytes`` must reflect uncompressed canonical length (ADR-0052 §D6); the
    # reference is already built that way, so no override is needed here.
    return reference


async def store_coco_rle_gzip(
    rle: dict[str, Any], *, storage: StorageService = storage_service
) -> dict[str, Any]:
    """Async gzip storage entry (boto3 I/O in ``to_thread``).

    Stores the ``.json.gz`` body and returns a reference with
    ``encoding == "coco_rle_gzip"``; ``object_key`` / ``sha256`` / ``runs`` /
    ``bytes`` / ``size`` are schema-identical to the uncompressed
    ``coco_rle_ref`` (``bytes`` = uncompressed canonical length).
    """
    return await asyncio.to_thread(store_coco_rle_gzip_sync, rle, storage=storage)


def load_coco_rle_sync(
    reference: dict[str, Any], *, storage: StorageService = storage_service
) -> dict[str, Any]:
    """Sync load path: handles legacy ``.json`` and new ``.json.gz`` keys.

    All digest / byte-count / run / size checks operate on the **decompressed
    canonical bytes**, so behavior is identical regardless of transport.
    """
    key = str(reference["object_key"])
    raw = _get_object_sync(storage, key=key)
    if key.endswith(".json.gz"):
        data = decompress_mask_gzip(
            raw,
            max_compressed=MAX_COMPRESSED_BYTES,
            max_uncompressed=MAX_RLE_OBJECT_BYTES,
        )
    else:
        if len(raw) > MAX_RLE_OBJECT_BYTES:
            raise ValueError("stored mask RLE exceeds 4 MiB")
        data = raw
    if len(data) > MAX_RLE_OBJECT_BYTES:
        raise ValueError("stored mask RLE exceeds 4 MiB")
    digest = hashlib.sha256(data).hexdigest()
    expected_key = (
        rle_gzip_object_key(digest)
        if key.endswith(".json.gz")
        else rle_object_key(digest)
    )
    if digest != reference.get("sha256") or key != expected_key:
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


async def load_coco_rle(
    reference: dict[str, Any], *, storage: StorageService = storage_service
) -> dict[str, Any]:
    """Async wrapper of :func:`load_coco_rle_sync` (boto3 I/O in ``to_thread``)."""
    return await asyncio.to_thread(load_coco_rle_sync, reference, storage=storage)
