# ML Backend 能力协商 + AI 预标注模态化重设计（epic）

> **性质**：架构 epic，按阶段推进，**不绑版本号**（落地时按当时主线切片）。
> **缘起（2026-05-22）**：v0.10.35/36 接通真实视频 tracker 后，发现平台始终没把「模态 / 能力」当成一等维度——注册、绑定、预标注三处都是模态盲的。这三件事是同一问题的三个切面。
> **关联**：视频 roadmap [Phase 3.3 协议统一收口（I20.4）](2026-05-21-video-workbench-roadmap.md)、[ADR-0012](../docs/adr/0012-sam-backend-as-independent-gpu-service.md)、[ADR-0020 能力协商](../docs/adr/0020-ml-backend-capability-negotiation.md)、主 [ROADMAP.md](../ROADMAP.md) §A「项目多后端绑定 + 按后端参数面板」。

---

## 0. 核心问题（一句话）

**平台对 ML Backend 的「能力」和「模态」无持久化感知**：

| 现状 | 代码位置 |
|---|---|
| `MLBackend` 表无 modality / data_type / 能力字段 | [ml_backend.py](../apps/api/app/db/models/ml_backend.py) |
| `is_interactive` 是注册表单**手填**布尔，**不从 `/setup.is_interactive` 派生** → 双真相 | [MlBackendFormModal.tsx:47](../apps/web/src/components/projects/MlBackendFormModal.tsx) |
| `/setup` 的 `supported_prompts` / `supported_trackers` / `params` **平台从不入库**，只在工作台临时拉来置灰工具 | [ml_backends.py:285](../apps/api/app/api/v1/ml_backends.py) |
| `Project.ml_backend_id` 单值；绑定时**不校验** `Project.data_type` 与 backend 能力匹配 | [projects.py:361](../apps/api/app/api/v1/projects.py) |
| `/ai-pre` 仅图像（`PredictionJob`、单 backend、单 prompt/阈值）；视频走完全独立的另一套（`VideoTrackerJob` + 工作台 Shift+T + ModelMarket 监控页） | [ProjectDetailPanel.tsx:106](../apps/web/src/pages/AIPreAnnotate/ProjectDetailPanel.tsx) |

**已先行修复**（2026-05-22）：`/ai-pre` summary 加 `data_type=image` 过滤，挡住视频项目误入图像文本预标页（[admin_preannotate.py:329](../apps/api/app/api/v1/admin_preannotate.py)）。这是症状止血，根因仍待本 epic。

**遵守的决策底线**（见 [ROADMAP.md](../ROADMAP.md) 决策底线表）：
- AI backend 保持 HTTP `/predict` 协议 + 独立容器，不自管 serverless。
- 不为「灵活性」回退 DSL；能力靠 `/setup` 自描述 + JSONB 持久化。
- 能由现有数据派生的状态**不新增手填字段**（modality / is_interactive 都应派生而非手填）。
- `annotations[]` / `predictions[]` 双数组分开；两套 job 模型不强行合表。

---

## 阶段 1 · 能力协商落库 + 模态派生（前置基石）

> 这是 [视频 roadmap Phase 3.3](2026-05-21-video-workbench-roadmap.md) 说的「第一块砖」的延续——v0.10.35 已让 `/setup` 自报 `supported_trackers`，本阶段把它**存下来并消费**。后两阶段都依赖本阶段，否则 ai-pre 无法可靠按模态分流。

**做什么**
1. **注册 / 健康检查时探 `/setup`，持久化能力快照**：把 `supported_prompts` / `supported_trackers` / `is_interactive` / `supported_geometric_outputs` 落进 `health_meta` 或 `MLBackend` 新列（取一种，倾向 health_meta 复用现有缓存通道，见 [ml_client.py:107 health_meta()](../apps/api/app/services/ml_client.py)）。
2. **`is_interactive` 改为派生 / 对账**：以 `/setup.is_interactive` 为真值，不再纯手填（手填可保留为覆盖，但默认对齐 backend 自报）。
3. **modality 派生而非手填**：`supported_trackers` 非空 ⇒ 支持 video；`supported_prompts` 非空 ⇒ 支持 image。不新增手填 modality 列。
4. **绑定按 data_type 校验**：`PATCH /projects/{id}` 绑定 backend 时，校验 backend 能力覆盖项目 `data_type`（视频项目不能绑只支持图片的 backend）；wizard `Step4Ai` 按模态过滤推荐。
5. **注册表单收敛**：表单收到 `url/auth` 即可；探测后**只读展示**检测到的能力，前端不同显示由持久化能力驱动，而非另一份手填配置（[Step4Ai.tsx](../apps/web/src/components/projects/steps/Step4Ai.tsx)、[MlBackendFormModal.tsx](../apps/web/src/components/projects/MlBackendFormModal.tsx)）。

**边界**：不动 `/predict` 协议本身；不引入 backend 端 modality 字段（modality 是平台从能力派生的视图概念）。

**验收**：注册视频 backend 后平台能正确识别其模态；视频项目绑只支持图片的 backend 被拒；`is_interactive` 与 backend 自报一致。

---

## 阶段 2 · AI 预标注模态化重设计（多 backend × 多数据类型）

> 对应主 [ROADMAP.md](../ROADMAP.md) §A「项目多后端绑定 + 按后端参数面板（重设计，未排期）」。基础设施部分已就位：`SchemaForm` 按 `/setup.params` 动态渲染、`User.preferences.ai.params_by_backend` 已按 backend 分桶。

**做什么**
1. **模态感知路由**：`/ai-pre` 按 `project.data_type` 分流入口——图像走现有批量文本预标（`PredictionJob`），视频走 tracker 式预标（接 `VideoTrackerJob`）。彻底取代「症状止血式过滤」。
2. **多 backend 选择**：项目侧 `ml_backend_id` 单值 → 多值 / 默认值；预标注入口加 backend 选择器 + 按后端参数面板（复用现有 infra）；批量预标决策「项目级阈值是否收口到按后端动态」。
3. **统一 job 视图层（不合表）**：`PredictionJob`（批次×模型，粗粒度）与 `VideoTrackerJob`（任务×标注，帧级）粒度不同，**保留两表**；只统一**展示层**——一个能按模态分 tab 的 job 历史。底层长期收敛到「async_jobs 统一表」（见 [取经合集 §1.7](2026-05-18-cvat-labelstudio-inspiration.md)），不在本 epic 强推。

**边界**：分清「快速批量预标」（现有流程）与「精细单 batch 多模型对比」（modal 模式，可复用 v0.9.x orphan 的 `PreannotateStepper` 等组件）——本阶段先做模态路由 + 多 backend，精细对比模式按客户驱动延后。不造「batch×backend 矩阵配置」怪物。

**验收**：视频项目能在 ai-pre 正常发起 / 查看预标；同项目可选不同 backend 跑预标；job 历史一处看全模态。

---

## 阶段 3 · video-jobs 并入统一 job 历史

> v0.10.36 把视频追踪任务监控页放在 ModelMarket（`/model-market/video-jobs`），是当「观测面」临时落地。概念上 tracker job 是一种 AI 预测 job，归属 ai-pre 的 job 历史。

**做什么**
- 把视频追踪 job 监控**作为 image/video 模态 tab 并入 `/ai-pre/jobs`** 的统一 job 历史（接阶段 2 的统一视图层）。
- 复用既有解耦资产：`GET /video-tracker-jobs` 端点 + `VideoTrackerJobsPage` 组件**改挂载点 + 加 tab 即可**，逻辑不重写。

**关键边界——两个面别混**：
- **ModelMarket = 后端 / 显存池健康**（v0.10.36 模态拆分预热面板，容器视角）→ 留在 ModelMarket。
- **ai-pre = 任务（job）历史**（谁跑的 / 成没成 / 错在哪）→ video-jobs 归这里。

**验收**：`/ai-pre/jobs` 一处看图像 + 视频两类 AI 任务历史；ModelMarket 仅保留后端 / 池健康观测。

---

## 依赖顺序

```
阶段 1 能力协商落库 + 模态派生   ← 前置（后两阶段都依赖可靠的模态识别）
        ↓
阶段 2 ai-pre 模态化重设计（模态路由 + 多 backend + 统一 job 视图层）
        ↓
阶段 3 video-jobs 并入 ai-pre/jobs（modality tab）
```
