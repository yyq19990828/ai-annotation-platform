import asyncio
import io
import json
import math
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any

from app.workers.celery_app import celery_app
from app.config import settings

FFPROBE_TIMEOUT_SECONDS = 30
FFMPEG_POSTER_TIMEOUT_SECONDS = 60
FFMPEG_TRANSCODE_TIMEOUT_SECONDS = 600
BROWSER_PLAYABLE_VIDEO_CODECS = {"h264", "avc1"}


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
            poster_path = Path(tmp) / "poster.webp"
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

            try:
                extract_video_poster(input_path, poster_path)
                poster_key = f"thumbnails/{item_id}.webp"
                storage.ensure_bucket(storage.datasets_bucket)
                storage.client.put_object(
                    Bucket=storage.datasets_bucket,
                    Key=poster_key,
                    Body=poster_path.read_bytes(),
                    ContentType="image/webp",
                )
                item.thumbnail_path = poster_key
                video_meta["poster_frame_path"] = poster_key
                video_meta.pop("poster_error", None)
            except subprocess.TimeoutExpired:
                video_meta["poster_error"] = (
                    f"ffmpeg poster extraction timed out after {FFMPEG_POSTER_TIMEOUT_SECONDS}s"
                )
            except Exception as exc:
                video_meta["poster_error"] = str(exc)

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
