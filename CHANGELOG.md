# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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

## 最新版本

## [0.11.23] - 2026-05-29

> **删除批次时级联重置 task 状态 + 清 AI 预标（批次解绑状态修复 1/3）。** 删批次不再只解绑：批次内非 pending task 先重置回 pending（保留人工标注、软删 AI 标注、删 predictions），消除「review/completed task 解绑成孤儿」「重分包污染新批次计数/状态机」「AI 预标残留再预标叠加重复标注」三类问题。→ [plan](docs/plans/2026-05-29-v0.11.23-batch-delete-reset-cascade.md)

### Fixed

- **删除/批量删除批次级联重置**: 抽 `reset_to_draft` 的级联清理为 `BatchService._reset_and_clean_batch_tasks(batch_id)`，`delete()` / `bulk_delete()` 在解绑前复用——非 pending task → pending、软删 `source=prediction_based` annotation（保留 `manual`）、删 `predictions`/`failed_predictions`/`prediction_metas`/本批 `batch_predict` job、`total_predictions` 归零并重算 `total_annotations`/`is_labeled`。`reset_to_draft` 改调同一 helper（行为不变）。取消关联数据集走硬删 task 路径、无需此清理。

### Changed

- 用户手册 `projects/batch.md` 新增「删除批次」一节，说明重置语义与 AI 预标清除。

## [0.11.22] - 2026-05-29

> **批次分包统一走切分 + 支持注入单个批次 + 顺序切分。** 修复「分包时选单个批次无法把 task 注入」缺口（原「单个批次」模式只建空批次、且空批次无法再填充），把分包统一到切分流程：批次数量可填 1（= 把全部未归类任务注入一个新批次），并新增「顺序切分（不打乱）」。

### Added

- **顺序切分**: `BatchSplitRequest` 新增 `shuffle` 字段（默认 `true`）。`shuffle=false` 时按任务创建顺序切分、不打乱；`_splittable_task_ids` 加 `ORDER BY created_at, id` 保证结果稳定。前端「创建批次」对话框新增「顺序切分 / 打乱切分」切换。

### Changed

- **分包统一走切分，支持注入单个批次**: `n_batches` 下限从 2 放宽到 1，`n_batches=1` 即把全部未归类任务注入一个新批次（名称直接取 `name_prefix`，不加 " 1" 后缀）。前端移除「单个批次」空批次创建模式（空批次无法再追加任务，是死胡同），「创建批次」与「去分包」统一进切分对话框；批次数量为 1 时第二个输入变为批次完整名称。

### Fixed

- **删除批次时未归类任务状态去向写入 [ROADMAP](ROADMAP.md)**: 删除已预标注 / 进行中批次时 task 仅解绑（`batch_id` 置 NULL）、`status` 不变属设计预期，但其副作用（半成品 task 变未归类、重分包后状态滞留）作为待商议项记入 ROADMAP §A。

## [0.11.21] - 2026-05-28

> **ML backend 告警（Alertmanager）。** 新增 alertmanager service 与告警规则，backend 离线 / 显存打满 / 推理延迟劣化时经 SMTP 主动告警（dev 投递 mailpit），补上 PerfHud 没有的告警能力，完成可观测性 epic（v0.11.19–21）。

### Added

- **告警规则**: `infra/prometheus/alerts.yml` 三条 —— `MLBackendDown`（`up==0` 持续 5m）/ `GPUMemoryHigh`（显存 >90% 持续 10m）/ `InferenceLatencyHigh`（P95 >10s 持续 10m）；`prometheus.yml` 接入 `alerting` + `rule_files`。误报防护：`MLBackendDown` 只覆盖 http_sd 生成的 `ml-backends` target，主动 disconnect 的 backend 不在其中。→ [plan](docs/plans/2026-05-27-v0.11.21-ml-backend-alerting.md)
- **Alertmanager**: docker-compose `alertmanager` service（`monitoring` profile，9093）+ `infra/alertmanager/alertmanager.yml`，SMTP receiver dev 投递 mailpit、生产换真实 SMTP。

### Changed

- observability 指南 §4 更新：ML backend 告警从「建议规则」落地为仓库内规则。

## [0.11.20] - 2026-05-27

> **Grafana ML backend / GPU 监控面板。** 新增 `ML Backends` dashboard，把 v0.11.19 接入的 GPU/推理/cache 指标按 `service` 多 backend 对比可视化（显存占用、利用率、温度功耗、推理 P50/P95、cache 命中率、容器 CPU/内存）。

### Added

- **ML Backends Grafana dashboard**: `infra/grafana/dashboards/ml-backends.json`（provisioning 自动加载），11 个 panel + `$service` 多选模板变量，按 `service` label 区分 grounded-sam2 / sam3。复用既有 Prometheus datasource uid。→ [plan](docs/plans/2026-05-27-v0.11.20-grafana-ml-backend-dashboard.md)

### Changed

- `prometheus.yml` 的 `ml-backends` 兜底注释改用 bridge gateway 地址并补 dev 前提（dev `uvicorn` 默认绑 `127.0.0.1`，prometheus 容器经 host-gateway 抓不到 host api，需 `--host 0.0.0.0`；与既有 `anno-api` job 同前提）；observability 指南同步。

## [0.11.19] - 2026-05-27

> **ML backend 指标接入 Prometheus（自动发现）+ 指标命名统一。** 两个 ML backend（grounded-sam2 / sam3）的 `/metrics` 现由 Prometheus `ml-backends` job 经 http_sd 从 `ml_backends` 表自动发现并抓取——新 backend 在超管注册即被纳入，无需手改 `prometheus.yml`；指标统一为裸名 + `service` label 区分 backend。为 Grafana GPU 面板（v0.11.20）与告警（v0.11.21）铺底。

### Added

- **http_sd 服务发现端点**: 新增 `GET /api/v1/internal/metrics-targets`（`include_in_schema=False`，不进 OpenAPI 快照），从 `ml_backends` 表（`state != disconnected`）生成 Prometheus http_sd target 列表，按 `host:port` 去重 project-scoped 记录，labels 注入 `service` / `backend_id` / `project_id`。可选 `METRICS_SD_TOKEN` bearer 鉴权，默认空 = 免鉴权（与 `/metrics` 一致）。`prometheus.yml` 新增 `ml-backends` job（http_sd + static 兜底注释）。→ [plan](docs/plans/2026-05-27-v0.11.19-ml-metrics-naming-and-http-sd.md)
- **GPU 显存指标**: 两个 backend `/metrics` 补 `gpu_memory_used_mb` / `gpu_memory_total_mb` gauge（复用 PerfHud 现有 pynvml 采样，无新依赖、零额外采样），此前显存仅在 `/health`。

### Changed

- **指标命名统一**: sam3 backend 去掉所有指标的 `sam3_` 前缀，与 grounded-sam2 逐字对齐（`gpu_utilization_percent` / `inference_latency_seconds` / `embedding_cache_*` 等），同语义指标靠 `service` label 区分 backend；超管 PerfHud 读 `/health`、不受影响。
- 部署文档 §8.5 与可观测性指南同步：说明自动发现机制，及 PerfHud（实时一眼看）与 Prometheus/Grafana（历史趋势 + 告警）的分工。

## [0.11.18] - 2026-05-27

> **连接器导入保留源目录结构 + 路径名自动命名数据集。** 从 S3/OSS/SFTP 连接器导入时，数据集内部按 Source path 内部的子目录层级落库（不再拍平、也不多嵌套一层）；新建向导调整为「先选来源、后填信息」，连接器模式下数据集名自动取 Source path 末段（可改）。

### Added

- **连接器导入保留目录结构**: `ingest_one` 新增 `dest_relpath`，连接器导入 worker 计算每个对象相对 Source path 的子路径作为 `file_name` / 存储 key，源 `dataset-A/a/img.jpg` → 数据集内 `a/img.jpg`，目录与源一致。`scan_and_import` 同步保留前缀下的相对路径。后续对同一来源再导一次，已存在文件按内容哈希自动跳过、只补新增子文件夹。→ [plan](docs/plans/2026-05-27-v0.11.18-connector-import-preserve-structure.md)
- **新建向导步序调整 + 自动命名**: 导入向导「选择来源」与「基本信息」对调为先选来源；连接器模式选定 Source path 后，数据集名自动填为其末段（用户手改后不再被覆盖）。本地多文件 / ZIP 两种来源不受影响。

### Changed

- 不影响关联项目 / 分包 / 当前导出（`export_packaging` 本就按 `file_path` 推导相对路径）/ 缩略图等既有能力；`file_name` 含 `/` 仅在前端显示为更长路径。

## [0.11.17] - 2026-05-26

> **后台任务浮层清理。** `JobsBell` 浮层新增 `全部 / 进行中` 筛选与终态任务本地 dismiss，缓解连接器导入等新任务进入后浮层被终态历史挤占的问题。纯前端显示层，不触后端、不删除任何 job。

### Added

- **任务浮层筛选与清理**: `JobsBell` 顶部新增 `全部 / 进行中` 分段筛选，并支持对 `completed / failed / cancelled` 任务单条 ✕ 隐藏或「清空已结束」批量隐藏；选择与隐藏集合持久化到 `localStorage`。`pending / running` 永不隐藏，dismiss 仅影响本地显示、不调任何删除接口，完整历史仍走 `/ai-pre/jobs`。隐藏集合按当前轮询窗口收敛，避免 `localStorage` 无限增长。→ [plan](docs/plans/2026-05-26-v0.11.17-jobsbell-filter-dismiss.md)

## [0.11.16] - 2026-05-26

> **数据集导入能力扩展 · 连接器前端入口（切片 3/3）。** `/datasets` 现在可管理数据源连接器，并在导入向导中直接选择 S3/OSS 或 SFTP 连接器提交异步导入任务；连接器权限语义从项目级收敛为 owner-scope。

### Added

- **数据集页连接器管理**: 新增 `/datasets` 内的数据源连接器面板，支持创建、编辑、删除、连通性测试 S3/OSS 与 SFTP 连接器；非超管创建的连接器默认归属创建者，超管仍可创建全局连接器。→ [plan](docs/plans/2026-05-26-v0.11.16-connector-frontend.md)
- **导入向导连接器模式**: `ImportDatasetWizard` 在多文件与 ZIP 之外新增「连接器导入」，可选择连接器、填写 `source_path`、递归扫描与 `include_globs`，提交后轮询 `AsyncJob(kind="dataset_import")` 进度与结果。

### Changed

- **连接器权限 owner-scope 化**: `StorageScope` 从 `project` 调整为 `owner`；列表对普通用户只返回全局连接器与本人创建的连接器，测试与导入统一走 `assert_connection_usable(user, conn)`。历史 `project_id` 列保留但新连接器不再写入。

## [0.11.15] - 2026-05-26

> **数据集导入能力扩展 · SourceAdapter + 异步导入（切片 2/3）。** 连接器现在可经 HTTP API 端到端导入数据集：外部 S3/OSS 或 SFTP 路径由 Celery job 流式复制到 `minio-datasets`，复用 DatasetItem/Task/媒体派生管线，并可通过 `async_jobs` 轮询与取消。

### Added

- **SourceAdapter + S3/SFTP 拉取实现**: 新增 `SourceAdapter` 抽象及 `S3CompatibleSource` / `SftpSource`，导入前复检连接器主机白名单并限制 `source_path` 必须位于连接器 `base_prefix` / `base_path` 内，支持递归扫描与 `include_globs` 过滤。→ [plan](docs/plans/2026-05-26-v0.11.15-adapter-and-import-job.md)
- **异步数据集导入 API**: 新增 `POST /api/v1/datasets/{id}/import-from-connection`，创建 `AsyncJob(kind="dataset_import")` 后由 Celery 后台执行；job payload 只保存连接器 ID、数据集 ID、路径与过滤条件，不保存明文密钥。
- **流式入库复用管线**: `DatasetService.ingest_one()` 分块写入 `minio-datasets`，同步计算 content hash，重复内容跳过并清理临时对象；新增文件会生成 DatasetItem、为已关联项目补 Task，并派发缩略图 / 视频元数据任务。

## [0.11.14] - 2026-05-26

> **数据集导入能力扩展 · 存储连接器基建（切片 1/3）。** 为"服务端主动拉取"类导入（外部 S3/OSS + SFTP/SSH）打地基：可复用、密钥加密落库、受超管主机白名单约束的存储连接器。本版仅含连接器管理与连通性测试，实际导入在后续切片。

### Added

- **存储连接器 CRUD + 连通性测试**: 新增 `storage_connections` 表与 `/api/v1/storage-connections` 端点（list/create/get/patch/delete/test）。支持 `s3`（外部对象存储）与 `sftp`（宿主机 & 同网段服务器）两类。超管可建 global-scope，项目负责人可建归属己项目的 project-scope。→ [plan](docs/plans/2026-05-26-v0.11.14-connector-foundation.md)
- **连接器主机白名单（SSRF 防护）**: 新增 `GET/PUT /api/v1/storage-connections/allowlist`（仅超管）。连接器创建 / 测试 / 导入入口统一过白名单 + SSRF 校验：DNS 解析为真实 IP 后逐个判定，永久拒绝 loopback / link-local（含云元数据 169.254.169.254），内网地址须经白名单 CIDR 显式放行，缓解 DNS rebinding。
- **凭据 Fernet 加密**: 连接器密钥（AK/SK、SSH 密码 / 私钥）经新环境变量 `CONNECTOR_ENCRYPTION_KEY`（与 `SECRET_KEY` 隔离）Fernet 加密落库，API 永不回吐明文（仅 `secret_set:bool`）；未配置时连接器加解密一律拒绝（返回 503）。

## [0.11.13] - 2026-05-26

> **类别 / 属性孤儿数据治理。** 删除类别或属性前展示受影响标注数；工作台可隐藏孤儿标注；导出跳过孤儿类别并收敛属性；新增 owner/superadmin cleanup 端点。

### Added

- **类别 / 属性删除确认用量统计**: 新增 `GET /projects/{id}/class-usage`，项目设置删除类别或属性时拉取当前 active 标注计数，确认文案明确“删除定义不删除标注，加回同名 / 同 key 可恢复”。
- **工作台隐藏孤儿标注开关**: Topbar ⚙ 菜单新增“隐藏孤儿标注”，同时作用于画布与右侧人工列表；未隐藏时孤儿行显示“已删除”标记。
- **孤儿 cleanup 运维端点**: 新增 `POST /projects/{id}/cleanup-orphans`，默认 `dry_run=true` 返回孤儿标注数与孤儿属性 key 计数；`dry_run=false` 软删孤儿类别标注并移除有效类别标注中的孤儿用户属性 key。→ [plan](docs/plans/2026-05-26-v0.11.13-orphan-class-attr-cleanup.md)

### Changed

- **导出兜底过滤孤儿数据**: COCO / YOLO / VOC / AAP JSON / Video JSON 统一在加载后跳过当前类别定义中不存在的标注，并只导出当前 attribute schema 内的用户属性 key，避免 schema 与 data 自相矛盾。

## [0.11.12] - 2026-05-25

> **评论画布批注交互完善。** 评论批注改为点击 pin 持续显示在 konva 画布上；正在编辑的评论的 pending 批注实时预览到画布；修复白板快速绘制丢点。

### Changed

- **评论画布批注：hover-reveal → 点击 pin** ([useHoveredCommentStore.ts](apps/web/src/pages/Workbench/state/useHoveredCommentStore.ts) · [CommentsPanel.tsx](apps/web/src/pages/Workbench/shell/CommentsPanel.tsx)): 此前评论的画布批注仅在 hover 评论卡片时半透明叠加到 konva 画布、鼠标一移开即清空，无法移到画布定睛查看。改为「点击评论卡片 = pin 其批注到画布持续显示」（再次点击同条 / 切换标注则取消），hover 保留为快速 peek。落实「批注线 ⟷ 评论绑定、聚焦即显示」的可见性模型。
- **正在编辑的评论 pending 批注预览到画布** ([CommentInput.tsx](apps/web/src/pages/Workbench/shell/CommentInput.tsx) · [useHoveredCommentStore.ts](apps/web/src/pages/Workbench/state/useHoveredCommentStore.ts)): 此前「弹窗批注」保存后只更新评论区按钮、主画布不显示，须再点「在题图上绘制」才载入可见。现 CommentInput 把 pending 批注上报到 composing 预览通道，弹窗批注 / live 完成后即实时叠加到主 konva 画布，发送 / 切换标注后清除。画布叠加优先级统一为 `selectEffectiveShapes`: hover（peek）> composing（编辑中）> pinned（点击选中）。

### Fixed

- **白板（弹窗批注 CanvasDrawingEditor）快速绘制时笔画跟不上手** ([CanvasDrawingEditor.tsx](apps/web/src/components/CanvasDrawingEditor.tsx)): `handleMove` 用渲染闭包里的 `drawing` 做守卫，pointerdown 的 `setDrawing` 未 flush 时紧跟的快速 pointermove 命中旧闭包 `drawing===null` 被丢弃，笔画开头缺失。改用 pointerdown 同步置位的 ref 守卫，不受 React 渲染时机影响。

## [0.11.7] - 2026-05-25

> **Issue 视频帧图钉。** video stage 按当前播放帧显隐 issue 图钉，时间轴标记可跳帧。

### Added

- **Issue 视频帧图钉** ([VideoIssueLayer.tsx](apps/web/src/pages/Workbench/stage/VideoIssueLayer.tsx)): video stage 按当前播放帧（`anchor_position.frame`）显隐 pixel-anchored issue 图钉；时间轴对有 issue 的帧加标记可点击跳帧；DiscussionIssuesTab 列表项显示所属帧（`F{n}`）并支持单击跳帧定位。→ [plan](docs/plans/2026-05-25-v0.11.7-issue-video-frame-pin.md)

### Fixed

- **VideoStage `issueFrames` useMemo 提到 early-return 之前**: 帧标记 memo 误放在 `isLoading`/`error` 返回之后，违反 `react-hooks/rules-of-hooks`。

## [0.11.5] - 2026-05-25

> **DiscussionPanel 转正 + 右栏旧路径清理。** 去 flag、删旧 CommentsPanel 路径，并修复转正后实测发现的回退。

### Changed

- **DiscussionPanel 转正 + 右栏旧路径清理**: 移除 `DISCUSSION_PANEL_ENABLED` flag，两段右栏成为默认；AIInspectorPanel 瘦身（移除内嵌 CommentsPanel 及相关 props）；删除旧浮动 `IssueListPanel`（图钉点击与 issue FAB 统一改走 DiscussionPanel issues tab）。→ [plan](docs/plans/2026-05-25-v0.11.5-discussion-cutover-cleanup.md)

### Fixed

- **右栏列宽拖拽线在 DiscussionPanel 区域失效**（实测）: 列宽 `ResizeHandle` 原在 AIInspectorPanel 内，去 flag 后只覆盖右栏上段；提到 `.rightSplit` 全高层级，整列可拖。
- **评论内画布批注（live 绘图）+ 点评论跳帧（video）断开**（实测，v0.11.2 引入）: DiscussionPanel 复用 CommentsPanel 时漏传 `backgroundUrl`/`enableCanvasDrawing`/`liveCanvas`/`commentAnchor`/`onSeekFrame`，去 flag 后旧路径消失致功能失效；透传桥接 props + 恢复 shell model 的 `videoCommentAnchor` memo 与 `liveCanvas` 桥接。
- **标注评论删除后偶现重现**（实测）: 后端软删正确但前端 invalidate+refetch 在快速切换标注时有 stale 缓存竞态；`useDeleteComment` 改为乐观移除 + 失败回滚 + invalidate 兜底。

## [0.11.1] ~ [0.11.4] - 2026-05-25

> **工作台统一讨论面板 DiscussionPanel。** 右栏两段布局，评论 / 历史 / Issue 三 tab，Issue 列表 ↔ 画布图钉双向联动。

### Added

- **工作台统一讨论面板 DiscussionPanel** ([DiscussionPanel.tsx](apps/web/src/pages/Workbench/shell/DiscussionPanel.tsx)): 右栏改为两段固定布局（上 AIInspectorPanel + 下 DiscussionPanel，中间可拖拽 [ResizeHandle](apps/web/src/pages/Workbench/shell/ResizeHandle.tsx) 纵向、比例持久化 localStorage）。DiscussionPanel 含 3 个 tab: **评论**（标注级 / 任务级合并，复用 CommentsPanel `hideTabs`/`forceTab`）、**历史**（标注级 / 任务级 audit 时间线，复用既有 `GET /tasks/{id}/audit-history`）、**Issue**（[DiscussionIssuesTab](apps/web/src/pages/Workbench/shell/DiscussionIssuesTab.tsx) · `useFeedbacks(kind=issue)` 列表 + status 过滤）。Issue 列表 ↔ 画布图钉双向联动（[useActiveIssueStore](apps/web/src/pages/Workbench/state/useActiveIssueStore.ts): 单击列表项定位+高亮图钉，单击图钉切 tab+高亮行）。边界: 仅统一 comment/issue/history，bug/reject 保留各自专用入口。→ plan [v0.11.1](docs/plans/2026-05-25-v0.11.1-discussion-panel-shell.md) / [v0.11.2](docs/plans/2026-05-25-v0.11.2-discussion-comments-tab.md) / [v0.11.3](docs/plans/2026-05-25-v0.11.3-discussion-history-tab.md) / [v0.11.4](docs/plans/2026-05-25-v0.11.4-discussion-issues-tab.md)

## [0.11.0] - 2026-05-25

> **双写一致性对账 cron。** 补 ADR-0027 承诺的对账安全网，drift>0 写审计 + 通知 superadmin。

### Added

- **双写一致性对账 cron** ([feedback_reconcile.py](apps/api/app/services/feedback_reconcile.py) · [worker](apps/api/app/workers/feedback_reconcile.py)): 补 ADR-0027 承诺却未落地的对账。纯函数 `compute_feedback_drift` 按 `source_table` 对比 `v_annotation_feedback_unified` 与各旧表"应 mirror 行数"（排除 `bug_reports.project_id IS NULL` / `annotation_comments.is_active=false` / `tasks.status≠rejected` 等设计内不 mirror 行）；beat 任务 `reconcile_annotation_feedback`（每日 03:00 UTC）在 drift>0 时写 `FEEDBACK_RECONCILE_DRIFT` 审计 + 通知 superadmin。切单源前的数据一致性安全网。→ [plan](docs/plans/2026-05-25-v0.11.0-feedback-reconcile-cron.md)

### Fixed

- **通知中心补 `feedback.reconcile_drift` 标签** ([NotificationsPopover.tsx](apps/web/src/components/shell/NotificationsPopover.tsx)): 对账 cron 通知此前无 `TYPE_LABEL` 映射，会向 superadmin 显示原始点号字符串。

<!-- 0.11.x 版本变更按版本段追加到本区；开始开发 0.12 后整体移到 docs/changelogs/0.11.x.md -->
