---
audience: [super_admin]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
---

# 失败预测排查

`prediction_jobs.status='failed'` 的记录就是"AI 预标跑过但失败的"——本页讲怎么定位根因。

## 入口

- 超管：`/model-market` → **Failed Predictions** tab
- 项目管理员：`/ai-pre` → **失败预测** tab（v0.9.9 B-2 平移）
- 任何角色：`/ai-pre/jobs` 切「完整历史」 + 状态过滤 = failed

## 失败常见根因

| 错误信号 | 看哪 |
|---|---|
| `Connection refused` / `Name resolution` | [容器网络与 loopback](../../dev/troubleshooting/container-networking) |
| `TypeError: ... unexpected keyword argument` | [Docker rebuild vs restart](../../dev/troubleshooting/docker-rebuild-vs-restart)（worker stale code） |
| ML Backend `422` / `400` | prompt 格式问题——v0.9.9 B-12 起工作台一键预标会自动用项目 alias 拼，避免空 prompt 导致 DINO 422 |
| `Timeout` | ML Backend 推理太慢；看监控 P95 |
| `403` / `401` | API Key 配置错误 |
| 前端看不到候选但 job=succeeded | [Schema 适配器陷阱](../../dev/troubleshooting/schema-adapter-pitfalls) |

## 排查流程

1. **拿 job_id**：从失败 tab 列表点击展开
2. **看 error 字段**：通常包含 ML Backend 返回的 status code + body 摘要
3. **对照 prediction_jobs 时间戳**：
   - `created_at` → `started_at` 间隔大 → broker / worker 拥堵
   - `started_at` → `finished_at` 间隔大 → 推理超时
4. **看 worker 日志**：`docker logs ai-annotation-platform-celery-worker-1 --since 1h | grep <job_id>`
5. **看 ML Backend 日志**：grounded-sam2-backend 在 `/metrics` + 容器日志
6. **复现**：拿 job 的 prompt + 一张样本图，直接 `curl` ML Backend `/predict`

## 重跑

失败 job 不会自动重试（避免雪崩）。手动重跑：

- 项目侧 `/ai-pre`：选回该批次 + 同 prompt + 「跑预标注」
- 重置批次 `pre_annotated` 标记位（项目设置 → 数据 → 重置）后再跑

## 大量失败如何排查

- 模型市场 → Health Overview → 看错误率峰值
- 同一时间窗集中失败 → 多半是 ML Backend 自身挂了，重启容器即可
- 跨多个 backend 同时失败 → 看 worker 容器、Redis、网络

## 监控告警

Prometheus 指标 `prediction_job_failed_total{backend=...}` 可设阈值告警，详见 [监控](../../dev/monitoring)。
