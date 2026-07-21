---
audience: [project_admin, super_admin]
type: reference
since: v0.9.0
status: stable
last_reviewed: 2026-07-20
---

# 模型市场（/model-market）

模型市场把 ML Backend 能力目录、运行时观测、注册管理集中到同一个页面；项目管理员使用只读能力视图，超级管理员负责全局运行时与注册管理。

## 目的

跨项目纵览所有 ML Backend 与模型能力。从这里可以一站式：

- 按 model 条目检索能力目录
- 超管查看注册 backend 与未注册容器的实时健康 / GPU / pool 状态
- 超管对注册 backend 执行健康检查、卸载、预热
- 超管全局新增 / 编辑 / 删除 backend，并查看各项目对它的启用状态

## 主要视图

![模型市场列表](../images/superadmin/model-market/list.png)

超级管理员看到三段切换：**能力目录 / 运行时观测 / 注册管理**；项目管理员只看到能力目录和只读注册管理。当前视图写入 `?tab=catalog|runtime|registry`，可直接分享深链。

> **按角色可见范围**：本页对超管与项目管理员开放，但内容按角色收敛。超管看到顶部统计卡与全部三段（能力目录 / 运行时观测 / 注册管理）。项目管理员**只看到能力目录 + 只读的注册管理**——顶部统计卡与「运行时观测」段隐藏（二者依赖 super_admin only 的全局 overview / observe 接口），能力目录也退到 `/instances` 单端点视图（协议卡 + model 卡，不含各项目运行时池富化，不再因拿不到 overview 而整块报错）。项目管理员对自己项目的 backend 启用仍在项目设置里做。

### 1. 能力目录

> 「能力目录」与 backend 注册解耦：默认按**协议能力 (task)** 分组渲染协议卡，无 backend 注册时仍完整展示协议层支持的全部能力 + 推荐 backend；详见 [ADR-0037](../../dev/adr/archive/0037-protocol-capability-catalog-decoupling)。

<!-- TODO IMAGE_CHECKLIST: images/superadmin/model-market/protocol-card-details.png — 能力目录协议卡 + ModelCard 详情态。 -->

能力目录默认按**协议能力 (task)** 分组：

- 始终渲染 9 张协议卡（detection / obb / segmentation / keypoint / classification / ocr / doc_layout / tracker / interactive_seg），数据来自 `GET /v1/ml-capabilities/protocol`（与 backend 注册无关）。
- 已注册 backend 的 model 按 `model.task` 字段挂载到对应卡片下；卡片标题旁显示「N 个模型已接入」徽标。
- 未挂任何 model 的协议卡显示「暂无接入」徽标，并列出**典型模型**与**推荐 backend**（含 GitHub 链接），CTA「去注册 backend」可一键跳到 `?tab=registry`。
- 零接入时顶部加 onboarding 横幅，强调「平台支持 9 类 AI 标注能力，当前还没有 backend 接入」。

已接入的 model 会复用统一的 ModelCard 展示：

- 顶部显示 task、原子 / 内置流程、infra、模态、模型族、交互式徽标，以及从 `resource_profile` 升级来的**设备**（GPU 等）与**可批量 / 交互·有状态**徽标。
- 「运行时」行显示当前 pool 尺寸、默认变体是否已加载，并提供可用时的预热按钮。
- 「可接受输入」区分整图、裁剪图、框提示、点提示；多阶段预标用它判断下游阶段能否接上游框。
- 「输出几何 / 输出属性」展示落库形态和可写属性，例如 bbox、polygon、text、class。属性优先取结构化 `output_attribute_schema` 的 label（更友好），backend 未报 schema 时回落到扁平 `output_attribute_types`。
- 「资源」行只展示设备 / batchable 之外的余项（如显存估算）；当前 backend 多数只报设备 / batchable（已在顶部徽标呈现），此时整行隐藏。变体区展示 series / size / SAM / DINO 等轴、显存估算、速度档和推荐项。
- 若 backend `/setup` 里 task、infra、prompt 或几何枚举不在平台受控词表内，卡片右上角会显示 `⚠ 协议 N`，hover 可看具体字段和值；这是诊断提示，不会阻断目录解析。

切换到「分组：backend / infra / 不分组」时进入 model-centric 视图（按 model 条目展开）。除了项目已启用的 backend，平台已知但未接入任何项目的内置 backend（如 docker-compose 自带的）也会在这里列出并标「平台内置」；仅当平台完全没有已知 backend 时才显示空态。

通用筛选：

- 卡片 / 列表切换；协议能力分组下列表按协议能力逐行展示，backend / infra / 不分组下列表按 model 条目展开。
- 搜索模型名、model id、模型族、task 中文标签和来源 backend；协议能力分组下，搜索同时过滤协议卡（命中 task label / summary / typical_models 的卡保留）。
- 与 task / model_family / infra / modality chips 过滤叠加。

### 2. 运行时观测

<!-- TODO IMAGE_CHECKLIST: images/superadmin/model-market/runtime-pools.png — 运行时观测摘要带 + 两列服务池摘要卡 + 展开实例 [manual] -->

运行时观测是 runtime-centric 视图（**仅超管可见**）。它以**服务池**为默认比较层，先用摘要带汇总路由模式、可路由实例、异常池和数据新鲜度，再按服务池摘要卡 → 实例面板 → 详情 Sheet 逐级下钻。宽屏下服务池以两列排布，展开的卡片自动跨列；窄屏回落为单列。数据来自 `topology` + `runtime-snapshot` 两个权威读模型，按稳定 ID 关联（不再按 URL join）。

页面提供单一「刷新」动作 + 自动刷新开关，并展开「数据来源」区域显示各来源（拓扑 / 路由账本 / 健康探活 / GPU 仲裁 / 模型驻留）的 `updated_at` / `stale` / `error`。单个来源失败不会抹掉其它可信数据——例如路由账本不可用时，拓扑与最近健康配置仍然展示，数据来源区域显示部分可用告警。

<!-- TODO IMAGE_CHECKLIST: images/superadmin/model-market/runtime-data-sources.png — 展开的数据来源部分失败态（stale/error + 更新时间） [manual] -->

**服务池摘要卡**分组展示独立状态轴，不合成单一「在线」徽标：

| 分组 | 内容 |
|---|---|
| 可用性 | 总体严重度、可路由 / 总实例、draining / offline 数 |
| 流量 | 窗口请求数、实例选择分布紧凑分段条、最近选择时间 |
| 容量 | inflight / limit、饱和或熔断提示 |
| 资源 | 驻留实例数、CPU fallback 数 |
| 新鲜度 | 新鲜来源计数；各来源时间与错误在「数据来源」展开区查看 |
| 状态依据 | 非正常状态的 reason code，便于与问题中心交叉定位 |

资源区的驻留实例数只统计可信探活中处于加载、已驻留或释放中的实例；`unloaded`、未知状态与过期缓存均不计入。实例面板也会区分实时探活、缓存状态和过期状态，缓存中的 `connected` 不会显示成实时健康。

> **「暂无路由指标」**：P95、错误率、最近选择、选择 / 拒绝计数等流量真值在合同中保留为 `null`，前端统一显示「暂无路由指标」，不会回落为 `0` 或「健康」。这些字段等后续版本接入共享路由计数器后才会显示真值。

展开服务池后显示实例面板：名称 / URL、权重、接流状态、routable reason、当前 / 最大并发、窗口 selection / rejection、P95、错误率、最近选中、health / compute / GPU claim / residency 摘要。缺失的路由指标统一保留未知语义，不显示为零。点「详情」打开右侧 Sheet，里面才展示模型 / 视频驻留池、cache、variant、builder / borrower、generation、原始诊断和复制 ID。

<!-- TODO IMAGE_CHECKLIST: images/superadmin/model-market/runtime-instance-detail.png — 实例详情 Sheet（路由、健康、GPU claim、驻留与诊断） [manual] -->

> **信任边界**：`/observe` 直连 `ML_BACKEND_OBSERVE_URLS` 里的地址探活，**不带应用层鉴权**——它假定这些地址在可信内网、免鉴权可达。请勿把该变量指向可从不受信网络到达的地址；需要鉴权的 backend 应通过「注册管理」注册（注册项携带 `auth_method` / `auth_token`，走鉴权链路），而非只靠裸 observe URL。

**未注册容器**单独放在折叠区：只显示直连 health / latency / compute / GPU / 模型驻留；允许显式注册或 smoke test，但**不展示权重、routable、流量分布，也不自动并池**。

**实例维护走安全顺序**：drain（停止接收新请求）→ 等待 inflight 归零且快照新鲜（quiescent）→ 卸载。成员必须精确处于 `draining`；`route_inflight` 缺失、账本 stale 或 Redis 不可用都不能作为零证明。当 `ML_BACKEND_ROUTER_MODE != enforce` 时，drain 只标记为「预配置未生效」而非「已停流」。同一权威门禁也用于移除服务池成员和物理删除 registry。

### 3. 注册管理

<!-- TODO IMAGE_CHECKLIST: images/superadmin/model-market/registry-service-pools.png — 注册管理服务池主视图（结构化 tab + 展开成员 + 维护操作） [auto] -->

注册管理按实体拆成四个结构化视图 + 问题中心，超管看到全部五个 tab，项目管理员只看到服务池 + 实例两个只读视图。每个物理 backend 全局只有一行，注册一次、所有项目共享；服务池是路由选择的逻辑边界（ADR-0050），实例是可定位到物理 URL 的 registry 记录。

**服务池**（super_admin + project_admin）：

| 主列 | 内容 |
|---|---|
| 服务池 | 名称、稳定 key、策略；ID 只在 tooltip / 复制动作中显示 |
| 成员 | 可路由 / 总实例，按状态分段 |
| 容量 | inflight / 总并发、饱和拒绝；明确标注「暂无路由指标」当无计数 |
| 项目 | 启用项目数，可进入项目绑定视图 |
| GPU | 关联资源数、最高严重度、预算摘要 |
| 状态 | 健康、configured → effective 路由、router mode、数据新鲜度分开显示 |
| 操作 | 创建、重命名、启停、删除空池，加入 / 移除成员、修改权重、暂停 / 恢复接流（**仅超管**） |

服务池行可展开成员实例。项目管理员看不到 `routing_policy`、权重与 GPU 列（服务端裁剪为 `unknown` / `null`，非前端隐藏），也没有操作按钮。

**实例**（super_admin + project_admin）：实例名称、所属服务池、URL、来源、接流状态、权重（超管）、最大并发、GPU claim（超管）、最近检查、操作（健康检查 / 编辑 / drain / resume / unload / 删除，**仅超管**，按风险排序）。原始错误全文、能力快照、模型池、GPU generation 和诊断进入详情 Sheet。

**GPU 资源**（**仅超管**）：资源名称、节点、静态预算 / 可分配容量、已声明预算、运行时 committed、Backend / card queue、lease、desired → effective 和最高诊断。静态声明超售与运行时实际占用是两根独立 Progress 条。资源行展开后列出受影响实例。

**项目绑定**（**仅超管**）：默认按项目显示所绑定服务池、主服务池、可用实例数和风险；支持切换为按服务池反查项目。本页只读，修改入口跳项目设置。项目已启用但池内无可路由实例时单独告警。

**问题中心**（**仅超管**）：按 `code + subject_type + subject_id` 稳定去重，同一问题只渲染一次主记录；默认按 blocker → critical → warning → info 排序。支持按服务池、实例、GPU 资源和 code 筛选。资源 / 实例行只显示关联标记和计数 + 跳转，不复制诊断全文。

<!-- TODO IMAGE_CHECKLIST: images/superadmin/model-market/registry-issue-center.png — 问题中心去重、严重度、受影响对象与筛选 [manual] -->

对应后端端点：`GET /admin/ml-integrations/topology`（角色裁剪读模型）、`GET /admin/ml-integrations/runtime-snapshot`（仅超管）、`/admin/ml-integrations/service-pools/*`（pool/member CRUD + drain/resume，仅超管）、`POST/PUT/DELETE /admin/ml-integrations/registry/:id`（实例增删改）、`POST /admin/ml-integrations/registry/:id/health`（健康检查）。

> **角色门控**：超管看到全部五个 tab 与所有 mutation。项目管理员只看到「服务池 + 实例」两个只读视图，不显示 GPU 资源 / 项目绑定 / 问题中心，也看不到 `routing_policy` / 权重 / GPU UUID / 预算 / 内部 reason / 诊断拓扑——这些字段在服务端响应中已裁剪为 `unknown` / `null`（非前端隐藏）。项目管理员对自己项目的 backend 启用仍在项目设置里做（详见 [启用 ML 后端](../projects/ml-backends)）。

## 视频追踪观测与任务监控

模型市场区分**图像推理**与**视频追踪**两种模态。

### 观测 / 预热面板按模态拆分

backend 的变体面板拆成两组：

- **图像推理变体**：SAM + DINO 双下拉，预热加载到图片池（grounded-sam2 图片 predictor）。预热走 `POST /{backend_id}/reload`（含 `task_type` 可选体）或 `POST /{backend_id}/warmup`（协议 v2 §4.4，backend 声明 `warmup_endpoint=true` 时启用）。
- **视频追踪权重**：video tracker 不使用 DINO，预热加载到**独立 video 池**（`POST /reload` body 携带 `task_type=video`）。有多档视频权重时显示 SAM 下拉；只有单一视频模型时显示独立权重条目和预热按钮，不制造无意义下拉。
- 分组是否显示优先读取健康检查落库的 `health_meta.capabilities.modalities`；纯图像 backend 不显示视频组，纯视频 backend 不显示图像组。未健康检查过、没有 modalities 快照时，页面回落到 `/setup` enum / tracker 判断，避免把未知能力的 backend 误隐藏。

> ⚠️ **常见误区**：视频 tracker 用的是独立 `_video_pool`，不能只预热图片池。视频组的预热会走 `POST /reload` 并传 `task_type=video`，正确加载 video 池。
>
> 若 backend 自报支持视频但未上报 `video_pool`（旧版本），视频组会降级提示，不影响图像组。

### 视频追踪任务监控

视频追踪任务监控已并入 [`/ai-pre/jobs`](../projects/ai-preannotate) 的「视频」模态 tab；图像 tab 由 `async_jobs(kind=batch_predict|prediction_retry)` 提供，视频 tab 由 `async_jobs(kind=video_tracker)` 提供。旧链接 `/model-market/video-jobs` 自动跳转到 `/ai-pre/jobs?tab=video`。**模型市场只保留后端 / 显存池健康观测**（上面的模态拆分预热面板），任务（job）历史归 ai-pre。

<!-- 注：「能力目录」完整双层架构已在 ## 1. 能力目录 节描述，此处不再重复。 -->
<!-- 如需实例层细节请参见 ADR-0037 与 ML Backend 协议文档。 -->

## 新建 / 编辑 Backend

点「注册管理」右上角的 **「注册 backend」** 即可新增一条全局 backend 记录；点某行的「编辑」可改其 URL / 名称 / 鉴权 / GPU 资源与预算 / 驱逐优先级 / `max_concurrency` 及其他 `extra_params`。注册表单字段与校验详见 [ML Backend 注册](./ml-backend-registry)。env 配置的 backend 启动后会自动出现在列表里（来源 `env`），无需手动注册。

## 删除

「注册管理」列表支持逐条删除全局 backend（**仅超管**）。删除会从注册表移除该记录，所有引用它的项目 `ml_backend_id` 自动置空（ON DELETE SET NULL）。若有正在运行的预测 job 会返回 `HTTP 409` 阻断。项目管理员若只想让某 backend 对本项目失效，应在项目设置取消勾选启用，而非删除。删除规则详见 [ML Backend 注册](./ml-backend-registry#删除)。

## 路由历史

| 旧路由 | 新路由 | 跳转方式 |
|---|---|---|
| `/model-market/video-jobs` | `/ai-pre/jobs?tab=video` | 前端 `<Navigate replace>`（客户端跳转，非 HTTP 301） |
| `/model-market?tab=failed`（旧书签） | `/ai-pre/jobs?status=failed` | 前端检测 `tab=failed` 自动跳转 |

> `/ml-integrations` 路由**没有**配置 301 重定向，该旧路径已废弃（无路由匹配则 404）。`/admin/ml-integrations/*` 是后端 API 路径（仍在使用），与前端页面路由不同。
