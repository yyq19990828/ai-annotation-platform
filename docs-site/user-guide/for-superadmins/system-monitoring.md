---
audience: [super_admin]
type: reference
since: v0.8.7
status: stable
last_reviewed: 2026-05-09
---

# 系统监控

平台用 Prometheus + 结构化日志做可观测，超管可从前端「平台概览」看核心指标，深度排查走 Grafana / 直接 PromQL。

## 入口

- 前端：`/dashboard?view=overview`（仅超管）
- Prometheus 端点：
  - `apps/api`：`http://api:8000/metrics`
  - `grounded-sam2-backend`：`http://gpu-host:8001/metrics`

## 关键指标

### API 层

| 指标 | 含义 | 告警阈值（参考） |
|---|---|---|
| `http_requests_total{status=~"5.."}` | 5xx 速率 | > 1% / 5min |
| `http_request_duration_seconds` (P95) | API 延迟 | > 1s / 5min |
| `db_pool_used` / `db_pool_size` | 连接池水位 | 持续 > 80% |
| `redis_pool_used` | Redis 连接池 | — |

### Worker 层

| 指标 | 含义 |
|---|---|
| `celery_tasks_total{status="success"\|"failure"}` | task 成败率 |
| `celery_task_duration_seconds` | 任务时长 |
| `prediction_job_total{status=...}` | 预标 job 状态分布（v0.9.8） |

### ML Backend（grounded-sam2-backend）

| 指标 | 含义 |
|---|---|
| `sam_predict_duration_seconds` | 推理延迟 |
| `sam_embedding_cache_hits_total` / `misses_total` | LRU 缓存命中率（v0.9.1） |
| `gpu_memory_used_bytes` | 显存水位 |

详细 PromQL 见 [可观测性 / 监控](../../dev/monitoring)。

## 日志

所有服务输出结构化 JSON 日志（`structlog`）。常用 grep：

```bash
# 看某 job 的全链路
docker logs ai-annotation-platform-celery-worker-1 2>&1 | grep <job_id>

# 看 5xx
docker logs ai-annotation-platform-api-1 2>&1 | jq 'select(.status>=500)'
```

生产环境建议接 ELK / Loki 集中。

## 健康检查端点

| 服务 | 路径 | 含义 |
|---|---|---|
| api | `/health` | DB + Redis + MinIO 联通性 |
| api | `/ready` | lifespan 完成 |
| grounded-sam2-backend | `/health` | 模型加载完成 |

⚠️ FastAPI lifespan 阻塞会让 `/health` 30s 内不可用——曾在 CI 引发卡死，详见 [CI 服务依赖踩坑](../../dev/troubleshooting/ci-flaky-services)。

## 错误监控

前后端错误打到 Sentry（DSN 见 `.env`）。前端 BUG 反馈侧通过 `BugReportDrawer` 入 `bug_reports` 表（`docker exec ... psql` 即可查询，详见 CLAUDE.md 末尾）。

## 容量规划经验值

| 资源 | 经验值 |
|---|---|
| 每标注员日均 200 任务 → API 流量 ~1 req/s 长尾 | — |
| 每 SAM 推理 P95 ~800ms（A10G）/ ~3s（CPU fallback） | — |
| 单 GPU 并发 4 推理稳定 | — |
| Postgres 连接池建议 = (worker concurrency + api concurrency) × 1.5 | — |

## 备份

- Postgres：`pg_dump` 每日 + WAL 归档
- MinIO：bucket 镜像到对象存储或外部 S3
- Redis：可丢（broker），不需要备份
- SAM 缓存：可丢（性能优化）

详见 [部署拓扑](../../dev/architecture/deployment-topology)。
