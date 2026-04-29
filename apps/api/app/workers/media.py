import asyncio
import io
import uuid

from app.workers.celery_app import celery_app
from app.config import settings


async def _generate_thumbnail(item_id: str) -> None:
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.db.models.dataset import DatasetItem
    from app.services.storage import StorageService

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

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
            thumb = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

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


async def _backfill_media(dataset_id: str) -> None:
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from sqlalchemy import select
    from app.db.models.dataset import DatasetItem

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with SessionLocal() as db:
        rows = await db.execute(
            select(DatasetItem.id).where(
                DatasetItem.dataset_id == uuid.UUID(dataset_id),
                DatasetItem.file_type == "image",
                DatasetItem.thumbnail_path.is_(None),
            )
        )
        item_ids = [str(r[0]) for r in rows.all()]

    await engine.dispose()

    for iid in item_ids:
        await _generate_thumbnail(iid)


async def _generate_task_thumbnail(task_id: str) -> None:
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.db.models.task import Task
    from app.db.models.dataset import DatasetItem  # noqa: F401 — needed for FK resolution
    from app.services.storage import StorageService

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

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
            thumb = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

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
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from sqlalchemy import select
    from app.db.models.task import Task
    from app.db.models.dataset import DatasetItem  # noqa: F401 — needed for FK resolution

    engine = create_async_engine(settings.database_url, echo=False)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

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
def generate_task_thumbnail(self, task_id: str) -> None:
    asyncio.run(_generate_task_thumbnail(task_id))


@celery_app.task(bind=True, max_retries=1, queue="media")
def backfill_media(self, dataset_id: str) -> None:
    asyncio.run(_backfill_media(dataset_id))


@celery_app.task(bind=True, max_retries=1, queue="media")
def backfill_tasks(self, project_id: str) -> None:
    asyncio.run(_backfill_tasks(project_id))
