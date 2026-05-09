# 可观测性 / 运维监控

> 适用读者：负责上线运维 / SRE 视角的工程师；需要在 production 看 panel 排查抖动的开发者。

v0.8.7 起 FastAPI `/metrics` 暴露 4 组 Prometheus metrics：

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

v0.8.8 加了 docker-compose `monitoring` profile（默认不启动，避免 dev 多吃 ~200 MB）：

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

## 3. 关键告警建议

不在仓库内强制产出 alert rule（不同团队偏好不一），下面是建议规则：

| 告警 | 触发表达式 | 严重度 |
|---|---|---|
| API p99 > 1s 持续 5min | `histogram_quantile(0.99, sum by (le)(rate(http_request_duration_seconds_bucket[5m]))) > 1` | warning |
| ML Backend 失败率 > 10% | `sum(rate(ml_backend_request_duration_seconds_count{outcome="error"}[5m])) / sum(rate(ml_backend_request_duration_seconds_count[5m])) > 0.1` | critical |
| Celery queue 堆积 > 200 持续 10min | `celery_queue_length > 200` | warning |
| Worker 离线 > 2min | `celery_worker_heartbeat_seconds > 120` | critical |
| Sentry DSN 未配置 production | (启动日志 WARN，配合 deploy.md checklist) | one-shot |

---

## 4. 关键文件索引

| 主题 | 路径 |
|---|---|
| Metrics 定义 | `apps/api/app/observability/metrics.py` |
| FastAPI `/metrics` 挂载 | `apps/api/app/main.py:108-130` |
| Sentry 初始化 | `apps/api/app/main.py:22-45` |
| Grafana dashboard JSON | `infra/grafana/dashboards/anno-overview.json` |
| Grafana provisioning | `infra/grafana/provisioning/` |
| Prometheus scrape | `infra/prometheus/prometheus.yml` |
| docker-compose monitoring profile | `docker-compose.yml` |
| GPU/ML backend 实时浮窗 (PerfHud) | [architecture/perfhud.md](./architecture/perfhud.md) |
