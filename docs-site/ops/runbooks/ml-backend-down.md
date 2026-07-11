---
title: Runbook：ML Backend 不可用
audience: [ops]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-07-11
---

# Runbook：ML Backend 不可用

## 症状

- 超管 → ML Backend 注册页面显示 Backend 状态异常
- AI 预标注 Job 失败，错误信息包含 `ConnectionError` 或 `502`
- 工作台 SAM 工具无响应

## 快速诊断

```bash
# 1. 检查 Backend 容器（以内置 SAM 为例）
docker ps | grep sam

# 2. 手动 health check
curl -f http://localhost:8001/health || echo "Backend 不可达"

# 3. 查看日志
docker logs ai-annotation-platform-grounded-sam2-backend-1 --tail 100
```

## 处理步骤

### 情况 A：容器已退出（OOM 或异常）

```bash
docker compose -f docker-compose.yml -f docker-compose.ml.yml \
  --profile gpu up -d grounded-sam2-backend

# 观察启动日志（GPU 加载通常需要 30–60 秒）
docker logs -f ai-annotation-platform-grounded-sam2-backend-1
```

如果反复因 OOM 退出：
- 检查 GPU 显存（`nvidia-smi`）
- 换用更小的 SAM 变体（`SAM_VARIANT=tiny`）

### 情况 B：容器运行但 health check 失败

```bash
# 检查端口映射
docker port ai-annotation-platform-grounded-sam2-backend-1

# 查看详细错误
curl -v http://localhost:8001/health
docker logs ai-annotation-platform-grounded-sam2-backend-1 --tail 200
```

常见原因：模型权重下载未完成 / CUDA 初始化失败。

### 情况 C：外部自部署 Backend 不可达

1. 确认 Backend 服务在目标机器上正常运行
2. 检查网络/防火墙：运行平台 API 的进程是否能访问 Backend URL。
3. 开发态 API 跑在宿主机，直接从宿主机测试：
   ```bash
   curl -fsS http://<backend-host>:<port>/health
   ```
   生产叠加 compose 时，使用 API 容器：
   ```bash
   docker compose --env-file .env.production \
     -f docker-compose.yml -f docker-compose.prod.yml exec api \
     curl -fsS http://<backend-host>:<port>/health
   ```
4. 参考 [容器网络排查](/dev/troubleshooting/container-networking)

### 情况 D：协议版本不兼容

```bash
curl http://localhost:8001/health
# 检查返回的 protocol_version 字段是否与平台要求一致
```

对照 [ML Backend 协议](/dev/reference/ml-backend-protocol) 检查 Backend 实现。

## 维护窗口 / 避免告警

`MLBackendDown` 由 Prometheus `up{job="ml-backends"} == 0` 持续 5m 触发，target 由 http_sd 从 `ml_backends` 表生成，**仅** `state="disconnected"` 的 backend 被排除。换言之 `state="error"`（health 探活失败）仍在 target 列表中，会按设计触发告警。

要做带外维护（停机刷模型 / 换权重等），先把 backend 在超管 → ML Backend 注册页 disconnect，再操作；否则 5m 后会被 `MLBackendDown` 告警炸。

## 影响范围评估

| 受影响功能 | 影响级别 |
|---|---|
| SAM 工具（工作台） | 功能降级，标注员手动框选仍可用 |
| AI 预标注（批量） | 新 Job 会失败；已完成的 Prediction 不受影响 |
| 已有 Annotation | 无影响 |

## 相关文档

- [AI 预标注流水线](/user-guide/workflows/ai-preannotate-pipeline)
- [失败预测恢复流程](/user-guide/workflows/failed-prediction-recovery)
- [AI 模型集成](/dev/concepts/ai-models)
- [ML Backend 协议](/dev/reference/ml-backend-protocol)
- [ML Backend API](/api/guides/ml-backend)
- [Runbook: Celery Worker 卡死](/ops/runbooks/celery-worker-stuck)
