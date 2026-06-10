---
audience: [super_admin]
type: reference
since: v0.9.0
status: stable
last_reviewed: 2026-06-10
---

# 模型市场（/model-market）

模型市场把 ML Backend 能力目录、运行时观测、注册管理集中到同一个超管页面。

## 目的

跨项目纵览所有 ML Backend 与模型能力。从这里可以一站式：

- 按 model 条目检索能力目录
- 看注册 backend 与 env-only 容器的实时健康 / GPU / pool 状态
- 对注册 backend 执行健康检查、卸载、预热
- 全局新增 / 编辑 / 删除项目级 backend

## 三段切换

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/superadmin/model-market-tabs.png — 能力目录/运行时观测/注册管理三 tab [manual] -->

## 主要视图

页面顶部有三段切换：**能力目录 / 运行时观测 / 注册管理**。当前视图写入 `?tab=catalog|runtime|registry`，可直接分享深链。

### 1. 能力目录

> v0.14.11 起「能力目录」与 backend 注册解耦：默认按**协议能力 (task)** 分组渲染 9 张协议卡，无 backend 注册时仍完整展示协议层支持的全部能力 + 推荐 backend；详见 [ADR-0037](../../dev/adr/0037-protocol-capability-catalog-decoupling)。

能力目录默认按**协议能力 (task)** 分组：

- 始终渲染 9 张协议卡（detection / obb / segmentation / keypoint / classification / ocr / doc_layout / tracker / interactive_seg），数据来自 `GET /v1/ml-capabilities/protocol`（与 backend 注册无关）。
- 已注册 backend 的 model 按 `model.task` 字段挂载到对应卡片下；卡片标题旁显示「N 个模型已接入」徽标。
- 未挂任何 model 的协议卡显示「暂无接入」徽标，并列出**典型模型**与**推荐 backend**（含 GitHub 链接），CTA「去注册 backend」可一键跳到 `?tab=registry`。
- 零接入时顶部加 onboarding 横幅，强调「平台支持 9 类 AI 标注能力，当前还没有 backend 接入」。

切换到「分组：backend / infra / 不分组」时退回 v0.14.10 的 model-centric 视图（按 model 条目展开，零接入时显示原空态）。

通用筛选：

- 卡片 / 紧凑列表切换。
- 搜索模型名、model id、模型族、task 中文标签和来源 backend；协议能力分组下，搜索同时过滤协议卡（命中 task label / summary / typical_models 的卡保留）。
- 与 task / model_family / infra / modality chips 过滤叠加。
- 列表态按模型名、task、infra 轻量排序。

### 2. 运行时观测

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/superadmin/model-market-runtime-card.png — backend 卡片（GPU 显存 + 池状态 + 操作按钮） [manual] -->

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

## 视频追踪观测与任务监控

模型市场区分**图像推理**与**视频追踪**两种模态。

### 观测 / 预热面板按模态拆分

backend 的变体面板拆成两组：

- **图像推理变体**：SAM + DINO 双下拉，预热加载到图片池（grounded-sam2 图片 predictor）。预热走 `POST /{backend_id}/reload`（含 `task_type` 可选体）或 `POST /{backend_id}/warmup`（协议 v2 §4.4，backend 声明 `warmup_endpoint=true` 时启用）。
- **视频追踪变体**：**仅 SAM 单下拉**（video tracker 不使用 DINO），预热加载到**独立 video 池**（`POST /reload` body 携带 `task_type=video`，`apps/api/app/services/ml_client.py:277`）。
- 分组是否显示优先读取健康检查落库的 `health_meta.capabilities.modalities`；纯图像 backend 不显示视频组，纯视频 backend 不显示图像组。未健康检查过、没有 modalities 快照时，页面回落到 `/setup` enum / tracker 判断，避免把未知能力的 backend 误隐藏。

> ⚠️ **常见误区**：视频 tracker 用的是独立 `_video_pool`，不能只预热图片池。视频组的预热会走 `POST /reload` 并传 `task_type=video`，正确加载 video 池。
>
> 若 backend 自报支持视频但未上报 `video_pool`（旧版本），视频组会降级提示，不影响图像组。

### 视频追踪任务监控

视频追踪任务监控已并入 [`/ai-pre/jobs`](../projects/ai-preannotate) 的「视频」模态 tab；图像 tab 由 `async_jobs(kind=batch_predict|prediction_retry)` 提供，视频 tab 由 `async_jobs(kind=video_tracker)` 提供。旧链接 `/model-market/video-jobs` 自动跳转到 `/ai-pre/jobs?tab=video`。**模型市场只保留后端 / 显存池健康观测**（上面的模态拆分预热面板），任务（job）历史归 ai-pre。

<!-- 注：「能力目录」完整双层架构已在 ## 1. 能力目录 节描述，此处不再重复。 -->
<!-- 如需实例层细节请参见 ADR-0037 与 ML Backend 协议文档。 -->

## 新建 / 编辑 Backend

「注册管理」列表会显示两类项目：已注册 backend 的项目，以及已启用 AI 但还没有 backend 的项目。后者会显示「AI 已启用 · 未注册 backend」，可直接点「注册第一个 backend」把第一条 backend 记录注册到该项目；注册表单与 [ML Backend 注册](./ml-backend-registry) 等价。

## 删除

「注册管理」列表支持逐条删除 backend（超管和项目管理员均可操作）。平台**不提供批量删除孤立 backend** 功能；如需批量清理，需逐条在项目设置解绑后删除，或直接在项目设置中删除。删除规则详见 [ML Backend 注册](./ml-backend-registry#删除)。

## 路由历史

| 旧路由 | 新路由 | 跳转方式 |
|---|---|---|
| `/model-market/video-jobs` | `/ai-pre/jobs?tab=video` | 前端 `<Navigate replace>`（客户端跳转，非 HTTP 301） |
| `/model-market?tab=failed`（旧书签） | `/ai-pre/jobs?status=failed` | 前端检测 `tab=failed` 自动跳转 |

> `/ml-integrations` 路由**没有**配置 301 重定向，该旧路径已废弃（无路由匹配则 404）。`/admin/ml-integrations/*` 是后端 API 路径（仍在使用），与前端页面路由不同。
