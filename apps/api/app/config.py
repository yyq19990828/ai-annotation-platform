import json
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings

# repo root .env (apps/api/app/config.py → ../../.. = repo root)
# 容器布局是 /app/app/config.py 只有 3 层 parents, parents[3] 越界 IndexError;
# 容器内 env vars 由 docker-compose `environment:` 直接注入, 找不到 .env 是正常的.
_PARENTS = Path(__file__).resolve().parents
_REPO_ROOT_ENV = (
    _PARENTS[3] / ".env" if len(_PARENTS) > 3 else Path("/nonexistent/.env")
)


class Settings(BaseSettings):
    app_name: str = "AI 标注平台 API"
    debug: bool = True
    environment: Literal["development", "staging", "production"] = "development"

    database_url: str = "postgresql+asyncpg://user:pass@localhost:5432/annotation"
    redis_url: str = "redis://localhost:6379/0"

    # CORS — dev 默认允许三个常见前端端口 + localhost regex；
    # production 必须在 env 显式设置 cors_allow_origins，regex 自动失效。
    cors_allow_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
    ]
    cors_allow_origin_regex: str | None = r"http://localhost:\d+"

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, v):
        """允许 env 用 JSON list 或逗号分隔字符串。"""
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                return json.loads(v)
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    @property
    def effective_cors_origin_regex(self) -> str | None:
        """production 强制不放 regex，避免误用本机正则上线。"""
        if self.environment == "production":
            return None
        return self.cors_allow_origin_regex

    secret_key: str = "dev-secret-change-in-production"
    access_token_expire_minutes: int = 60 * 24

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "annotations"
    minio_datasets_bucket: str = "datasets"
    # B-4 · bug 反馈截图独立桶,与 anno/datasets 隔离,180 天 lifecycle
    minio_bug_reports_bucket: str = "bug-reports"
    minio_use_ssl: bool = False
    minio_public_url: str = ""  # if set, replaces the endpoint host in presigned URLs

    # v0.9.4 · 当 ML backend 在 docker compose 网内、平台 api 在 host 进程时,
    # SAM 容器无法 hit host 的 localhost:9000; 设为 docker bridge gateway
    # (Linux: 172.17.0.1:9000) 或 host.docker.internal:9000 (macOS/Win) 即可。
    # 留空时 file URL 直接透传 (生产: api / sam / minio 同 K8s 网时不需要)。
    ml_backend_storage_host: str = ""

    # v0.9.6 · ML Backend 注册表单 URL 默认值预填 hint (avoid 手敲 http://172.17.0.1:8001).
    # dev 推荐 http://172.17.0.1:8001; 生产 K8s 同 namespace 时留空, 让运维直接输 service DNS.
    ml_backend_default_url: str = ""

    ml_predict_timeout: int = 100
    ml_health_timeout: int = 10
    celery_broker_url: str = ""

    # v0.9.25 · 视频后端帧服务 Wave B。Chunk 与单帧缓存都落在 datasets bucket。
    video_chunk_size_frames: int = 60
    video_frame_cache_ttl_days: int = 14
    video_chunk_cache_ttl_days: int = 30
    video_frame_memory_cache_items: int = 64
    video_segment_size_frames: int = 18000
    video_segment_lock_ttl_seconds: int = 300

    # v0.7.6 · AuditMiddleware 异步化开关。true = 通过 Celery 旁路写 audit_logs；
    # false 或 broker 不可用时，自动 fallback 到原同步路径。
    audit_async: bool = True

    # v0.8.1 · 审计日志冷数据保留月数：超期分区每月 2 日归档到 MinIO 后 DROP。
    audit_retention_months: int = 12

    # v0.8.4 · task_events 异步写入开关。true = Celery 旁路写；false 或 broker 不可用 → 同步 fallback。
    task_events_async: bool = True

    # Governance / invitations
    frontend_base_url: str = "http://localhost:5173"
    invitation_ttl_days: int = 7
    allow_open_registration: bool = False
    max_invitations_per_day: int = 30

    # CORS — production 收紧 methods / headers
    cors_allow_methods: list[str] = ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
    cors_allow_headers: list[str] = ["Authorization", "Content-Type", "X-Request-ID"]

    # v0.8.3 · 在线状态心跳：超过该分钟数未刷新 last_seen_at 的 online 用户由
    # Celery beat 任务 mark_inactive_offline 置 offline。前端 30s 心跳 × 10 容差。
    offline_threshold_minutes: int = 5

    # SMTP（本期占位，仅在 GET /settings/system 中以「已配置/未配置」呈现）
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None

    # Sentry（v0.6.6 接入；DSN 留空则完全不初始化，dev 默认关闭）
    sentry_dsn: str | None = None
    sentry_environment: str = "development"
    sentry_traces_sample_rate: float = 0.1

    # v0.8.7 · Cloudflare Turnstile CAPTCHA。dev 默认关闭，service 层 short-circuit 返 True；
    # production 在 env 显式 enabled=true + 填两把 key。
    turnstile_enabled: bool = False
    turnstile_site_key: str | None = None
    turnstile_secret_key: str | None = None
    turnstile_verify_url: str = (
        "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    )

    # v0.9.3 · 登录页 progressive CAPTCHA：同 IP 失败 ≥ 阈值后下一次登录强制 Turnstile。
    # 计数键 login_failed:{ip}，TTL = window_seconds，成功登录后 DEL。
    login_captcha_threshold: int = 5
    login_failed_window_seconds: int = 3600

    @property
    def effective_celery_broker(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_port and self.smtp_from)

    class Config:
        # 用绝对路径让从任何 cwd 起 uvicorn 都能读到 repo root .env
        env_file = str(_REPO_ROOT_ENV)
        # `.env` 中包含若干 VITE_* 前端变量（VITE_API_URL / VITE_SENTRY_DSN /
        # VITE_TURNSTILE_SITE_KEY 等）；pydantic-settings 2.13 起 extra 默认
        # 为 "forbid"，会让本地 dev 启动失败。这里显式忽略，让前后端共用一份 .env。
        extra = "ignore"


settings = Settings()
