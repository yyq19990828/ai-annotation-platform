import json
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings


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
    minio_use_ssl: bool = False
    minio_public_url: str = ""  # if set, replaces the endpoint host in presigned URLs

    ml_predict_timeout: int = 100
    ml_health_timeout: int = 10
    celery_broker_url: str = ""

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
    turnstile_verify_url: str = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

    @property
    def effective_celery_broker(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_port and self.smtp_from)

    class Config:
        env_file = ".env"
        # `.env` 中包含若干 VITE_* 前端变量（VITE_API_URL / VITE_SENTRY_DSN /
        # VITE_TURNSTILE_SITE_KEY 等）；pydantic-settings 2.13 起 extra 默认
        # 为 "forbid"，会让本地 dev 启动失败。这里显式忽略，让前后端共用一份 .env。
        extra = "ignore"


settings = Settings()
