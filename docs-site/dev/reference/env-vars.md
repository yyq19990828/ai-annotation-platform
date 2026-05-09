---
title: 环境变量参考
audience: [dev, ops]
type: reference
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
---

# 环境变量参考

> **自动生成说明**：本页由 `docs-site/scripts/generate-env-vars.mjs` 从 `.env.example` 生成。
> 修改环境变量说明请编辑 `.env.example` 中的注释，再运行 `pnpm docs:gen-env-vars`。

## 数据库（PostgreSQL）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://user:pass@localhost:5432/annotation` | 异步数据库连接串。生产环境替换为真实凭据。 |

## 缓存 / 消息队列（Redis）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379/0` | Redis 连接地址，用于会话缓存、速率限制、Celery Broker。 |

## 对象存储（MinIO / S3 兼容）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO 服务地址（不含协议前缀）。 |
| `MINIO_ACCESS_KEY` | `minioadmin` | 访问密钥（相当于 AWS Access Key ID）。 |
| `MINIO_SECRET_KEY` | `minioadmin` | 密钥（相当于 AWS Secret Access Key）。**生产环境必须更换。** |
| `MINIO_BUCKET` | `annotations` | 存放标注文件的桶名称。 |
| `ML_BACKEND_STORAGE_HOST` | `172.17.0.1:9000` | ML Backend 访问 MinIO 的地址。容器网络中 Backend 无法直接访问 `localhost`，需设为 Docker 网关地址。生产 K8s 环境留空。 |
| `ML_BACKEND_DEFAULT_URL` | `http://172.17.0.1:8001` | ML Backend 注册表单的 URL 预填值。 |

## 认证 / 安全

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SECRET_KEY` | _(示例值)_ | JWT 签名密钥。**生产环境必须替换为高强度随机字符串（≥32 字符）。** |
| `ALLOW_OPEN_REGISTRATION` | `false` | 是否允许开放注册。`true` 任何人可注册（默认 viewer 角色）；`false` 仅管理员可创建账号。v0.8.1+ 可在系统设置中热更新。 |
| `TURNSTILE_ENABLED` | `false` | 是否启用 Cloudflare Turnstile CAPTCHA（v0.8.7+）。启用后注册和忘记密码接口需携带 captcha_token。 |
| `TURNSTILE_SITE_KEY` | — | Turnstile sitekey（与 `VITE_TURNSTILE_SITE_KEY` 保持一致）。 |
| `TURNSTILE_SECRET_KEY` | — | Turnstile siteverify 用的 secret，**绝不可暴露给前端**。 |
| `AUDIT_RETENTION_MONTHS` | `12` | 审计日志保留月数（v0.8.1+）。超期分区归档为 `audit-archive/{YYYY}/{MM}.jsonl.gz` 上传 MinIO 后删除。 |

## 前端

| 变量 | 默认值 | 说明 |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | 前端访问后端 API 的基础 URL（Vite 构建时注入）。部署时改为实际域名。 |
| `VITE_SENTRY_DSN` | — | 前端 Sentry DSN（v0.6.6+）。留空禁用前端错误上报。 |
| `VITE_TURNSTILE_SITE_KEY` | — | Turnstile sitekey（v0.8.7+）。留空时注册页不渲染 CAPTCHA widget。 |

## 错误监控（Sentry）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SENTRY_DSN` | — | 后端 Sentry DSN（v0.6.6+）。留空禁用后端错误上报。 |
| `SENTRY_ENVIRONMENT` | `development` | Sentry 环境标签，用于区分 development / staging / production。 |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | 性能追踪采样率（0.0–1.0）。 |

## 跨域（CORS）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CORS_ALLOW_ORIGINS` | — | 允许的前端来源列表，支持 JSON 数组或逗号分隔字符串。**生产环境必填。** |
| `CORS_ALLOW_ORIGIN_REGEX` | — | 来源正则匹配（仅 dev/staging 生效，production 自动忽略）。 |

## Grounded-SAM-2 ML Backend（v0.9.0+，GPU profile）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SAM_VARIANT` | `tiny` | 模型变体：`tiny` / `small` / `base_plus` / `large`，按精度/显存递增。`tiny` 对 RTX 4060 友好。 |
| `DINO_VARIANT` | `T` | GroundingDINO 变体：`T`（Swin-T）/ `B`（Swin-B，更准但显存翻倍）。 |
| `BOX_THRESHOLD` | `0.35` | DINO 检测阈值。召回不足可下调到 0.25，误检多则上调到 0.45。 |
| `TEXT_THRESHOLD` | `0.25` | DINO 文本-标签匹配阈值。 |
| `GSAM2_LOG_LEVEL` | `INFO` | Backend 日志级别：`DEBUG` / `INFO` / `WARNING`。 |

## 部署环境

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ENVIRONMENT` | `development` | 当前运行环境：`development` / `staging` / `production`，影响 CORS 策略、日志级别、调试开关。 |
