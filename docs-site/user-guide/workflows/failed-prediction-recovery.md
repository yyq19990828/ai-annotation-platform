---
title: 失败预测恢复流程
audience: [super_admin, project_admin]
type: how-to
since: v0.9.0
status: stable
last_reviewed: 2026-06-10
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

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/workflows/failed-prediction-recovery-jobs-list.png — /ai-pre/jobs?status=failed 列表 [auto] -->

**方式 A：AI 预标 Jobs 页面**
1. 主导航 → **AI 预标** → **Jobs**（`/ai-pre/jobs?status=failed`）
2. 查看 Job 状态、错误信息；打开 Job 详情可看 Task 级别的失败原因与 payload

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

再次触发 Job：主导航 → **AI 预标** → 选择项目 → 勾选批次 → 跑预标。

### 场景：Celery Worker 崩溃

```bash
docker compose restart celery-worker
```

Worker 重启后，**状态为 `pending` 的 Job** 会自动被拾起重新执行。**但 `running` 状态的 Job 不会自动恢复**（本项目 Celery 配置未启用 `acks_late`，默认在任务出队时即 ACK；worker 崩溃后这些正在执行的任务不会被重新投递，Job 会卡在 `running` 状态）。需要手动在 `/ai-pre/jobs` 中将卡住的 Job 取消，再重新触发预标。详见 [Runbook: Celery Worker 卡死](/ops/runbooks/celery-worker-stuck)。

### 场景：数据格式不兼容

1. 检查 Backend 日志中的 `ValidationError` 字段名
2. 对照 [ML Backend 协议](/dev/reference/ml-backend-protocol) 核查 Backend 返回格式
3. 修复 Backend 后重新注册并触发 Job

## Step 3：清理残留数据（可选）

若希望用新 Prediction 替换旧的（包括部分成功的）：
1. 项目设置 → **危险操作** → 或 Dashboard 项目卡片菜单 → **清除预测**，选择清除范围（按来源：外部导入 / ML Backend 预标 / 全部），确认操作（此操作不可逆）
2. 重新触发预标

> **注意**：清除 Prediction 不影响已由标注员采用的 Annotation。
