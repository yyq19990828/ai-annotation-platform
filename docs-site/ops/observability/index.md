---
audience: [ops, dev]
type: reference
since: v0.8.7
status: stable
last_reviewed: 2026-05-27
---

# 可观测性 / 运维监控

> 适用读者：负责上线运维 / SRE 视角的工程师；需要在 production 看 panel 排查抖动的开发者。

FastAPI `/metrics` 暴露 Prometheus metrics。超管也可以直接打开 `/admin/health` 查看同一批基础探测的实时摘要；该页面适合快速确认 DB / Redis / MinIO / Celery 是否可用，长期趋势和告警仍以 Prometheus / Grafana 为准。

| Metric | 类型 | Labels | 用途 |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `path`, `status_code` | 请求 QPS / 错误率 |
| `http_request_duration_seconds` | Histogram | `method`, `path` | 请求延迟分位（p50 / p95 / p99） |
| `ml_backend_request_duration_seconds` | Histogram | `backend_id`, `outcome` | ML Backend 调用延迟 |
| `celery_queue_length` | Gauge | `queue` | 各队列堆积（default / ml / media / audit / events） |
| `celery_worker_heartbeat_seconds` | Gauge | `worker` | worker 上次心跳距今秒数 |

定义在 `apps/api/app/observability/metrics.py` 与 `apps/api/app/main.py:108`。

---

## 1. 本地启动监控栈

本地监控栈通过 docker-compose `monitoring` profile 启动（默认不启动，避免 dev 多吃约 200 MB）：

```bash
docker compose --profile monitoring up -d prometheus grafana
```

- Prometheus → http://localhost:9090
- Grafana → http://localhost:3001（admin / admin，dev 默认）

Grafana 启动时自动 provision：
- Datasource `Prometheus`（`infra/grafana/provisioning/datasources/prometheus.yaml`）
- Dashboard 文件夹 `Anno`（`infra/grafana/provisioning/dashboards/default.yaml`）
- Dashboard JSON `Anno Overview`（`infra/grafana/dashboards/anno-overview.json`）

打开 Grafana → Dashboards → Anno → Anno Overview，五个 panel 即可看到当前 stack：HTTP rate / HTTP p95 / ML p50/p95/p99 / Celery queue / Celery worker heartbeat。

> Linux 上 `host.docker.internal` 默认未解析；docker-compose.yml 已显式 `extra_hosts: host.docker.internal:host-gateway`。如果 Docker 版本太旧不支持，把 `infra/prometheus/prometheus.yml` 中的 target 改成宿主机 LAN IP。

---

## 2. Production 部署

production 不建议把 prometheus / grafana 跟应用塞同一 docker-compose（资源 / 升级耦合）。建议：

- 用现有运维栈的 prometheus / grafana 实例
- scrape config 把 `apps/api/openapi.snapshot.json` 那类配置参考 `infra/prometheus/prometheus.yml`，target 改成 internal API 域名 / SRV
- Grafana 一次性 import `infra/grafana/dashboards/anno-overview.json`（点 `+` → Import → Upload JSON）
- 后续 dashboard 升级 = git pull + 再 import 一次（Grafana 选 Replace 即可）

---

## 3. ML Backend GPU 指标接入（自动发现，v0.11.19）

ML backend（grounded-sam2 / sam3 / 后续接入的任意 backend）的 `/metrics` 由 Prometheus 的 `ml-backends` job 自动抓取，**无需手改 `prometheus.yml`**：

- 该 job 用 `http_sd_config` 定期拉 anno-api 的 `/api/v1/internal/metrics-targets`，端点从 `ml_backends` 表（`state != disconnected`）生成 target 列表并按 host:port 去重。**新 backend 在超管「模型市场」注册即被纳入抓取**，与 PerfHud 共用同一真相源。
- 指标统一为**裸名 + `service` label**（不带 backend 前缀），同语义指标靠 label 区分 backend：

| Metric | 类型 | 用途 |
|---|---|---|
| `gpu_utilization_percent` | Gauge | GPU SM 利用率 |
| `gpu_memory_used_mb` / `gpu_memory_total_mb` | Gauge | 显存（占用率 = used/total） |
| `gpu_temperature_celsius` / `gpu_power_watts` | Gauge | 温度 / 功耗 |
| `inference_latency_seconds` | Histogram | 推理延迟（P50/P95 用 `histogram_quantile`） |
| `embedding_cache_hits_total` / `_misses_total` / `embedding_cache_size` | Counter/Gauge | embedding cache 命中与容量 |
| `container_cpu_percent` / `container_memory_percent` | Gauge | 容器 CPU / 内存 |
| `video_tracker_*`（仅 grounded-sam2） | Counter/Histogram | 视频追踪帧数 / 延迟 |

> backend 在独立 GPU 机、prometheus 不在同网时，把 `ml-backends` job 的 `http_sd_configs` 注释掉，改用同 job 里注释好的 static 兜底（target 填 prometheus 视角可达地址）。
>
> **dev 前提**：`pnpm dev:api` 默认 `uvicorn --port 8000`（绑 `127.0.0.1`），prometheus 容器经 host-gateway 抓不到——http_sd 与**既有 `anno-api` job 同此前提**。要在 dev 抓到，用 `uvicorn app.main:app --reload --port 8000 --host 0.0.0.0` 起 api；或按上一条用 static 兜底，target 写 bridge gateway `172.17.0.1:<host 映射端口>`（dev 下 backend 的 service DNS 未必解析）。
>
> 与超管 PerfHud 的关系：两套通道、同一数据源（`/metrics` 与 `/health` 共用同一次 NVML/psutil 采样）。PerfHud 实时一眼看（无历史），Prometheus 留 14d 时序做趋势/告警。Grafana 的 `ML Backends` dashboard（`infra/grafana/dashboards/ml-backends.json`，v0.11.20，provisioning 自动加载）据此渲染。

---

## 4. 告警

**ML backend GPU 告警已落地**（v0.11.21）：`infra/prometheus/alerts.yml` 提供 `MLBackendDown`（`up==0` 持续 5m）/ `GPUMemoryHigh`（显存 >90% 持续 10m）/ `InferenceLatencyHigh`（P95 >10s 持续 10m）三条规则，随 `monitoring` profile 的 `alertmanager`（9093）经 SMTP 发邮件 —— dev 投递到 mailpit（见 `infra/alertmanager/alertmanager.yml`），生产换真实 SMTP。`MLBackendDown` 只覆盖 `ml-backends` job 的 target（由 http_sd 从 `state != disconnected` 的 backend 生成），主动 disconnect 的 backend 不会误报。排查见 [ML Backend 不可用 runbook](/ops/runbooks/ml-backend-down)。

其余 HTTP / Celery / Sentry 相关不在仓库内强制产出（不同团队偏好不一），下面是建议规则：

| 告警 | 触发表达式 | 严重度 |
|---|---|---|
| API p99 > 1s 持续 5min | `histogram_quantile(0.99, sum by (le)(rate(http_request_duration_seconds_bucket[5m]))) > 1` | warning |
| ML Backend 失败率 > 10% | `sum(rate(ml_backend_request_duration_seconds_count{outcome="error"}[5m])) / sum(rate(ml_backend_request_duration_seconds_count[5m])) > 0.1` | critical |
| Celery queue 堆积 > 200 持续 10min | `celery_queue_length > 200` | warning |
| Worker 离线 > 2min | `celery_worker_heartbeat_seconds > 120` | critical |
| Sentry DSN 未配置 production | (启动日志 WARN，配合 deploy.md checklist) | one-shot |

---

## 5. 关键文件索引

| 主题 | 路径 |
|---|---|
| Metrics 定义 | `apps/api/app/observability/metrics.py` |
| ML backend 指标埋点 | `apps/grounded-sam2-backend/observability.py` · `apps/sam3-backend/observability.py` |
| ML backend http_sd 端点 | `apps/api/app/api/v1/` → `GET /api/v1/internal/metrics-targets` |
| ML backend 告警规则 | `infra/prometheus/alerts.yml` |
| Alertmanager 配置 | `infra/alertmanager/alertmanager.yml` |
| FastAPI `/metrics` 挂载 | `apps/api/app/main.py:108-130` |
| Sentry 初始化 | `apps/api/app/main.py:22-45` |
| Grafana dashboard JSON | `infra/grafana/dashboards/anno-overview.json` |
| Grafana provisioning | `infra/grafana/provisioning/` |
| Prometheus scrape | `infra/prometheus/prometheus.yml` |
| docker-compose monitoring profile | `docker-compose.yml` |
| 超管系统健康聚合端点 | `apps/api/app/api/v1/admin_system_health.py` |
| GPU/ML backend 实时浮窗 (PerfHud) | [concepts/perfhud](/dev/concepts/perfhud) |
