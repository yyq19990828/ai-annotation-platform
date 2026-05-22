from __future__ import annotations

import argparse
import asyncio
import tempfile
import uuid
from pathlib import Path
from typing import Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import async_session, engine
from app.db.models.dataset import DatasetItem, VideoFrameIndex
from app.services.storage import StorageService
from app.services.video_frame_service import (
    select_sparse_anchor_rows,
    source_key_for_item,
)
from app.workers.media import probe_video_frame_timetable


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rebuild video_frame_indices for existing video dataset items.",
    )
    parser.add_argument(
        "--dataset-item-id",
        action="append",
        default=[],
        help="Video DatasetItem UUID. Can be passed multiple times.",
    )
    parser.add_argument("--dataset-id", help="Dataset UUID containing video items.")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Rebuild all video dataset items.",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--sparse-stride",
        type=int,
        default=1,
        help=(
            "长视频 sparse timetable: 每隔 N 帧存一个 pts_ms 锚点 (+ 所有关键帧), "
            "中间帧由相邻锚点线性插值。默认 1 = 全帧 (不 sparse)。"
        ),
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--keep-going", action="store_true")
    return parser


def _parse_uuid(raw: str, flag: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise SystemExit(f"{flag} must be a UUID: {raw}") from exc


async def select_video_items(
    db: AsyncSession,
    *,
    dataset_item_ids: Sequence[uuid.UUID],
    dataset_id: uuid.UUID | None,
    all_items: bool,
    limit: int | None,
) -> list[DatasetItem]:
    selectors = sum([bool(dataset_item_ids), dataset_id is not None, all_items])
    if selectors != 1:
        raise SystemExit(
            "Pass exactly one selector: --dataset-item-id, --dataset-id, or --all"
        )

    stmt = select(DatasetItem).where(DatasetItem.file_type == "video")
    if dataset_item_ids:
        stmt = stmt.where(DatasetItem.id.in_(dataset_item_ids))
    elif dataset_id is not None:
        stmt = stmt.where(DatasetItem.dataset_id == dataset_id)
    stmt = stmt.order_by(DatasetItem.created_at.asc())
    if limit is not None:
        stmt = stmt.limit(max(0, limit))
    return (await db.execute(stmt)).scalars().all()


async def rebuild_item_timetable(
    db: AsyncSession,
    item: DatasetItem,
    *,
    storage: StorageService | None = None,
    dry_run: bool = False,
    sparse_stride: int = 1,
) -> int:
    storage = storage or StorageService()
    meta = dict(item.metadata_ or {})
    video_meta = dict(meta.get("video") or {})
    source_key = source_key_for_item(item)

    with tempfile.TemporaryDirectory(prefix="anno-video-timetable-") as tmp:
        suffix = Path(item.file_name).suffix or ".mp4"
        input_path = Path(tmp) / f"source{suffix}"
        with input_path.open("wb") as fh:
            storage.client.download_fileobj(
                Bucket=storage.bucket_for_cache_key(source_key),
                Key=source_key,
                Fileobj=fh,
            )
        rows = probe_video_frame_timetable(input_path)

    # sparse: 只持久化锚点行 (+ 关键帧)。frame_timetable_frame_count 仍记录源视频
    # 总帧数, 中间帧的 pts_ms 在读取时由相邻锚点插值/估算补齐 (对外语义不变)。
    total_frames = len(rows)
    persisted_rows = select_sparse_anchor_rows(rows, sparse_stride)

    if dry_run:
        return len(persisted_rows)

    await db.execute(
        delete(VideoFrameIndex).where(VideoFrameIndex.dataset_item_id == item.id)
    )
    db.add_all(
        [
            VideoFrameIndex(
                dataset_item_id=item.id,
                frame_index=row["frame_index"],
                pts_ms=row["pts_ms"],
                is_keyframe=row["is_keyframe"],
                pict_type=row.get("pict_type"),
                byte_offset=row.get("byte_offset"),
            )
            for row in persisted_rows
        ]
    )
    video_meta["frame_timetable_frame_count"] = total_frames
    video_meta.pop("frame_timetable_error", None)
    meta["video"] = video_meta
    item.metadata_ = meta
    await db.commit()
    return len(persisted_rows)


async def _mark_item_error(db: AsyncSession, item: DatasetItem, error: str) -> None:
    meta = dict(item.metadata_ or {})
    video_meta = dict(meta.get("video") or {})
    video_meta["frame_timetable_error"] = error
    meta["video"] = video_meta
    item.metadata_ = meta
    await db.commit()


async def async_main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    dataset_item_ids = [
        _parse_uuid(raw, "--dataset-item-id") for raw in args.dataset_item_id
    ]
    dataset_id = (
        _parse_uuid(args.dataset_id, "--dataset-id") if args.dataset_id else None
    )

    async with async_session() as db:
        items = await select_video_items(
            db,
            dataset_item_ids=dataset_item_ids,
            dataset_id=dataset_id,
            all_items=args.all,
            limit=args.limit,
        )
        failures = 0
        for item in items:
            try:
                count = await rebuild_item_timetable(
                    db, item, dry_run=args.dry_run, sparse_stride=args.sparse_stride
                )
                prefix = "would rebuild" if args.dry_run else "rebuilt"
                suffix = " (sparse)" if args.sparse_stride > 1 else ""
                print(f"{prefix} {item.id}: {count} anchor rows{suffix}")
            except Exception as exc:
                failures += 1
                await db.rollback()
                if not args.dry_run:
                    await _mark_item_error(db, item, str(exc))
                print(f"failed {item.id}: {exc}")
                if not args.keep_going:
                    break

    await engine.dispose()
    return 1 if failures else 0


def main() -> None:
    raise SystemExit(asyncio.run(async_main()))


if __name__ == "__main__":
    main()
