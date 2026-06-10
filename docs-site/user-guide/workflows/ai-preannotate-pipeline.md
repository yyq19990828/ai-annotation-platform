---
title: AI 预标注流水线
audience: [project_admin, super_admin]
type: tutorial
since: v0.9.0
status: stable
last_reviewed: 2026-06-10
---

# AI 预标注流水线

本文描述 AI 预标注的完整流程：从注册 ML Backend → 触发预标注 Job → 标注员采用结果。

## 前提条件

- 已有可用 ML Backend（自部署或使用平台内置 Grounded-SAM-2）
- 已在 **模型市场**（`/model-market`）完成 ML Backend 注册（super_admin 或 project_admin 均可访问）
- 项目已创建并上传数据

## 流程概览

```
超管注册 ML Backend → 项目绑定 backend → 触发批量 Job → Job 完成 → 标注员采用 Prediction
```

## Step 1：注册 ML Backend

1. 主导航 → **模型市场**（`/model-market`）→ **注册管理** tab
2. 填写服务 URL（如 `http://sam-backend:8001`）并点击**测试连接** — 返回 200 且协议版本匹配即可
3. 保存后可在**能力目录** tab 中看到该 Backend 及其模型条目

详见 [ML Backend 协议](/dev/reference/ml-backend-protocol)。

## Step 2：项目绑定 backend（项目管理员操作）

1. 项目详情 → **设置** → **ML 模型** → 从注册列表选择
2. 保存（不影响现有 Task 和 Prediction）

## Step 3：触发批量预标注

1. 主导航 → **AI 预标**（`/ai-pre`）→ 选择项目卡片，进入 ProjectDetailPanel
2. 勾选一个或多个 `active` 批次
3. 选择幂等模式（`跳过已预标` / `覆盖` / `追加`，默认跳过已预标）
4. 点击**跑预标**（单批次）或选择串行 / 并行后批量触发
5. 系统为每个批次创建一个 Job（状态 `pending` → `running`）；Celery Worker 调用 ML Backend，逐 Task 写入 Prediction
6. 所有 Task 处理完毕后 Job 状态变为 `completed`

可在 `/ai-pre/jobs` 或右上角后台任务铃实时查看 Job 进度；失败任务在 `/ai-pre/jobs?status=failed` 查看并重试。

## Step 4：标注员采用预测结果

预标注完成后，标注员打开工作台：
- **紫色候选框** = AI 预测（Prediction）
- 点击选中某个 Prediction 框后：按 `A` 采纳选中框 / 按 `D` 驳回选中框
- 也可在右侧 AI 面板逐条点击接受 / 拒绝按钮

> **注意**：`A` / `D` 快捷键仅对**当前选中**的 Prediction 生效，不会操作全部候选框。

采纳的 Prediction 变为正式 Annotation（蓝色），可继续编辑。

## 错误处理

| 情况 | 原因 | 处理 |
|---|---|---|
| Job 停在 `running` 超过 10 分钟 | Worker 崩溃或 Backend 超时 | 查 Celery Worker 日志（`docker logs ai-annotation-platform-celery-worker-1 --tail 100`）；参考 [Runbook: ML Backend 不可用](/ops/runbooks/ml-backend-down) |
| 部分 Task 无 Prediction | Backend 返回空结果（置信度低） | 检查 Backend 日志，调整阈值配置 |
| 连接 Backend 失败 | URL 配置错误或网络隔离 | 参考 [容器网络排查](/dev/troubleshooting/container-networking) |
