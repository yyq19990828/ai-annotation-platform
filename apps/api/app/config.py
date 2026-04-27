from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "AI 标注平台 API"
    debug: bool = True

    database_url: str = "postgresql+asyncpg://user:pass@localhost:5432/annotation"
    redis_url: str = "redis://localhost:6379/0"

    secret_key: str = "dev-secret-change-in-production"
    access_token_expire_minutes: int = 60 * 24

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "annotations"
    minio_use_ssl: bool = False

    class Config:
        env_file = ".env"


settings = Settings()
