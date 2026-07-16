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

- 该 job 用 `http_sd_config` 定期拉 anno-api 的 `/api/v1/internal/metrics-targets`，端点从 `ml_backend_registry`（`state != disconnected`）生成 target 列表并按 host:port 去重。**新 backend 在超管「模型市场」注册即被纳入抓取**，与 PerfHud 共用同一真相源。响应即 Prometheus http_sd 原生格式（`include_in_schema=False`，不入 OpenAPI；实现 `apps/api/app/api/v1/internal.py`）：

  ```json
  [
    {
      "targets": ["grounded-sam2-backend:8080"],
      "labels": {
        "service": "grounded-sam2",
        "backend_id": "1",
        "project_id": "1"
      }
    }
  ]
  ```

  鉴权可选：`METRICS_SD_TOKEN` 非空时端点校验 `Authorization: Bearer <env>`，否则免鉴权（与 `/metrics` 同走 nginx `/internal` 网段隔离）。

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

## 5. ML Backend pool 观测口径 (v0.14.14)

各 backend 的 `/health.pool` 统一为 `PoolStatus`（协议 §4.3），运维 / 模型市场都从同一结构读：

```jsonc
{
  "pool": {
    "cap": 4,
    "current_size": 2,
    "loaded_keys": [
      {
        "key": "yolov11/s/detection",     // backend-defined opaque string
        "loaded_at": "2026-06-08T03:11:22Z",
        "last_used_at": "2026-06-08T03:15:00Z",
        "hit_count": 12                   // 累计命中次数 (不含 warmup)
      }
    ],
    "last_evict": {
      "key": "yolov8/x/detection",
      "at": "2026-06-08T03:14:00Z",
      "reason": "lru"                     // 受控: lru | manual | idle_timeout
    }
  }
}
```

**key 命名约定**（backend 自由选择，平台只做相等匹配）：

| backend | key 形式 |
|---|---|
| yolo-backend | `{series}/{size}/{task}`，如 `yolov11/s/detection` |
| grounded-sam2-backend | `sam={sam_variant}/dino={dino_variant}`；video 池另用 `video:sam=…` 区分 |
| sam3-backend | 模型变体字符串如 `sam3`；`cap` 永远 `1` |

**`/predict` 响应观测三件套**（协议 §4.2）：

| 字段 | 用途 |
|---|---|
| `cache_hit: bool \| null` | 本次推理是否命中 pool 内权重；`false` 表本次触发加载（冷启动 / pool evict 后 / 服务重启） |
| `model_load_ms: int \| null` | 本次 disk→GPU 加载毫秒（`cache_hit=True` 时通常 `0`） |
| `pool_state: {current_size, cap} \| null` | 轻量 pool 快照（按需开启，常态 `null` 避免响应体膨胀） |

**前端冷启动 UX**：响应回来后调 `recordPredictCacheHit(backendId, variants, cache_hit)` 写入本会话 Map，下次同 variant 调用前查 `isVariantHot()` 决定按钮文案。pool LRU evict 后误判一次不可避免（前端 Map 还以为热的），但下次响应里 `cache_hit=false` 会自我修正。v0.14.13 的 `sessionStorage` 猜测保留作老 backend (未上报 `cache_hit`) 的 fallback，v0.14.15 删除。

**显式预热（`POST /warmup`）**：运维 / 用户可在不消耗推理算力的前提下把指定 variant 权重加载到 pool。响应 `evicted` 字段回填本次因 cap 上限淘汰的 key 名，供前端 toast 提示。例：

```bash
# 三 backend 的 warmup body 各自定义, 响应统一为 WarmupResponse:
curl -X POST localhost:8003/warmup \
  -d '{"task":"detection","variants":{"series":"yolov11","size":"s"}}' | jq
# {"ok":true,"model_load_ms":4500,"cache_hit":false,"evicted":null}
```

平台代理 `POST /api/v1/projects/{pid}/ml-backends/{bid}/warmup` 把 body 原样转发；upstream 4xx 透传，5xx 502 兜底。

---

## GPU 显存影子决策日志

当全局与资源级 mode 合成为 `observe` 时，API 和各 Celery 派发进程会在发送
predict、交互预测、warmup 或 reload 之前输出 `gpu_arbiter_shadow_decision`。主要字段包括：

- `decision=would-admit|would-evict|would-reject`、`reason`、`operation`；
- 完整 `resource_id`、`allocatable_mb`、`committed_before_mb`、`projected_mb` 和 `shortfall_mb`；
- 仅通过新鲜 residency、managed generation / identity 与空闲安全检查的 `candidates`；
- 保守计费的 `uncertain_backend_ids`、`authoritative=false` 和
  `candidate_order_authoritative=false`。

候选列表只是当前快照中的可行集，不是最终 LRU 顺序。此模式不会调用驱逐、拒绝或排队；
手工 legacy unload 另记 `gpu_arbiter_shadow_unload`，并固定
`releases_allocation=false`。未注册 smoke-test 的直连加载会记
`gpu_arbiter_shadow_unregistered_dispatch`，用来识别无法绑定物理资源的非受管旁路；
未注册 unload 另记 `gpu_arbiter_shadow_unregistered_unload`，不带 `would-*` 决策。

旁路查询超过短超时或数据库不可用时会记 `gpu_arbiter_shadow_observer_failed` 并放行业务请求。
`off` 模式不解析资源配置、不查询影子快照也不产生上述日志。这些日志由各派发进程分别输出，不应把单个 API
进程的内存或日志片段解读为跨进程全局账本。

### GPU 资源账本与修复状态

`GET /api/v1/admin/ml-integrations/gpu-resources` 会同时返回 `rollout_enabled` 和逐资源
`rollout`：PostgreSQL 持久状态、保守 effective/target mode、exact transition/last transition、
revision 与 blocker。`runtime_ready` 只在 desired、持久 `enforcing` 与 Redis ready 同时成立时
才为真。持久状态仍为 `promoting/enforcing/demoting/blocked` 却关闭 release latch，会报
`gpu_rollout_active_while_disabled` blocker，必须先完成安全 demotion。

每个资源的 `runtime` 包含 Redis 账本状态、ready、revision、
证据 deadline、已承诺预算、durable pending/active/retiring 数、allocation 状态数、lease、卡级/backend 级
队列以及 transition。`durable_domain_matches=false` 表示 PostgreSQL 封闭成员域与 Redis 不一致，不能仅凭
Redis 快照继续工作。`prepared` 表示 proof reset 已冻结并可在下一轮恢复；`corrupt/unavailable` 都按
fail-closed 处理。prepared、disabled 或读取失败时，无法原子证明的 child/queue/transition 计数返回 `null`，
不会用 `0` 误报为空。

每轮完整 backend 健康扫描后会输出逐资源 `gpu_arbiter_resource_repair` 结构化日志，包含 action、status、
reason、revision、committed、rollout 结果、GC collection 结果和耗时。release latch 开启后，只有
desired mode 为 `enforce` 的资源运行该控制面；
beat 消息过期、长于任务 hard limit 的防重入锁和 50 秒批次总时限共同阻止慢任务跨分钟堆积；多卡最多四路
并行，并按波次数量均分 45 秒工作预算，确保固定排序后的每张卡都能在本轮获得执行机会。稳定 ready 且不含
retiring 的卡只读
返回，缺失/损坏/过期账本走严格 proof reset。退役 GC 的常见阻塞包括等待 token horizon、
缺少 challenge 回显、residency 未严格 unloaded、仍有 lease/queue/transition，或 registry 已删除而无法重新
探活。每个 tombstone 由不可复用 `retirement_id` 标识，completion receipt 独立保留七天，并以自身收集结果域
承受数据库 sibling 域的后续演进；proof reset 轮换 incarnation 后则必须用新鲜证明重新收集。冻结的退役 health
只用于诊断，不能授权删除 tombstone。

release latch 关闭时，周期 worker 不创建仲裁 Redis client。开启后，纯 `off/observe`
且持久 rollout 已为 `off` 的资源仍返回 `runtime.status=disabled`；若存在未收敛的持久过渡态，
管理查询会保守读取 Redis runtime 供排障。observe 的 shadow 日志仍按上一节工作。worker 结果通过
Celery 结果与进程日志暴露，当前不应把 worker 进程内的普通
Prometheus Gauge 当作 API `/metrics` 可见的跨进程指标。

---

## 6. 关键文件索引

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
