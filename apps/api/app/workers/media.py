import asyncio
import io
import json
import math
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select

from app.db.models.dataset import DatasetItem, VideoChunk, VideoFrameCache, VideoFrameIndex
from app.observability.metrics import (
    VIDEO_CHUNK_GENERATION_SECONDS,
    VIDEO_FRAME_ASSET_BYTES,
    VIDEO_FRAME_EXTRACTION_SECONDS,
)
from app.schemas.task import VideoMetadata
from app.services.video_frame_service import (
    cache_key_for_chunk,
    cache_key_for_frame,
    metadata_for_item,
    pts_ms_for_frame,
    source_key_for_item,
)
from app.workers.celery_app import celery_app
from app.config import settings

FFPROBE_TIMEOUT_SECONDS = 30
FFMPEG_POSTER_TIMEOUT_SECONDS = 60
FFMPEG_TRANSCODE_TIMEOUT_SECONDS = 600
FFMPEG_CHUNK_TIMEOUT_SECONDS = 180
FFMPEG_FRAME_TIMEOUT_SECONDS = 60
BROWSER_PLAYABLE_VIDEO_CODECS = {"h264", "avc1"}
SMART_COPY_VIDEO_CODECS = {"h264", "avc1", "hevc", "h265"}


def _parse_ratio(value: str | None) -> float | None:
    if not value:
        return None
    if "/" in value:
        num, den = value.split("/", 1)
        try:
            n = float(num)
            d = float(den)
            if d == 0:
                return None
            return n / d
        except ValueError:
            return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_ffprobe_video_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    streams = payload.get("streams") or []
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video_stream:
        raise ValueError("ffprobe did not return a video stream")

    fmt = payload.get("format") or {}
    fps = _parse_ratio(video_stream.get("avg_frame_rate")) or _parse_ratio(
        video_stream.get("r_frame_rate")
    )
    duration_s: float | None = None
    for raw in (video_stream.get("duration"), fmt.get("duration")):
        if raw is None:
            continue
        try:
            duration_s = float(raw)
            break
        except (TypeError, ValueError):
            continue

    frame_count: int | None = None
    raw_frames = video_stream.get("nb_frames")
    if raw_frames not in (None, "N/A"):
        try:
            frame_count = int(raw_frames)
        except (TypeError, ValueError):
            frame_count = None
    if frame_count is None and fps and duration_s:
        frame_count = max(1, int(round(fps * duration_s)))

    width = video_stream.get("width")
    height = video_stream.get("height")
    return {
        "duration_ms": int(round(duration_s * 1000))
        if duration_s is not None
        else None,
        "fps": round(float(fps), 3) if fps and math.isfinite(fps) else None,
        "frame_count": frame_count,
        "width": int(width) if width is not None else None,
        "height": int(height) if height is not None else None,
        "codec": video_stream.get("codec_name"),
    }


def _parse_frame_time_ms(frame: dict[str, Any]) -> int | None:
    for key in (
        "best_effort_timestamp_time",
        "pkt_pts_time",
        "pts_time",
        "pkt_dts_time",
    ):
        raw = frame.get(key)
        if raw in (None, "N/A"):
            continue
        try:
            seconds = float(raw)
        except (TypeError, ValueError):
            continue
        if math.isfinite(seconds):
            return int(round(seconds * 1000))
    return None


def _parse_int(value: Any) -> int | None:
    if value in (None, "N/A"):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_ffprobe_frame_timetable(payload: dict[str, Any]) -> list[dict[str, Any]]:
    frames = payload.get("frames") or []
    out: list[dict[str, Any]] = []
    for frame in frames:
        if frame.get("media_type") not in (None, "video"):
            continue
        pts_ms = _parse_frame_time_ms(frame)
        if pts_ms is None:
            continue
        out.append(
            {
                "frame_index": len(out),
                "pts_ms": pts_ms,
                "is_keyframe": bool(_parse_int(frame.get("key_frame")) or 0),
                "pict_type": frame.get("pict_type"),
                "byte_offset": _parse_int(frame.get("pkt_pos")),
            }
        )
    return out


def probe_video_file(path: str | Path) -> dict[str, Any]:
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_frames,duration",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=FFPROBE_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "ffprobe failed")
    return parse_ffprobe_video_metadata(json.loads(proc.stdout or "{}"))


def probe_video_frame_timetable(path: str | Path) -> list[dict[str, Any]]:
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_frames",
            "-show_entries",
            "frame=media_type,key_frame,pict_type,best_effort_timestamp_time,pkt_pts_time,pts_time,pkt_dts_time,pkt_pos",
            "-of",
            "json",
            str(path),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=FFPROBE_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "ffprobe frame timetable failed")
    return parse_ffprobe_frame_timetable(json.loads(proc.stdout or "{}"))


def extract_video_poster(input_path: str | Path, output_path: str | Path) -> None:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-frames:v",
            "1",
            "-vf",
            "scale='min(512,iw)':-2",
            str(output_path),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=FFMPEG_POSTER_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "ffmpeg poster extraction failed")


def transcode_video_for_browser(
    input_path: str | Path, output_path: str | Path
) -> None:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-map",
            "0:v:0",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-movflags",
            "+faststart",
            str(output_path),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=FFMPEG_TRANSCODE_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "ffmpeg browser transcode failed")


def extract_video_chunk(
    input_path: str | Path,
    output_path: str | Path,
    start_ms: int,
    frame_count: int,
) -> None:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{max(0, start_ms) / 1000:.3f}",
            "-i",
            str(input_path),
            "-frames:v",
            str(max(1, frame_count)),
            "-an",
            "-c:v",
            "libx264",
            "-profile:v",
            "baseline",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-g",
            "30",
            "-keyint_min",
            "30",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            str(output_path),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=FFMPEG_CHUNK_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "ffmpeg chunk extraction failed")


def extract_video_chunk_smart_copy(
    input_path: str | Path,
    output_path: str | Path,
    start_ms: int,
    duration_ms: int,
) -> None:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{max(0, start_ms) / 1000:.3f}",
            "-i",
            str(input_path),
            "-t",
            f"{max(1, duration_ms) / 1000:.3f}",
            "-map",
            "0:v:0",
            "-an",
            "-c:v",
            "copy",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            str(output_path),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=FFMPEG_CHUNK_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "ffmpeg chunk smart-copy failed")


def extract_video_frame_image(
    input_path: str | Path,
    output_path: str | Path,
    pts_ms: int,
    width: int,
) -> None:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{max(0, pts_ms) / 1000:.3f}",
            "-i",
            str(input_path),
            "-frames:v",
            "1",
            "-vf",
            f"scale='min({max(1, width)},iw)':-2",
            str(output_path),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=FFMPEG_FRAME_TIMEOUT_SECONDS,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "ffmpeg frame extraction failed")


async def _get_or_create_frame_cache_row(
    db,
    item_id: uuid.UUID,
    frame_index: int,
    width: int,
    format_: str,
) -> VideoFrameCache:
    row = (
        await db.execute(
            select(VideoFrameCache).where(
                VideoFrameCache.dataset_item_id == item_id,
                VideoFrameCache.frame_index == frame_index,
                VideoFrameCache.width == width,
                VideoFrameCache.format == format_,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = VideoFrameCache(
            dataset_item_id=item_id,
            frame_index=frame_index,
            width=width,
            format=format_,
            status="pending",
        )
        db.add(row)
        await db.flush()
    return row


async def _store_frame_cache_image(
    db,
    storage,
    item: DatasetItem,
    metadata,
    input_path: Path,
    tmp_dir: Path,
    row: VideoFrameCache,
) -> None:
    fmt = row.format if row.format in {"webp", "jpeg"} else "webp"
    ext = "jpg" if fmt == "jpeg" else "webp"
    output_path = tmp_dir / f"frame-{row.frame_index}-{row.width}.{ext}"
    pts_ms = await pts_ms_for_frame(db, item.id, row.frame_index, metadata)
    extract_video_frame_image(input_path, output_path, pts_ms or 0, row.width)
    key = cache_key_for_frame(item.id, row.frame_index, row.width, fmt)
    body = output_path.read_bytes()
    storage.ensure_bucket(storage.datasets_bucket)
    storage.client.put_object(
        Bucket=storage.datasets_bucket,
        Key=key,
        Body=body,
        ContentType="image/jpeg" if fmt == "jpeg" else "image/webp",
    )
    row.storage_key = key
    row.byte_size = len(body)
    row.status = "ready"
    row.error = None
    row.last_accessed_at = datetime.now(timezone.utc)


async def _generate_thumbnail(item_id: str) -> None:
    from sqlalchemy.ext.asyncio import (
        create_async_engine,
        async_sessionmaker,
        AsyncSession,
    )
    from app.db.models.dataset import DatasetItem
    from app.services.storage import StorageService

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with SessionLocal() as db:
        item = await db.get(DatasetItem, uuid.UUID(item_id))
        if not item or item.file_type != "image":
            return

        storage = StorageService()
        try:
            resp = storage.client.get_object(
                Bucket=storage.datasets_bucket, Key=item.file_path
            )
            raw = resp["Body"].read()
        except Exception as exc:
            meta = dict(item.metadata_ or {})
            meta["thumbnail_error"] = str(exc)
            item.metadata_ = meta
            await db.commit()
            return

        try:
            from PIL import Image

            img = Image.open(io.BytesIO(raw)).convert("RGB")
            max_side = 256
            w, h = img.size
            scale = min(max_side / w, max_side / h)
            thumb = img.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS
            )

            import blurhash as bh

            small = img.resize((32, 32), Image.LANCZOS)
            hash_str = bh.encode(small, x_components=4, y_components=3)

            buf = io.BytesIO()
            thumb.save(buf, format="WEBP", quality=80)
            buf.seek(0)
        except Exception as exc:
            meta = dict(item.metadata_ or {})
            meta["thumbnail_error"] = str(exc)
            item.metadata_ = meta
            await db.commit()
            return

        thumb_key = f"thumbnails/{item_id}.webp"
        try:
            storage.ensure_bucket(storage.datasets_bucket)
            storage.client.put_object(
                Bucket=storage.datasets_bucket,
                Key=thumb_key,
                Body=buf.getvalue(),
                ContentType="image/webp",
            )
        except Exception as exc:
            meta = dict(item.metadata_ or {})
            meta["thumbnail_error"] = str(exc)
            item.metadata_ = meta
            await db.commit()
            return

        item.thumbnail_path = thumb_key
        item.blurhash = hash_str
        await db.commit()

    await engine.dispose()


async def _generate_video_metadata(item_id: str) -> None:
    from sqlalchemy.ext.asyncio import (
        create_async_engine,
        async_sessionmaker,
        AsyncSession,
    )
    from app.db.models.dataset import DatasetItem
    from app.services.storage import StorageService

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with SessionLocal() as db:
        item = await db.get(DatasetItem, uuid.UUID(item_id))
        if not item or item.file_type != "video":
            return

        storage = StorageService()
        meta = dict(item.metadata_ or {})
        video_meta = dict(meta.get("video") or {})

        with tempfile.TemporaryDirectory(prefix="anno-video-") as tmp:
            suffix = Path(item.file_name).suffix or ".mp4"
            input_path = Path(tmp) / f"source{suffix}"
            playback_path = Path(tmp) / "playback.mp4"

            try:
                with input_path.open("wb") as fh:
                    storage.client.download_fileobj(
                        Bucket=storage.datasets_bucket,
                        Key=item.file_path,
                        Fileobj=fh,
                    )
            except Exception as exc:
                video_meta["probe_error"] = str(exc)
                meta["video"] = video_meta
                item.metadata_ = meta
                await db.commit()
                return

            try:
                video_meta.update(probe_video_file(input_path))
                video_meta.pop("probe_error", None)
            except subprocess.TimeoutExpired:
                video_meta["probe_error"] = (
                    f"ffprobe timed out after {FFPROBE_TIMEOUT_SECONDS}s"
                )
            except Exception as exc:
                video_meta["probe_error"] = str(exc)

            if not video_meta.get("probe_error"):
                try:
                    frame_timetable = probe_video_frame_timetable(input_path)
                    await db.execute(
                        delete(VideoFrameIndex).where(
                            VideoFrameIndex.dataset_item_id == item.id
                        )
                    )
                    db.add_all(
                        [
                            VideoFrameIndex(
                                dataset_item_id=item.id,
                                frame_index=entry["frame_index"],
                                pts_ms=entry["pts_ms"],
                                is_keyframe=entry["is_keyframe"],
                                pict_type=entry.get("pict_type"),
                                byte_offset=entry.get("byte_offset"),
                            )
                            for entry in frame_timetable
                        ]
                    )
                    video_meta["frame_timetable_frame_count"] = len(frame_timetable)
                    video_meta.pop("frame_timetable_error", None)
                except subprocess.TimeoutExpired:
                    video_meta["frame_timetable_error"] = (
                        f"ffprobe frame timetable timed out after {FFPROBE_TIMEOUT_SECONDS}s"
                    )
                except Exception as exc:
                    video_meta["frame_timetable_error"] = str(exc)

            if video_meta.get("width") is not None:
                item.width = int(video_meta["width"])
            if video_meta.get("height") is not None:
                item.height = int(video_meta["height"])

            if (
                video_meta.get("codec")
                and video_meta.get("codec") not in BROWSER_PLAYABLE_VIDEO_CODECS
            ):
                try:
                    transcode_video_for_browser(input_path, playback_path)
                    playback_key = f"playback/{item_id}.mp4"
                    storage.ensure_bucket(storage.datasets_bucket)
                    storage.client.put_object(
                        Bucket=storage.datasets_bucket,
                        Key=playback_key,
                        Body=playback_path.read_bytes(),
                        ContentType="video/mp4",
                    )
                    video_meta["playback_path"] = playback_key
                    video_meta["playback_codec"] = "h264"
                    video_meta.pop("playback_error", None)
                except subprocess.TimeoutExpired:
                    video_meta["playback_error"] = (
                        f"ffmpeg browser transcode timed out after {FFMPEG_TRANSCODE_TIMEOUT_SECONDS}s"
                    )
                except Exception as exc:
                    video_meta["playback_error"] = str(exc)

            poster_row = None
            start = time.perf_counter()
            try:
                poster_row = await _get_or_create_frame_cache_row(
                    db, item.id, 0, 512, "webp"
                )
                poster_row.status = "pending"
                poster_row.error = None
                await db.commit()
                await _store_frame_cache_image(
                    db,
                    storage,
                    item,
                    VideoMetadata.model_validate(video_meta),
                    input_path,
                    Path(tmp),
                    poster_row,
                )
                VIDEO_FRAME_EXTRACTION_SECONDS.labels(
                    outcome="success", format="webp"
                ).observe(time.perf_counter() - start)
                item.thumbnail_path = poster_row.storage_key
                video_meta["poster_frame_path"] = poster_row.storage_key
                video_meta.pop("poster_error", None)
            except subprocess.TimeoutExpired:
                if poster_row is not None:
                    poster_row.status = "failed"
                    poster_row.error = (
                        f"ffmpeg poster extraction timed out after {FFMPEG_FRAME_TIMEOUT_SECONDS}s"
                    )
                video_meta["poster_error"] = (
                    f"ffmpeg poster extraction timed out after {FFMPEG_FRAME_TIMEOUT_SECONDS}s"
                )
                VIDEO_FRAME_EXTRACTION_SECONDS.labels(
                    outcome="error", format="webp"
                ).observe(time.perf_counter() - start)
            except Exception as exc:
                if poster_row is not None:
                    poster_row.status = "failed"
                    poster_row.error = str(exc)
                video_meta["poster_error"] = str(exc)
                VIDEO_FRAME_EXTRACTION_SECONDS.labels(
                    outcome="error", format="webp"
                ).observe(time.perf_counter() - start)

        meta["video"] = video_meta
        item.metadata_ = meta
        await db.commit()

    await engine.dispose()


async def _backfill_media(dataset_id: str) -> None:
    from sqlalchemy.ext.asyncio import (
        create_async_engine,
        async_sessionmaker,
        AsyncSession,
    )
    from sqlalchemy import and_, or_, select
    from app.db.models.dataset import DatasetItem

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with SessionLocal() as db:
        rows = await db.execute(
            select(DatasetItem.id, DatasetItem.file_type).where(
                DatasetItem.dataset_id == uuid.UUID(dataset_id),
                or_(
                    and_(
                        DatasetItem.file_type == "image",
                        DatasetItem.thumbnail_path.is_(None),
                    ),
                    and_(
                        DatasetItem.file_type == "video",
                        DatasetItem.metadata_["video"]["frame_count"].astext.is_(None),
                    ),
                ),
            )
        )
        items = [(str(row.id), row.file_type) for row in rows.all()]

    await engine.dispose()

    for item_id, file_type in items:
        if file_type == "image":
            await _generate_thumbnail(item_id)
        elif file_type == "video":
            await _generate_video_metadata(item_id)


async def _generate_task_thumbnail(task_id: str) -> None:
    from sqlalchemy.ext.asyncio import (
        create_async_engine,
        async_sessionmaker,
        AsyncSession,
    )
    from app.db.models.task import Task
    from app.db.models.dataset import DatasetItem  # noqa: F401 — needed for FK resolution
    from app.services.storage import StorageService

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with SessionLocal() as db:
        task = await db.get(Task, uuid.UUID(task_id))
        if not task or task.file_type != "image":
            return

        storage = StorageService()
        try:
            resp = storage.client.get_object(Bucket=storage.bucket, Key=task.file_path)
            raw = resp["Body"].read()
        except Exception:
            return

        try:
            from PIL import Image

            img = Image.open(io.BytesIO(raw)).convert("RGB")
            max_side = 256
            w, h = img.size
            scale = min(max_side / w, max_side / h)
            thumb = img.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS
            )

            import blurhash as bh

            small = img.resize((32, 32), Image.LANCZOS)
            hash_str = bh.encode(small, x_components=4, y_components=3)

            buf = io.BytesIO()
            thumb.save(buf, format="WEBP", quality=80)
            buf.seek(0)
        except Exception:
            return

        thumb_key = f"thumbnails/{task_id}.webp"
        try:
            storage.ensure_bucket(storage.bucket)
            storage.client.put_object(
                Bucket=storage.bucket,
                Key=thumb_key,
                Body=buf.getvalue(),
                ContentType="image/webp",
            )
        except Exception:
            return

        task.thumbnail_path = thumb_key
        task.blurhash = hash_str
        await db.commit()

    await engine.dispose()


async def _backfill_tasks(project_id: str) -> None:
    from sqlalchemy.ext.asyncio import (
        create_async_engine,
        async_sessionmaker,
        AsyncSession,
    )
    from sqlalchemy import select
    from app.db.models.task import Task
    from app.db.models.dataset import DatasetItem  # noqa: F401 — needed for FK resolution

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with SessionLocal() as db:
        rows = await db.execute(
            select(Task.id).where(
                Task.project_id == uuid.UUID(project_id),
                Task.file_type == "image",
                Task.dataset_item_id.is_(None),
                Task.thumbnail_path.is_(None),
            )
        )
        task_ids = [str(r[0]) for r in rows.all()]

    await engine.dispose()

    for tid in task_ids:
        await _generate_task_thumbnail(tid)


def _normalize_video_codec(codec: str | None) -> str | None:
    if not codec:
        return None
    normalized = codec.lower().strip()
    if normalized in {"avc1", "h264"}:
        return "h264"
    if normalized in {"hevc", "h265"}:
        return "hevc"
    return normalized


def _chunk_source_codec(metadata: VideoMetadata) -> str | None:
    if metadata.playback_path:
        codec = metadata.playback_codec or metadata.codec
    else:
        codec = metadata.codec
    return _normalize_video_codec(codec)


def _transcode_fallback_reason(
    source_codec: str | None,
    keyframe_aligned: bool | None,
    has_start_timetable: bool,
) -> str | None:
    if not source_codec:
        return "missing_source_codec"
    if source_codec not in SMART_COPY_VIDEO_CODECS:
        return "unsupported_codec"
    if not has_start_timetable:
        return "missing_start_frame_timetable"
    if not keyframe_aligned:
        return "start_frame_not_keyframe"
    return None


def _chunk_duration_ms(row: VideoChunk, metadata: VideoMetadata) -> int:
    if row.start_pts_ms is not None and row.end_pts_ms is not None:
        frame_ms = int(round(1000 / metadata.fps)) if metadata.fps else 1
        return max(1, row.end_pts_ms - row.start_pts_ms + frame_ms)
    if metadata.fps:
        frame_count = max(1, row.end_frame - row.start_frame + 1)
        return max(1, int(round((frame_count / metadata.fps) * 1000)))
    return 1


async def _chunk_diagnostics(
    db,
    item: DatasetItem,
    metadata: VideoMetadata,
    row: VideoChunk,
) -> dict[str, Any]:
    frame_rows = {
        frame.frame_index: frame
        for frame in (
            await db.execute(
                select(VideoFrameIndex).where(
                    VideoFrameIndex.dataset_item_id == item.id,
                    VideoFrameIndex.frame_index.in_([row.start_frame, row.end_frame]),
                )
            )
        )
        .scalars()
        .all()
    }
    start_entry = frame_rows.get(row.start_frame)
    end_entry = frame_rows.get(row.end_frame)
    source_codec = _chunk_source_codec(metadata)
    keyframe_aligned = start_entry.is_keyframe if start_entry else None
    fallback_reason = _transcode_fallback_reason(
        source_codec,
        keyframe_aligned,
        start_entry is not None,
    )
    return {
        "source_codec": source_codec,
        "output_codec": None,
        "keyframe_aligned": keyframe_aligned,
        "start_byte_offset": start_entry.byte_offset if start_entry else None,
        "end_byte_offset": end_entry.byte_offset if end_entry else None,
        "smart_copy_eligible": fallback_reason is None,
        "fallback_reason": fallback_reason,
    }


async def _store_video_chunk(
    db,
    storage,
    item: DatasetItem,
    metadata: VideoMetadata,
    input_path: Path,
    tmp_dir: Path,
    row: VideoChunk,
) -> None:
    diagnostics = await _chunk_diagnostics(db, item, metadata, row)
    start_ms = row.start_pts_ms
    if start_ms is None:
        start_ms = await pts_ms_for_frame(db, item.id, row.start_frame, metadata)

    output_path = tmp_dir / f"chunk-{row.chunk_id}.mp4"
    generation_mode = "transcode"
    if diagnostics["smart_copy_eligible"]:
        try:
            extract_video_chunk_smart_copy(
                input_path,
                output_path,
                start_ms or 0,
                _chunk_duration_ms(row, metadata),
            )
            generation_mode = "smart_copy"
            diagnostics["output_codec"] = diagnostics["source_codec"]
        except Exception as exc:
            output_path.unlink(missing_ok=True)
            diagnostics["fallback_reason"] = f"smart_copy_failed: {exc}"
            diagnostics["smart_copy_eligible"] = False

    if generation_mode == "transcode":
        row.generation_mode = generation_mode
        row.diagnostics = diagnostics
        extract_video_chunk(
            input_path,
            output_path,
            start_ms or 0,
            row.end_frame - row.start_frame + 1,
        )
        diagnostics["output_codec"] = "h264"

    key = cache_key_for_chunk(item.id, row.chunk_id)
    storage.ensure_bucket(storage.datasets_bucket)
    body = output_path.read_bytes()
    storage.client.put_object(
        Bucket=storage.datasets_bucket,
        Key=key,
        Body=body,
        ContentType="video/mp4",
    )
    row.storage_key = key
    row.byte_size = len(body)
    row.generation_mode = generation_mode
    row.diagnostics = diagnostics
    row.status = "ready"
    row.error = None
    row.last_accessed_at = datetime.now(timezone.utc)


async def _ensure_video_chunks(item_id: str, chunk_ids: list[int]) -> None:
    from sqlalchemy.ext.asyncio import (
        AsyncSession,
        async_sessionmaker,
        create_async_engine,
    )
    from app.services.storage import StorageService

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with SessionLocal() as db:
        item = await db.get(DatasetItem, uuid.UUID(item_id))
        if not item or item.file_type != "video":
            await engine.dispose()
            return
        metadata = metadata_for_item(item)
        source_key = source_key_for_item(item)
        storage = StorageService()

        with tempfile.TemporaryDirectory(prefix="anno-video-chunk-") as tmp:
            suffix = Path(item.file_name).suffix or ".mp4"
            input_path = Path(tmp) / f"source{suffix}"
            try:
                with input_path.open("wb") as fh:
                    storage.client.download_fileobj(
                        Bucket=storage.datasets_bucket,
                        Key=source_key,
                        Fileobj=fh,
                    )
            except Exception as exc:
                rows = (
                    await db.execute(
                        select(VideoChunk).where(
                            VideoChunk.dataset_item_id == item.id,
                            VideoChunk.chunk_id.in_(chunk_ids),
                        )
                    )
                ).scalars()
                for row in rows:
                    row.status = "failed"
                    row.error = str(exc)
                await db.commit()
                await engine.dispose()
                return

            for chunk_id in chunk_ids:
                row = (
                    await db.execute(
                        select(VideoChunk).where(
                            VideoChunk.dataset_item_id == item.id,
                            VideoChunk.chunk_id == int(chunk_id),
                        )
                    )
                ).scalar_one_or_none()
                if row is None:
                    continue
                row.status = "pending"
                row.error = None
                row.generation_mode = None
                row.diagnostics = {}
                await db.commit()
                start = time.perf_counter()
                try:
                    await _store_video_chunk(
                        db,
                        storage,
                        item,
                        metadata,
                        input_path,
                        Path(tmp),
                        row,
                    )
                    VIDEO_CHUNK_GENERATION_SECONDS.labels(outcome="success").observe(
                        time.perf_counter() - start
                    )
                except Exception as exc:
                    row.status = "failed"
                    row.error = str(exc)
                    VIDEO_CHUNK_GENERATION_SECONDS.labels(outcome="error").observe(
                        time.perf_counter() - start
                    )
                await db.commit()

        await _refresh_video_asset_bytes(db)

    await engine.dispose()


async def _extract_video_frames(
    item_id: str, frame_requests: list[dict[str, Any]]
) -> None:
    from sqlalchemy.ext.asyncio import (
        AsyncSession,
        async_sessionmaker,
        create_async_engine,
    )
    from app.services.storage import StorageService

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with SessionLocal() as db:
        item = await db.get(DatasetItem, uuid.UUID(item_id))
        if not item or item.file_type != "video":
            await engine.dispose()
            return
        metadata = metadata_for_item(item)
        source_key = source_key_for_item(item)
        storage = StorageService()

        with tempfile.TemporaryDirectory(prefix="anno-video-frame-") as tmp:
            suffix = Path(item.file_name).suffix or ".mp4"
            input_path = Path(tmp) / f"source{suffix}"
            try:
                with input_path.open("wb") as fh:
                    storage.client.download_fileobj(
                        Bucket=storage.datasets_bucket,
                        Key=source_key,
                        Fileobj=fh,
                    )
            except Exception as exc:
                for request in frame_requests:
                    row = await _load_frame_cache_row(db, item.id, request)
                    if row:
                        row.status = "failed"
                        row.error = str(exc)
                await db.commit()
                await engine.dispose()
                return

            for request in frame_requests:
                row = await _load_frame_cache_row(db, item.id, request)
                if row is None:
                    continue
                row.status = "pending"
                row.error = None
                await db.commit()
                fmt = row.format if row.format in {"webp", "jpeg"} else "webp"
                start = time.perf_counter()
                try:
                    await _store_frame_cache_image(
                        db,
                        storage,
                        item,
                        metadata,
                        input_path,
                        Path(tmp),
                        row,
                    )
                    VIDEO_FRAME_EXTRACTION_SECONDS.labels(
                        outcome="success", format=fmt
                    ).observe(time.perf_counter() - start)
                except Exception as exc:
                    row.status = "failed"
                    row.error = str(exc)
                    VIDEO_FRAME_EXTRACTION_SECONDS.labels(
                        outcome="error", format=fmt
                    ).observe(time.perf_counter() - start)
                await db.commit()

        await _refresh_video_asset_bytes(db)

    await engine.dispose()


async def _load_frame_cache_row(
    db, item_id: uuid.UUID, request: dict[str, Any]
) -> VideoFrameCache | None:
    return (
        await db.execute(
            select(VideoFrameCache).where(
                VideoFrameCache.dataset_item_id == item_id,
                VideoFrameCache.frame_index == int(request["frame_index"]),
                VideoFrameCache.width == int(request["width"]),
                VideoFrameCache.format == str(request["format"]),
            )
        )
    ).scalar_one_or_none()


async def _cleanup_video_frame_assets() -> None:
    from sqlalchemy.ext.asyncio import (
        AsyncSession,
        async_sessionmaker,
        create_async_engine,
    )
    from app.services.storage import StorageService

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with SessionLocal() as db:
        storage = StorageService()
        now = datetime.now(timezone.utc)
        frame_cutoff = now - timedelta(days=settings.video_frame_cache_ttl_days)
        chunk_cutoff = now - timedelta(days=settings.video_chunk_cache_ttl_days)

        frame_rows = (
            await db.execute(
                select(VideoFrameCache).where(
                    VideoFrameCache.status == "ready",
                    VideoFrameCache.last_accessed_at.is_not(None),
                    VideoFrameCache.last_accessed_at < frame_cutoff,
                )
            )
        ).scalars()
        for row in frame_rows:
            if row.storage_key:
                storage.delete_object(row.storage_key, bucket=storage.datasets_bucket)
            row.status = "pending"
            row.storage_key = None
            row.byte_size = None
            row.generation_mode = None
            row.diagnostics = {}

        chunk_rows = (
            await db.execute(
                select(VideoChunk).where(
                    VideoChunk.status == "ready",
                    VideoChunk.last_accessed_at.is_not(None),
                    VideoChunk.last_accessed_at < chunk_cutoff,
                )
            )
        ).scalars()
        for row in chunk_rows:
            if row.storage_key:
                storage.delete_object(row.storage_key, bucket=storage.datasets_bucket)
            row.status = "pending"
            row.storage_key = None
            row.byte_size = None

        await db.commit()
        await _refresh_video_asset_bytes(db)

    await engine.dispose()


async def _refresh_video_asset_bytes(db) -> None:
    frame_bytes = sum(
        row.byte_size or 0
        for row in (
            await db.execute(
                select(VideoFrameCache).where(VideoFrameCache.status == "ready")
            )
        )
        .scalars()
        .all()
    )
    chunk_bytes = sum(
        row.byte_size or 0
        for row in (
            await db.execute(select(VideoChunk).where(VideoChunk.status == "ready"))
        )
        .scalars()
        .all()
    )
    VIDEO_FRAME_ASSET_BYTES.labels(asset_type="frame").set(frame_bytes)
    VIDEO_FRAME_ASSET_BYTES.labels(asset_type="chunk").set(chunk_bytes)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60, queue="media")
def generate_thumbnail(self, item_id: str) -> None:
    asyncio.run(_generate_thumbnail(item_id))


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60, queue="media")
def generate_video_metadata(self, item_id: str) -> None:
    asyncio.run(_generate_video_metadata(item_id))


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60, queue="media")
def generate_task_thumbnail(self, task_id: str) -> None:
    asyncio.run(_generate_task_thumbnail(task_id))


@celery_app.task(bind=True, max_retries=1, queue="media")
def backfill_media(self, dataset_id: str) -> None:
    asyncio.run(_backfill_media(dataset_id))


@celery_app.task(bind=True, max_retries=1, queue="media")
def backfill_tasks(self, project_id: str) -> None:
    asyncio.run(_backfill_tasks(project_id))


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30, queue="media")
def ensure_video_chunks(self, item_id: str, chunk_ids: list[int]) -> None:
    asyncio.run(_ensure_video_chunks(item_id, chunk_ids))


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30, queue="media")
def extract_video_frames(
    self, item_id: str, frame_requests: list[dict[str, Any]]
) -> None:
    asyncio.run(_extract_video_frames(item_id, frame_requests))


@celery_app.task(bind=True, max_retries=1, queue="media")
def cleanup_video_frame_assets(self) -> None:
    asyncio.run(_cleanup_video_frame_assets())
