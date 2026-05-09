---
title: 失败预测恢复流程
audience: [super_admin, project_admin]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
---

# 失败预测恢复流程

本文描述当 AI 预标注 Job 失败时如何定位原因并恢复。

## 失败场景

| 场景 | 症状 |
|---|---|
| ML Backend 服务下线 | Job 停在 `running`，Celery 日志出现 `ConnectionError` |
| Backend 返回非 200 | Job 变为 `failed`，超管页面显示错误详情 |
| Celery Worker 崩溃 | Job 状态卡住，`docker ps` 显示 worker 容器已退出 |
| 数据格式不兼容 | 部分 Task 无 Prediction，Backend 日志有 `ValidationError` |

## Step 1：定位失败原因

**方式 A：超管界面**
1. 超级管理员 → **失败预测排查**
2. 查看 Job 状态、错误信息和 Task 级别的失败原因

**方式 B：日志**
```bash
# Celery Worker 日志
docker logs ai-annotation-platform-celery-worker-1 --tail 100

# ML Backend 日志（如 SAM）
docker logs ai-annotation-platform-grounded-sam2-1 --tail 100
```

## Step 2：修复原因

### 场景：ML Backend 服务下线

```bash
# 重启 Backend 容器（根据实际容器名调整）
docker compose restart grounded-sam2-backend

# 验证服务正常
curl http://localhost:8001/health
```

再次触发 Job：项目详情 → AI 预标注 → 重新预标注。

### 场景：Celery Worker 崩溃

```bash
docker compose restart celery-worker
```

Worker 重启后 pending Job 会自动被拾起。详见 [Runbook: Celery Worker 卡死](/ops/runbooks/celery-worker-stuck)。

### 场景：数据格式不兼容

1. 检查 Backend 日志中的 `ValidationError` 字段名
2. 对照 [ML Backend 协议](/dev/reference/ml-backend-protocol) 核查 Backend 返回格式
3. 修复 Backend 后重新注册并触发 Job

## Step 3：清理残留数据（可选）

若希望用新 Prediction 替换旧的（包括部分成功的）：
1. 项目详情 → AI 预标注 → **清除全部 Prediction** （此操作不可逆）
2. 重新触发 Job

> **注意**：清除 Prediction 不影响已由标注员采用的 Annotation。
