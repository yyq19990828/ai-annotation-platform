---
title: Runbook：Celery Worker 卡死
audience: [ops]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-07-11
---

# Runbook：Celery Worker 卡死

## 症状

- AI 预标注 Job 长时间停在 `running` 状态（超过 15 分钟）
- `docker ps` 中某个 celery worker 容器状态为 `Exited` 或 `Restarting`
- 超管失败预测页面无新进展

## 快速诊断

```bash
# 1. 查看 Worker 容器状态
docker ps -a | grep celery

# 2. 查看最近日志
docker logs ai-annotation-platform-celery-worker-1 --tail 100
docker logs ai-annotation-platform-celery-worker-gpu-1 --tail 100

# 3. 查看 Redis 队列积压
docker exec ai-annotation-platform-redis-1 redis-cli llen default
docker exec ai-annotation-platform-redis-1 redis-cli llen ml
docker exec ai-annotation-platform-redis-1 redis-cli llen gpu
```

## 处理步骤

### 情况 A：容器已退出

```bash
docker compose up -d celery-worker celery-worker-gpu celery-worker-cpu celery-worker-export
```

只启动实际消费该队列的 worker：默认队列组为 `celery-worker`（`default,media,cleanup,audit`），GPU 预标和视频追踪为 `celery-worker-gpu`（`ml,gpu`），CPU 预标为 `celery-worker-cpu`（`ml.cpu`），导出为 `celery-worker-export`（`export`）。重启后对应 worker 会自动认领 pending 任务。

### 情况 B：容器运行但无进展（Worker 卡死）

```bash
# 默认队列组；视频追踪 / GPU 预标改为 celery-worker-gpu
docker compose restart celery-worker

# 观察日志确认 Worker 已就绪
docker logs -f ai-annotation-platform-celery-worker-1
# 看到 "ready." 即正常
```

### 情况 C：代码变更后 Worker 运行旧版本

Celery worker 无热重载。改动后必须重启加载该模块的容器；改预标或 tracker 代码时通常需要重启 GPU worker：

```bash
docker compose restart celery-worker-gpu

# 验证运行的是最新代码
docker exec ai-annotation-platform-celery-worker-gpu-1 \
  python -c "import inspect, app.workers.tasks as t; print(inspect.signature(t.batch_predict))"
```

### 情况 D：Redis 连接失败

```bash
# 检查 Redis 容器
docker ps | grep redis
docker logs ai-annotation-platform-redis-1 --tail 50

# 重启 Redis（注意：会清空内存中的任务队列）
docker compose restart redis

# 之后重启 Worker
docker compose restart celery-worker
```

## 预防措施

- 生产环境建议为 Celery Worker 配置进程守护（systemd / supervisord）
- 设置 `CELERY_TASK_SOFT_TIME_LIMIT` 防止单任务永久阻塞
- 监控 `celery_queue_length` 指标（见 [监控与告警](/ops/observability/)）

## 相关文档

- [AI 预标注流水线](/user-guide/workflows/ai-preannotate-pipeline)
- [失败预测恢复流程](/user-guide/workflows/failed-prediction-recovery)
- [调试 Celery](/dev/how-to/debug-celery)
