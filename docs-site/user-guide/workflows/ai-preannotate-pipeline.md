---
title: AI 预标注流水线
audience: [project_admin, super_admin]
type: tutorial
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
---

# AI 预标注流水线

本文描述 AI 预标注的完整流程：从注册 ML Backend → 触发预标注 Job → 标注员采用结果。

## 前提条件

- 已有可用 ML Backend（自部署或使用平台内置 Grounded-SAM-2）
- 超级管理员已在 [ML Backend 注册](../for-superadmins/ml-backend-registry) 中完成注册
- 项目已创建并上传数据

## 流程概览

```
超管注册 ML Backend → 项目绑定模型 → 触发批量 Job → Job 完成 → 标注员采用 Prediction
```

## Step 1：注册 ML Backend（超管操作）

1. 超级管理员入口 → **ML Backend 注册**
2. 填写服务 URL（如 `http://sam-backend:8001`）
3. 点击**测试连接** — 返回 200 且协议版本匹配即可
4. 保存后可在**模型市场**中看到该 Backend

详见 [ML Backend 协议](/dev/reference/ml-backend-protocol)。

## Step 2：项目绑定模型（项目管理员操作）

1. 项目详情 → **设置** → **AI 模型** → 从注册列表选择
2. 保存（不影响现有 Task 和 Prediction）

## Step 3：触发批量预标注

1. 项目详情 → **AI 预标注** → **立即预标注**
2. 系统创建一个 Job（状态 `pending` → `running`）
3. Celery Worker 并行调用 ML Backend，逐 Task 写入 Prediction
4. 所有 Task 处理完毕后 Job 状态变为 `done`

可在超管 → **失败预测排查**页面实时查看 Job 进度。

## Step 4：标注员采用预测结果

预标注完成后，标注员打开工作台：
- **紫色候选框** = AI 预测（Prediction）
- 按 `A` 采用全部候选 / 按 `D` 拒绝 / 单独点击选择

采用的 Prediction 变为正式 Annotation（蓝色），可继续编辑。

## 错误处理

| 情况 | 原因 | 处理 |
|---|---|---|
| Job 停在 `running` 超过 10 分钟 | Worker 崩溃或 Backend 超时 | 查 Celery Worker 日志；参考 [Runbook: ML Backend 不可用](/ops/runbooks/ml-backend-down) |
| 部分 Task 无 Prediction | Backend 返回空结果（置信度低） | 检查 Backend 日志，调整阈值配置 |
| 连接 Backend 失败 | URL 配置错误或网络隔离 | 参考 [容器网络排查](/dev/troubleshooting/container-networking) |
