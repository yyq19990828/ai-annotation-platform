import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode

# repo root .env (apps/api/app/config.py → ../../.. = repo root)
# 容器布局是 /app/app/config.py 只有 3 层 parents, parents[3] 越界 IndexError;
# 容器内 env vars 由 docker-compose `environment:` 直接注入, 找不到 .env 是正常的.
_PARENTS = Path(__file__).resolve().parents
_REPO_ROOT_ENV = (
    _PARENTS[3] / ".env" if len(_PARENTS) > 3 else Path("/nonexistent/.env")
)
# DuckDB 默认路径锚定仓库根 (host)，不随 API 进程 cwd 漂移 (apps/api 启动时旧的
# 相对 ./data/duckdb 会指向不存在的 apps/api/data/duckdb)。容器内 len<=3 走相对
# fallback，但 compose 已用 DUCKDB_PATH env 注入绝对路径，故默认值在容器内不生效。
_REPO_ROOT_DUCKDB = (
    str(_PARENTS[3] / "data" / "duckdb" / "analytics.duckdb")
    if len(_PARENTS) > 3
    else "./data/duckdb/analytics.duckdb"
)


class Settings(BaseSettings):
    app_name: str = "AI 标注平台 API"
    # v0.10.24 · 版本号单源真值。FastAPI title version 与 /health version 都读它，
    # 发版只改这一处（+ pyproject.toml / package.json）。运维 scrape /health 拿到的
    # 版本号此前长期 stale（曾硬编码 0.7.6），故收口到 settings。
    app_version: str = "0.20.5"
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

    # v0.11.14 · 存储连接器凭据 Fernet 加密 key（与 secret_key 隔离）。
    # 一把 Fernet key（32B url-safe base64）；留空则连接器加解密一律拒绝（API 转 503）。
    # 生成: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    connector_encryption_key: str = ""
    # v0.11.16 · 存储连接器主机白名单部署默认值（CSV / JSON list）。
    # system_settings.connector_host_allowlist 若存在则覆盖该 env 默认值。
    connector_host_allowlist: Annotated[list[str], NoDecode] = []

    @field_validator("connector_host_allowlist", mode="before")
    @classmethod
    def _parse_connector_host_allowlist(cls, v):
        """允许 env 用 JSON list 或逗号分隔字符串。"""
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return []
            if v.startswith("["):
                return json.loads(v)
            return [entry.strip() for entry in v.split(",") if entry.strip()]
        return v

    # v0.11.15 · 连接器导入护栏。超限 job 会失败，不会部分导入。
    dataset_import_max_files: int = 50_000
    dataset_import_max_total_bytes: int = 200 * 1024 * 1024 * 1024

    # v0.12.0 · dataset link 建 task 同步阈值：item 数 ≤ 阈值走同步快路径，
    # > 阈值改入 Celery 异步建 task（避免大 dataset 在 HTTP 单事务里超时 + 长事务锁）。
    task_create_sync_threshold: int = 2000

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "annotations"
    minio_datasets_bucket: str = "datasets"
    # B-4 · bug 反馈截图独立桶,与 anno/datasets 隔离,180 天 lifecycle
    minio_bug_reports_bucket: str = "bug-reports"
    # v0.10.17 · 派生媒体缓存独立桶。承载 thumbnails / video frames / chunks / playback,
    # 数据全部可由源文件重生,挂 30 天 lifecycle,清理与源数据解耦。
    minio_media_cache_bucket: str = "media-cache"
    # v0.10.17 · 审计冷分区归档独立桶。归档后永久保留,合规相关,与运营数据物理隔离。
    minio_audit_archive_bucket: str = "audit-archive"
    # v0.10.27 · 导入预标注 / 导出标注产物的短生命周期独立桶,各挂整桶 7 天 lifecycle。
    minio_import_bucket: str = "import"
    minio_export_bucket: str = "export"
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

    # v0.10.26 · 模型市场「容器直连观测」面板要观测的后端容器 URL 列表 (CSV / JSON list)。
    # 与项目注册解耦: 即使没有任何项目注册 backend, 运维也能在模型市场直连这些容器看
    # 健康度 / 变体目录 / 试启动。留空时回退到 [ml_backend_default_url] (若其非空)。
    # NoDecode: 关掉 pydantic-settings 对该字段的 JSON 自动解码, 否则 CSV env 值
    # (http://a,http://b) 会在 validator 前被当 JSON 解析失败 → SettingsError。
    ml_backend_observe_urls: Annotated[list[str], NoDecode] = []

    @field_validator("ml_backend_observe_urls", mode="before")
    @classmethod
    def _parse_observe_urls(cls, v):
        """允许 env 用 JSON list 或逗号分隔字符串。"""
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return []
            if v.startswith("["):
                return json.loads(v)
            return [u.strip() for u in v.split(",") if u.strip()]
        return v

    ml_predict_timeout: int = 100
    ml_health_timeout: int = 10

    # v0.11.19 · Prometheus http_sd 服务发现端点 (/api/v1/internal/metrics-targets)
    # 的可选 bearer token。默认空 = 免鉴权 (靠内网/nginx 网段隔离, 与 /metrics 一致);
    # 设为非空时, 该端点校验请求头 Authorization: Bearer <token>, 不匹配返回 401。
    metrics_sd_token: str = ""

    celery_broker_url: str = ""

    # v0.19.5 · 设备感知预标队列路由 (resource_profile.device → Celery 队列)。
    # gpu 默认复用现有 "ml" 队列 (零退化: 老 backend / 混合 device pipeline 仍落此);
    # 全 CPU pipeline 进 "ml.cpu" 队列, 由 CPU worker 组高并发消费。
    # 注意: 改这两个队列名须同步 docker-compose 各 worker 的 -Q 订阅, 否则任务静默积压。
    preannotate_gpu_queue: str = "ml"
    preannotate_cpu_queue: str = "ml.cpu"

    # v0.9.25 · 视频后端帧服务 Wave B。Chunk 与单帧缓存都落在 datasets bucket。
    video_chunk_size_frames: int = 60
    # v0.10.29 · chunk warmup look-ahead: 请求命中 chunk N 时顺带预解码 N+1..N+K。
    # 默认 1 (只 warmup 紧邻的下一个 chunk), 保守且向后兼容; 设 0 完全关闭 warmup。
    video_chunk_warmup_lookahead: int = 1
    video_frame_cache_ttl_days: int = 14
    video_chunk_cache_ttl_days: int = 30
    video_frame_memory_cache_items: int = 64
    video_segment_size_frames: int = 18000
    video_segment_lock_ttl_seconds: int = 300
    video_tracker_window_size_frames: int = 300
    video_tracker_low_confidence_outside_threshold: float = 0.15

    # v0.7.6 · AuditMiddleware 异步化开关。true = 通过 Celery 旁路写 audit_logs；
    # false 或 broker 不可用时，自动 fallback 到原同步路径。
    audit_async: bool = True

    # v0.8.1 · 审计日志冷数据保留月数：超期分区每月 2 日归档到 MinIO 后 DROP。
    audit_retention_months: int = 12

    # v0.8.4 · task_events 异步写入开关。true = Celery 旁路写；false 或 broker 不可用 → 同步 fallback。
    task_events_async: bool = True

    # v0.10.16 · DuckDB 离线分析文件位置。Celery worker 写、FastAPI 进程只读 (read_only)。
    # docker compose 把 host 路径 ./data/duckdb 挂到 worker /var/lib/duckdb；API 跑 host
    # 时直接读 host 文件 (默认锚定仓库根，见 _REPO_ROOT_DUCKDB)。容器与 host 均可通过
    # DUCKDB_PATH env 覆盖。
    duckdb_path: str = _REPO_ROOT_DUCKDB

    # Governance / invitations
    frontend_base_url: str = "http://localhost:5173"
    invitation_ttl_days: int = 7
    allow_open_registration: bool = False
    max_invitations_per_day: int = 30

    # v0.12.0 · 开放注册邮箱验证。None = 按环境派生（production 默认开、dev/staging 默认关），
    # 显式 true/false 覆盖派生（staging 提前联调 / 生产临时兜底）。业务代码只读
    # email_verification_required property，不直接读裸字段。
    require_email_verification: bool | None = None

    # CORS — production 收紧 methods / headers
    cors_allow_methods: list[str] = ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
    cors_allow_headers: list[str] = ["Authorization", "Content-Type", "X-Request-ID"]

    # v0.8.3 · 在线状态心跳：超过该分钟数未刷新 last_seen_at 的 online 用户由
    # Celery beat 任务 mark_inactive_offline 置 offline。前端 30s 心跳 × 10 容差。
    offline_threshold_minutes: int = 5

    # v0.10.25 · Worker 心跳上报间隔（秒）。每个 worker 的心跳 bootstep（v0.11.18，见
    # workers/heartbeat.py）周期写 Redis（key celery:hb:{worker}，TTL = 间隔 × 3），/health/celery 读差值。
    worker_heartbeat_interval_seconds: int = 30

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

    @property
    def email_verification_required(self) -> bool:
        """开放注册是否强制邮箱验证。None → production 开、其它环境关。"""
        if self.require_email_verification is not None:
            return self.require_email_verification
        return self.environment == "production"

    class Config:
        # 用绝对路径让从任何 cwd 起 uvicorn 都能读到 repo root .env
        env_file = str(_REPO_ROOT_ENV)
        # `.env` 中包含若干 VITE_* 前端变量（VITE_API_URL / VITE_SENTRY_DSN /
        # VITE_TURNSTILE_SITE_KEY 等）；pydantic-settings 2.13 起 extra 默认
        # 为 "forbid"，会让本地 dev 启动失败。这里显式忽略，让前后端共用一份 .env。
        extra = "ignore"


settings = Settings()
