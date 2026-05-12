import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db, require_roles
from app.db.enums import UserRole
from app.db.models.dataset import DatasetItem, VideoChunk, VideoFrameCache
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.user import User
from app.services.storage import storage_service
from app.schemas.storage import BucketSummary, BucketsResponse

router = APIRouter()

_MEDIA_MANAGERS = (UserRole.SUPER_ADMIN, UserRole.PROJECT_ADMIN)
VideoAssetKind = Literal["probe", "poster", "frame_timetable", "chunk", "frame"]


@router.get("/health")
async def storage_health(_: User = Depends(get_current_user)):
    try:
        storage_service.client.head_bucket(Bucket=storage_service.bucket)
        return {"status": "ok", "bucket": storage_service.bucket}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/buckets", response_model=BucketsResponse)
async def storage_buckets(_: User = Depends(get_current_user)):
    bucket_roles = {
        storage_service.bucket: "annotations",
        storage_service.datasets_bucket: "datasets",
    }
    items: list[BucketSummary] = []
    for b, role in bucket_roles.items():
        summary = storage_service.summarize_bucket(b)
        items.append(BucketSummary(role=role, **summary))

    return BucketsResponse(
        items=items,
        total_object_count=sum(i.object_count for i in items),
        total_size_bytes=sum(i.total_size_bytes for i in items),
    )


class VideoAssetFailureItem(BaseModel):
    asset_key: str
    asset_type: VideoAssetKind
    dataset_item_id: uuid.UUID
    file_name: str
    task_id: uuid.UUID | None = None
    task_display_id: str | None = None
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    error: str
    updated_at: datetime | None = None
    chunk_id: int | None = None
    frame_index: int | None = None
    width: int | None = None
    format: str | None = None


class VideoAssetFailuresResponse(BaseModel):
    items: list[VideoAssetFailureItem]
    total: int
    limit: int
    offset: int


class VideoAssetRetryRequest(BaseModel):
    asset_type: VideoAssetKind
    dataset_item_id: uuid.UUID
    chunk_id: int | None = None
    frame_index: int | None = Field(default=None, ge=0)
    width: int | None = Field(default=None, ge=1, le=4096)
    format: Literal["webp", "jpeg"] | None = None


class VideoAssetRetryResponse(BaseModel):
    status: Literal["queued"]
    asset_type: VideoAssetKind
    dataset_item_id: uuid.UUID


def _task_context(
    task: Task | None, project: Project | None
) -> dict[str, uuid.UUID | str | None]:
    return {
        "task_id": task.id if task else None,
        "task_display_id": task.display_id if task else None,
        "project_id": project.id if project else None,
        "project_name": project.name if project else None,
    }


def _metadata_error_items(
    item: DatasetItem, task: Task | None, project: Project | None
) -> list[VideoAssetFailureItem]:
    video_meta = (item.metadata_ or {}).get("video") or {}
    mapping: list[tuple[VideoAssetKind, str]] = [
        ("probe", "probe_error"),
        ("poster", "poster_error"),
        ("frame_timetable", "frame_timetable_error"),
    ]
    out: list[VideoAssetFailureItem] = []
    for asset_type, field_name in mapping:
        raw_error = video_meta.get(field_name)
        if not raw_error:
            continue
        out.append(
            VideoAssetFailureItem(
                asset_key=f"{item.id}:{asset_type}",
                asset_type=asset_type,
                dataset_item_id=item.id,
                file_name=item.file_name,
                error=str(raw_error),
                updated_at=item.updated_at,
                **_task_context(task, project),
            )
        )
    return out


@router.get("/video-assets/failures", response_model=VideoAssetFailuresResponse)
async def list_video_asset_failures(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_MEDIA_MANAGERS)),
):
    rows = (
        await db.execute(
            select(DatasetItem, Task, Project)
            .outerjoin(Task, Task.dataset_item_id == DatasetItem.id)
            .outerjoin(Project, Project.id == Task.project_id)
            .where(DatasetItem.file_type == "video")
        )
    ).all()

    items_by_key: dict[str, VideoAssetFailureItem] = {}
    for item, task, project in rows:
        for failure in _metadata_error_items(item, task, project):
            items_by_key.setdefault(failure.asset_key, failure)

    chunk_rows = (
        await db.execute(
            select(VideoChunk, DatasetItem, Task, Project)
            .join(DatasetItem, DatasetItem.id == VideoChunk.dataset_item_id)
            .outerjoin(Task, Task.dataset_item_id == DatasetItem.id)
            .outerjoin(Project, Project.id == Task.project_id)
            .where(VideoChunk.status == "failed")
        )
    ).all()
    for chunk, item, task, project in chunk_rows:
        key = f"chunk:{chunk.id}"
        items_by_key.setdefault(
            key,
            VideoAssetFailureItem(
                asset_key=key,
                asset_type="chunk",
                dataset_item_id=item.id,
                file_name=item.file_name,
                error=chunk.error or "Chunk generation failed",
                updated_at=chunk.updated_at,
                chunk_id=chunk.chunk_id,
                **_task_context(task, project),
            ),
        )

    frame_rows = (
        await db.execute(
            select(VideoFrameCache, DatasetItem, Task, Project)
            .join(DatasetItem, DatasetItem.id == VideoFrameCache.dataset_item_id)
            .outerjoin(Task, Task.dataset_item_id == DatasetItem.id)
            .outerjoin(Project, Project.id == Task.project_id)
            .where(VideoFrameCache.status == "failed")
        )
    ).all()
    for frame, item, task, project in frame_rows:
        key = f"frame:{frame.id}"
        items_by_key.setdefault(
            key,
            VideoAssetFailureItem(
                asset_key=key,
                asset_type="frame",
                dataset_item_id=item.id,
                file_name=item.file_name,
                error=frame.error or "Frame extraction failed",
                updated_at=frame.updated_at,
                frame_index=frame.frame_index,
                width=frame.width,
                format=frame.format,
                **_task_context(task, project),
            ),
        )

    items = sorted(
        items_by_key.values(),
        key=lambda it: it.updated_at.timestamp() if it.updated_at else 0,
        reverse=True,
    )
    return VideoAssetFailuresResponse(
        items=items[offset : offset + limit],
        total=len(items),
        limit=limit,
        offset=offset,
    )


@router.post(
    "/video-assets/retry",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=VideoAssetRetryResponse,
)
async def retry_video_asset(
    payload: VideoAssetRetryRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_roles(*_MEDIA_MANAGERS)),
):
    item = await db.get(DatasetItem, payload.dataset_item_id)
    if not item or item.file_type != "video":
        raise HTTPException(status_code=404, detail="Video item not found")

    if payload.asset_type in {"probe", "poster", "frame_timetable"}:
        from app.workers.media import generate_video_metadata

        generate_video_metadata.delay(str(item.id))
        return VideoAssetRetryResponse(
            status="queued", asset_type=payload.asset_type, dataset_item_id=item.id
        )

    if payload.asset_type == "chunk":
        if payload.chunk_id is None:
            raise HTTPException(status_code=400, detail="chunk_id is required")
        row = (
            await db.execute(
                select(VideoChunk).where(
                    VideoChunk.dataset_item_id == item.id,
                    VideoChunk.chunk_id == payload.chunk_id,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Video chunk not found")
        row.status = "pending"
        row.error = None
        await db.commit()
        from app.workers.media import ensure_video_chunks

        ensure_video_chunks.delay(str(item.id), [payload.chunk_id])
        return VideoAssetRetryResponse(
            status="queued", asset_type=payload.asset_type, dataset_item_id=item.id
        )

    if payload.frame_index is None or payload.width is None or payload.format is None:
        raise HTTPException(
            status_code=400,
            detail="frame_index, width and format are required for frame retry",
        )
    row = (
        await db.execute(
            select(VideoFrameCache).where(
                VideoFrameCache.dataset_item_id == item.id,
                VideoFrameCache.frame_index == payload.frame_index,
                VideoFrameCache.width == payload.width,
                VideoFrameCache.format == payload.format,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Video frame cache row not found")
    row.status = "pending"
    row.error = None
    await db.commit()
    from app.workers.media import extract_video_frames

    extract_video_frames.delay(
        str(item.id),
        [
            {
                "frame_index": payload.frame_index,
                "width": payload.width,
                "format": payload.format,
            }
        ],
    )
    return VideoAssetRetryResponse(
        status="queued", asset_type=payload.asset_type, dataset_item_id=item.id
    )
