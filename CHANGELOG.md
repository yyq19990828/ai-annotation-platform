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
