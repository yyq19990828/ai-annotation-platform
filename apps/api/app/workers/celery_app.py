from celery import Celery
from celery.schedules import crontab
from app.config import settings

celery_app = Celery(
    "annotation_worker",
    broker=settings.effective_celery_broker,
    backend=settings.effective_celery_broker,
    include=[
        "app.workers.tasks",
        "app.workers.media",
        "app.workers.cleanup",
        "app.workers.audit",
        "app.workers.deactivation",
        "app.workers.audit_partition",
        "app.workers.task_events",
    ],
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
        # v0.7.6 · audit 异步 INSERT 走独立队列，不与 ml/media 抢资源
        "app.workers.audit.persist_audit_entry": {"queue": "audit"},
        # v0.8.4 · task_events 批量 INSERT 走独立队列
        "app.workers.task_events.persist_task_events_batch": {"queue": "audit"},
        # v0.8.4 · 物化视图 hourly refresh
        "app.workers.cleanup.refresh_user_perf_mv": {"queue": "cleanup"},
    },
    # v0.7.0：beat schedule。运维侧需 deploy `celery -A app.workers.celery_app beat` 进程
    # （或 worker --beat 单进程模式）才会触发。
    beat_schedule={
        "purge-soft-deleted-attachments": {
            "task": "app.workers.cleanup.purge_soft_deleted_attachments",
            "schedule": crontab(hour=3, minute=0),  # 每日 03:00 UTC
        },
        # v0.8.1 · 自助注销冷静期到期处理（每日 04:00 UTC）
        "process-deactivation-requests": {
            "task": "app.workers.deactivation.process_deactivation_requests",
            "schedule": crontab(hour=4, minute=0),
        },
        # v0.8.1 · 审计分区每月维护：25 日提前建未来分区
        "ensure-future-audit-partitions": {
            "task": "app.workers.audit_partition.ensure_future_audit_partitions",
            "schedule": crontab(day_of_month=25, hour=3, minute=0),
        },
        # v0.8.1 · 审计冷数据归档：每月 2 日把保留期外分区归档至 MinIO 后 DROP
        "archive-old-audit-partitions": {
            "task": "app.workers.audit_partition.archive_old_audit_partitions",
            "schedule": crontab(day_of_month=2, hour=3, minute=0),
        },
        # v0.8.4 · 效率看板物化视图：每小时第 5 分钟 REFRESH MATERIALIZED VIEW CONCURRENTLY
        "refresh-user-perf-mv": {
            "task": "app.workers.cleanup.refresh_user_perf_mv",
            "schedule": crontab(minute=5),
        },
    },
)
