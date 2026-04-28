from celery import Celery
from app.config import settings

celery_app = Celery(
    "annotation_worker",
    broker=settings.effective_celery_broker,
    backend=settings.effective_celery_broker,
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
    },
)
