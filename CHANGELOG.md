# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.22.x | [docs/changelogs/0.22.x.md](docs/changelogs/0.22.x.md) |
| 0.21.x | [docs/changelogs/0.21.x.md](docs/changelogs/0.21.x.md) |
| 0.20.x | [docs/changelogs/0.20.x.md](docs/changelogs/0.20.x.md) |
| 0.19.x | [docs/changelogs/0.19.x.md](docs/changelogs/0.19.x.md) |
| 0.18.x | [docs/changelogs/0.18.x.md](docs/changelogs/0.18.x.md) |
| 0.17.x | [docs/changelogs/0.17.x.md](docs/changelogs/0.17.x.md) |
| 0.16.x | [docs/changelogs/0.16.x.md](docs/changelogs/0.16.x.md) |
| 0.15.x | [docs/changelogs/0.15.x.md](docs/changelogs/0.15.x.md) |
| 0.14.x | [docs/changelogs/0.14.x.md](docs/changelogs/0.14.x.md) |
| 0.13.x | [docs/changelogs/0.13.x.md](docs/changelogs/0.13.x.md) |
| 0.12.x | [docs/changelogs/0.12.x.md](docs/changelogs/0.12.x.md) |
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## [Unreleased]

### Changed

- 首页的 SAM3 与 OCR 演示统一使用高清 WebM 和独立 WebP 海报，OCR 录制中的 AI 面板改为停靠在主图右侧，便于看清识别对象和候选结果。
- 重整模型市场“运行时观测”的信息层级：服务池由宽表改为摘要卡，集中展示路由模式、可用实例、容量、资源和数据新鲜度；实例指标与维护操作在展开面板内分组，缺失指标不再淹没关键状态。
- 图片、视频和点云工作台的用户手册截图与流程录屏统一使用暗色主题，并移除已与当前交互不符的旧截图。

### Fixed

- 修复首页 Hero 在首次打开或慢网络下同时请求所有大图，导致个别卡片轮播时短暂空白的问题；现仅挂载当前与下一张，并在切换前完成预加载和解码。
- 修复新注册 ML Backend 的 singleton 服务池未随项目启用而激活，以及批量、逐帧、重试、二次推理和同步预测绕过服务池路由的问题；这些请求现统一按池选择物理实例，并遵守 drain、跨进程并发和熔断门禁。
- 修复标注员进入图片工作台时误请求管理员专用类别频率接口、重复弹出权限告警的问题。
- 修复运行时观测把 `unloaded` 或不可信驻留数据计为已驻留，并在缺少实时探活时把缓存 `connected` 状态显示为健康的问题；服务池资源计数与实例健康徽标现明确区分实时、缓存、过期和未知数据。
- 修复服务池迁移误将预标注编排和用户 AI 偏好中的 registry id 改写为 pool id，导致前端无法按全局注册表恢复模型、参数和交互式 backend 选择。校正迁移恢复这些公共字段的物理实例身份，同时保留项目启用与请求溯源的服务池身份。
- 修复服务池能力指纹与真实 `models[]` 能力响应不一致、singleton 池缺少指纹以及健康检查后能力漂移仍可接流的问题；能力合同现会稳定排序、第一次探活建立指纹，漂移成员自动禁用。
- 修复路由 generation 与 Redis 账本可漂移、追踪任务忽略路由选中实例或拒绝结果、中途取消泄漏 lease 及 heartbeat 失败仍静默继续的问题。
- 修复缺失或过期的 inflight 数据被当作零而允许卸载或移除成员的问题。纳管实例的卸载、移除和物理删除现均要求 enforce 路由、draining 状态、新鲜账本和精确 `inflight=0`，Redis 不可用时失败关闭。
- 修复服务池成员 PUT 重复插入、API `PATCH` 丢失 `If-Match` 等额外 header、通用预热按钮错发 reload、GPU 静态超售告警无法触发，以及注册管理缺少服务池和成员增删改、权重编辑与实例联动筛选的问题。

## [0.23.4] - 2026-07-20

### Added

- **模型市场「注册管理」与「运行时观测」结构化重设计** (ADR-0051). 在 ADR-0050 的服务池 /
  实例 / GPU 三层之上定义观测面信息架构：注册管理拆成「服务池 / 实例 / GPU 资源 / 项目绑定」
  四个结构化视图 + 问题中心；运行时观测改为可展开的服务池树表，默认展示路由健康、容量与
  流量分布，实例详情下沉到 Sheet。前端不再按 URL join `/all` + `/overview` + `/observe`。
- **四条独立状态轴**: 连通/健康、路由 (configured → effective)、容量、驻留分别判定，不再合成
  单一「在线」徽标。每条轴的来源不可互推（`connected` 缓存不冒充实时 healthy，GPU queue 不
  等于路由 inflight，CPU compute 不代表 GPU 已释放）。
- **typed topology / runtime-snapshot 读模型**: 两个端点从 `-> dict` 升级为 Pydantic
  `response_model` (`TopologyResponse` / `RuntimeSnapshotResponse`)，OpenAPI snapshot 与
  generated TS 类型不再是 `unknown`。topology 新增派生 `routable_instances` / `status` /
  `status_reason_codes`；runtime-snapshot 新增 `observed_at` / `partial` / `partial_reason` /
  `sources[]` freshness 信封。
- **服务端角色裁剪收紧**: Project Admin 经 `topology` 拿到的响应中 `routing_policy="unknown"`、
  member `weight` / `state` / `last_checked_at` / `gpu_resource_id` 为 `None`（服务端裁剪，
  非前端隐藏）。`runtime-snapshot` / `/observe` / `/gpu-resources` 对 Project Admin 返回 403。
- **诊断去重合同**: 问题按 `code + subject_type + subject_id` 稳定去重；同一问题在问题中心
  只渲染一次主记录，受影响对象在 `affected_*_ids[]` 完整列出，资源 / 实例行只显示计数 + 跳转。
- **卸载安全门**: 实例维护走 drain → quiescent (inflight=0 AND 快照新鲜) → unload 顺序。
  `routable` 实例不可一键卸载；`router_mode != enforce` 时 draining 标记为「预配置未生效」。
- **纯 view-model 层** (`runtimeTopology.ts`): 把 topology + runtime snapshot 按 ID 合并为页面
  view model，保留 unknown / stale / partial，不做业务真值猜测；含可独立测试的派生、排序、
  筛选、诊断聚合与卸载门控函数。

### Changed

- `RegisteredBackendsTab.tsx` 与 `RuntimeObservePanel.tsx` 重写为编排 shell，详情渲染下沉到
  `registry/` (5 组件) 与 `runtime/` (10 组件) 子目录。原 `min-w-[980px]` 扁平宽表与实例
  卡片墙移除；窄屏保留核心列，次要字段进展开行 / Sheet。
- GPU 资源从大卡改为表格；静态声明超售与运行时实际占用拆成两根独立 Progress 条。
- 运行时观测刷新合并为单一按钮 + 自动刷新开关 + 「数据来源」展开区（显示各来源 updated_at /
  stale / error）；部分来源失败不抹掉其它可信数据。
- 未注册 env 容器独立归组，不授予 routable / weight / traffic 字段，也不自动并池。

### Fixed

- 缺失 / 陈旧路由指标不再回落为 `0` 或 `healthy`：metrics 字段（P95 / 错误率 / 最近选择 /
  选择 / 拒绝计数）在合同中保留为 `None`，前端统一渲染「暂无路由指标」。
- 健康快照陈旧时保留上次值 + stale 标记 + 时间，不沿用实时状态色；`runtime-snapshot`
  partial 时显示「N/M 来源新鲜」+ partial_reason，不整页替换为错误块。

## [0.23.3] - 2026-07-20

### Added

- **ML Backend 服务池与真实请求路由地基** (ADR-0050). 在全局实例注册表 (ADR-0044) 之上
  新增逻辑服务池层 (`ml_backend_service_pools` + `ml_backend_pool_members`), 把「项目请求一个
  逻辑能力」与「平台选择一个物理实例」拆成两个步骤。项目、pipeline、用户偏好以 pool id 为配置
  真值; 每个现有 registry 经 alembic 迁移自动得到一个 singleton 服务池, off mode 下行为与
  v0.23.2 完全一致。详见 `docs/adr/0050-ml-backend-service-pools-and-request-routing.md`。
- **跨进程原子路由 ledger** (Redis, namespace `ml-router:v1`, 独立于 GPU 仲裁 `gpu-arbiter:v1`):
  平滑加权轮询 (SWRR) + per-instance 并发上限 + 被动熔断 (仅 transport failure 触发) + route
  lease acquire/heartbeat/finish/cancel (原子 Lua, 幂等终态, crash TTL 回收)。
- **路由能力指纹** (SHA-256): 服务池成员加入前必须 exact match canonical 能力指纹 (排除
  URL/GPU/VRAM/residency 等运行态字段, 使等价副本可互换); 漂移自动 disabled。
- **Pool + instance 双 ID 溯源**: `Prediction` / `FailedPrediction` 新增 `ml_backend_pool_id`
  (requested pool); `AsyncJob.payload` 新增 `ml_backend_pool_id`; audit 日志记录双 ID。
  多阶段聚合的 stage-level lineage 存 `PredictionMeta.extra.pipeline`。
- **项目服务池 API**: `GET /projects/:id/ml-backends/pools/available`、
  `PUT /projects/:id/ml-backends/pools/:pool_id/enablement` (pool 级启用 + 变体覆盖)。
- **超管服务池管理 API**: pool/member CRUD + drain/resume
  (`/admin/ml-integrations/service-pools/*`), 含能力不匹配 409 结构化 diff。
- **读模型** (v0.23.4 前置): `GET /admin/ml-integrations/topology` (角色裁剪)、
  `GET /admin/ml-integrations/runtime-snapshot` (仅超管; router mode + inflight + circuit +
  health + GPU 摘要)。
- **路由指标**: `ml_backend_router_selections_total` / `_rejections_total` / `_ejections_total` /
  `_routed_request_duration_seconds` / `_inflight` (label 仅稳定 UUID + 受控 outcome)。
- **路由灰度开关**: `ML_BACKEND_ROUTER_MODE` (off / observe / enforce) + lease TTL / heartbeat /
  passive-failure-threshold / eject-seconds / health-max-age 环境变量。

### Changed

- `Project.ml_backend_id` → `ml_backend_pool_id` (项目主绑定改为服务池; 内部经 singleton pool
  的 `legacy_instance_id` 解析回原 registry 实例, off mode 行为不变; 公共 schema 仍接受
  `ml_backend_id` registry id 以兼容前端 / SDK, v0.23.4 完整池管理 UI 落地)。
- `project_ml_backend` 表 → `project_ml_backend_pool` (`registry_id` → `pool_id`); 迁移保留原
  关联行 id / enabled / default_variants / 时间戳。
- `MLBackendService` resolver 方法 (list_enabled_for_project / get_project_backend /
  get_tracker_backend_for_capabilities / set_enabled / delete) 经服务池层操作; registry 创建
  (admin / env auto-upsert) 自动建 singleton pool。
- 删除 registry 前须先清理服务池层 (成员移除 + legacy 清空 + pool disable), 满足 RESTRICT FK。
- The product, documentation site, PWA installs, browser tabs, and README now share the new AI Annotation Platform icon.

## [0.23.2] - 2026-07-17

### Changed

- 全部第一方代码（9 个生产文件、17 个测试文件、1 个校验脚本）不再从 `gpu_arbiter` facade 导入，改为直接导入 `gpu_arbitration` 下按职责划分的子模块。导出视频 logger namespace 从 `app.services.export_video` 迁至 `app.services.exporting.video`（事件名、level、字段不变）。新增永久 removed-module 扫描器、`.dockerignore` 与迁移清单。

### Removed

- 物理删除 23 个旧平铺 service 兼容 facade 模块（Data Manager 6、Video 3、Export 6、GPU ledger 1、GPU orchestration 7），它们在源树、生产镜像和干净 Python 进程中均不可导入。兼容测试转为永久 removed-module 负向守卫（`find_spec is None`、五种导入形式冷进程失败、package 属性缺失）。API、WebSocket、Celery、SQL、Redis/Lua、锁序与用户行为零变化；完整迁移表见 `docs/migration/2026-07-17-v0.23.2-service-import-cutover.md`。

## [0.23.1] - 2026-07-17

### Changed

- GPU 准入签名实现 `gpu_admission_signer.py` 迁入领域包 `app.services.gpu_arbitration.signing`，原路径降级为纯兼容 facade（对象 identity、签名与冷导入双向守卫不变）；第一方生产代码、测试与校验脚本改用新路径。属 GPU 编排领域化收口的第一步，行为零变化。
- GPU rollout 持久状态与决策实现 `gpu_arbiter_rollout.py` 迁入领域包 `app.services.gpu_arbitration.rollout_state`，原路径降级为纯兼容 facade；`ml_client`、admin ML 接口与 health worker 改用新路径。`rollout_state` 是 cycle-safe 叶模块（仅依赖 config 与 rollout DB 模型），行为零变化。
- GPU tombstone 收集器最小权限 DB 边界 `gpu_collector_database.py` 迁入领域包 `app.services.gpu_arbitration.collector_database`，原路径降级为纯兼容 facade；health worker 与校验测试改用新路径。`collector_database` 是独立基础设施叶模块，行为零变化。
- 将 GPU dispatch 失败记录与汇总（`gpu_arbiter_failure_record` / `summarize_gpu_arbiter_failures`）从 `gpu_arbiter.py` 抽入 `gpu_arbitration.contracts`，并将 durable fence 原语（fence 错误、会话工厂类型、membership 行锁、generation/control-epoch/token-expiry high-water 事务与公开 fence API）抽入新模块 `gpu_arbitration.fences`。`gpu_arbiter.py` 显式 re-export 全部迁出符号，第一方调用方（workers、dispatch/membership/rollout sibling、fence/dispatch contract 测试）改用新路径。行为、SQL 文本、锁序与对象 identity 零变化。
- 将 GPU proof schema、canonical/residency 解析器、runtime subject dataclass 与错误、generation 准备、token horizon、drain health 分类、cold/eviction/eviction-cancel terminal commit 以及共享 proof-domain 原语（`_snapshot_gpu_mode_backend`、`_lock_gpu_resource_proof_domain`、`_optional_datetime_document`、`_gpu_domain_members`）从 `gpu_arbiter.py` 抽入新模块 `gpu_arbitration.proofs`（~2900 行、73 个定义）。`gpu_arbiter.py` 显式 re-export 全部迁出符号，`gpu_dispatch_authority` 与 proof recovery 测试改用新路径；私有 monkeypatch target 改到 `proofs` 模块。行为零变化。
- 将 legacy ack 与 rollout control 准备（错误、dataclass、evidence 校验、membership 别名检查、endpoint canonicalization、boot-id 挑战绑定、reset/mode 准备）从 `gpu_arbiter.py` 抽入新模块 `gpu_arbitration.control_preparation`（~900 行、16 个定义）。`gpu_arbiter.py` 显式 re-export 全部迁出符号；`gpu_membership_activation` 与 `gpu_rollout_control` 改用新路径。`control_preparation` 依赖 contracts、fences、proofs，不依赖 ml_client 或高层编排。行为零变化。
- 将 proof 评估、proof reset、repair 与 runtime observation 从 `gpu_arbiter.py` 抽入 `gpu_arbitration.reconciliation`；将 retired live probe、tombstone GC collection 抽入 `gpu_arbitration.retirement`（并在模块顶层依赖 `ml_client`，消除原函数内 import）；将 unregistered shadow dispatch 日志、backend config status 与 resource summaries 抽入 `gpu_arbitration.diagnostics`。至此 `gpu_arbiter.py` 成为纯显式兼容 facade（仅 re-export），无任何实现代码。行为、SQL、Redis/Lua、锁序与对象 identity 零变化。
- 将三个高层 GPU sibling 一对一迁入领域包：`gpu_dispatch_authority.py` → `gpu_arbitration.dispatch`、`gpu_membership_activation.py` → `gpu_arbitration.membership_activation`、`gpu_rollout_control.py` → `gpu_arbitration.rollout_control`。原路径全部降级为纯兼容 facade。第一方生产代码（deps、workers、admin ML 接口）、测试（含字符串 patch target）与校验脚本改用新路径。至此 7 个旧 GPU 实现路径全部成为 facade。行为、Celery 注册名、worker 路由与对象 identity 零变化。

## [0.23.0] - 2026-07-17

### Changed

- 文档站首屏把单张工作台海报升级为真实路由卡牌堆，自动按 AI 交互、视频、点云、Data Manager 与质检审阅循环；首卡抽出后回到底层，悬停或聚焦时暂停，并支持手动切换。工作台截图按场景关闭侧栏或固定左右各 15%。
- AI 工具组文档去掉重复总览图，按智能点、智能框、Magic Box、Exemplar、文本预标顺序展示各自工具条，并为四个交互工具分别补充无侧边栏、对齐真实车辆的 SAM3 操作 GIF；文档站首页同步提供四工具的左右滑动实录预览与独立说明。
- 文档站 OCR 场景改为真实 RapidOCR 当前题推理 GIF，并同步替换产品实证区的 OCR 展示；工作台录制统一使用 15% 左右侧栏，按场景显式开合且不再写回用户偏好。
- GPU 显存仲裁的 Redis ledger 从单体 `app/services/gpu_arbiter_store.py`（约 8.8k 行）拆分为领域 package `app/services/gpu_arbitration/ledger/`（types / keys / validation / store / scripts），并保留 `gpu_arbiter_store.py` 作为纯 re-export 兼容 facade。15 个最终 Lua 脚本的 SHA-256、Redis key、`KEYS`/`ARGV` 顺序、公开对象 identity 与签名完全不变；旧 `from app.services.gpu_arbiter_store import ...` 导入路径继续可用，仓内生产代码与测试已同步收敛到新路径。
- 打破 `gpu_arbiter ↔ ml_client` 循环依赖：将 `ml_client` 依赖的契约类型与纯策略（dispatch request/grant、错误码、claim 校验、shadow 仲裁、mode 解析等共 39 个符号）抽到 cycle-safe 的 `gpu_arbitration/contracts.py` 与 `gpu_arbitration/policy.py`，`ml_client` 改从这两个低层模块导入而不再导入 `gpu_arbiter`；`gpu_arbiter.py` 保留显式 re-export 以兼容旧 named import，同时继续承载尚待领域化的 orchestration 实现。retirement 探测仍按需局部导入 `ml_client`，此时已不构成环。
- 视频追踪三个平铺模块（`video_tracker_adapters.py` / `video_tracker_job_service.py` / `video_tracker_runner.py`）归位为领域 package `app/services/video_tracking/`（adapters / jobs / runner），原文件保留为纯 re-export 兼容 facade。同时把 task URL 解析从 API router 下沉到 `app.services.storage.resolve_task_url`，消除 tracker runner 的 service → API 反向依赖；tracker job 派发改用 `celery.send_task` 按名调度，消除 service → worker 反向依赖。Celery task 名称、signature、事件 channel/payload 与状态机均不变。
- 导出六个平铺模块（`export.py` / `export_packaging.py` / `export_cache.py` / `export_video.py` / `export_lidar.py` / `export_davis.py`）归位为领域 package `app/services/exporting/`（service / packaging / cache / video / lidar / davis），使用 `exporting` 命名以避开兼容期 `export.py`；六个原文件保留为纯 re-export 兼容 facade。导出成员路径、文件名、静态内容、manifest 语义与 cache key 均不变。
- Data Manager 与 Task Views（`data_manager.py` + 四个 `data_manager_*` 与 `task_views.py`）归位为领域 package `app/services/data_management/`，并按单向层级拆分为 9 个模块：primitive 层 `schema` / `task_metrics` / `task_filters` / `cursor`，mid 层 `entity_filters` / `entities` / `tracks`，high 层 `views` / `service`。消除原有 `data_manager ↔ task_views ↔ entity_filter` 三方循环：schema 与 task_metrics 抽成不依赖 views 的低层模块，task_filters 承载 filter/visibility primitives，entity_filters 只依赖 schema 与 task_filters 的公开接口；schema 根据项目配置直接确定 builtin view keys，不再依赖 views 的导入副作用。六个原文件保留为纯 re-export 兼容 facade，任务/对象/轨迹响应、排序、总数与 cursor 完全一致。

### Fixed

- 修复视频追踪任务按未注册的 Celery 短名称派发、导致 GPU worker 拒收且任务持续排队的问题；派发名称现与 worker 注册名及路由配置完全一致。
- 修复直接导入 Data Manager schema 时内置任务视图为空的问题；视图键现在仅由项目配置确定，不再受模块导入顺序影响。
- 修复文档站首屏以平台 Dashboard 充当标注工作台、与“人在回路”数据生产概念不符的问题；首屏现轮播真实的 AI 交互、视频、点云、数据管理与质检审阅场景。
- 修复视频 mask 导入、关键帧可见性与批量追踪种子处理，确保无损导入、outside 帧编辑和 mask 多轨延展保持正确。
- 修复视频追踪入口的模型与目标类别校验：已有轨迹可继续使用 SAM3，画布级无源追踪不会写入缺失或越界标签。
- 修复视频追踪迁移在存在无源或多源任务时无法回滚的问题；回滚会先移除旧 schema 无法表达的任务。
- 修复并发复用旧 mask 对象时可能被后台回收的问题；引用写入与回收现在按对象键协调并在删除前做最终引用检查。

<!--
日常变更（含普通 bug 修复）按 Keep a Changelog 类型分组追加到本段：
Added / Changed / Deprecated / Removed / Fixed / Security（按此顺序，空组省略）。
发版时把「## [Unreleased]」重命名为「## [x.y.z] - 日期」，再在其上方留一个空的
「## [Unreleased]」。0.23.x 版本段累积在本区；进入 0.24.x 后整体移到 docs/changelogs/0.23.x.md。
-->
