---
audience: [ops]
type: how-to
since: v0.1.0
status: stable
last_reviewed: 2026-05-27
---

# 部署指南

> 适用读者：第一次把平台搬到 staging / production 的运维或开发者。
>
> 当前部署形态：API + Web 进程式跑（Node + Python），基础设施（PG / Redis / MinIO / Celery）走 docker-compose。完整 K8s / Terraform 模板暂未维护。
>
> 想先理解开发态 / staging / 生产态的整体差异（谁进容器、profile、`ENVIRONMENT` 断言行为），先读[运行环境形态](/dev/concepts/runtime-environments)。

---

## 1. 拓扑

```
┌─ Reverse Proxy (nginx / Caddy) ─ TLS 终结
│   │
│   ├── /api/*  → FastAPI (uvicorn, port 8000)
│   ├── /ws/*   → FastAPI WS（同进程）
│   ├── /metrics → 只允许内网 / 监控网段
│   └── /*       → 静态站点（pnpm build:web 产物）
│
├─ Postgres 16
├─ Redis 7              （Celery broker + Pub/Sub + 限流 + token 黑名单）
├─ MinIO               （或 S3 / OSS 兼容存储）
├─ Celery worker × N   （default,ml,media,gpu,cleanup,audit 队列）
├─ Celery worker (export) （独立 export 队列，导出大任务资源隔离，v0.10.27）
├─ Celery beat × 1     （单实例！定时任务：审计归档 / PerfHud 推送 / ml health 巡检，v0.9.11）
└─ ML backend（可选，GPU profile）：grounded-sam2 (8001) / sam3 (8002)
```

> **Celery beat 必须单实例**：worker 可水平扩多副本，但 beat 多实例会重复触发定时任务。进程式部署务必单独跑 beat（见 §4.3），漏了它则审计归档、PerfHud、ml health 等全部静默失效。

最小生产部署：1 台 4C8G + 1 个独立 PG 实例（托管 RDS 优先）。

---

## 2. 环境变量

平台通过 pydantic-settings 加载，源文件：`apps/api/app/config.py`。本节按 [`.env.example`](https://github.com/yyq19990828/ai-annotation-platform/blob/main/.env.example) 的分块结构介绍；标 **必填** 的在 `ENVIRONMENT=production` 启动时会触发断言失败。

> 生产部署：基于 `.env.example` 复制 `.env.production`，逐项审过再启动。`config.py` 里有几个未列入 `.env.example` 的可选项，统一在 §2.10 兜底。

### 2.1 数据库 (PostgreSQL)

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` **必填** | dev 连本机 | asyncpg 连接串，格式 `postgresql+asyncpg://用户名:密码@主机:端口/库`。驱动必须 `postgresql+asyncpg`；托管库走 SSL 用 `?ssl=require`（asyncpg **不认** `sslmode=`）。密码含特殊字符要 URL 编码（`@`→`%40`）。生产用托管 RDS / Cloud SQL 优先。 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `user` / `pass` / `annotation` | 仅 `docker-compose.yml` 的 postgres 容器初始化用，后端不读。**沿用 compose 自带 postgres 时**生产须设强凭据，且与 `DATABASE_URL` 的用户名/密码/库名一致；用托管库时忽略。 |

迁移在容器外手动跑：`uv run alembic upgrade head`。详见 §4.2。

### 2.2 缓存 / 消息队列 (Redis)

| 变量 | 默认 | 说明 |
|---|---|---|
| `REDIS_URL` **必填** | `redis://localhost:6379/0` | 同时承担：Celery broker、result backend、WebSocket pub/sub、限流计数、token 黑名单，无需单独配置。 |
| `CELERY_BROKER_URL` | 空 → 复用 `REDIS_URL` | 想拆开 broker（如换 RabbitMQ）时单独设。 |

> Redis 建议为生产挂 AOF volume——dev 容器**没**挂 volume，重启即清空所有队列与限流计数。详见 [后端基础设施](/dev/concepts/backend-infrastructure)。

### 2.3 对象存储 (MinIO / S3 兼容)

| 变量 | 默认 | 说明 |
|---|---|---|
| `MINIO_ENDPOINT` **必填** | `localhost:9000` | host:port，**不含**协议前缀。S3 / OSS 走兼容协议时填它们的 endpoint。 |
| `MINIO_ACCESS_KEY` **必填** | `minioadmin` | 等价 AWS Access Key ID。 |
| `MINIO_SECRET_KEY` **必填** | `minioadmin` | 生产**必须**换。 |
| `MINIO_BUCKET` | `annotations` | 主标注文件桶（图像 / 视频帧）。 |
| `MINIO_DATASETS_BUCKET` | `datasets` | 上传 dataset 桶。 |
| `MINIO_BUG_REPORTS_BUCKET` | `bug-reports` | bug 反馈附件桶。 |
| `MINIO_PUBLIC_URL` | 空 | 客户端拿 presigned URL 时走的外网地址；与 `MINIO_ENDPOINT` 不同时必填（容器内/外网络两层视角）。 |
| `MINIO_USE_SSL` | `false` | 生产建议 `true`（即便 LB 终结 TLS，到对象存储一段也建议加密）。 |
| `ML_BACKEND_STORAGE_HOST` | 空 | dev 桥接：api 跑 host 进程时，docker 内的 ML backend 不能 hit `localhost:9000`。Linux `172.17.0.1:9000` / macOS `host.docker.internal:9000`；K8s 同 namespace 留空。 |
| `ML_BACKEND_DEFAULT_URL` | 空 | ML Backend 注册表单 URL 预填值，避免运维手敲；K8s 设 service DNS 即可。 |

### 2.4 认证 / 安全

| 变量 | 默认 | 说明 |
|---|---|---|
| `SECRET_KEY` **必填** | `change-this-...` | JWT 签名密钥，≥ 32 字节随机串。`ENVIRONMENT=production` 仍是默认值时启动会 RuntimeError（`apps/api/app/main.py:50-57`）。生成：`python -c "import secrets; print(secrets.token_hex(32))"`。 |
| `ALLOW_OPEN_REGISTRATION` | `false` | 自助注册开关，可在 SettingsPage 热更新覆盖。 |
| `REQUIRE_EMAIL_VERIFICATION` | 空（按环境派生） | 开放注册是否强制邮箱验证。留空时 production 默认开、dev/staging 默认关；显式 `true`/`false` 覆盖。开启后注册需点邮件链接验证才能登录，邀请注册恒视为已验证。依赖 SMTP 配置（未配时验证链接仅写日志）。 |
| `TURNSTILE_ENABLED` | `false` | Cloudflare Turnstile CAPTCHA。开启后 `/auth/register-open` `/auth/forgot-password` 必须带 `captcha_token`。 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 空 | 启用 Turnstile 时配套；secret 绝不暴露给前端。 |
| `AUDIT_RETENTION_MONTHS` | `12` | 冷数据保留月数。Celery beat 每月 2 日把超期 partition 归档为 `audit-archive/{YYYY}/{MM}.jsonl.gz` 上 MinIO 后 DROP。 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440`（24h） | 未列入 `.env.example`；高敏环境调到 `480`（8h）。 |

### 2.5 前端

> 前端 API base 是硬编码的同源相对路径 `/api/v1`（`apps/web/src/api/client.ts`），**不读 `VITE_API_URL`**——dev 由 vite proxy、生产由 web 容器内 nginx 反代 `/api/`→`api:8000`，故无需构建时注入 API 地址。

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_TURNSTILE_SITE_KEY` | 空 | 与后端 `TURNSTILE_SITE_KEY` 一致；空则注册页不渲染 widget。 |
| `VITE_SENTRY_DSN` | 空 | 前端 Sentry DSN；留空禁用前端错误上报。 |
| `FRONTEND_BASE_URL` | `http://localhost:5173` | 后端在邮件 / 邀请链接里回跳到这个 origin；生产必改成实际域名。 |

### 2.6 错误监控 (Sentry)

| 变量 | 默认 | 说明 |
|---|---|---|
| `SENTRY_DSN` | 空 | 后端 DSN；留空完全不启用 SDK（不会偷偷上报）。 |
| `SENTRY_ENVIRONMENT` | `development` | 环境标签 → Sentry 看板按 `development / staging / production` 分组。 |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | 性能追踪采样率（0–1）。流量大时按比例降。 |

> production 启动若 `ENVIRONMENT=production` 但 `SENTRY_DSN` 为空，lifespan 会打 WARN（不阻断启动），便于 Sentry 失踪不悄悄发生。

### 2.7 跨域 (CORS)

| 变量 | 默认 | 说明 |
|---|---|---|
| `CORS_ALLOW_ORIGINS` **production 必填** | dev 默认放行 localhost 常用端口 | 支持 JSON 数组 `["https://app.example.com"]` 或逗号分隔。即便前后端同源也要显式列；`main.py:71-74` 启动断言。 |
| `CORS_ALLOW_ORIGIN_REGEX` | dev `http://localhost:\d+` | 仅 `dev / staging` 生效，production 自动忽略以防误把本机正则上线。 |

### 2.8 Grounded-SAM-2 ML Backend (GPU profile)

仅当启用 `docker-compose.ml.yml` 的 `--profile gpu` 拉起 grounded-sam2-backend 时生效。详见 §8.5。

| 变量 | 默认 | 说明 |
|---|---|---|
| `SAM_VARIANT` | `tiny` | 精度 / 显存递增：`tiny` → `small` → `base_plus` → `large`（4060 8G 选 tiny）。 |
| `DINO_VARIANT` | `T` | `T`（Swin-T 默认）/ `B`（Swin-B 更准但显存翻倍）。 |
| `BOX_THRESHOLD` | `0.35` | DINO 检测阈值；召回不足 → `0.25`，误检多 → `0.45`。 |
| `TEXT_THRESHOLD` | `0.25` | DINO 文本-标签匹配阈值；短语 prompt 一般 0.25 即可。 |
| `GSAM2_LOG_LEVEL` | `INFO` | `DEBUG / INFO / WARNING`。 |
| `MODEL_POOL_CAP` | `1` | 同容器内并存的 `(sam_variant, dino_variant)` 变体数上限（LRU 驱逐）。`1` = 维持单变体常驻；切变体走「驱逐旧 + 冷启新」。按显存预算调，见下表。 |
| `MODEL_POOL_BUILD_TIMEOUT` | `30` | pool 满 + 并发 miss 时排队等显存腾挪的超时（秒），超时返回 503「显存繁忙，稍后重试」。 |
| `PREFETCH_SAM_VARIANTS` | `tiny,small,base_plus,large` | entrypoint 启动时额外预拉的 SAM 变体 checkpoint（主变体 `SAM_VARIANT` 之外）。逗号分隔。pool 能服务多变体，但只有这里声明（+ 主变体）的 checkpoint 会落盘，**运行期请求未预拉的变体返回 503**。磁盘紧张时裁剪。 |
| `PREFETCH_DINO_VARIANTS` | `T,B` | 同上，GroundingDINO 变体。 |
| `IDLE_UNLOAD_SECONDS` | `600` | 空闲 N 秒后自动卸载模型释放显存；`<=0` 关闭定时卸载（仍可手动 `POST /unload`）。 |
| `IDLE_CHECK_INTERVAL` | `60` | 上面空闲判断的轮询间隔（秒）。 |
| `VIDEO_MODEL_POOL_CAP` | `1` | v0.10.35 · sam2_video tracker 的**独立**显存池上限，与图片池预算分离、互不驱逐。 |
| `VIDEO_MODEL_POOL_BUILD_TIMEOUT` | `60` | video 池满 + 并发 miss 时排队等显存的超时（秒）。 |
| `VIDEO_TRACKER_MAX_WINDOW_FRAMES` | `300` | 单次 `init_state` 一次性加载的最大帧数（安全上限，防超长窗口灌爆显存）。 |
| `VIDEO_IDLE_UNLOAD_SECONDS` | `600` | video 池独立 idle 卸载（与图片池 `IDLE_UNLOAD_SECONDS` 各自计时）；`<=0` 关闭。 |

> **多变体 checkpoint 预拉**：ModelPool 让运行期能切任意 `(sam_variant, dino_variant)`，但 checkpoint 必须先落盘。磁盘预算大致 `tiny ~150M / small ~180M / base_plus ~320M / large ~900M`，DINO `T ~680M / B(SwinB) ~940M`；全量约 3.2GB。
>
> 启动顺序（避免全量 ~3GB 阻塞期间容器对外 `error`）：entrypoint 只**阻塞**下载主变体（`SAM_VARIANT`/`DINO_VARIANT`，单档、秒级）→ uvicorn 立即起、`/health` 可达 → app startup 后台异步下载 `PREFETCH_*` 列表里的额外变体（边服务边补）。`/health.provisioning.status` 反映进度：`downloading`（额外变体下载中，容器仍 healthy）→ `ready`（全下完）/ `partial`（部分失败）/ `error`。下载期间请求尚未下完的变体返回 503（可诊断），主变体始终可用。主变体下载失败则容器启动失败（不带半残上线）；额外变体失败仅 warn 不阻塞。
>
> **按显存预算配 `MODEL_POOL_CAP`**：变体热切换让前端可按会话切 `(sam_variant, dino_variant)`，pool 把多个变体常驻显存以省冷启。cap 越大并存越多、切换越快，但显存占用线性上升（单变体 tiny/small ~2–4GB，large + SwinB 峰值 ~6–8GB）。
>
> | GPU | 显存 | 建议 `MODEL_POOL_CAP` | 说明 |
> |---|---|---|---|
> | RTX 4060 | 8G | `1` | 仅够单变体常驻；切变体冷启 1–3s，可接受。 |
> | RTX 3090 | 24G | `1–2` | 2 时 tiny/large 可并存，切换无冷启。 |
> | A100 | 40/80G | `2–4` | 多变体并存，团队多人并发切换最顺。 |
>
> cap 设过大触发 OOM 时，pool 在驱逐前先腾位（驱逐到 cap-1 再 build 新变体），并发 miss 排队超 `MODEL_POOL_BUILD_TIMEOUT` 返回 503 而非 OOM。保守起步用 `1`，观察 `/health.pool.evict_count` 与显存占用再调高。

### 2.8.1 SAM 3 ML Backend (gpu-sam3 profile)

v0.10.0+ 的高精度 backend（`facebookresearch/sam3` + `facebook/sam3.1` 权重），独立 profile `gpu-sam3`，与 grounded-sam2 的 `gpu` profile 解耦、两者可并存（sam3 高精度首选，grounded-sam2 4060 友好兜底）。仅当启用 `docker-compose.ml.yml` 的 `--profile gpu-sam3` 拉起 sam3-backend 时生效，监听 `8002`。

| 变量 | 默认 | 说明 |
|---|---|---|
| `HF_TOKEN` **必填** | 空 | sam3.1 权重是 gated repo（~3.2GB），首次启动下载必须带；`start_period=180s`。 |
| `SAM3_EMBEDDING_CACHE_SIZE` | `32` | 图像 embedding LRU 缓存条数。 |
| `SAM3_SCORE_THRESHOLD` | `0.5` | 检测置信度阈值；召回不足下调、误检多上调。 |
| `SAM3_LOG_LEVEL` | `INFO` | `DEBUG / INFO / WARNING`。 |
| `SAM3_IDLE_UNLOAD_SECONDS` | `600` | 空闲 N 秒自动卸载释放显存（sam3 ~7GB FP16，与 grounded-sam2 并存时强烈建议保留）；`<=0` 关闭。前缀与 grounded-sam2 的 `IDLE_*` 解耦，可独立调。 |
| `SAM3_IDLE_CHECK_INTERVAL` | `60` | 空闲判断轮询间隔（秒）。 |

> 镜像基础 `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel`（比 grounded-sam2 的 2.3.1-cuda12.1 更新，注意宿主 nvidia 驱动需支持 CUDA 12.8）。

### 2.9 部署环境

| 变量 | 默认 | 说明 |
|---|---|---|
| `ENVIRONMENT` **必填** | `development` | `development / staging / production`。决定多个安全开关：CORS 严格断言、SECRET_KEY 默认值检测、Sentry 缺失告警、CORS regex 是否生效等。 |

### 2.10 未列入 `.env.example` 的可选项

`config.py` 支持但 `.env.example` 没列出，按需在 `.env.production` 显式添加：

| 变量 | 默认 | 何时改 |
|---|---|---|
| `MAX_INVITATIONS_PER_DAY` | `30` | 邀请活动期临时调高 |
| `INVITATION_TTL_DAYS` | `7` | 合规要求短链 → `1–3` |
| `ML_PREDICT_TIMEOUT` | `100` 秒 | LLM 慢 backend 调到 ≥ 180 |
| `ML_HEALTH_TIMEOUT` | `10` 秒 | 通常不需动；冷启动慢的 backend 适当上调 |
| `AUDIT_ASYNC` | `true` | broker 故障时回退 `false`（强一致但慢） |
| `TASK_EVENTS_ASYNC` | `true` | 同上，针对 task event 流 |
| `OFFLINE_THRESHOLD_MINUTES` | `5` | 在线状态心跳判断窗口 |
| `LOGIN_CAPTCHA_THRESHOLD` | `5` | 同 IP 登录失败几次后强制 Turnstile |
| `LOGIN_FAILED_WINDOW_SECONDS` | `3600` | 上面失败计数的窗口长度 |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD` `SMTP_FROM` | 空 | 启用密码重置邮件 / bug digest 时配齐 |

---

## 3. 反向代理（nginx 示例）

```nginx
upstream anno_api { server 127.0.0.1:8000; }

server {
    listen 443 ssl http2;
    server_name app.example.com;
    ssl_certificate     /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    # WS 长连接（防 LB 把心跳间隔的连接踢掉）
    location /ws/ {
        proxy_pass http://anno_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;        # > 30s 心跳
    }

    location /api/ {
        proxy_pass http://anno_api;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 256m;       # 上传图像/分片
    }

    # 内网 only
    location /metrics {
        allow 10.0.0.0/8;
        deny all;
        proxy_pass http://anno_api;
    }

    location / {
        root /var/www/anno;
        try_files $uri /index.html;
    }
}
```

注意：
- `proxy_read_timeout` 必须 ≥ WS 心跳间隔（30s，`apps/api/app/api/v1/ws.py:33`）。建议 300s 给一定缓冲。
- `X-Forwarded-For` 是必传——审计日志的 IP 字段从这里拿（`apps/api/app/services/audit.py:69-77`）。
- Web 静态资源上 `Cache-Control: public, max-age=31536000, immutable` 给 hashed assets，HTML 走 `no-cache`。

---

## 4. 启动顺序

### 4.1 基础设施

```bash
docker compose up -d postgres redis minio
```

`docker-compose.yml` **默认（不带 `--profile`）** 会起 7 个 service：postgres / redis / minio / mailpit / `celery-worker` / `celery-worker-export` / `celery-beat`；GPU backend（profile `gpu` / `gpu-sam3`）与监控（profile `monitoring`）按需单独启用。mailpit 只是 dev SMTP 收件箱，**生产应禁用并改用真实 SMTP**（见 §2.10）。API/Web 当前推荐进程式跑（开发时也是这样）。

### 4.2 API（uvicorn）

```bash
cd apps/api
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

`--workers 4` 仅对 sync code 有意义，但 FastAPI async 路由也能利用。建议用 `--workers $(($(nproc) * 2 + 1))` 或挂 systemd 单元。

### 4.3 Celery worker

```bash
cd apps/api
uv run celery -A app.workers.celery_app worker -l info -Q default,ml,media,gpu,cleanup,audit --concurrency=4
```

队列含义（worker 必须订阅全部 6 个，否则未订阅队列的任务静默堆积）：
- `default` — 兜底队列（`task_default_queue`）、PerfHud 推送、心跳、在线状态、分区维护等
- `ml` — 自动预标注、模型调用
- `media` — 图像/视频转码、缩略图、视频帧
- `gpu` — 视频目标追踪
- `cleanup` — 软删清理、效率看板物化视图刷新、DuckDB 同步
- `audit` — 审计日志 / task event 批量入库

或直接用 `docker compose up -d celery-worker`（已配置好）。

#### 导出专用 worker（v0.10.27）

`export` 队列由独立 worker 处理，让导出大任务资源隔离、不拖累预标 / 媒体处理。上面那个主 worker **不订阅** `export`，所以进程式部署必须再起一个：

```bash
cd apps/api
uv run celery -A app.workers.celery_app worker -l info -Q export --concurrency=2
```

或 `docker compose up -d celery-worker-export`。

#### Celery beat（必须单实例，v0.9.11）

beat 是定时任务调度进程（审计 partition 月度归档、PerfHud 推送、ml health 巡检等），**必须且只能起一个实例**——多实例会重复触发。worker 可以多副本，beat 不行：

```bash
cd apps/api
uv run celery -A app.workers.celery_app beat -l info --schedule=/tmp/celerybeat-schedule
```

或 `docker compose up -d celery-beat`。漏了 beat 不会报错，但所有定时任务静默不跑。

### 4.4 首个 super_admin（bootstrap_admin）

平台没有「第一个用户自动当管理员」的逻辑。第一次部署后必须手动跑：

```bash
cd apps/api
ADMIN_EMAIL=ops@your-org.com \
ADMIN_PASSWORD='set-a-strong-one' \
ADMIN_NAME='平台管理员' \
uv run python -m scripts.bootstrap_admin
```

脚本：[`apps/api/scripts/bootstrap_admin.py`](https://github.com/yyq19990828/ai-annotation-platform/blob/main/apps/api/scripts/bootstrap_admin.py)。
- 已存在同邮箱用户时跳过（不更新角色）
- 写一行 `audit_logs.action = system.bootstrap_admin`，可在 SettingsPage 审计日志页搜索追溯
- **跑完后立即从 shell history 清除明文密码**，并要求该账号首次登录后改密

### 4.5 Web

```bash
pnpm install --filter @anno/web
pnpm --filter @anno/web build
# 把 apps/web/dist/ rsync 到 nginx 的 root 目录
```

前端调用硬编码同源 `/api/v1`，由托管它的 nginx 反代 `/api/`→后端即可（见 `infra/docker/nginx.conf`），无需构建时配置 API 地址。

---

## 5. 备份与恢复

### 5.1 Postgres

按业务重要度分级：

```bash
# 每日全量（保留 14 天）
pg_dump -Fc -U user -d annotation -f /backup/anno-$(date +%F).pgdump

# WAL 归档（点位恢复）
# postgresql.conf: archive_mode=on, archive_command='cp %p /backup/wal/%f'
```

恢复：
```bash
pg_restore -U user -d annotation_new -j 4 /backup/anno-2026-05-06.pgdump
```

> `audit_logs` 上有 `BEFORE UPDATE/DELETE` 触发器拒绝改写（`apps/api/alembic/versions/0032_audit_log_immutability.py`）。pg_restore 走 COPY，不会被触发器阻断。

### 5.2 MinIO 桶

```bash
# 用 mc client（或 aws s3 sync）按桶同步到异地
mc mirror anno/annotations s3-backup/anno/annotations
mc mirror anno/datasets    s3-backup/anno/datasets
```

桶名见 `MINIO_BUCKET` / `MINIO_DATASETS_BUCKET`（默认 `annotations` / `datasets`）。

### 5.3 Redis

不需要持久备份——Redis 当前只装：
- Celery 队列（短暂）
- 限流计数（5 分钟窗口）
- token 黑名单（≤ token 剩余有效期）
- 通知 Pub/Sub（瞬时）

崩溃影响：用户当下需重新登录、断线 30s 内 publish 的通知可能丢失（兜底 GET 端点会补齐）。

### 5.4 卷存储位置（命名卷 vs 宿主机统一前缀）

`docker-compose.yml` 默认用 **Docker 托管的命名卷**（`pgdata` / `miniodata` / 模型权重 / 监控），数据落在 `/var/lib/docker/volumes/<project>_<vol>`。想把它们集中到宿主机一个统一目录（便于备份、迁移、放到指定磁盘），叠加 `docker-compose.hostvols.yml`：

```bash
export DATA_ROOT=/srv/annotation-data   # 绝对路径
# bind 目录须先建好，Docker 不会自动 mkdir：
mkdir -p "$DATA_ROOT"/{pgdata,minio,gsam2-checkpoints,gsam2-hf-cache,sam3-checkpoints,sam3-hf-cache,prometheus,grafana}
docker compose -f docker-compose.yml -f docker-compose.hostvols.yml up -d
```

不挂这个文件时行为完全不变（仍是命名卷）。想免去每次敲 `-f`，在 `.env` 设 `COMPOSE_FILE=docker-compose.yml:docker-compose.hostvols.yml`。

> 切换不会自动迁移数据：从命名卷转 bind 前，先 `docker compose stop`，把旧卷内容（`docker volume inspect <vol>` 查 `Mountpoint`）`cp` 到 `$DATA_ROOT` 对应子目录，否则容器会以为数据为空。

---

## 6. 升级与迁移 runbook

每次 `git pull` 主分支后：

1. **读 CHANGELOG**：包含 Alembic 迁移的版本需要先确认迁移顺序和回滚策略。
2. **先备份**：`pg_dump` + `mc mirror`（见 §5）。
3. **更新依赖**：
   ```bash
   cd apps/api && uv sync
   pnpm install
   ```
4. **跑迁移**：
   ```bash
   cd apps/api && uv run alembic upgrade head
   ```
   失败立即停下，read 错误日志，**不要**手动 `alembic stamp`（除非熟悉 alembic 内部）。
5. **重启 API + worker**：systemd / supervisor 滚动重启；蓝绿部署优先。
6. **冒烟测试**：
   ```bash
   curl -fsS https://app.example.com/api/v1/health/db | jq
   curl -fsS https://app.example.com/api/v1/health/redis | jq
   curl -fsS https://app.example.com/api/v1/health/minio | jq
   curl -fsS https://app.example.com/api/v1/health/celery | jq
   ```
7. **回滚预案**：`alembic downgrade -1` + 旧 commit 重启。MinIO 数据通常向前兼容；audit_logs 触发器 downgrade 已写在 0032 迁移里。

---

## 7. 健康检查端点

平台暴露多个健康检查（不需鉴权）：

| 端点 | 检查项 | 用途 |
|---|---|---|
| `/health` | 基础进程存活 | LB liveness |
| `/health/db` | PG 可读 | k8s readinessProbe |
| `/health/redis` | Redis ping | 同上 |
| `/health/minio` | MinIO bucket 存在 | 同上 |
| `/health/celery` | broker + 一个 worker 应答 | DataDog / Grafana |
| `/metrics` | Prometheus exposition | 仅内网 |

LB 配置 `livenessProbe → /health`、`readinessProbe → /health/db`。`/metrics` 不要暴露公网（包含 path 维度 label，可能泄露内部路由）。

---

## 8. 常见问题

**Q: API 启动时报 `PRODUCTION ENVIRONMENT DETECTED WITH DEFAULT SECRET KEY`**
A: `ENVIRONMENT=production` 但 `SECRET_KEY` 是默认值。生成强随机：`python -c "import secrets; print(secrets.token_hex(32))"`。

**Q: production 启动时报 `production 环境必须显式设置 CORS_ALLOW_ORIGINS`**
A: 即使前后端同源也要设。回填 `CORS_ALLOW_ORIGINS=["https://app.example.com"]`。

**Q: WS 频繁掉线，前端控制台报 1006**
A: 检查 nginx `proxy_read_timeout`。默认 60s 会被 30s 心跳保住，但反代链路上还有别的 LB（云厂商 ALB / WAF）也要 ≥ 60s。

**Q: `uv run alembic upgrade head` 报 `psycopg2 not installed` / 类似错误**
A: 这个项目用 asyncpg。Alembic 配置在 `apps/api/alembic.ini` 里指向 `app.db.base`，确保 `DATABASE_URL` 走 `postgresql+asyncpg://`。

**Q: ML Backend 测试连接 504**
A: 接入方实现的 `/health` 没在 `ml_health_timeout`（10s）内返回。如果你的 backend 冷启动慢，调高 `ML_HEALTH_TIMEOUT`，或在 backend 侧加 warm-up endpoint。详见 [`ml-backend-protocol.md`](/dev/reference/ml-backend-protocol)。

---

## 8.5 GPU 节点部署

ML backend（grounded-sam2-backend / sam3-backend 等）需要 nvidia GPU。本节给出 docker-compose 最小落地。

### docker compose 启用 GPU service

三个 backend 定义在叠加文件 `docker-compose.ml.yml`（从基础 `docker-compose.yml` 拆出，profile-gated 且与核心 infra 无 depends_on / 不共享数据卷），各有独立 profile，可单独启用也可并存。启用时须同时 `-f` 两个文件：

```bash
# 默认不启任何 GPU service（基础栈不含 ML backend，节约本地资源）
docker compose up -d

# 启 grounded-sam2（profile gpu，端口 8001）
docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu up -d grounded-sam2-backend

# 启 sam3（profile gpu-sam3，端口 8002）
docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu-sam3 up -d sam3-backend

# 启 yolo（profile gpu-yolo，端口 8003）
docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu-yolo up -d yolo-backend
```

> 嫌每次敲两个 `-f` 麻烦，可在 shell 或 `.env` 固化 `COMPOSE_FILE=docker-compose.yml:docker-compose.ml.yml`，之后 `docker compose --profile gpu up -d grounded-sam2-backend` 即可（profile-gated 不影响默认 `docker compose up`）。

要点：

- 镜像基础：grounded-sam2 = `pytorch/pytorch:2.3.1-cuda12.1-cudnn8-devel`，sam3 = `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel`（**devel 必需**：GroundingDINO 算子要 nvcc 现场编译；sam3 的 CUDA 12.8 要求宿主驱动够新）
- nvidia device reservation 已配置；需要 host 装 nvidia-container-toolkit
- healthcheck `start_period`：grounded-sam2 `120s`（冷启加载 ~80-100s）、sam3 `180s`（下载 ~3.2GB gated 权重）
- 显存 / 变体相关 env 见 §2.8（grounded-sam2）与 §2.8.1（sam3）；两者 `IDLE_*` / `MODEL_POOL_*` 前缀解耦，可独立调

### dev 跨容器存储访问（`ML_BACKEND_STORAGE_HOST`）

平台 api 跑 host 进程、SAM 容器跑 docker 网内时，SAM 无法访问 host `localhost:9000` MinIO，platform api 端 `_resolve_task_url` 会按 env 把 host 重写：

```bash
# .env
ML_BACKEND_STORAGE_HOST=172.17.0.1:9000   # docker bridge gateway
```

K8s 同 namespace 部署时一般留空（直接走 service DNS）；跨 namespace / 跨集群时按需配。详见 ADR-0012。

### `/health` 显存监控

backend `/health` 返回新增 `gpu_info` / `cache` 子对象，便于运维一眼看显存占用 + cache hit rate：

```json
{
  "ok": true,
  "gpu": true,
  "gpu_info": {
    "device_name": "NVIDIA RTX 4060",
    "memory_used_mb": 4280,
    "memory_total_mb": 8188,
    "memory_free_mb": 3908
  },
  "cache": { "size": 12, "max_size": 16, "hits": 248, "misses": 92 },
  "model_version": "grounded-sam2-dinoT-sam2.1tiny",
  "loaded": true
}
```

两个 backend 的 `/metrics`（GPU 利用率/显存/温度/功耗、推理延迟、cache 命中、容器 CPU/内存）由 Prometheus 的 `ml-backends` job **自动发现并抓取**（v0.11.19）：该 job 用 `http_sd_config` 从 anno-api 的 `/api/v1/internal/metrics-targets` 拉 target，真相源是 `ml_backends` 表 —— **新 backend 在超管注册即被纳入，无需改 `prometheus.yml`**。指标统一为裸名 + `service` label 区分 backend，Grafana 的 `ML Backends` dashboard（v0.11.20）据此渲染。backend 在独立 GPU 机、prometheus 不在同网时，改用该 job 里注释好的 static 兜底。`/cache/stats` 仍单独提供更细的 LRU 内部状态。

> 这套 Prometheus/Grafana 与超管「模型市场」的实时 PerfHud 是**两套通道、同一数据源**（`/metrics` vs `/health` 共用同一次采样）：PerfHud 管"实时一眼看"，Prometheus 管"历史趋势 + 告警"。详见 [可观测性](/ops/observability/)。

### 进一步阅读

- [ADR-0012](/dev/adr/0012-sam-backend-as-independent-gpu-service) — 为什么 SAM backend 独立 GPU 服务化
- [ADR-0013](/dev/adr/0013-mask-to-polygon-server-side) — mask→polygon 后端化决策

---

## 9. 待补（roadmap）

参考 ROADMAP.md：
- HTTPS 强制 / HSTS / CSP middleware（B §安全）
- 审计日志归档按月 PARTITION + S3 冷备（B §治理）
- 真正的 K8s helm chart / terraform module — 暂未维护，进 P3

如团队需要，请先开 issue 讨论需求边界。
