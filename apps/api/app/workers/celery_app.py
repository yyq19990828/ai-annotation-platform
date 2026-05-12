from datetime import timedelta

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
        "app.workers.presence",
        "app.workers.ml_health",
        "app.workers.predictions_retry",
        "app.workers.video_tracker",
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
        "app.workers.predictions_retry.retry_failed_prediction": {"queue": "ml"},
        "app.workers.media.generate_thumbnail": {"queue": "media"},
        "app.workers.media.generate_video_metadata": {"queue": "media"},
        "app.workers.media.generate_task_thumbnail": {"queue": "media"},
        "app.workers.media.backfill_media": {"queue": "media"},
        "app.workers.media.backfill_tasks": {"queue": "media"},
        "app.workers.media.ensure_video_chunks": {"queue": "media"},
        "app.workers.media.extract_video_frames": {"queue": "media"},
        "app.workers.media.cleanup_video_frame_assets": {"queue": "media"},
        "app.workers.video_tracker.run_video_tracker_job": {"queue": "gpu"},
        "app.workers.cleanup.purge_soft_deleted_attachments": {"queue": "cleanup"},
        # v0.7.6 · audit 异步 INSERT 走独立队列，不与 ml/media 抢资源
        "app.workers.audit.persist_audit_entry": {"queue": "audit"},
        # v0.8.4 · task_events 批量 INSERT 走独立队列
        "app.workers.task_events.persist_task_events_batch": {"queue": "audit"},
        # v0.8.4 · 物化视图 hourly refresh
        "app.workers.cleanup.refresh_user_perf_mv": {"queue": "cleanup"},
        # v0.9.11 PerfHud · 1s 推送任务走 default queue (worker 默认订阅 default,ml,media)
        "app.workers.ml_health.publish_ml_backend_stats": {"queue": "default"},
        # v0.8.6 · check_ml_backends_health 历史也漏在路由表外, 同步补上避免 stale celery 队列堆积
        "app.workers.ml_health.check_ml_backends_health": {"queue": "default"},
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
        # v0.8.3 · 在线状态心跳：每 2 分钟扫描，把超 OFFLINE_THRESHOLD_MINUTES 未活跃的 online 用户置 offline
        "mark-inactive-offline": {
            "task": "app.workers.presence.mark_inactive_offline",
            "schedule": crontab(minute="*/2"),
        },
        # v0.8.6 F2 · ML Backend 周期健康检查：每 60s 扫所有 backend 调 /health，串行 + 0-3s 抖动错峰
        "check-ml-backends-health": {
            "task": "app.workers.ml_health.check_ml_backends_health",
            "schedule": crontab(minute="*"),
        },
        # v0.9.11 PerfHud · ML Backend 实时统计推送：每 1s 拉所有 active backend /health → publish 到
        # ml-backend-stats:global. 仅在 WS 订阅者计数 > 0 时执行实拉, 0 订阅者时短路 skip 节省 GPU 成本.
        "publish-ml-backend-stats": {
            "task": "app.workers.ml_health.publish_ml_backend_stats",
            "schedule": timedelta(seconds=1),
        },
        # v0.9.25 · 视频帧服务缓存 TTL housekeeping。
        "cleanup-video-frame-assets": {
            "task": "app.workers.media.cleanup_video_frame_assets",
            "schedule": crontab(hour=2, minute=30),
        },
    },
)
