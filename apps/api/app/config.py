from typing import Literal

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "AI 标注平台 API"
    debug: bool = True
    environment: Literal["development", "staging", "production"] = "development"

    database_url: str = "postgresql+asyncpg://user:pass@localhost:5432/annotation"
    redis_url: str = "redis://localhost:6379/0"

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

    # Governance / invitations
    frontend_base_url: str = "http://localhost:5173"
    invitation_ttl_days: int = 7

    # SMTP（本期占位，仅在 GET /settings/system 中以「已配置/未配置」呈现）
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None

    @property
    def effective_celery_broker(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_port and self.smtp_from)

    class Config:
        env_file = ".env"


settings = Settings()
