---
audience: [dev, ops]
type: reference
since: v0.11.19
status: stable
last_reviewed: 2026-05-28
---

# 内部 API 端点

`/api/v1/internal/*` 是只给内网消费方 (Prometheus / 内部脚本) 调用的端点, **不进 OpenAPI 公开 schema** (`include_in_schema=False`), 同时在 `infra/docker/nginx.conf` 显式 `deny all + return 404`, 与根路径 `/metrics` 一样靠"反向代理不转发"做网段隔离。直连 api 容器 (例如同 docker network 内的 prometheus) 才能访问。

可选的全局 bearer token: env `METRICS_SD_TOKEN` 非空时, 所有 `/internal/*` 端点强制校验 `Authorization: Bearer <env>` (常量时间比较, 不匹配返回 401); 为空则免鉴权。

## GET /api/v1/internal/metrics-targets

Prometheus [`http_sd_config`](https://prometheus.io/docs/prometheus/latest/http_sd/) 期望的 JSON 服务发现端点, 从 `ml_backends` 表动态生成 ML backend 的 scrape target 列表。

**消费方**: `infra/prometheus/prometheus.yml` 的 `ml-backends` job。新 backend 在超管「模型市场」注册即被自动纳入抓取, 无需手改 prometheus.yml。

**过滤规则**: `state != "disconnected"` 的 backend 进入 target 列表。这意味着 `state="error"` (health 探活失败) 仍在列, 会被 `MLBackendDown` 告警捕获 —— 这是设计意图。运维带外维护时请先把 backend 置 `disconnected`, 否则 5m 后触发告警。

**去重**: `ml_backends` 是 project-scoped, 同一物理 backend 在不同 project 下可能多条记录, 按 `host:port` 去重 (首条胜出)。

**实现**: [apps/api/app/api/v1/internal.py](https://github.com/yyq19990828/ai-annotation-platform/blob/main/apps/api/app/api/v1/internal.py)

### 响应 schema

返回 JSON 数组, 每项是 Prometheus http_sd 原生格式:

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

| 字段                | 类型   | 含义                                                                                                                                                                                                                            |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `targets[0]`        | string | `host:port`, 由 `ml_backends.url` 剥出 scheme / path 得到                                                                                                                                                                       |
| `labels.service`    | string | `ml_backends.name`。**未加 unique 约束**, 同名 backend 会撞 label; 在 Prometheus 内靠 http_sd 自动注入的 `instance` (= `host:port`) 二次定位 (见 `infra/prometheus/alerts.yml` / `infra/grafana/dashboards/ml-backends.json`)。 |
| `labels.backend_id` | string | `ml_backends.id` (字符串化)                                                                                                                                                                                                     |
| `labels.project_id` | string | `ml_backends.project_id` (字符串化)                                                                                                                                                                                             |

### 鉴权

| 场景                                                              | 行为                        |
| ----------------------------------------------------------------- | --------------------------- |
| `METRICS_SD_TOKEN=""` (默认)                                      | 免鉴权, 仍受 nginx 隔离保护 |
| `METRICS_SD_TOKEN=<token>` + 正确 `Authorization: Bearer <token>` | 200                         |
| `METRICS_SD_TOKEN=<token>` + 缺失/错配 `Authorization`            | 401                         |

生产环境若 internal 端点会被运维网段以外的容器访问, 强烈建议显式设置 `METRICS_SD_TOKEN` 作为第二道闸。

### 示例 curl

```bash
# 默认免鉴权
curl http://anno-api:8000/api/v1/internal/metrics-targets

# 配了 token
curl -H "Authorization: Bearer $METRICS_SD_TOKEN" \
  http://anno-api:8000/api/v1/internal/metrics-targets
```

## 关联文档

- [可观测性总览](/ops/observability/) — Prometheus / Grafana 接入指南
- [环境变量参考 · METRICS_SD_TOKEN](/dev/reference/env-vars#服务发现鉴权)
- [Runbook · ML Backend 不可用](/ops/runbooks/ml-backend-down)
