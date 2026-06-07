---
audience: [super_admin]
type: reference
since: v0.9.0
status: stable
last_reviewed: 2026-05-27
---

# 模型市场（/model-market）

模型市场把 ML Backend 能力目录、运行时观测、注册管理集中到同一个超管页面。

## 目的

跨项目纵览所有 ML Backend 与模型能力。从这里可以一站式：

- 按 model 条目检索能力目录
- 看注册 backend 与 env-only 容器的实时健康 / GPU / pool 状态
- 对注册 backend 执行健康检查、卸载、预热
- 全局新增 / 编辑 / 删除项目级 backend

## 主要视图

页面顶部有三段切换：**能力目录 / 运行时观测 / 注册管理**。当前视图写入 `?tab=catalog|runtime|registry`，可直接分享深链。

### 1. 能力目录

能力目录是 model-centric 视图：枚举所有项目已注册的 backend，对每个 backend 拉 `/capabilities` 取 `models[]`，再按 model 条目展示。

支持：

- 卡片 / 紧凑列表切换。
- 按 backend / task / infra 分组，组可折叠。
- 搜索模型名、model id、模型族、task 中文标签和来源 backend。
- 与 task / model_family / infra / modality chips 过滤叠加。
- 列表态按模型名、task、infra 轻量排序。

### 2. 运行时观测

运行时观测是 runtime-centric 视图。它以**已注册 backend** 为主键展示，因为健康检查、卸载、预热都需要 `project_id + backend_id`。`ML_BACKEND_OBSERVE_URLS` 返回的实时指标按 URL join 到注册 backend：

- 同一 URL 被多个项目注册时，会按每个项目 backend 各显示一行；实时指标共享同一个容器值。
- 观测 URL 没有匹配任何注册 backend 时，会进入「未注册容器」分组，只支持直连 observe / smoke-test。
- 已注册 backend 可执行健康检查、卸载、默认预热，并展示变体面板。
- env-only 容器若只暴露通用 `supported_variants`，当前只读展示变体目录；「试启动」保持 disabled，等待 backend 实现通用 warm 接口。

### 3. 注册管理

注册管理只保留项目级 backend CRUD：

| 列 | 说明 |
|---|---|
| 名称 | backend 名称 |
| URL | 注册地址 |
| 类型 | 交互式 / 批量；最大并发 chip |
| 状态 | 注册记录最近状态与错误片段 |
| 最近检查 | 上次健康检查时间 |
| 操作 | 编辑 / 删除 |

运行时指标（GPU、cache、model_version、pool）和生命周期动作已经迁到「运行时观测」。

## 视频追踪观测

模型市场区分**图像推理**与**视频追踪**两种模态。

### 观测 / 预热面板按模态拆分

backend 的变体面板拆成两组：

- **图像推理变体**：SAM + DINO 双下拉，预热加载到图片池（grounded-sam2 图片 predictor）。
- **视频追踪变体**：**仅 SAM 单下拉**（video tracker 不使用 DINO），预热加载到**独立 video 池**。
- 分组是否显示优先读取健康检查落库的 `health_meta.capabilities.modalities`；纯图像 backend 不显示视频组，纯视频 backend 不显示图像组。未健康检查过、没有 modalities 快照时，页面回落到 `/setup` enum / tracker 判断，避免把未知能力的 backend 误隐藏。

> ⚠️ **常见误区**：视频 tracker 用的是独立 `_video_pool`，不能只预热图片池。视频组的预热会走 `/reload?task_type=video`，正确加载 video 池。
>
> 若 backend 自报支持视频但未上报 `video_pool`（旧版本），视频组会降级提示，不影响图像组。

### 视频追踪任务监控

视频追踪任务监控已并入 [`/ai-pre/jobs`](../projects/ai-preannotate) 的「视频」模态 tab；图像 tab 由 `async_jobs(kind=batch_predict|prediction_retry)` 提供，视频 tab 由 `async_jobs(kind=video_tracker)` 提供。旧链接 `/model-market/video-jobs` 自动跳转到 `/ai-pre/jobs?tab=video`。**模型市场只保留后端 / 显存池健康观测**（上面的模态拆分预热面板），任务（job）历史归 ai-pre。
>
> 监控内容不变：计数卡（queued / running / completed / failed / cancelled）+ 按状态 / model_key / 项目过滤的 cursor 分页列表（failed 行展开 `error_message`），数据来自 `GET /video-tracker-jobs`。

## 能力目录（多模型）

v0.14.9 起页面新增「能力目录」面板，是[能力声明协议 v2](../../dev/reference/ml-backend-protocol) 的消费视图。与「注册管理」按 backend 罗列不同，这里**按 model 条目展开**：枚举所有项目已注册的 backend，对每个 backend 拉 `/capabilities` 取 `models[]`，每个 model 渲染一张卡片或一行列表。

卡片信息：

- **task / infra / modality 徽章**：受控 task（检测 / 旋转框 / 分割 / 关键点 / 分类 / 文字识别 / 版面分析 / 追踪 / 交互分割）、infra（pytorch / onnx / paddle / tensorrt / openvino / 其它 / 未知）、modality（图像 / 视频 / 文本 / 点云）。
- **输出几何 / 输出属性 / variants / resource**：来自 model 条目的 `supported_geometric_outputs` / `output_attribute_types` / `supported_variants` / `resource_profile`。

顶部工具栏按 **task / model_family / infra / modality** 提供多选 chips 过滤（空集 = 不过滤该轴），并支持名称搜索、卡片/列表切换、分组和列表排序。「刷新」按钮对每个 backend 调用 `capabilities/refresh` 重探 `/setup` 并刷新缓存。

- 老 backend（协议 v1）由平台合成单 model 条目，长度为 1，正常显示。
- backend 离线或上次探测失败时，目录可能展示缓存旧值，卡片会标注 stale。

## 新建 / 编辑 Backend

「注册管理」列表会显示两类项目：已注册 backend 的项目，以及已启用 AI 但还没有 backend 的项目。后者会显示「AI 已启用 · 未注册 backend」，可直接点「注册第一个 backend」把第一条 backend 记录注册到该项目；注册表单与 [ML Backend 注册](./ml-backend-registry) 等价。

## 删除

超管在此处可批量删除孤立 backend（无项目引用的）。有引用的需要先在项目侧解绑。

## 路由历史

| 旧路由 | 新路由 |
|---|---|
| `/ml-integrations` | `/model-market?tab=registry` |
| `/failed-predictions` | `/ai-pre/jobs?status=failed` |

旧路由已 301 重定向到新地址。
