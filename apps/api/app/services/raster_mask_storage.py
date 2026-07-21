from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any

from botocore.exceptions import ClientError
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import DatasetItem
from app.db.models.project import Project
from app.db.models.raster_mask_upload import RasterMaskUpload
from app.db.models.task import Task
from app.services.raster_mask_capabilities import evaluate_raster_mask_capabilities
from app.services.storage import StorageService, storage_service
from app.utils.raster_mask_gzip import (
    MAX_COMPRESSED_BYTES,
    MAX_EXPANSION_RATIO,
    compress_mask_gzip,
    decompress_mask_gzip,
)
from app.utils.raster_mask_rle import coco_rle_area, validate_coco_rle

MAX_RLE_OBJECT_BYTES = 4 * 1024 * 1024
RLE_OBJECT_PREFIX = "raster-masks/sha256"

# v0.23.5 · ADR-0052 §D6 · encoding markers carried inside ``coco_rle_ref``
# (additive — legacy uncompressed ``.json`` refs keep ``encoding="coco_rle_ref"``).
COCO_RLE_REF_ENCODING = "coco_rle_ref"
COCO_RLE_GZIP_ENCODING = "coco_rle_gzip"  # legacy request/reference marker
RLE_STORAGE_IDENTITY = "identity"
RLE_STORAGE_GZIP = "gzip"


class RasterMaskContractError(ValueError):
    """Stable API-facing rejection raised at the mask persistence boundary."""

    def __init__(self, *, status_code: int, reason: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.detail = {"reason": reason, "message": message}


def assert_raster_mask_write_enabled(project: Project | None) -> None:
    capabilities = evaluate_raster_mask_capabilities(project)
    if not capabilities.write_enabled:
        raise RasterMaskContractError(
            status_code=409,
            reason="raster_mask_create_disabled",
            message="raster mask creation is disabled",
        )


def _rle_has_foreground(rle: dict[str, Any]) -> bool:
    return coco_rle_area(rle) > 0


def collect_mask_references(value: Any) -> list[dict[str, Any]]:
    """Collect every content-addressed RLE reference from a nested payload."""
    references: list[dict[str, Any]] = []
    if isinstance(value, dict):
        key = value.get("object_key")
        if isinstance(key, str) and key.startswith(f"{RLE_OBJECT_PREFIX}/"):
            references.append(value)
        for child in value.values():
            references.extend(collect_mask_references(child))
    elif isinstance(value, list):
        for child in value:
            references.extend(collect_mask_references(child))
    return references


def collect_mask_geometries(value: Any) -> list[dict[str, Any]]:
    """Collect persisted mask geometry objects from a nested write payload."""
    geometries: list[dict[str, Any]] = []
    if isinstance(value, dict):
        geometry_type = value.get("type")
        if geometry_type == "raster_mask" and (
            "mask" in value or "geometry" not in value
        ):
            geometries.append(value)
            return geometries
        if geometry_type == "video_track_mask" and (
            "keyframes" in value or "geometry" not in value
        ):
            geometries.append(value)
            return geometries
        for child in value.values():
            geometries.extend(collect_mask_geometries(child))
    elif isinstance(value, list):
        for child in value:
            geometries.extend(collect_mask_geometries(child))
    return geometries


def resolve_mask_reference_objects(
    value: Any,
    mask_objects: dict[str, dict[str, Any]],
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Resolve and validate portable RLE objects, deduplicated by object key."""
    resolved: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    for reference in collect_mask_references(value):
        digest = reference.get("sha256")
        rle = mask_objects.get(str(digest))
        if rle is None:
            raise ValueError(f"AAP mask_objects missing sha256 {digest}")
        validate_reference_for_rle(reference, rle)
        resolved.setdefault(str(reference["object_key"]), (reference, rle))
    return list(resolved.values())


async def lock_raster_mask_references(
    db: AsyncSession,
    value: Any,
    *,
    verify: bool = True,
    task_id: Any | None = None,
    require_raster_foreground: bool = False,
) -> list[str]:
    """Serialize reference commits with GC until the current DB transaction ends."""
    references = {
        str(reference["object_key"]): reference
        for reference in collect_mask_references(value)
    }
    for key in sorted(references):
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"aap:raster-mask:{key}"},
        )
        if verify:
            payload = await load_coco_rle(references[key])
            if (
                require_raster_foreground
                and value.get("type") == "raster_mask"
                and key == str((value.get("mask") or {}).get("object_key"))
                and not _rle_has_foreground(payload)
            ):
                raise RasterMaskContractError(
                    status_code=422,
                    reason="raster_mask_empty_foreground",
                    message="raster mask annotation must contain foreground pixels",
                )
    if task_id is not None and references:
        await db.execute(
            update(RasterMaskUpload)
            .where(
                RasterMaskUpload.task_id == task_id,
                RasterMaskUpload.object_key.in_(sorted(references)),
                RasterMaskUpload.linked_at.is_(None),
            )
            .values(linked_at=func.now())
        )
    return sorted(references)


async def store_mask_reference_objects(
    db: AsyncSession,
    value: Any,
    resolved: list[tuple[dict[str, Any], dict[str, Any]]],
    *,
    task_id: Any,
) -> None:
    """Store portable objects before linking their references to a DB row."""
    if not resolved:
        await lock_raster_mask_references(db, value, task_id=task_id)
        return
    await lock_raster_mask_references(db, value, verify=False)
    for reference, rle in resolved:
        if str(reference.get("object_key") or "").endswith(".json.gz"):
            stored = await store_coco_rle_gzip(rle)
        else:
            stored = await store_coco_rle(rle)
        if stored["object_key"] != reference.get("object_key"):
            raise ValueError("AAP mask object storage does not match reference")
    await lock_raster_mask_references(db, value, task_id=task_id)


async def reserve_raster_mask_upload(
    db: AsyncSession,
    *,
    task_id: Any,
    object_key: str,
    limit: int,
) -> int:
    """Reserve one task-owned anonymous upload under a transaction-scoped lock."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"aap:raster-mask-upload:{task_id}"},
    )
    existing = (
        await db.execute(
            select(RasterMaskUpload).where(
                RasterMaskUpload.task_id == task_id,
                RasterMaskUpload.object_key == object_key,
            )
        )
    ).scalar_one_or_none()
    current = int(
        (
            await db.execute(
                select(func.count(RasterMaskUpload.id)).where(
                    RasterMaskUpload.task_id == task_id,
                    RasterMaskUpload.linked_at.is_(None),
                )
            )
        ).scalar()
        or 0
    )
    if existing is not None:
        return current
    if current >= limit:
        raise ValueError(f"mask orphan quota exceeded ({current}/{limit})")
    db.add(RasterMaskUpload(task_id=task_id, object_key=object_key))
    await db.flush()
    return current + 1


async def validate_mask_geometry_for_task(
    db: AsyncSession,
    task: Task,
    geometry: dict[str, Any],
) -> None:
    """验证掩码几何是否与任务数据集项匹配。

    支持 video_track_mask（视频）和 raster_mask（图片）两种类型。
    """
    geom_type = geometry.get("type")

    if geom_type == "raster_mask":
        # v0.23.6 · 图片掩码验证
        if task.dataset_item_id is None:
            raise RasterMaskContractError(
                status_code=422,
                reason="raster_mask_dataset_item_required",
                message="raster mask requires a primary dataset item",
            )
        item = await db.get(DatasetItem, task.dataset_item_id)
        if item is None or item.file_type != "image":
            raise RasterMaskContractError(
                status_code=422,
                reason="raster_mask_image_required",
                message="raster mask requires an image dataset item",
            )
        width = item.width
        height = item.height
        if not width or not height:
            raise RasterMaskContractError(
                status_code=409,
                reason="raster_mask_source_dimensions_missing",
                message=(
                    "source image width / height metadata is required for raster mask"
                ),
            )
        expected_size = [int(height), int(width)]
        mask = geometry.get("mask") or {}
        if list(mask.get("size") or []) != expected_size:
            raise RasterMaskContractError(
                status_code=422,
                reason="raster_mask_size_mismatch",
                message=f"mask size must match source image {expected_size}",
            )
        return

    if geom_type == "video_track_mask":
        # 视频掩码验证（原有逻辑）
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
        return

    # 其他几何类型不需要验证
    return


async def prepare_mask_payload_for_write(
    db: AsyncSession,
    task: Task | None,
    value: Any,
) -> None:
    """Gate, validate and claim every mask in a nested persistence payload.

    Prediction results wrap their geometry one level below the result item while
    annotation writes pass a geometry directly.  Keeping both paths here prevents
    a new persistence entry point from linking an uploaded object before applying
    the raster-mask create gate and task-context checks.
    """
    geometries = collect_mask_geometries(value)
    if not geometries:
        return

    if task is None:
        raise RasterMaskContractError(
            status_code=409,
            reason="mask_task_context_missing",
            message="mask persistence requires an existing task",
        )

    # Check every image-mask gate before object reads, advisory locks, or upload
    # association. Video mask tracks keep their existing deployment contract.
    if any(geometry.get("type") == "raster_mask" for geometry in geometries):
        project = await db.get(Project, task.project_id)
        assert_raster_mask_write_enabled(project)

    for geometry in geometries:
        try:
            await validate_mask_geometry_for_task(db, task, geometry)
        except RasterMaskContractError:
            raise
        except ValueError as exc:
            raise RasterMaskContractError(
                status_code=422,
                reason="mask_geometry_invalid",
                message=f"mask geometry is invalid: {exc}",
            ) from exc

    # Verify every referenced object before associating any upload with the row.
    # The transaction-scoped advisory locks remain held through the final claim.
    try:
        for geometry in geometries:
            await lock_raster_mask_references(
                db,
                geometry,
                require_raster_foreground=geometry.get("type") == "raster_mask",
            )
        await lock_raster_mask_references(db, value, verify=False, task_id=task.id)
    except RasterMaskContractError:
        raise
    except (KeyError, ValueError) as exc:
        raise RasterMaskContractError(
            status_code=409,
            reason="mask_reference_invalid",
            message=f"mask object is invalid: {exc}",
        ) from exc
    except Exception as exc:
        raise RasterMaskContractError(
            status_code=503,
            reason="mask_storage_unavailable",
            message="mask object storage is unavailable",
        ) from exc


async def prepare_mask_geometry_for_annotation_write(
    db: AsyncSession,
    task: Task | None,
    geometry: dict[str, Any],
) -> None:
    """Backward-compatible direct-geometry wrapper for annotation writes."""
    await prepare_mask_payload_for_write(db, task, geometry)


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

    ``object_key`` ends in ``.json.gz`` and ``storage_encoding`` is ``gzip``;
    reference ``encoding`` remains ``coco_rle_ref``. ``sha256`` / ``bytes`` / ``runs`` / ``size`` are
    identical to the uncompressed reference (the digest is over the
    **uncompressed** canonical bytes, ``bytes`` is the uncompressed length).
    """
    data, gzip_bytes = canonical_rle_bytes_gzip(rle)
    if len(data) > len(gzip_bytes) * MAX_EXPANSION_RATIO:
        raise ValueError("mask RLE exceeds the bounded gzip expansion ratio")
    digest = hashlib.sha256(data).hexdigest()
    height, width, counts = validate_coco_rle(rle)
    return {
        "encoding": COCO_RLE_REF_ENCODING,
        "storage_encoding": RLE_STORAGE_GZIP,
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


def _get_object_sync(storage: StorageService, *, key: str, max_bytes: int) -> bytes:
    """Sync boto3 get with a caller-selected compressed/uncompressed bound."""
    try:
        response = storage.client.get_object(Bucket=storage.bucket, Key=key)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"NoSuchKey", "404", "NotFound"}:
            raise ValueError("stored mask RLE object is missing") from exc
        raise
    try:
        data = response["Body"].read(max_bytes + 1)
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
    # A reference written here must always be readable under the same bounded
    # decompression contract. Highly compressible payloads fall back to JSON.
    if len(data) > len(gzip_bytes) * MAX_EXPANSION_RATIO:
        return store_coco_rle_sync(rle, storage=storage)
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
    raw = _get_object_sync(
        storage,
        key=key,
        max_bytes=(
            MAX_COMPRESSED_BYTES if key.endswith(".json.gz") else MAX_RLE_OBJECT_BYTES
        ),
    )
    storage_encoding = reference.get("storage_encoding")
    gzip_key = key.endswith(".json.gz")
    if storage_encoding not in (None, RLE_STORAGE_IDENTITY, RLE_STORAGE_GZIP):
        raise ValueError("unsupported mask reference storage_encoding")
    if storage_encoding == RLE_STORAGE_GZIP and not gzip_key:
        raise ValueError("gzip mask reference must use .json.gz")
    if storage_encoding == RLE_STORAGE_IDENTITY and gzip_key:
        raise ValueError("identity mask reference must use .json")
    if reference.get("encoding") not in (
        COCO_RLE_REF_ENCODING,
        COCO_RLE_GZIP_ENCODING,
    ):
        raise ValueError("unsupported mask reference encoding")
    if gzip_key:
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


def validate_reference_for_rle(reference: dict[str, Any], rle: dict[str, Any]) -> None:
    """Validate portable AAP object metadata independent of storage encoding."""
    data = canonical_rle_bytes(rle)
    digest = hashlib.sha256(data).hexdigest()
    height, width, counts = validate_coco_rle(rle)
    key = str(reference.get("object_key") or "")
    expected = (
        rle_gzip_object_key(digest)
        if key.endswith(".json.gz")
        else rle_object_key(digest)
    )
    if (
        reference.get("encoding") not in (COCO_RLE_REF_ENCODING, COCO_RLE_GZIP_ENCODING)
        or key != expected
        or reference.get("sha256") != digest
        or list(reference.get("size") or []) != [height, width]
        or reference.get("runs") != len(counts)
        or reference.get("bytes") != len(data)
    ):
        raise ValueError(f"AAP mask object metadata mismatch for sha256 {digest}")
