---
audience: [super_admin]
type: reference
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
---

# 模型市场（/model-market）

v0.9.3-phase2 把分散的 `/ml-integrations` 与 `/failed-predictions` 两个超管页合并成统一的 **模型市场**。

## 目的

跨项目纵览所有 ML Backend 与最近的预测健康度。从这里可以一站式：

- 看哪些 backend 在线 / 不可达
- 看每个 backend 最近 N 次推理的成功/失败率
- 跳转到具体失败 case 排查
- 全局新增 / 编辑 backend

## 主要 Tab

### 1. Integrations（集成）

列所有项目的 ML Backend 表，列：

| 列 | 说明 |
|---|---|
| 名称 / 类型 | — |
| URL | 点击可复制；红/绿色徽章表示健康 |
| 所属项目 | 一个 backend 若被多项目复用，列每个项目 |
| 最近 24h 调用 | 调用次数 + 成功率 |
| 操作 | 编辑 / 删除 |

### 2. Failed Predictions（失败预测）

`prediction_jobs` 表中 `status='failed'` 的记录，按 `finished_at desc` 排：

- 列 backend 名 / 项目名 / 触发时间 / 错误片段
- 点击展开看完整 error trace
- 可一键「查看 job 详情」跳到 `/ai-pre/jobs?job_id=X`
- v0.9.9 B-2 起这个 tab 也在项目侧 `/ai-pre` 出现，方便项目管理员自查（不再是超管独占）

### 3. Health Overview

可观测性概览（最近 24h）：

- 各 backend 的调用次数 / P95 延迟 / 错误率
- grounded-sam2-backend 还会显示 embedding 缓存命中率（v0.9.1 LRU）
- Prometheus 指标见 [可观测性](../../ops/observability/)

## 视频追踪观测（v0.10.36）

有了真实 video tracker（v0.10.35，gsam2 `sam2_video`）后，模型市场区分**图像推理**与**视频追踪**两种模态。

### 观测 / 预热面板按模态拆分

backend 的变体面板拆成两组：

- **图像推理变体**：SAM + DINO 双下拉，预热加载到图片池（grounded-sam2 图片 predictor）。
- **视频追踪变体**：**仅 SAM 单下拉**（video tracker 不使用 DINO），预热加载到**独立 video 池**。
- v0.10.41 起，分组是否显示优先读取健康检查落库的 `health_meta.capabilities.modalities`；纯图像 backend 不再显示视频组，纯视频 backend 不再显示图像组。未健康检查过、没有 modalities 快照时，页面回落到旧的 `/setup` enum / tracker 判断，避免把未知能力的 backend 误隐藏。

> ⚠️ **常见误区**：在 v0.10.36 之前，对一个纯视频项目的 backend 点「预热」其实只热了**图片池**——video tracker 用的是独立 `_video_pool`，首次追踪请求才冷启，预热按钮碰不到它，等于白占图片侧显存。现在视频组的预热走 `/reload?task_type=video`，正确加载 video 池。
>
> 若 backend 自报支持视频但未上报 `video_pool`（旧版本），视频组会降级提示，不影响图像组。

### 视频追踪任务监控（v0.10.38 起迁至 /ai-pre/jobs）

> **v0.10.38**：视频追踪任务监控已从模型市场迁出，并入 [`/ai-pre/jobs`](../projects/ai-preannotate) 的「视频」模态 tab（与图像 `prediction_jobs` 并列，统一 AI 任务历史）。旧链接 `/model-market/video-jobs` 自动跳转到 `/ai-pre/jobs?tab=video`。**模型市场只保留后端 / 显存池健康观测**（上面的模态拆分预热面板），任务（job）历史归 ai-pre。
>
> 监控内容不变：计数卡（queued / running / completed / failed / cancelled）+ 按状态 / model_key / 项目过滤的 cursor 分页列表（failed 行展开 `error_message`），数据来自 `GET /video-tracker-jobs`。

## 新建 / 编辑 Backend

「项目级 ML Backend」列表会显示两类项目：已注册 backend 的项目，以及已启用 AI 但还没有 backend 的项目。后者会显示「AI 已启用 · 未注册 backend」，可直接点「注册第一个 backend」把第一条 backend 记录注册到该项目；注册表单与 [ML Backend 注册](./ml-backend-registry) 等价。

## 删除

超管在此处可批量删除孤立 backend（无项目引用的）。有引用的需要先在项目侧解绑。

## 路由历史

| 旧路由 | 新路由 |
|---|---|
| `/ml-integrations` | `/model-market`（Integrations tab） |
| `/failed-predictions` | `/model-market`（Failed Predictions tab） |

旧路由已 301 重定向到新地址。
