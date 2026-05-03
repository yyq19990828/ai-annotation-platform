from celery import Celery
from celery.schedules import crontab
from app.config import settings

celery_app = Celery(
    "annotation_worker",
    broker=settings.effective_celery_broker,
    backend=settings.effective_celery_broker,
    include=["app.workers.tasks", "app.workers.media", "app.workers.cleanup"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    task_track_started=True,
    worker_max_memory_per_child=512_000,
    task_routes={
        "app.workers.tasks.batch_predict": {"queue": "ml"},
        "app.workers.media.generate_thumbnail": {"queue": "media"},
        "app.workers.media.generate_task_thumbnail": {"queue": "media"},
        "app.workers.media.backfill_media": {"queue": "media"},
        "app.workers.media.backfill_tasks": {"queue": "media"},
        "app.workers.cleanup.purge_soft_deleted_attachments": {"queue": "cleanup"},
    },
    # v0.7.0：beat schedule。运维侧需 deploy `celery -A app.workers.celery_app beat` 进程
    # （或 worker --beat 单进程模式）才会触发。
    beat_schedule={
        "purge-soft-deleted-attachments": {
            "task": "app.workers.cleanup.purge_soft_deleted_attachments",
            "schedule": crontab(hour=3, minute=0),  # 每日 03:00 UTC
        },
    },
)
