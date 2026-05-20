# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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

## [0.10.23] - 2026-05-20

> **ML Backend 变体运行期热切换 + 工作台变体/文本面板收敛.** grounded-sam2-backend 原用全局单例 `_predictor` + 单 cache, 变体由启动 env `SAM_VARIANT`/`DINO_VARIANT` 锁死, `_run_prompt` 完全忽略请求变体。本期引入容器内 `ModelPool`: 按请求级 `(sam_variant, dino_variant)` LRU 缓存 predictor, 命中复用 / miss 冷启 1–3s / 超 cap 驱逐 LRU + 释放显存; embedding cache 按变体分桶隔离。前端把变体选择上移 AI 面板(会话级, 切工具保留), 文本输入下沉子工具面板。**前置 bug 修复**: `/setup` 的 `sam_variant` enum 原暴露 `["tiny","small","base","large"]`, 但 `SAM2_CONFIGS` key 是 `base_plus` —— 选 `base` 会在 backend 真消费 variant 后 KeyError → 422; 统一为 `["tiny","small","base_plus","large"]`。 → [plan](ROADMAP/2026-05-20-v0.10.23-plan.md) · [需求](ROADMAP/2026-05-20-ml-backend-variant-hot-switch.md)。

### Added

- **`model_pool.py` · 容器内变体 LRU 池** ([apps/grounded-sam2-backend/model_pool.py](apps/grounded-sam2-backend/model_pool.py)): `OrderedDict[(sam,dino), GroundedSAM2Predictor]` LRU(cap=`MODEL_POOL_CAP`); `async get()` 命中 `move_to_end`, miss 在 per-variant `asyncio.Lock` 内 `run_in_executor` build(防并发同变体重复 build), 超 cap 先驱逐到 cap-1 再 build(避免峰值 cap+1 模型); pool 满 + 并发 miss 排队超 `MODEL_POOL_BUILD_TIMEOUT` 抛 RuntimeError(main.py 翻 503); embedding cache 按变体分桶 `dict[(sam,dino), EmbeddingCache]`, 驱逐时连带 clear 桶 + `_free_gpu_memory()`; idle watcher 超时 `clear_all()` 清整池。
- **新 env `MODEL_POOL_CAP`(默认 1) / `MODEL_POOL_BUILD_TIMEOUT`(默认 30s)** ([docker-compose.yml](docker-compose.yml) · [.env.example](.env.example)): 加显存预算注释(4060=1 / 3090=1-2 / A100=2-4)。
- **多变体 checkpoint 预拉 `PREFETCH_SAM_VARIANTS` / `PREFETCH_DINO_VARIANTS`** ([scripts/download_checkpoints.py](apps/grounded-sam2-backend/scripts/download_checkpoints.py) · [docker-compose.yml](docker-compose.yml) · [.env.example](.env.example)): pool 能服务多变体, 但 entrypoint 原只下主变体 checkpoint → 运行期请求其他变体 `FileNotFoundError`。新增逗号分隔的预拉列表(默认全量 `tiny,small,base_plus,large` × `T,B`, 磁盘紧张可裁剪); 主变体下载失败 `exit 1`(不带半残上线), 额外变体失败仅 warn 不阻塞启动(运行期由 pool 报 503)。
- **后台 prefetch + `/health.provisioning` warming-up** ([Dockerfile](apps/grounded-sam2-backend/Dockerfile) · [main.py](apps/grounded-sam2-backend/main.py) · [download_checkpoints.py](apps/grounded-sam2-backend/scripts/download_checkpoints.py)): 全量 prefetch 在全新 volume 上要下 ~3GB, 原 entrypoint 阻塞下载期间(数分钟)容器对外是 `error`。改为 entrypoint 仅阻塞下**主变体**(单档, 秒级)→ uvicorn 立即起 → app startup 后台 subprocess 跑 `download_checkpoints.py prefetch` 边服务边补额外变体。`/health` 加 `provisioning` 子对象(`idle`/`downloading`/`ready`/`partial`/`error`), 下载脚本加 `primary`/`prefetch`/`both` 三模式。期间请求未下完的变体仍 503(可诊断), 但容器对外 healthy。

### Changed

- **`main.py` 接入 pool + 请求级变体** ([apps/grounded-sam2-backend/main.py](apps/grounded-sam2-backend/main.py)): startup 预热默认变体进 pool(保持单变体常驻); `_run_prompt` 经 `_resolve_variant(ctx)` 读 `ctx.{sam_variant,dino_variant}`(缺省回退 env 默认, 非法值 422), `await _pool.get(sv,dv)`, `cache_key`/cache 桶按请求变体隔离; `model_version` 经 `_model_version(sv,dv)` 按请求变体拼; `/setup` 去两个 variant 的 `readOnly` 并对齐 enum 为 `base_plus`; `/health` 加 `pool` 子对象(`cap`/`loaded_variants`/`evict_count`/`per_variant_lru_ts`), `/cache/stats`+`/metrics` 聚合各桶; `/unload`/`/reload` 改整池语义。
- **embedding cache 加 `variant`/`size()`** ([apps/grounded-sam2-backend/embedding_cache.py](apps/grounded-sam2-backend/embedding_cache.py)): `EmbeddingCache(sam_variant=...)` 记录所属变体, `stats()` 暴露 `variant`, 新增 `size()` 供 pool 聚合。
- **前端变体上移 AI 面板 / 文本下沉子工具** ([AIInspectorPanel.tsx](apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx) · [SchemaForm/index.tsx](apps/web/src/pages/Workbench/components/SchemaForm/index.tsx) · [WorkbenchShell.tsx](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx) · [useWorkbenchState.ts](apps/web/src/pages/Workbench/state/useWorkbenchState.ts)): 变体选择移到 AI 面板(会话级 `aiVariant`, 切工具不重置), `SchemaForm` 排除 variant enum 字段, enum 原值直接渲染不映射。
- **变体切换三态通知** ([useInteractiveAI.ts](apps/web/src/pages/Workbench/state/useInteractiveAI.ts)): 变体切换是惰性的(选完下次预测才生效), 故在切换后首次预测期间复用全局 `useToastStore` 弹「正在切换到 SAM x/DINO y 模型…」→「已切换到 …」/「模型切换失败: {detail}」三态(透 backend 503 detail); `lastAppliedVariantRef` 记上次成功应用的变体签名, 同变体后续预测不弹, 切 backend 时清空。不加「应用」按钮 / 不主动预热(选择即应用)。
- **协议/部署文档同步** ([ml-backend-protocol.md](docs-site/dev/reference/ml-backend-protocol.md) · [docker-compose.md](docs-site/ops/deploy/docker-compose.md)): `/predict` context 加 `sam_variant`/`dino_variant` 字段说明, `/health` pool 子对象, `/setup` 去 readOnly + 修 enum, deploy 加按显存配 pool cap + 多变体 prefetch 章节。

### Fixed

- **Dockerfile 漏 COPY `model_pool.py`** ([apps/grounded-sam2-backend/Dockerfile](apps/grounded-sam2-backend/Dockerfile)): 该 Dockerfile 用显式文件名白名单 COPY 各 `.py`, 新增的 `model_pool.py` 未加进列表 → 镜像内缺文件, 容器启动 `ModuleNotFoundError: No module named 'model_pool'`。加进 COPY 行。(GPU 真机重建时发现; 纯 lint/单测覆盖不到打包完整性。)
- **缺 checkpoint 变体从 500 → 503 可诊断** ([apps/grounded-sam2-backend/main.py](apps/grounded-sam2-backend/main.py)): 请求未预拉的变体时 `_build_predictor` 抛 `FileNotFoundError` 原裸传成 500; 改为 `_get_predictor` 捕获翻 503, 提示"把该变体加入 PREFETCH_* 后重建 / 手动下载 checkpoint"。
- **`DINO_CONFIGS["B"]` config 文件名错配** ([apps/grounded-sam2-backend/predictor.py](apps/grounded-sam2-backend/predictor.py)): vendor 里 SwinB 的 config 实际叫 `GroundingDINO_SwinB_cfg.py`, 但映射表写成 `GroundingDINO_SwinB_cogcoor.py` → 加载 DINO B 时 `FileNotFoundError`。变体热切换前 DINO 永远锁 `T`, 此错配从未被触发; 本期 GPU 真机切到 `dino_variant=B` 才暴露 (checkpoint `.pth` 下载正常, 只是 config `.py` 名错)。修正为 `GroundingDINO_SwinB_cfg.py`。

## [0.10.22] - 2026-05-20

> **ADR-0026 单源真值收口 · 删除派生 `classes` / `classes_config` / `attribute_schema` 列.** v0.10.17 引入 `tool_bindings` 后,旧扁平列由 service 层在每次写时双写派生兜底 —— 存储层实际存着两份会漂移的真值,ADR-0026 宣称的"单源"未真正达成。本期 drop 三列(`projects` + `project_templates`,migration 0078),移除写时双写 helper `apply_tool_bindings_legacy_sync`,所有读端(响应序列化 / COCO·YOLO·AAP 导出 / clone)改为从 `tool_bindings` **读时派生**。关键决策:① **不删** `ProjectOut` / `ProjectTemplateOut` 的三个扁平字段 —— 它们被 8+ 处活跃前端代码消费(`WorkbenchShell` / `AIInspectorPanel` / `useWorkbenchHotkeys` 等),改为 `model_validator` 序列化时从 `tool_bindings` 派生,前端零改动、API 契约不变(OpenAPI 仅 1 行 docstring 变化);② **保留** `coalesce_legacy_into_tool_bindings` 反向输入兼容(旧客户端 / 旧 AAP JSON schema 1.0 仍可传扁平字段,折叠进 `tool_bindings`);③ `derive_legacy_*` 去 "legacy" 命名升格为规范读时派生 helper。**reject_reason_type 结构化枚举(ROADMAP §B 标 P2 待做)经核查实为 v0.10.16 已落地,ROADMAP 该条陈旧。** → [plan](docs/plans/2026-05-20-v0.10.22-single-source-of-truth-cutover.md) · [ADR-0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md)。

### Changed

- **drop 派生列 + 写时双写移除** ([0078_drop_derived_class_columns.py](apps/api/alembic/versions/0078_drop_derived_class_columns.py) · [models/project.py](apps/api/app/db/models/project.py) · [models/project_template.py](apps/api/app/db/models/project_template.py) · [services/project.py](apps/api/app/services/project.py)): drop `projects` / `project_templates` 的 `classes` / `classes_config` / `attribute_schema` 三列(downgrade 重建并从 `tool_bindings` 回填);删 `apply_tool_bindings_legacy_sync`,`derive_legacy_*` → `derive_*`(读时派生投影);移除 create / update / rename_class / 模板 create-update 共 5 处双写调用。
- **`ProjectOut` / `ProjectTemplateOut` 序列化派生** ([schemas/project.py](apps/api/app/schemas/project.py) · [schemas/project_template.py](apps/api/app/schemas/project_template.py)): 加 `model_validator(mode="after")`,从 `tool_bindings` 派生 `classes` / `classes_config` / `attribute_schema` 三字段(响应形状不变)。
- **导出读端切派生** ([services/export.py](apps/api/app/services/export.py)): video-track / COCO / YOLO / AAP JSON 导出的 categories / classes.txt / attribute_schema 由读 `project.classes*` 改为 `derive_*(project.tool_bindings)`;clone 白名单([project_clone.py](apps/api/app/services/project_clone.py))去掉三个扁平字段,配置全部经 `tool_bindings` 复制。
- **create_project 校正显式扁平输入优先级** ([api/v1/projects.py](apps/api/app/api/v1/projects.py)): 把 `coalesce + pop` 提前到 source / template 兜底合并之前,保证客户端显式传的 `classes` 覆盖模板/源项目的 `tool_bindings`(此前模板注入的 `tool_bindings` 会让 coalesce 提前返回、丢失显式覆盖)。
- **前端 useToolBindings fallback 清理** ([useToolBindings.ts](apps/web/src/pages/Workbench/state/useToolBindings.ts)): 删除"老项目扁平字段 fallback"分支(全部项目已 backfill `tool_bindings`,且扁平字段现由其派生、不可能独立存在),保留 bbox/region 借类逻辑。

### Verified

- 后端 `cd apps/api && uv run pytest` → 全绿(含 `test_tool_bindings_helpers` / `test_projects_clone` / `test_project_templates` / `test_export_aap_json` / `test_openapi_contract`);测试 fixture 用 conftest 注入式兼容层(复用生产 `coalesce` 把旧 `classes=[...]` 风格 ORM 构造翻译为 `tool_bindings`,生产模型无 shim)。
- 前端 `pnpm vitest run useToolBindings useProjectToolBindings` → 全绿(2 个断言旧 fallback 的用例更新为单源语义)。
- OpenAPI 快照重生(`pnpm openapi:export`):schema 不变,仅 rename_class 操作描述 1 行变化。

## [0.10.21] - 2026-05-19

> **v0.10.20 deferred 项部分收口: I4 笔画 timeline + 任务级 feedback patch/delete UI.** 原计划 5 项 (D1-D5) 开工时重估发现 D1 (ADR-0027 切单源) 远超原计划体量 — 旧三表 (bug_reports / annotation_comments / tasks.reject_reason) 各自带独立 state machine + 子资源 (BugComment) + 前端专用 UI (BugReportDrawer), 不是删 mirror 写路径就能切, 需独立 legacy-table-retirement epic 处理。D3 (DiscussionPanel 完整拆分) 与 D5 (IssueLayer video pin) 为结构性 / stretch 工作, 无 UX 增量, 一并延期。**v0.10.21 收紧到 D2 + D4 两项可立即落地的 UX 完善**, 不破窗 ADR-0027 第三段决策。 → [plan](docs/plans/2026-05-19-v0.10.21-i4-stroke-timeline-adr0027-cutover.md).

### Added

- **I4 · 笔画 timeline 协议字段 + 评论卡片下方迷你时间条** ([_jsonb_types.py CanvasShape](apps/api/app/schemas/_jsonb_types.py) · [CanvasDrawingEditor.tsx](apps/web/src/components/CanvasDrawingEditor.tsx) · [CanvasDrawingEditor.module.css](apps/web/src/components/CanvasDrawingEditor.module.css)): `CanvasShape` 加 3 个 Optional 字段 `id` / `started_at` / `ended_at` (全 Optional, 旧记录缺字段时 UI 降级不渲染 timeline, 无 alembic migration); `CanvasDrawingEditor.handleDown/handleUp` 用 `Date.now()` 记 ms epoch + `crypto.randomUUID()` 生成 id; `CanvasDrawingPreview` 在 SVG 下方渲染 `TimelineBar` (纯 CSS flex bar, 每段 stroke 一个 segment, `flex-grow` ∝ 持续时长, `background` = stroke 颜色); hover segment → 仅该 stroke `opacity=1`, 其他 `opacity=0.25`, 移开恢复全部 1。
- **D4 · 任务级 feedback patch/delete UI 入口** ([CommentsPanel.tsx](apps/web/src/pages/Workbench/shell/CommentsPanel.tsx)): v0.10.20 任务级 feedback 行 (`__source=feedback`) 仅展示, 本期开放 patch (PATCH /feedbacks/{id} · status=resolved/open) + delete (DELETE /feedbacks/{id} · 软删 is_active=false); 作者本人可见删除按钮 (server 端 permission 兜底); `usePatchFeedback` / `useDeleteFeedback` hook 早在 v0.10.19 已就位, 本期仅 UI 接线。
- **4 例 vitest** ([CanvasDrawingPreview.timeline.test.tsx](apps/web/src/components/CanvasDrawingPreview.timeline.test.tsx)): ① 旧 shape 缺时间戳 → timeline 不渲染 (降级); ② 全字段 → 段数 = shape 数; ③ 混合 (1 缺 1 全) → 整段降级不渲染 (一致性); ④ hover segment → 对应 polyline opacity=1, 其他=0.25, 移开恢复。

### Changed

- **codegen openapi.snapshot.json 重生**: `CanvasShape` 新字段同步到前端 `generated/types.gen.ts` (id / started_at / ended_at 全 Optional)。

### Verified

- 后端 `cd apps/api && uv run pytest tests/test_annotation_comments_paged.py tests/test_comment_polish.py tests/test_annotation_feedbacks.py` → **16 passed** (无回归; schema 新字段全 Optional 不破老测试)。
- 前端 `pnpm --filter web typecheck` → 0 errors。
- 前端 `pnpm --filter web test` → **737 passed / 103 files** (baseline 733 + 4 新增 timeline 测试)。
- 前端 `pnpm --filter web lint` → 0 errors / 117 warnings (baseline 116 + 1 useElementStyle deps warning in TimelineSegment)。

### Deferred (推迟到独立 epic / v0.11+)

- **D1 · ADR-0027 第三段 (切单源)**: 重估发现旧三表各自带独立 state machine + 子资源 + 前端 UI, 不是删 mirror 写路径就能切。留独立 legacy-table-retirement epic (v0.11+) 处理: 先按表逐个评估迁移影响面 (bug_reports → 整套 BugReportDrawer / BugComment / display_id 体系; annotation_comments → mentions / attachments 子表; tasks.reject_reason → state machine 状态字段)。**双写仍正常进行 (v0.10.20 已落), 不破窗**。
- **D3 · 独立 DiscussionPanel.tsx + WorkbenchLayout 右栏两段固定结构 + ResizeHandle**: 重估发现 CommentsPanel 内嵌 Tabs (comments / history) 已能承担 UX, 拆出 DiscussionPanel + 右栏两段拆分为纯结构改造, 对用户行为无增量。Workbench Shell 仍 1210 行未破 900 触发线, 暂缓。
- **D5 · IssueLayer video stage frame-aware pin**: video stage 的 frame-aware pin 需要重做坐标转换 + frame 过滤 store, 与视频时间轴交互细节多, 留单独切片处理 (anchor_position 已预留 frame 字段, 协议不动)。

## [0.10.20] - 2026-05-19

> **v0.10.19 epic 留下的 5 项 deferred 收口 + ADR-0027 第二段迁移.** 把 I4 任务级评论 (POST /feedbacks · kind=comment / anchor_type=task) / I12 BoxList group 折叠卡片 + AttributeForm 多选 batch banner / I18 IssueLayer Konva pin 渲染 + 单击落点创建 / ADR-0027 三段式迁移第二段 (`v_annotation_feedback_unified` UNION ALL view + bug_reports / annotation_comments / tasks.reject_reason 双写 mirror) 一次性落地。**纯 UI / 双写迁移工作**, 后端契约延用 v0.10.19 已定型的 `annotation_feedbacks` + `annotations.group_id`, 不引入新 schema。关键决策: ① 任务级评论**不**新加 POST /tasks/{id}/comments 端点 (复用 v0.10.19 已落的 POST /feedbacks, 减少端点数量 + 直接走未来主存储); ② 旧三表写入路径接入 `FeedbackService.mirror_*` helper, 同事务 INSERT 新表, 失败一起回滚 (一致性由 PG 事务保证); ③ `v_annotation_feedback_unified` view 带 `source_table` 列, 用于双写一致性对账与 v0.10.21 切单源前的过渡; ④ I12 BoxList 同 group_id (≥2 成员) 折叠为带哈希色点的 group 卡片 (单击头部 = 整组选中, 单击 chevron = 展开/折叠), AttributeForm 在 `selectedIds.length > 1` 时顶部 batch banner + onChange fan-out 走 useAnnotationBulkUpdate; ⑤ I18 IssueLayer Konva 层挂在 ImageStage `</Stage>` 之前 (位于 ImageStageShapes 层之上), status 配色 (open=橙/resolved=绿/wont_fix=灰) + 高亮态加阴影, drop-arm FAB (crosshair 图标) 激活后单击图像落点 → 派发归一化坐标 → IssueCreateModal 自动预填 x/y. **不引入**: ① 独立 `DiscussionPanel.tsx` + WorkbenchLayout 右栏两段固定结构 (无 UX 增量, 控制 PR 体量); ② POST /tasks/{id}/comments 端点 (决策见 D1); ③ 旧 bug_reports / annotation_comments 数据 backfill 到 feedbacks (留 v0.10.21 切单源时一次性 backfill); ④ I4 笔画 timeline (canvas_drawing.shapes[i] 加 id/started_at/ended_at + 评论卡片下方迷你时间条) (stretch goal, 无客户触发信号 → 延期 v0.10.21); ⑤ IssueLayer 在 video stage 的 frame 维度 pin (anchor_position 已预留 frame 字段, 后续切片). → [plan](docs/plans/2026-05-19-v0.10.20-i4-i12-i18-deferred-closure.md) · [ADR-0027](docs/adr/0027-annotation-feedback-unified-table.md).

### Added

#### 后端

- **alembic 0077 · `v_annotation_feedback_unified` view** ([0077_annotation_feedback_unified_view.py](apps/api/alembic/versions/0077_annotation_feedback_unified_view.py)): UNION ALL 4 个数据源 (annotation_feedbacks / bug_reports / annotation_comments / tasks.reject_reason), 字段对齐到统一 schema (id/kind/anchor_type/project_id/task_id/annotation_id/anchor_position/status/severity/title/body/author_id/created_at/updated_at/is_active) + 额外 `source_table` 列方便对账; bug_reports.status 值域映射到统一 open/resolved/wont_fix (fixed → resolved, duplicate → wont_fix); annotation_comments 仅 is_active=true 行出现; tasks 仅 status='rejected' AND reject_reason IS NOT NULL 行出现; bug_reports.project_id IS NULL 行不出现 (新表 project_id NOT NULL).
- **`FeedbackService.mirror_bug_report / mirror_annotation_comment / mirror_task_reject`** ([feedback.py](apps/api/app/services/feedback.py)): 3 个双写 mirror helper, 接受 legacy 模型实例 → 同事务 INSERT AnnotationFeedback (kind=bug/comment/reject); bug_report.project_id IS NULL 时跳过 mirror (登录页等无项目归属 bug 暂不入新表); 日志 `[ADR-0027 double-write] {source} → feedback {id}` 方便排查不一致.
- **3 处 legacy 写路径接入 mirror** ([bug_report.py:create](apps/api/app/services/bug_report.py) · [annotation_comments.py:create_comment](apps/api/app/api/v1/annotation_comments.py) · [tasks.py:reject_task](apps/api/app/api/v1/tasks.py)): legacy INSERT 后立即调 mirror, db.commit() 一起落库; 失败回滚不留半边写.
- **4 例 pytest** ([tests/test_annotation_feedbacks.py](apps/api/tests/test_annotation_feedbacks.py)): `test_mirror_bug_report_creates_feedback` / `test_mirror_bug_report_skips_when_project_null` / `test_mirror_task_reject_creates_feedback` / `test_view_unions_sources` (4 源插入 → view SELECT 验证 source_table 分组计数).

#### 前端

- **`groupOutlineColor` export** ([ImageStageShapes.tsx](apps/web/src/pages/Workbench/stage/ImageStageShapes.tsx)): 把 v0.10.19 内联的 group_id 哈希配色函数 export 出来, 给 AIInspectorPanel BoxList group 卡片头色点复用.
- **BoxList group 折叠卡片** ([AIInspectorPanel.tsx](apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx)): 新 Row kind `userGroup`; 按 group_id 分桶 (≥2 成员的 group_id 显示折叠卡片 `组 #N · k 个标注` + 哈希色点; group_id null 或单成员仍平铺); chevron 按钮 toggle expandedGroups Set; 头部点击 → `onSelectGroup(memberIds)` → 整组 replaceSelected; 展开后内部仍按 BoxListItem 渲染单条.
- **AttributeForm batch banner** ([AttributeForm.tsx](apps/web/src/pages/Workbench/shell/AttributeForm.tsx) · [AttributeForm.module.css](apps/web/src/pages/Workbench/shell/AttributeForm.module.css)): 新增 `batchCount?: number` prop; > 1 时表单顶部渲染 warning 色 banner `N 个标注被选中, 修改将应用到全部`; AIInspectorPanel 在多选时把 banner 显示出来 + onChange 改派到 `onBulkUpdateAttributes(Array.from(selSet), { attributes: next })` (WorkbenchShell 接 useAnnotationBulkUpdate); 单选 / 未传时 banner 不渲染 (退化兼容).
- **`onBulkUpdateAttributes` / `onSelectGroup` props** ([AIInspectorPanel.tsx](apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx) · [WorkbenchShell.tsx](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx)): WorkbenchShell 把 `void useAnnotationBulkUpdate(...)` 替换为实参 mut, 传 `onBulkUpdateAttributes` / `onSelectGroup`; inspector prop 默认通过 `WorkbenchLayout {...inspector}` 直传.
- **任务级评论 POST + 合并显示** ([CommentsPanel.tsx](apps/web/src/pages/Workbench/shell/CommentsPanel.tsx)): annotationId=null + taskId+projectId 时 CommentInput 显示, 提交走 `useCreateFeedback({ kind:"comment", anchor_type:"task" })` POST /feedbacks; 列表合并 annotation_comments (useTaskCommentsInfinite) + task-level feedbacks (useFeedbacks · kind=comment/anchor_type=task), 按 created_at desc; feedback-source 行带 `__source` 标记, 不展示 patch/delete 按钮 (走不同端点, 暂不开放编辑入口).
- **`IssueLayer.tsx` Konva 层** ([IssueLayer.tsx](apps/web/src/pages/Workbench/stage/image/IssueLayer.tsx)): 渲染 pixel-anchored feedback 为图钉 (Circle + Text "i"); status 配色 (open=橙/resolved=绿/wont_fix=灰); 反向缩放保持视觉恒定 (`8/scale` 等); 高亮 id 加阴影; armedForDrop=true 时挂全画布透明 Rect 拦截 click, 转换为相对坐标 [0,1] → onDrop; crosshair cursor 提示.
- **drop-arm FAB + IssueListPanel highlight** ([WorkbenchShell.tsx](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx) · [IssueCreateModal.tsx](apps/web/src/pages/Workbench/shell/IssueCreateModal.tsx) · [IssueListPanel.tsx](apps/web/src/pages/Workbench/shell/IssueListPanel.tsx)): 新加圆形 FAB (crosshair 图标, 位置 bottom:128px 沉于 issueFab 之下), 单击 toggle `issuePinDropArmed` 状态; pin 单击落点 → 关闭 arm + 打开 IssueCreateModal 预填 anchor (`prefilledAnchor` prop · useEffect 同步到 x/y 输入框); IssueListPanel 接 `highlightId` prop (单击 Konva pin → setHighlightIssueId + 打开列表), 高亮项 border-color=warning + box-shadow + scrollIntoView.
- **AttributeForm batch banner 2 例单测** ([AttributeForm.test.tsx](apps/web/src/pages/Workbench/shell/AttributeForm.test.tsx)): batchCount > 1 时显示 + 1/未传时不显示.

### Changed

- **`bug_reports` / `annotation_comments` POST / `tasks reject` 写路径**: 同事务追加 INSERT annotation_feedbacks. 旧 reader 不动 (本切片不切单源), 前端 useFeedbacks 仍直接读新表 (view 仅用于对账); 待 v0.10.21 验证双写一致性后切单源 + 一次性 backfill 老数据.
- **`AnnotationFeedback service` 文档说明** ([feedback.py](apps/api/app/services/feedback.py)): 从"第一阶段, 旧表不动"更新为"第二阶段, 双写已开"; 新加 mirror helper 章节注释.

### Verified

- 后端 `cd apps/api && uv run pytest tests/test_annotation_feedbacks.py tests/test_bug_reports.py tests/test_annotation_comments_paged.py tests/test_comment_polish.py tests/test_task_lock.py -v` → **30 passed** (含 4 例新 mirror + view 测试).
- `uv run alembic upgrade head` 应用 0077; `SELECT source_table, COUNT(*) FROM v_annotation_feedback_unified GROUP BY source_table` 在 dev / annotation_test 两库均可查.
- 前端 `pnpm --filter web typecheck`: 与 v0.10.19 基线一致 (旧 generated/types.gen `ToolBinding` / `tool_bindings` 同样 21 处, 与本期 deferred 收口无关; 修复留 v0.10.21 codegen 重生).
- 前端 `pnpm --filter web test` → **733 passed / 102 files** (含 2 例新 AttributeForm batch banner 单测).
- 前端 `pnpm --filter web lint` → 0 errors / 116 warnings (基线 115 + 1 个本期 IssueLayer 内 react-hooks/exhaustive-deps 兼容性 warning); `check-css-tokens` 通过.
- 手动 smoke (未跑 e2e, 本切片由 maintainer 在 docker + uvicorn + pnpm dev 全栈环境 smoke): ① 未选中标注 → CommentsPanel 任务级模式 CommentInput 显示, 提交后通过 GET /feedbacks 看到 kind=comment / anchor_type=task 行; ② Shift+点击 5 框 Ctrl+G 后 BoxList 出现 group 卡片, 点击头部整组选中; ③ 多选 3 框 → AttributeForm 顶部 batch banner, 改 attribute 后 3 框同步; ④ 按 crosshair FAB → 单击图像落点 → IssueCreateModal 自动填 x/y; ⑤ 单击 Konva 图钉 → IssueListPanel 打开并高亮对应项.

### Deferred to v0.10.21

- **独立 `DiscussionPanel.tsx` + WorkbenchLayout 右栏两段固定结构**: 内嵌 CommentsPanel 已能承担 UX, 拆分纯结构改造对用户行为无增量, 本期不做.
- **I4 笔画 timeline**: `canvas_drawing.shapes[i]` 加 id/started_at/ended_at + CanvasDrawingPreview 评论卡片下方迷你 CSS flex 时间条 + hover 评论高亮对应 stroke.
- **ADR-0027 第三段 (切单源)**: 验证双写一致性 (cron 跑 view source_table 对账) → 一次性 backfill 旧表存量数据到 annotation_feedbacks → 删除 legacy 写路径; 旧表保留只读一个版本作回退.
- **IssueLayer video stage frame-aware pin**: 当前仅图像 stage; video stage 的 frame-aware pin 后续切片 (anchor_position 已预留 frame 字段).
- **任务级 feedback patch/delete UI 入口**: 当前 CommentsPanel feedback-source 行仅展示, 不允许 patch/delete (usePatchFeedback / useDeleteFeedback 已存在, UI 暂不开放).
- **POST /tasks/{id}/comments 端点**: 决策延续 — 不开新端点, 任务级评论一律走 POST /feedbacks.

## [0.10.19] - 2026-05-19

> **ROADMAP §C.7 I4 + I12 + I18 单 epic 一次性落地.** 三项工作台扩展 (I4 评论/历史常驻 / I12 Object Group 分组+批量编辑 / I18 Issue 锚定到像素位置) 作单一 epic 推进, 共享同一片 UI 表面 (右栏标注详情区 + Konva overlay 层),避免分三 PR 反复触碰热点。本切片**后端契约 + 前端核心 UI 流程**一次到位; 渐进式策略避免一次性重构 1210 行的 WorkbenchShell。 → [plan](docs/plans/2026-05-19-v0.10.19-i4-i12-i18-workbench-detail-extensions.md) · [ADR-0027](docs/adr/0027-annotation-feedback-unified-table.md).

### Added

#### 后端

- **I12 · `annotations.group_id` 字段 + `tasks.next_group_seq` 序号** ([0075_annotation_group_id.py](apps/api/alembic/versions/0075_annotation_group_id.py)): `annotations.group_id BIGINT NULL` 同 task 内分组序号; `tasks.next_group_seq INT DEFAULT 0` 每 task 独立序号空间; 复合 partial 索引 `ix_annotations_task_group(task_id, group_id) WHERE group_id IS NOT NULL`。与现有 `parent_annotation_id` 正交 (parent 表层级"车牌属于车", group 表平等成员同组)。
- **I12 · `/annotations/{bulk-update, group, ungroup}` 三端点** ([annotations.py router](apps/api/app/api/v1/annotations.py) + [AnnotationService.bulk_update/group/ungroup](apps/api/app/services/annotation.py)): bulk-update 批量改 class_name / attributes / 状态位 (locked/hidden/occluded) / z_order / group_id (带 `group_id_explicit_clear` 区分"未提供"与"显式清空"); group 走 `next_group_seq +1 RETURNING` 原子分配; ungroup 自动级联清理"仅剩 1 个成员"的 orphan group。class_name 软校验按 `tool_unit_id` 分桶避免 N 次重复查 project.tool_bindings。整批操作单事务回滚 (任一被锁/已软删则整体 422)。
- **I18 · `annotation_feedbacks` 统一反馈表** ([annotation_feedback.py model](apps/api/app/db/models/annotation_feedback.py) · [0076 migration](apps/api/alembic/versions/0076_annotation_feedbacks.py)): 取经合集 §2.2 落地第一段。`kind` ∈ {issue, comment, reject, bug}; `anchor_type` ∈ {project, task, annotation, pixel}; `anchor_position JSONB(none_as_null=True)` 携带 pixel 坐标 `{x, y, frame?}` (none_as_null 避免 Python None 序列化成 JSONB null 触发 CHECK 失败); 3 个索引 (project_kind_status / task_kind partial / annotation partial); 3 个 CHECK 约束保证 kind/status enum + anchor 一致性 (例 anchor_type='pixel' 必带 task_id + anchor_position)。
- **I18 · `/feedbacks` 统一 API** ([annotation_feedbacks.py router](apps/api/app/api/v1/annotation_feedbacks.py) · [feedback.py service](apps/api/app/services/feedback.py)): GET 按 project_id/task_id/annotation_id/kind/anchor_type/status 过滤 + keyset 分页; POST 走 pydantic `model_validator` 提前校验 anchor 一致性 (比 DB CHECK 早一层友好); PATCH 改 status 时自动写 `resolved_at` / `resolved_by_id`; DELETE 软删 (`is_active=false`); `POST /feedbacks/{id}/replies` 子评论继承 parent anchor + `thread_parent_id` 自引用链。**权限**: 作者 + project_admin + super_admin 可改/删; reviewer 可改 status (闭环 issue)。
- **I4 · 任务级 `/tasks/{id}/audit-history` + `/tasks/{id}/comments/page` 端点** ([annotation_history.py](apps/api/app/api/v1/annotation_history.py) · [annotation_comments.py](apps/api/app/api/v1/annotation_comments.py)): `audit-history` 合并 task 级 audit + 该 task 下所有 annotation 的 annotation 级 audit (压平 + 时序排序); `comments/page` 聚合 task 下所有 annotation 的 active 评论 (DESC 时序 + keyset 分页)。`AnnotationHistoryResponse.annotation_id` 改 nullable 兼容任务级降级。CommentsPanel 在未选中标注时降级到这两个端点的数据。
- **AuditAction 新增 6 个枚举值** ([audit.py](apps/api/app/services/audit.py)): `ANNOTATION_GROUP` / `ANNOTATION_UNGROUP` / `ANNOTATION_BULK_UPDATE` (I12); `FEEDBACK_CREATED` / `FEEDBACK_STATUS_CHANGED` / `FEEDBACK_DELETED` (I18)。
- **ADR-0027 · AnnotationFeedback 统一反馈表** ([docs/adr/0027-annotation-feedback-unified-table.md](docs/adr/0027-annotation-feedback-unified-table.md)): 三段式迁移决策 (v0.10.19 仅立新表 → v0.10.20 加 view + 双写 → v0.10.21 切单源), 旧 `bug_reports` / `annotation_comments` / `tasks.reject_reason` 在本切片**完全不动**, 每步单独可回退。

#### 前端

- **I12/I18 · API client + React Query hooks** ([api/feedbacks.ts](apps/web/src/api/feedbacks.ts) · [api/annotationGroup.ts](apps/web/src/api/annotationGroup.ts) · [hooks/useFeedbacks.ts](apps/web/src/hooks/useFeedbacks.ts) · [hooks/useAnnotationGroup.ts](apps/web/src/hooks/useAnnotationGroup.ts)): 含 `useFeedbacks` 列表 + `useCreateFeedback` / `usePatchFeedback` / `useDeleteFeedback` / `useReplyFeedback`; `useAnnotationGroup` / `useAnnotationUngroup` / `useAnnotationBulkUpdate` (bulkUpdate 已落 hook,UI 消费留 v0.10.20)。
- **I12 · `Ctrl+G / Ctrl+Shift+G` 快捷键** ([hotkeys.ts](apps/web/src/pages/Workbench/state/hotkeys.ts) · [useWorkbenchHotkeys.ts](apps/web/src/pages/Workbench/state/useWorkbenchHotkeys.ts) · [WorkbenchShell.tsx](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx)): `HotkeyAction` 新增 `annotationGroup` / `annotationUngroup`; dispatchKey 在系统 Ctrl/Meta 分支识别 G 键 + Shift 修饰; useWorkbenchHotkeys 接 `handleAnnotationGroup` / `handleAnnotationUngroup` 注入点; WorkbenchShell 通过 group/ungroup mutation 派发 + toast 报告结果 (含 orphan 自动清理提示)。
- **I12 · Konva 同 group_id 第二层虚线外圈** ([ImageStageShapes.tsx](apps/web/src/pages/Workbench/stage/ImageStageShapes.tsx)): user 框带 `group_id != null` 时,Rect 外偏移 4px/scale 渲染第二层虚线 Rect; `groupOutlineColor(groupId)` 派生 8 档稳定色 (与类别色刻意区分); `listening={false}` 不阻挡 hit-test。
- **I12 · `Annotation` / `AnnotationResponse` 类型 + `annotationToBox` 透传 `group_id`** ([types/index.ts](apps/web/src/types/index.ts) · [transforms.ts](apps/web/src/pages/Workbench/state/transforms.ts)): 渲染层与后端 schema 对齐, 旧记录 null/undefined 兼容。
- **I18 · `IssueCreateModal` + `IssueListPanel` + 浮动入口** ([IssueCreateModal.tsx](apps/web/src/pages/Workbench/shell/IssueCreateModal.tsx) · [IssueListPanel.tsx](apps/web/src/pages/Workbench/shell/IssueListPanel.tsx) · [WorkbenchShell.tsx](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx) `.issueFab`): 工作台右下浮动 `🚩` 按钮 (带 open issue 数 badge); 列表面板支持解决/搁置/重开/删除单条 issue + 跳新建; Modal 支持 title/severity (info/warn/blocker)/body + 可选填 0-1 像素坐标 (留空则 task anchor); 提交后 useFeedbacks invalidate 重拉。
- **I4 · 评论/历史常驻 (渐进式)** ([CommentsPanel.tsx](apps/web/src/pages/Workbench/shell/CommentsPanel.tsx) · [AIInspectorPanel.tsx](apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx)): CommentsPanel 加 `taskId` prop, annotationId null 时降级走 `useTaskCommentsInfinite` + `useTaskAuditHistory`,显示该任务下所有标注的评论汇总; AIInspectorPanel 不再 `selectedAnnotation && <CommentsPanel/>`,改为常驻渲染; CommentInput 在 task 级降级模式下隐藏 (任务级 POST 端点留 v0.10.20)。
- **`useTaskCommentsInfinite` / `useTaskAuditHistory` hooks** ([useAnnotationComments.ts](apps/web/src/hooks/useAnnotationComments.ts) · [useAnnotationAuditHistory.ts](apps/web/src/hooks/useAnnotationAuditHistory.ts)): 对应后端 task 级端点; 与现有 annotation 级 hook 并存,CommentsPanel 按 annotationId 是否存在分发。

### Changed

- **`AnnotationHistoryResponse.annotation_id` 改 nullable** ([annotation_history.py schema](apps/api/app/schemas/annotation_history.py)): 兼容 task 级时间线返回 (annotation_id=None)。

### Verified

- 后端 `uv run pytest tests/test_annotation_group_bulk.py tests/test_annotation_feedbacks.py tests/test_annotation_class_name_validation.py -v` → **17/17 passed** (group 序号单调递增 / ungroup orphan 级联清理 / bulk_update 锁定整体回滚 / pixel anchor schema 校验 + DB CHECK / feedback status → resolved 自动写 resolved_at / class_name 软校验回归)。
- `uv run alembic upgrade --sql 0074:0076` 生成 SQL 与设计一致 (BIGINT / 复合 partial index / 3 个 CHECK constraint)。
- 前端 `pnpm typecheck` 全绿 (0 错)。
- 前端 `pnpm test --run` → **731 passed / 102 files** (无回归; 新增 hook/component 文件已就位但暂未补 focused test, 留 v0.10.20 补)。
- 前端 `pnpm lint` → 0 errors / 115 warnings (warnings 全部为预存在的,与本期改动无关)。
- `pnpm --filter web build` 未跑 (本期纯前端文件新增, 没有 build 时配置变更, 走 CI 验证)。

### Deferred to v0.10.20 (本 epic 续作)

- **I4 完整拆分**: `DiscussionPanel.tsx` 从 AIInspectorPanel 内嵌升级为独立组件 + `WorkbenchLayout` 右栏两段固定结构 (上「检查器」下「讨论」) + 任务级评论 POST 端点 (允许在未选中标注时直接发任务级评论)。
- **I12 完整 UI**: AIInspectorPanel BoxList 同 group 折叠卡片 + AttributeForm 多选 batch banner (调用 `useAnnotationBulkUpdate`)。
- **I18 Konva pin 渲染**: 把 `IssueListPanel` 中的 pixel anchor 同步渲染到 ImageStage (新增 `IssueLayer.tsx` Konva 层 + 单击图像创建 pin 入口),替代当前的"输入框填 x/y"形态。
- **ADR-0027 第二段**: `v_annotation_feedback_unified` view + 旧三表双写。
- **I4 笔画 timeline**: `canvas_drawing.shapes[i]` 加 `id/started_at/ended_at` + 评论卡片下方迷你时间条。

## [0.10.18] - 2026-05-19

> **P3 维护项收尾 (除 dev SMTP).** v0.10.17 后遗留 6 项 P3 维护事项, 本期一次性收口其中 5 项 (排除 dev SMTP mailpit, 单独排期), 全部为**非用户可见行为变更**的代码瘦身 / 可观测增强 / 截图基建 / 测试补完: ① RenderingConfigSection 抽出 `RenderingConfigEditor` 受控视图, TemplateEditModal「渲染配置」tab 接入新 editor 并补 `rendering_config` 进 payload (v0.10.17 占位语清除); ② CreateProjectWizard 主控 1405 → 684 行, 7 个 Step 全部抽到 `components/projects/steps/` 子目录 + 共享 `UnitTabs`; ③ PerfHud 加 6 个浏览器侧指标 (FPS / JS heap / Longtask / API p95 / WS reconnect 累计 / 当前 task 框数), 显隐复用现有 `?perf=1` 开关; ④ WorkbenchStageHostProps 30+ 字段加 JSDoc 分组注释 (类型不变兼容现 call site) + 新增 `WorkbenchLayout.test.tsx` / `WorkbenchStageHost.test.tsx` 共 6 例 focused render tests; ⑤ 截图 4 张空白态 `ai-pre/history-search` / `ai-pre/empty-alias` / `bbox/iou` / `bbox/bulk-edit` 的 prepare 脚本改为 `page.route` mock API 注入示例数据 (避免污染真实 DB). 关键决策: WorkbenchStageHostProps 分组方案选「JSDoc only, 不动类型」, 避免牵动 1210 行的 WorkbenchShell call site (风险/收益不成正比), 后续若 Shell 再次膨胀再做嵌套 prop 对象重构. **不引入**: ① WorkbenchStageHostProps 类型嵌套重构 (call-site 改造延后); ② StageControls 通用抽象 (等真实 3D 需求); ③ `useWorkbenchShellModel` 装配 hook (Shell 1210 行未破 900 触发线); ④ dev SMTP mailpit (单独 排期); ⑤ 截图实际重跑 (本期仅交付 prepare 脚本, `pnpm screenshots` 需在 docker + uvicorn + pnpm dev 全栈环境下手动跑). → [plan](docs/plans/2026-05-19-v0.10.18-p3-maintenance-cleanup.md).

### Added

- **`RenderingConfigEditor` 受控视图** ([RenderingConfigEditor.tsx](apps/web/src/pages/Projects/sections/RenderingConfigEditor.tsx)): `{ value, onChange, disabled? }` 形态, 把原 `RenderingConfigSection` 184 行的 4 个 row (smoothImage / cssImageFilter / controlPointsSize / snapToGrid) + `isOverridden` / `toggleOverride` / `DEFAULTS` 全部迁入; ProjectSettings / TemplateEditModal 共享该视图.
- **`apps/web/src/components/projects/steps/` 子目录** ([Step1DataTypeAndTools](apps/web/src/components/projects/steps/Step1DataTypeAndTools.tsx) · [Step2ClassesPerUnit](apps/web/src/components/projects/steps/Step2ClassesPerUnit.tsx) · [Step3AttributesPerUnit](apps/web/src/components/projects/steps/Step3AttributesPerUnit.tsx) · [Step4Ai](apps/web/src/components/projects/steps/Step4Ai.tsx) · [Step5Datasets](apps/web/src/components/projects/steps/Step5Datasets.tsx) · [Step6Members](apps/web/src/components/projects/steps/Step6Members.tsx) · [Step7Success](apps/web/src/components/projects/steps/Step7Success.tsx) · [UnitTabs](apps/web/src/components/projects/steps/UnitTabs.tsx)): 7 个 Step + 共享 UnitTabs 各自独立文件; 主 `CreateProjectWizard.tsx` 仅保留 FormState / INITIAL / defaultUnitBindings / buildFormFromSource / buildFormFromTemplate / submit / Stepper / Footer.
- **PerfHud 浏览器侧指标采集** ([useBrowserStats.ts](apps/web/src/components/PerfHud/useBrowserStats.ts) · [BrowserPanel in PerfHud.tsx](apps/web/src/components/PerfHud/PerfHud.tsx)): rAF FPS loop / `performance.memory.usedJSHeapSize` (Chrome only, 非 Chrome 显示 N/A) / `PerformanceObserver({type:"longtask"})` 累计最近 60s > 50ms 任务数与最近一次时长 / API p95 / WS reconnect 累计 / 当前 task 框数 6 项; PerfHud body 末尾增加 `<BrowserPanel />` 与 backend 指标并列, 无后端连接时也展示.
- **API duration ring buffer** ([_metrics.ts](apps/web/src/api/_metrics.ts)): 60s 滑动窗口, 上限 1024 条; `recordApiDuration(ms)` 由 [client.ts](apps/web/src/api/client.ts) 的 `request` wrapper 在 fetch 完成后调 (try/catch 包裹, 失败不影响业务); `getApiP95Ms()` 惰性清理 + sort 取 p95.
- **WS reconnect 计数 store** ([_wsMetrics.ts](apps/web/src/hooks/_wsMetrics.ts)): 全局 Zustand store; [useReconnectingWebSocket](apps/web/src/hooks/useReconnectingWebSocket.ts) 的 `scheduleReconnect` 每次触发 `bumpWsReconnectCount()`.
- **当前 task 框数 store** ([useTaskBoxCount.ts](apps/web/src/components/PerfHud/useTaskBoxCount.ts)): 全局 Zustand store; [WorkbenchShell](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx) 每次 annotations 变化 `publishTaskBoxCount(annotationsRef.current.length)`.
- **`WorkbenchLayout.test.tsx` + `WorkbenchStageHost.test.tsx` focused render tests** ([WorkbenchLayout.test.tsx](apps/web/src/pages/Workbench/shell/WorkbenchLayout.test.tsx) · [WorkbenchStageHost.test.tsx](apps/web/src/pages/Workbench/shell/WorkbenchStageHost.test.tsx)): 6 例新单测 — Layout 验证 12 个 slot 都渲染 / 可选 modal/guidePanel 缺省时不渲染 / `gridTemplateColumns` 写入 CSS var; StageHost 验证 `stageKind` 分发到唯一对应舞台组件 (image / video / 3d).

### Changed

- **`RenderingConfigSection` 瘦身为外壳** ([RenderingConfigSection.tsx](apps/web/src/pages/Projects/sections/RenderingConfigSection.tsx)): 185 → 47 行, 只持有 `useUpdateProject` + `draft` state + commit, 视图层全部下放 `RenderingConfigEditor`.
- **`TemplateEditModal` 渲染配置 tab 接入 editor + payload 补 `rendering_config`** ([TemplateEditModal.tsx](apps/web/src/pages/ProjectTemplates/TemplateEditModal.tsx)): 删除 v0.10.17 占位语 (`v0.10.18 抽出共享 editor 后接入`); 新增 `renderingConfig` form state + `useEffect` 同步 initial; submit payload 加 `rendering_config: renderingConfig` (此前漏传, 模板编辑无法保存渲染配置, 现修复).
- **`CreateProjectWizard` 主控瘦身** ([CreateProjectWizard.tsx](apps/web/src/components/projects/CreateProjectWizard.tsx)): 1405 → 684 行 (-721 / -51%); 删除 Step1 / Step2Classes / Step3Attributes / Step4Ai / BackendSourceSelect / Step5Datasets / Step6Members / SuccessStep / UnitTabs 9 个内联组件 (全部移至 `steps/`); `FormState` / `UnitBindingForm` / `UnitBindingMap` / `defaultUnitBindings` 改为 `export`, 子 step 文件 import 类型即可.
- **`WorkbenchStageHostProps` 加 JSDoc 分组** ([WorkbenchStageHost.tsx](apps/web/src/pages/Workbench/shell/WorkbenchStageHost.tsx)): 30+ 平铺字段按 common / video / image / ai / editors 5 组加分隔注释; 类型签名不变兼容现 call site, 后续若拆嵌套 prop 对象有方便参考线.
- **`api/client.ts:request` 增加 API duration 上报** ([client.ts](apps/web/src/api/client.ts)): fetch 前 `performance.now()` 记 t0, 完成后 `recordApiDuration(performance.now() - t0)` (try/catch 包裹); PerfHud 浏览器侧 p95 数据源.
- **`useReconnectingWebSocket:scheduleReconnect` 加 reconnect 累计计数** ([useReconnectingWebSocket.ts](apps/web/src/hooks/useReconnectingWebSocket.ts)): 每触发一次 `scheduleReconnect` 即 `bumpWsReconnectCount()`; 计数跨 hook unmount 累计 (session 级).
- **`WorkbenchShell` 发布 task 框数到 PerfHud store** ([WorkbenchShell.tsx](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx)): 新增一个 `useEffect` 在 `annotationsData` 变化时调 `publishTaskBoxCount(annotationsRef.current.length)`.
- **截图场景 prepare 改为 page.route mock 注入** ([scenes/ai-pre.ts](apps/web/e2e/screenshots/scenes/ai-pre.ts) · [scenes/workbench-bbox.ts](apps/web/e2e/screenshots/scenes/workbench-bbox.ts)): `ai-pre/history-search` mock `GET /admin/preannotate-jobs*` 返回 8 条 job + 模拟搜索词 "person"; `ai-pre/empty-alias` mock `GET /admin/preannotate/project-cards*` 返回 1 个 `classes_aliases: {}` 项目; `bbox/iou` mock `GET /tasks/{id}/annotations` 返回 2 个高 IoU 重叠 bbox; `bbox/bulk-edit` mock 同端点 3 个 bbox + `Ctrl+A` 全选触发批量编辑栏. **不污染真实 DB**.

### Verified

- 前端 `pnpm --filter web typecheck` 全绿 (0 错).
- 前端 `pnpm --filter web test` → **731 passed / 102 files** (新增 6 例 WorkbenchLayout + WorkbenchStageHost focused render tests).
- 前端 `pnpm --filter web lint` → 0 errors / 115 warnings (warnings 全部为 v0.10.17 之前遗留, 与本期改动无关); `check-css-tokens` 通过 (所有 `--color-*` 引用对得上 tokens.css 定义, 未滥用 fallback).
- **未跑** `pnpm screenshots` 实际重跑 — 需 docker + uvicorn + pnpm dev + seed.py 全栈在环, 由 maintainer 在本地跑 `pnpm screenshots -- --grep="ai-pre/history-search|ai-pre/empty-alias|bbox/iou|bbox/bulk-edit"` 验证 4 张图非空白后再合 PR.

## [0.10.17] - 2026-05-19

> **新建项目向导通用化 + 类别 / 属性按工具单位强隔离 + Magic Box + 模板复杂字段编辑.** ROADMAP §A 新建项目向导一直延用 7 种 type_key 枚举(image-det / image-seg / image-kp / video-track / video-mm / mm / lidar)+ 项目级扁平类别表的形态;客户反馈"同一项目内不同工具想标不同类"(bbox 标行人/车辆 + polygon 标可行驶区/天空)、"项目类型不该把工具集死锁"。本期一次性收口四件相关事:① 新建向导从枚举 7 种 type 转向"image / video / lidar 三种数据载体 + 工具集多选"形态;② 类别和属性 schema 从项目级扁平改为按工具单位(tool_unit)**强隔离**绑定(bbox 工具的"人"与 region 工具的"人"是两条独立记录);③ Magic Box 工具落地(复用 SmartBoxTool 拖框 + sam3-backend bbox prompt → polygon → 紧凑外接矩形落 bbox,**零后端改动**);④ TemplateEditModal 从只能改 6 个简单字段升级为 3-tab Modal(基础信息 / 工具与类别 / 渲染配置),复用 ProjectSettings 已抽出的受控编辑器,模板与项目共享 tool_bindings 形态。关键决策(对照 [ADR-0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md)):后端 schema **重写为嵌套结构** `{ tool_unit_id: { enabled, classes: [...], attribute_schema: {...} } }`,旧扁平字段 v0.10.17 期间由 service 双写派生兜底、v0.10.18 删除;工具集分**三组**(基础几何 = bbox + polyline / 区域 = polygon + mask 打包 / AI 交互 = smart-* + magic-box 打包),polyline / lidar_box_3d 本版**留位置灰**未实现;Magic Box **仅复用 SAM 链路**,不引入 Canny/Sobel snap-to-edge(留 v0.11+);alembic 0072 / 0073 双 migration backfill 老数据(`image-seg` → `region` unit、其它 → `bbox` unit,按 `annotation_type` 反推 `annotations.tool_unit_id`)。后端 [`Project.tool_bindings`](apps/api/app/db/models/project.py) JSONB + [`Annotation.tool_unit_id`](apps/api/app/db/models/annotation.py) / [`Prediction.tool_unit_id`](apps/api/app/db/models/prediction.py) String(30) 列落地;[`_jsonb_types.py`](apps/api/app/schemas/_jsonb_types.py) 新增 `ToolUnitId` Literal + `ToolBinding` + `ToolClassEntry` + `validate_tool_bindings_keys` 校验器;[`services/project.py`](apps/api/app/services/project.py) 新建含 `apply_tool_bindings_legacy_sync` / `coalesce_legacy_into_tool_bindings` / `derive_legacy_classes_config` / `lookup_classes_for_tool_unit` 等 helper;[`services/annotation.py`](apps/api/app/services/annotation.py) `AnnotationService.create` 接 `tool_unit_id` 并按 `tool_bindings[unit].classes` 软校验 `class_name`(空集合放行兼容旧数据);[`services/prediction.py`](apps/api/app/services/prediction.py) 加 `derive_tool_unit_from_ls_type` / `derive_tool_unit_from_result` 按 LS shape 类型派生 unit;[`services/export.py`](apps/api/app/services/export.py) COCO categories 按 tool_unit 分组带 `supercategory`,`cat_map` 改为 `(tool_unit_id, class_name) → category_id` 二元组查找;[`schemas/aap_json.py`](apps/api/app/schemas/aap_json.py) schema_version 升 **1.1**,envelope `project.tool_bindings` 整段嵌入,annotations / predictions entries 加 `tool_unit_id`(1.0 reader 走 `extra="ignore"` 仍兼容)。前端 [`constants/toolUnits.ts`](apps/web/src/constants/toolUnits.ts) 含 `ToolUnitId` / `PROJECT_DATA_TYPES` / `TOOL_UNIT_GROUPS` 与 `defaultEnabledUnits` / `toolUnitFromLegacy` / `dataTypeFromLegacy` 派生;[`CreateProjectWizard`](apps/web/src/components/projects/CreateProjectWizard.tsx) FormState 从扁平 `classRows / attributeFields` 改为 `unitBindings: Record<ToolUnitId, {enabled, classRows, attributeFields}>` + `activeUnit`,Step 1 加工具集 chip 多选区域、Step 2 / Step 3 头部加 UnitTabs 切换,submit 构造 `tool_bindings` payload + 派生 legacy 字段兜底;[`useProjectToolBindings`](apps/web/src/pages/Projects/sections/useProjectToolBindings.ts) hook 与 [`ToolUnitTabs`](apps/web/src/pages/Projects/sections/ToolUnitTabs.tsx) 组件由 ProjectSettings sections / TemplateEditModal 共享;[`ClassesSection`](apps/web/src/pages/Projects/sections/ClassesSection.tsx) / [`AttributesSection`](apps/web/src/pages/Projects/sections/AttributesSection.tsx) 改造为按 unit tab + 可启用 / 禁用 unit + 重命名限定 unit(`useRenameClass` 加 `tool_unit_id` 参数);工作台 [`stage/tools/toolUnits.ts`](apps/web/src/pages/Workbench/stage/tools/toolUnits.ts) `TOOL_TO_UNIT` 映射 9 种 ToolId 到 ToolUnitId,[`state/useToolBindings`](apps/web/src/pages/Workbench/state/useToolBindings.ts) 按当前激活工具派生 classes / classesConfig / attributeSchema(老项目走 fallback);[`WorkbenchShell`](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx) 切到 hook 派生,切工具时 activeClass 不在新 unit 类别集自动切首个类;[`useWorkbenchAnnotationActions`](apps/web/src/pages/Workbench/state/useWorkbenchAnnotationActions.ts) bbox/polygon 创建路径透传 `tool_unit_id`。Magic Box [`MagicBoxTool`](apps/web/src/pages/Workbench/stage/tools/MagicBoxTool.ts) (id=magic-box, hotkey=G, icon=wandSparkles, requiredPrompt="bbox") 复用 SmartBoxTool 拖框语义返回 `samProbe { mode: "bbox" }`;[`useImageAnnotationActions`](apps/web/src/pages/Workbench/stages/image/useImageAnnotationActions.ts) 加 useEffect 监听 `sam.candidates`,当 `s.tool === "magic-box"` 且非 running 时取首个候选(polygonlabels → [`tightenBboxFromPolygon`](apps/web/src/pages/Workbench/stage/shared/geometry/bbox.ts) 紧凑外接矩形 / rectanglelabels → 直接用)→ `createBboxWithClass` + `sam.cancel()`,跳过 AI 候选层 UI。TemplateEditModal 重写为 3 tab 形态,基础信息 / 工具与类别 / 渲染配置(后两 tab 复用 ClassEditor + AttributeSchemaEditor + ToolUnitTabs;rendering_config 编辑器待 v0.10.18 抽出共享视图后接入)。Annotation `class_name` 软校验首版**只校验空集合放行**,新工具单位类别空时不阻断旧数据写入;v0.10.18 视客户反馈再考虑收紧。**不引入**:① polyline / keypoint / lidar 工具实现(schema 留位置灰);② Snap-to-edge(Canny/Sobel)pixel-level 边缘吸附,Magic Box 仅取 polygon 紧凑外接矩形;③ 跨 tool_unit 类别"软关联"(alias_to 链),强隔离意味同名是独立记录;④ AAP JSON 1.1 importer 完整支持 video_track tool_unit(留 §C.5 R23 同窗口);⑤ rendering_config 在 TemplateEditModal 的编辑器(待 RenderingConfigSection 抽出 `RenderingConfigEditor` 共享视图);⑥ POST `/annotations/import` 端点(AAP JSON `annotations[]` 仍仅导出可用,导入只警告日志)。**迁移风险**:alembic backfill 默认把所有 image-det 项目类塞 `bbox` unit;若客户实际混用 polygon 工具,需到 ProjectSettings 把类**复制**到 `region` unit(强隔离不能共享)。ROADMAP §A「新建项目向导」「项目模板 TemplateEditModal 复杂字段编辑 UI」「Magic Box & Snap」P2-P3 三项收官。→ [plan](docs/plans/2026-05-19-v0.10.17-project-wizard-tool-binding.md) · [ADR-0026](docs/adr/0026-tool-unit-class-and-attribute-binding.md).

### Added

- **`Project.tool_bindings` JSONB + `Annotation.tool_unit_id` / `Prediction.tool_unit_id` String(30) 列 + alembic 0072** ([project.py](apps/api/app/db/models/project.py) · [annotation.py](apps/api/app/db/models/annotation.py) · [prediction.py](apps/api/app/db/models/prediction.py) · [migration](apps/api/alembic/versions/0072_project_tool_bindings.py)):工具维度类别 / 属性绑定单源真值;migration 含 DDL + 按 `type_key` / `annotation_type` 反推的 backfill(`image-seg` → region,其它 → bbox)。
- **`_jsonb_types.py` 新增 `ToolUnitId` Literal + `ToolBinding` + `ToolClassEntry` + `validate_tool_bindings_keys`** ([_jsonb_types.py](apps/api/app/schemas/_jsonb_types.py)):五个稳定 enum 值(bbox / polyline / region / ai_interactive / lidar_box_3d)与 Pydantic 校验。
- **`app/services/project.py`** ([project.py](apps/api/app/services/project.py)):`derive_legacy_classes_config` / `derive_legacy_classes_list` / `derive_legacy_attribute_schema` / `apply_tool_bindings_legacy_sync` / `coalesce_legacy_into_tool_bindings` / `lookup_classes_for_tool_unit` / `derive_tool_unit_for_type_key` — 单源真值同步与老 reader 派生 helper 集合。
- **`AnnotationService.create` 接 `tool_unit_id` + class_name 软校验** ([annotation.py](apps/api/app/services/annotation.py)):service 层按 `project.tool_bindings[unit].classes` 校验 `class_name` 命中(空集合放行兼容旧数据,422 时返"类不在工具单位类别集内");`accept_prediction` 沿用 `prediction.tool_unit_id` 给生成的 annotation。
- **`prediction.to_internal_shape` + `derive_tool_unit_from_ls_type` / `derive_tool_unit_from_result`** ([prediction.py](apps/api/app/services/prediction.py)):LS shape 类型 → tool_unit_id 派生(polygonlabels / brushlabels / multi_polygon → region;rectanglelabels → bbox);`PredictionService.create_from_ml_result` 按 result[0].type 自动填 `tool_unit_id`;`to_internal_shape` pass-through 时**就地**回填 tool_unit_id 保 dict identity 兼容历史 test。
- **`ProjectTemplate.tool_bindings` + alembic 0073** ([project_template.py](apps/api/app/db/models/project_template.py) · [migration](apps/api/alembic/versions/0073_template_tool_bindings.py)):模板与 Project 对齐;backfill 同 0072 规则。
- **Magic Box 工具** ([MagicBoxTool.ts](apps/web/src/pages/Workbench/stage/tools/MagicBoxTool.ts) · [tightenBboxFromPolygon](apps/web/src/pages/Workbench/stage/shared/geometry/bbox.ts)):id=`magic-box`,hotkey=`G`,icon=`wandSparkles`,requiredPrompt=`bbox`;复用 SmartBoxTool 拖框 → sam3-backend bbox prompt → polygon → 紧凑外接矩形(min/max x/y + clamp [0,1])→ 落 bbox 标注;[`useImageAnnotationActions`](apps/web/src/pages/Workbench/stages/image/useImageAnnotationActions.ts) useEffect 监听 sam.candidates 自动转换 + sam.cancel() 跳过候选层 UI。
- **`constants/toolUnits.ts`** ([toolUnits.ts](apps/web/src/constants/toolUnits.ts)):`ToolUnitId` / `PROJECT_DATA_TYPES` (image/video/lidar) / `TOOL_UNIT_GROUPS` 元数据 + `defaultEnabledUnits` / `toolUnitFromLegacy` / `dataTypeFromLegacy` 派生 helper。
- **`useProjectToolBindings` hook + `ToolUnitTabs` 组件** ([useProjectToolBindings.ts](apps/web/src/pages/Projects/sections/useProjectToolBindings.ts) · [ToolUnitTabs.tsx](apps/web/src/pages/Projects/sections/ToolUnitTabs.tsx)):ProjectSettings sections / TemplateEditModal 共享的 unit tab 切换条 + enabled chip 控件 + buildUnitBindings / unitBindingsToPayload 序列化 helper。
- **`stage/tools/toolUnits.ts` + `state/useToolBindings.ts`** ([toolUnits.ts](apps/web/src/pages/Workbench/stage/tools/toolUnits.ts) · [useToolBindings.ts](apps/web/src/pages/Workbench/state/useToolBindings.ts)):工作台 ToolId → ToolUnitId 映射 + 按当前激活工具派生 classes / classesConfig / attributeSchema(老项目走 fallback)。
- **5 例 Magic Box helper 单测** ([bbox.test.ts](apps/web/src/pages/Workbench/stage/shared/geometry/bbox.test.ts)):空输入 / 0 面积 / 紧凑外接矩形派生 / 越界 clamp / number[][] 形式。
- **ADR-0026** ([0026-tool-unit-class-and-attribute-binding.md](docs/adr/0026-tool-unit-class-and-attribute-binding.md)):强隔离决策与方案 A/B/C/D 对比;实现位置 + 触发后续 v0.10.18+ 延伸项清单。

### Changed

- **`ProjectCreate / Update / Out` schema 加 `tool_bindings`** ([schemas/project.py](apps/api/app/schemas/project.py)):优先于扁平 `classes_config / attribute_schema`;`validate_tool_bindings_keys` 校验顶层 key 在枚举内;`ProjectOut` 暴露派生只读 legacy 字段。
- **`AnnotationCreate / Out` + `PredictionOut` 加 `tool_unit_id` ToolUnitId Literal** ([annotation.py](apps/api/app/schemas/annotation.py) · [prediction.py](apps/api/app/schemas/prediction.py)):Annotation 默认 `bbox` 保兼容,Prediction 由 service 派生回填。
- **`ProjectTemplateBase / Update / Out` 加 `tool_bindings`** ([project_template.py](apps/api/app/schemas/project_template.py)):与 Project 对齐;同 `validate_tool_bindings_keys` 校验器。
- **`projects.py:create_project` / `update_project` 接入 tool_bindings 同步** ([projects.py](apps/api/app/api/v1/projects.py)):写入前 `coalesce_legacy_into_tool_bindings`(旧客户端兼容)+ `apply_tool_bindings_legacy_sync`(派生覆盖 legacy);`rename_class` 加可选 `tool_unit_id` 字段限定工具单位(不传时跨所有 unit 同名一起改保兼容)。
- **`tasks.py:create_annotation` 透传 `tool_unit_id`** ([tasks.py](apps/api/app/api/v1/tasks.py)):POST 体携带 unit id;前端按当前激活工具自动填。
- **`services/export.py:export_coco` categories 按 tool_unit 分组** ([export.py](apps/api/app/services/export.py)):每 enabled unit 各贡献一段 categories,`category.supercategory = tool_unit_id`,同名类不去重(强隔离);`cat_map` 改为 `(tool_unit_id, class_name) → category_id`,ann 查询用 `(ann.tool_unit_id, ann.class_name)` 命中,跨 unit 同名走兜底。
- **`services/export.py:export_aap_json` envelope 升 1.1** ([export.py](apps/api/app/services/export.py)):`project.tool_bindings` 整段嵌入;annotations / predictions entries 每条加 `tool_unit_id`(annotation 默认 bbox,prediction 沿用行字段)。
- **`schemas/aap_json.py:AAP_SCHEMA_VERSION` 升 `1.1`** ([aap_json.py](apps/api/app/schemas/aap_json.py)):`AAPProjectMeta.tool_bindings` / `AAPAnnotationEntry.tool_unit_id` / `AAPPredictionEntry.tool_unit_id` 字段加入;1.0 reader 走 `extra="ignore"` 仍可解析(向后兼容)。
- **`services/project_clone.py:CLONEABLE_PROJECT_FIELDS` 收入 `tool_bindings`** ([project_clone.py](apps/api/app/services/project_clone.py)):clone + 模板应用共享同一份白名单。
- **`coalesce_legacy_into_tool_bindings` 同时支持 `classes: list[str]` / `classes_config` / `attribute_schema` 三源** ([project.py](apps/api/app/services/project.py)):names 优先级 list > cfg_map keys > prev unit;cfg_map 提供颜色 / order / alias,缺时从 prev classes 回查;空 dict 等价于"未给"触发反向派生(解决模板 fixture 默认 `{}` 不生效)。
- **`CreateProjectWizard` FormState 改为多 unit** ([CreateProjectWizard.tsx](apps/web/src/components/projects/CreateProjectWizard.tsx)):删除 `classRows / attributeFields` 扁平字段,改为 `unitBindings: Record<ToolUnitId, {enabled, classRows, attributeFields}>` + `activeUnit: ToolUnitId`;Step 1 加 unit chip 多选(切类型时按 data_type 重置默认 + 保留已配置内容)、Step 2 / Step 3 头部加 `UnitTabs` 切换 + 仅渲染 activeUnit 编辑器;`buildFormFromSource` / `buildFormFromTemplate` 复用 `buildUnitBindingsFromSource` 兼容老项目;submit 构造 `tool_bindings` payload 主真值 + 从 activeUnit 派生 legacy 字段兜底;step1Valid 加"至少 1 个 enabled unit"。
- **`ClassesSection` / `AttributesSection` 按 unit tab** ([ClassesSection.tsx](apps/web/src/pages/Projects/sections/ClassesSection.tsx) · [AttributesSection.tsx](apps/web/src/pages/Projects/sections/AttributesSection.tsx)):`useProjectToolBindings` hook 接管状态;`ToolUnitTabs allowToggle` 让 owner 在 ClassesSection 启用 / 禁用 unit;保存走 `unitBindingsToPayload(bindings)` 构造 `tool_bindings` PATCH;rename 走 `useRenameClass` 携带 `tool_unit_id` 限定工具单位的 annotations.class_name 迁移。
- **`projectsApi.renameClass` + `useRenameClass`** ([projects.ts](apps/web/src/api/projects.ts) · [useProjects.ts](apps/web/src/hooks/useProjects.ts)):加可选 `tool_unit_id` 参数 (不传时跨所有 unit 同名一起改保兼容)。
- **工作台 `WorkbenchShell` 切到 `useToolBindings` 派生** ([WorkbenchShell.tsx](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx)):`classes` / `classesConfig` / `attributeSchema` 三字段全部走 hook 派生(老项目走 fallback 到 `project.classes_config` / `attribute_schema`);切工具时若 `activeClass` 不在新 unit 类别集自动切首个类避免错位标注;`AIInspectorPanel` 与 `HotkeyOverlay` 的 `attributeSchema` 同步切换。
- **`api/tasks.ts:AnnotationPayload`** ([tasks.ts](apps/web/src/api/tasks.ts)):加可选 `tool_unit_id` 字段;`useWorkbenchAnnotationActions:submitPolygon / createBboxWithClass` 按 `toolUnitForTool(s.tool)` 自动填。
- **`Tool` union / `hotkeys.ts:setTool` / `AI_TOOL_CYCLE` / `AIInspectorPanel.tool union` / `AIToolDrawer TOOL_HINT` / `ToolDock TOOL_DESCRIPTORS` 同步加 `magic-box`** ([useWorkbenchState.ts](apps/web/src/pages/Workbench/state/useWorkbenchState.ts) · [hotkeys.ts](apps/web/src/pages/Workbench/state/hotkeys.ts) · [AIToolDrawer.tsx](apps/web/src/pages/Workbench/shell/AIToolDrawer.tsx) · [ToolDock.tsx](apps/web/src/pages/Workbench/shell/ToolDock.tsx)):`AI_TOOL_CYCLE` 顺序 smart-point → smart-box → **magic-box** → text-prompt → exemplar(S 键 cycle 经过 magic-box)。
- **`TemplateEditModal` 重写为 3 tab** ([TemplateEditModal.tsx](apps/web/src/pages/ProjectTemplates/TemplateEditModal.tsx)):基础信息(name / description / type / scope / annotation_guide) / 工具与类别(复用 `ToolUnitTabs allowToggle` + `ClassEditor` + `AttributeSchemaEditor`) / 渲染配置(占位 + 提示语 v0.10.18 接入共享编辑器);submit 走 `unitBindingsToPayload(bindings)` 构造 `tool_bindings`,classes 派生自首个 enabled unit 兼容老 reader。
- **`projectTemplates.ts` 类型加 `tool_bindings`** ([projectTemplates.ts](apps/web/src/api/projectTemplates.ts)):`ProjectTemplateOut` / `ProjectTemplateCreatePayload` 同步;codegen 自动派生强类型。
- **OpenAPI snapshot + 前端 codegen** ([openapi.snapshot.json](apps/api/openapi.snapshot.json) · [generated/types.gen.ts](apps/web/src/api/generated/types.gen.ts)):tool_bindings / tool_unit_id / ToolBinding / ToolClassEntry 全链路派生,前端 `api/projects.ts` 重导出 `ToolBinding / ToolClassEntry / ToolBindings` 强类型。

### Verified

- 后端:`alembic upgrade head` 应用 0072 / 0073 在 docker postgres 实测成功(P-0001 历史项目 classes 正确转入 `tool_bindings.bbox` unit,attribute_schema 一并迁入);`pytest tests/` → **577 passed**(含修复 `apply_template_with_explicit_field_override` 与 `clone_copies_all_cloneable_fields` 派生覆盖逻辑、`already_internal_shape_passthrough` mutate-in-place identity 保兼容)。
- 前端:`pnpm exec tsc --noEmit` 全绿(0 错);`pnpm vitest run` → **718 passed**(含 5 例新增 `tightenBboxFromPolygon` 单测:空输入 / 0 面积 / 紧凑外接矩形派生 / 越界 clamp / number[][] 形式)。
- 端到端冒烟(手测):① 进 `/projects/new` Wizard → 选 image → 工具集勾 bbox + region → 给两组各加同名 person 不同色 → 创建成功 → DB `SELECT tool_bindings FROM projects` 结构正确;② 进项目 ClassesSection / AttributesSection 看到两个 unit tab 类别不串、unit toggle 启停生效;③ 工作台 B/P 切 bbox/polygon,左侧 ClassPalette 自动换 unit 的类别,落标注 DB `tool_unit_id` 列非空;④ AI backend 启动时 G 键试 Magic Box 拖框 → 收紧到对象紧凑外接矩形 → 落 bbox(`tool_unit_id=ai_interactive`),AI 候选层不展示直接落库;⑤ COCO 导出 categories 段含 `supercategory` 字段、AAP JSON 导出 `schema_version="1.1"` + `tool_bindings` 整段嵌入。

## [0.10.16] - 2026-05-19

> **ROADMAP §1 立即可做小颗粒收尾 (4 子项).** 一次性收口 CVAT/Label Studio 取经合集 §1 中尚未完成的 4 项基建：reject 原因结构化（§1.2）、Webhook 事件信封 ADR-0025 草案（§1.3）、DuckDB 离线分析视图（§1.6）、统一 async_jobs 异步任务表 MVP（§1.7）。本期不动 webhook 实现，只锁信封 schema；不引入 ClickHouse，先用 DuckDB 顶量级；async_jobs 与现有 `prediction_jobs` / `video_tracker_jobs` 走**双写双轨**——前者只记最小元数据作为汇总索引，后者保留为 domain 真值。为后续 reject 率分析、Annotator Dashboard（§4.1）、Webhook 系统（§2.1）一并铺底。→ [plan](docs/plans/2026-05-19-v0.10.16-roadmap-s1-closure.md) · [ADR-0025](docs/adr/0025-webhook-event-envelope-versioning.md)

### Added

- **`tasks.reject_reason_type` 4 类枚举 + alembic 0070**（[model](apps/api/app/db/models/task.py) · [migration](apps/api/alembic/versions/0070_task_reject_reason_type.py)）：`missing` / `extra` / `wrong_label` / `wrong_geometry`；旧数据 NULL 不回填，新 reject 强制选 type；reviewer dashboard + workbench + review page 全部走 [`RejectReasonModal`](apps/web/src/pages/Review/RejectReasonModal.tsx) 4 按钮单选（ReviewerDashboard 从 `window.prompt` 升级到 Modal）；中文 label 映射常量 [`rejectReasonTypes.ts`](apps/web/src/pages/Review/rejectReasonTypes.ts) 前端单点。
- **`async_jobs` 统一异步任务表 + alembic 0071**（[model](apps/api/app/db/models/async_job.py) · [migration](apps/api/alembic/versions/0071_async_jobs.py) · [service](apps/api/app/services/async_job.py) · [API](apps/api/app/api/v1/async_jobs.py)）：`kind` ∈ `batch_predict|video_tracker|audit_archive|predictions_import`，`status` ∈ `pending|running|completed|failed|cancelled`；`GET /async-jobs`（owner-scoped，super_admin 看全部）+ `GET /async-jobs/{id}` + `POST /async-jobs/{id}/cancel`（MVP 仅支持 `predictions_import` / `audit_archive` 软取消）；Celery [`task_failure` / `task_revoked` signals](apps/api/app/workers/signals.py) 兜底翻 failed/cancelled；Celery beat 每日 04:15 UTC 跑 [`purge_old_async_jobs`](apps/api/app/workers/async_jobs_cleanup.py) 清 30 天前终态行。
- **Topbar 后台任务铃铛**（[JobsBell.tsx](apps/web/src/components/shell/JobsBell.tsx)）：5s polling `/async-jobs?limit=20`，badge 显示 in-progress 计数，drawer 列进度条 + 状态 pill + 错误提示。与现有 `PreannotateJobsBadge`（Redis pub/sub 走预标专用通道）并存。
- **DuckDB 离线分析 + `/admin/analytics`**（super_admin only）：[`duckdb_sync.py`](apps/api/app/services/duckdb_sync.py) 增量同步 `task_events`（带 `reject_reason_type` 反向 join）+ `audit_logs` 到 `./data/duckdb/analytics.duckdb`；[`analytics_queries.py`](apps/api/app/services/analytics_queries.py) 暴露 3 个固定面板查询（人均日吞吐 / reject 率分类型 / 标注耗时 p50/p95），**不**接受任意 SQL；[`AnalyticsPage.tsx`](apps/web/src/pages/Admin/AnalyticsPage.tsx) 渲染三张卡片；Celery beat 每日 02:30 UTC 跑 [`sync_to_duckdb`](apps/api/app/workers/analytics.py)。
- **ADR-0025 Webhook 事件信封 + Pydantic schema 占位**（[ADR](docs/adr/0025-webhook-event-envelope-versioning.md) · [schema](apps/api/app/schemas/event_envelope.py)）：约定 `event_version` / `event` / `delivery_id` / `occurred_at` / `data` 5 个必备字段，breaking change 升 major、minor 只能加可空字段（Postel's law）；与 §1.5 AAP JSON 的 `schema_version` 同源思路。**不实现** publisher / outbox / delivery 表，留给 §2.1 epic。

### Changed

- **batch_predict / video_tracker / audit_archive / predictions_import 接入 async_jobs 双写**：service 层显式 `create_job` + `update_progress`（每 5% 步长）+ `mark_complete/failed`；专表（`prediction_jobs` / `video_tracker_jobs`）保留为 domain 真值。失败路径走 try/except 兜底，**专表写入失败不阻断主流程**。
- **`docker-compose.yml` celery-worker 加 `./data/duckdb:/var/lib/duckdb` bind mount + 队列加 `cleanup,audit`**，确保 DuckDB 同步 + async_jobs 清理任务有 worker 接管。
- **Python 新依赖**：`duckdb>=1.1.0,<2.0.0`（worker 写、API 只读，单 writer 多 reader 模型）。
- **`docs/adr/README.md` 索引补齐 ADR 0019-0025**（旧索引停在 0018）。

### Verified

- 后端：`alembic upgrade head` 应用 0070/0071 通过；reject endpoint 缺 `reason_type` → 422、带合法 type → 200；`EventEnvelope` 序列化往返锁；FastAPI 加载 249 路由，含 `/api/v1/async-jobs/*` + `/api/v1/admin/analytics/{panel_name}`；Celery beat 11 项 schedule（含 `sync-to-duckdb` / `purge-old-async-jobs`）+ task_routes 含 analytics / async_jobs_cleanup 路由。
- 前端：`RejectReasonModal` 4 按钮 + comment 可空 + skip hint 预填；`ReviewerDashboard` 改用 Modal 后 reject 流程；`JobsBell` 空态 / running badge 计数 / 终态不计入 badge 全部覆盖。

## [Unreleased]

### Changed

- **CSP style-src sections + Workbench + Dashboard + 基础 UI 群续推**：`apps/web/src/**/*.tsx` 的 JSX `style=` / `<style>` 已全站清零，`no-restricted-syntax` guard 已扩到全站 TSX。迁移覆盖 Projects sections、Workbench、Dashboard、AIPreAnnotate、Admin、Annotate、Audit、Bugs、Datasets、Review、Settings、Storage、Users、Login/Register/Unauthorized、ModelMarket、App，以及 `components/ui` / shell / bugreport / datasets / projects / users / CommandPalette / PerfHud / UserPicker / CanvasDrawingEditor 等全局组件。`Button` / `Card` / `Badge` / `Icon` / `Avatar` 继续保留 public `style` prop 兼容性，但改由 `useElementStyle` ref 同步 DOM style；`Badge` 补 `className` 透传，避免迁移时用 wrapper 改变文本匹配。CSP 头同步摘掉 `style-src 'unsafe-inline'`：API 响应路径收紧为 `style-src 'self'`，Nginx HTML 出站路径改为 `style-src 'self' 'nonce-$request_id'`，vite nonce 插件补齐 `<style>` 标签 nonce。→ [plan](docs/plans/2026-05-18-v0.10.12-csp-style-src-sections.md) · [ADR-0010](docs/adr/0010-security-headers-middleware.md) · [迁移指南](docs-site/dev/how-to/migrate-inline-style-to-css-modules.md)

## [0.10.15] - 2026-05-19

> **Predictions Import 端点 + 平台原生 AAP JSON v1.0 无损中间格式.** ROADMAP §A AI/模型 P2 项: 当前 `predictions` 行只能由内部 ML backend 写入, 客户自家训好的模型 / 不愿托管在平台 backend 的场景(学术/初创/合规)无法把外部模型结果灌进来; 同时 COCO/YOLO/VOC 三种导出格式都是**有损**(attribute_schema 值/prediction.confidence/annotation.source/annotation_guide/classes_config 都丢失), 缺一个**无损**中间格式作为跨实例迁移/SDK/Plugin/dataset snapshot 锚点. 本期同窗口做两件事:① 新增 `POST /projects/{id}/predictions/import` 端点(COCO + AAP JSON 两种 input);② AAP JSON v1.0 作为新导出格式与 COCO/YOLO/VOC 并列接入. 关键决策(对照取经合集 §6 决策底线): `schema_version` 必备 + breaking change 升 major; `annotations[]` 和 `predictions[]` **双数组分开**(不混 type 字段, 避开 CVAT 部分格式踩的坑); 导出严格写满 null + 导入 lenient `extra="ignore"`; `geometry` 使用平台**内部格式**(与 annotation.geometry JSONB 对齐), 不嵌套 LabelStudio shape; `task_match` oneof `display_id` 优先(全局唯一最稳), `file_path` fallback, 跨项目 display_id 命中视为不匹配防偷换项目. 后端 alembic 0069 加 `predictions.source String(20) NOT NULL DEFAULT 'ml_backend'` + 索引, 老数据按默认回填(当前唯一出口是 ML backend 含义准确), 外部导入行 `source='external_import'` / `ml_backend_id=NULL`. 新 [`app/schemas/aap_json.py`](apps/api/app/schemas/aap_json.py) 写 AAP JSON v1.0 envelope (AAPJsonV1Envelope / AAPTaskBlock / AAPAnnotationEntry / AAPPredictionEntry, 全部 pydantic v2 `extra="ignore"`). [`ExportService.export_aap_json`](apps/api/app/services/export.py) 复用 `_load_data` + 新增 `_load_predictions`, 通过 `to_internal_shape` 把 prediction.result 的 LS shape 反推为内部 geometry, 组装严格写满 null 的 envelope. [`predictions_import.py`](apps/api/app/services/predictions_import.py) 内 `internal_geometry_to_ls_shape` 适配器把 bbox/polygon/multi_polygon → LabelStudio shape, `import_aap_json` 与 `import_coco` 复用 [`PredictionService.create_from_ml_result`](apps/api/app/services/prediction.py)(扩 `source` 参数)写入. [`task_matcher.resolve_task`](apps/api/app/services/task_matcher.py) 统一封装 display_id+file_path 两段式查找. 端点 [`POST /projects/{id}/predictions/import`](apps/api/app/api/v1/predictions.py) 接 multipart/form-data, 走 `require_project_owner` 权限, AuditMiddleware 写 `predictions.import` 审计. AAP JSON 导出接入 [`/projects/{id}/export`](apps/api/app/api/v1/projects.py) 和 [`/projects/{id}/batches/{bid}/export`](apps/api/app/api/v1/batches.py) 两个端点的 `format=aap_json` 分派. 前端 [`predictionsApi.import`](apps/web/src/api/predictions.ts) 走 FormData + fetch(client.ts 默认 Content-Type=application/json 不能复用), [`PredictionImportWizard`](apps/web/src/components/predictions/PredictionImportWizard.tsx) 三步 Modal(选格式+文件 → dry-run 预览 errors 表 → 确认提交), 入口放在 [AIPreAnnotate ProjectDetailPanel](apps/web/src/pages/AIPreAnnotate/components/ProjectDetailPanel.tsx) toolbar 与 batch 级预标流程并列(语义最贴近"外部模型结果上传"). [`Dashboard ExportSection`](apps/web/src/pages/Dashboard/ExportSection.tsx) 格式下拉加「AAP JSON」选项与 COCO/YOLO/VOC 并列; `ExportFormat` 类型扩 `"aap_json"`. **不引入**:① `POST /annotations/import` 端点(AAP JSON `annotations[]` 字段导出端写满, 导入端只警告日志不入库; annotations import 涉及 batch/owner/audit 协议复杂度, 留下一版);② Task 表加 `external_id` 字段(本期 display_id+file_path 两元组够; external_id 留 v0.11+);③ ProjectTemplate 进 AAP JSON manifest(与 ADR-0023 模板 epic 触发条件挂钩, 本期仅约定 envelope 末层预留扩展位);④ datumaro 链转换(其它格式走 datumaro 中转, 本期不引入). ROADMAP §A 「Predictions Import + AAP JSON」P2 收官. → [plan](docs/plans/2026-05-19-v0.10.15-predictions-import-aap-json.md) · [ADR-0024](docs/adr/0024-aap-json-format.md) · [用户文档](docs-site/user-guide/reference/export-formats.md) · [API 导入指南](docs-site/api/guides/import.md).

### Added

- **`predictions.source` 字段 + alembic 0069** ([model](apps/api/app/db/models/prediction.py) · [migration](apps/api/alembic/versions/0069_predictions_source.py))：String(20) NOT NULL DEFAULT 'ml_backend' + 索引; 老数据回填.
- **`POST /projects/{id}/predictions/import`** ([predictions.py](apps/api/app/api/v1/predictions.py)): 端点接 COCO + AAP JSON, dry_run + overwrite_existing 参数.
- **`/projects/{id}/export?format=aap_json` + 批次级同向**: 双端点接入 AAP JSON 导出.
- **`app/schemas/aap_json.py`** ([aap_json.py](apps/api/app/schemas/aap_json.py)): AAP JSON v1.0 envelope pydantic schema + schema_major 守门.
- **`app/services/predictions_import.py`** ([predictions_import.py](apps/api/app/services/predictions_import.py)): import_aap_json / import_coco + internal_geometry_to_ls_shape 适配器.
- **`app/services/task_matcher.py`** ([task_matcher.py](apps/api/app/services/task_matcher.py)): resolve_task display_id+file_path 两段式查找.
- **`ExportService.export_aap_json`** ([export.py](apps/api/app/services/export.py)): 项目级 + 批次级 AAP JSON 导出, 双数组 annotations[]+predictions[].
- **`PredictionImportWizard`** ([PredictionImportWizard.tsx](apps/web/src/components/predictions/PredictionImportWizard.tsx)): 三步 Modal (选格式+文件 → dry-run 预览 → 确认提交).
- **AIPreAnnotate ProjectDetailPanel 「导入预测」按钮** ([ProjectDetailPanel.tsx](apps/web/src/pages/AIPreAnnotate/components/ProjectDetailPanel.tsx)): 与 batch 级预标触发位并列.
- **Dashboard ExportSection 「AAP JSON」选项** ([ExportSection.tsx](apps/web/src/pages/Dashboard/ExportSection.tsx)): 与 COCO/YOLO/VOC 并列.
- **13 例后端 import 单测** ([test_predictions_import.py](apps/api/tests/test_predictions_import.py)): AAP bbox/polygon/multi_polygon happy path + COCO happy + schema_version 守门 + task_match display_id/file_path 命中/miss + 跨项目 display_id + dry_run 不入库 + overwrite_existing 替换 + 未知 kind errors + annotator 403 + 默认 source.
- **4 例后端 export 单测** ([test_export_aap_json.py](apps/api/tests/test_export_aap_json.py)): project envelope + batch_display_id 透传 + 空项目 + import→export round-trip.
- **4 例前端 Wizard 单测** ([PredictionImportWizard.test.tsx](apps/web/src/components/predictions/PredictionImportWizard.test.tsx)): 文件未选不能预览 + dry-run 预览 errors 渲染 + 格式切换 COCO 参数 + 确认提交 dry_run=false + onComplete.
- **ADR-0024** ([0024-aap-json-format.md](docs/adr/0024-aap-json-format.md)): schema_version / 双数组 / lenient import / geometry 格式选择 / 范围边界.
- **用户文档 AAP JSON 段** ([export-formats.md](docs-site/user-guide/reference/export-formats.md)).
- **API 导入指南** ([import.md](docs-site/api/guides/import.md)): 端点契约 + dry-run 工作流 + task_match 语义.

### Changed

- **`PredictionService.create_from_ml_result`** ([prediction.py](apps/api/app/services/prediction.py)): 扩 `source: str = "ml_backend"` 参数, 默认值保持原行为, 外部导入路径传 `source="external_import"`.
- **`AuditAction.PREDICTIONS_IMPORT`** ([audit.py](apps/api/app/services/audit.py)): 新 audit action 枚举值.
- **`ExportFormat` 前端类型** ([projects.ts](apps/web/src/api/projects.ts) · [batches.ts](apps/web/src/api/batches.ts)): 扩 `"aap_json"`; 文件名默认扩展名按 JSON/ZIP 双分支.

### Verified

- `cd apps/api && uv run python -m pytest tests/test_predictions_import.py tests/test_export_aap_json.py` → 17 passed.
- `pnpm --filter web vitest run src/components/predictions` → 4 passed.
- `pnpm --filter web typecheck` → 全绿 (0 错).
- alembic 0069 已在 dev 库 apply 成功, `\d predictions` 看到 `source` 列 + `ix_predictions_source` 索引.

## [0.10.14] - 2026-05-18

> **ProjectTemplate 表 + 模板库 UI.** ROADMAP §A 「项目模板」二阶段：v0.10.11 的「从已有项目复制」是项目级一次性快照（80% 场景），v0.10.13 E1 落 annotation_guide 做整合伏笔；本期补「独立模板资产」形态 —— 模板可手工建 / 跨组织共享 / 多次引用 / 携带 annotation_guide 文本。后端 alembic 0068 新建 `project_templates` 表（display_id `PT-N` 序列 + scope `private/organization/public` + organization_id CASCADE + created_by + source_project_id SET NULL + usage_count + annotation_guide TEXT，**不存 guide_assets**），加 CHECK 约束保证 organization scope 必须给 organization_id。`_CLONEABLE_PROJECT_FIELDS` 16 字段白名单抽到 [`app.services.project_clone`](apps/api/app/services/project_clone.py) 供 projects + project_templates 共享，避免字段漂移。[`/project-templates/*`](apps/api/app/api/v1/project_templates.py) 5 端点：GET（按 scope 可见性过滤）/ POST（创建，public 仅 super_admin）/ GET :id / PATCH（created_by 或 super_admin）/ DELETE / POST :id/duplicate（克隆为私有副本）。`ProjectCreate` 加 [`template_id: UUID | None`](apps/api/app/schemas/project.py)，与 `source_project_id` **互斥**（pydantic `model_validator` 强制，违反返 422）；POST `/projects` 给定 `template_id` 时把模板载荷 deepcopy 进 payload + 模板 `usage_count + 1`；新项目自动继承模板的 `annotation_guide` 文本，**guide_assets 不携带**（storage key 跨实例引用混乱 / 跨组织私密性 / 源项目删 asset 会让所有依赖模板的项目失效）。可见性 service [`assert_template_visible`](apps/api/app/services/project_template.py)：private 仅 `created_by` 看得到、organization 走 [`OrganizationMember`](apps/api/app/db/models/organization.py) 查同组织、public 全部；编辑/删除权限 = `created_by` 或 super_admin。前端 `/project-templates` 新路由（[ProjectTemplatesPage](apps/web/src/pages/ProjectTemplates/ProjectTemplatesPage.tsx)）—— 三 tab（我的 / 组织 / 公共）+ 搜索 + 类型过滤 + 卡片网格；[TemplateCard](apps/web/src/pages/ProjectTemplates/TemplateCard.tsx) 展示 scope chip / classes 数 / usage_count / 含指引徽标 + 操作（应用 / 克隆 / 编辑 / 删除）。两种创建入口：[TemplateEditModal](apps/web/src/pages/ProjectTemplates/TemplateEditModal.tsx) 空白建（name / description / type / classes CSV / annotation_guide / scope），[CreateFromProjectDialog](apps/web/src/pages/ProjectTemplates/CreateFromProjectDialog.tsx) 从已有项目导出（后端自动 dump CLONEABLE 字段）。`CreateProjectWizard` 加 `templateId?` prop + `buildFormFromTemplate()`，模板模式 banner「已用模板字段预填表单 (annotation_guide 也会一并应用; guide_assets 不携带)」；提交时携带 `template_id`，与 `sourceProjectId` 互斥；模板模式跳过 localStorage 草稿。Sidebar 工作区栏目新增「项目模板」入口（icon=book），`PageKey` + `ROLE_PAGE_ACCESS` 同步扩 `project-templates`（project_admin + super_admin 可见）。**不引入**：① 模板版本号 / changelog（PATCH 直接覆盖，需审计就在创建项目时落项目审计日志）；② organization admin 提交 public 模板的审核流（KISS，仅 super_admin 可建 public）；③ guide_assets 跨项目 deepcopy（Stage 2，触发条件：客户大量在 guide 中用图且确需跨项目复用，再用 worker 异步 deepcopy 到新项目 storage namespace）；④ 模板复杂字段编辑 UI（attribute_schema / classes_config / rendering_config 走「从已有项目导出」即可，首版不在 TemplateEditModal 里复刻 7 步 Wizard）；⑤ 模板审计审计日志专用字段（POST /project-templates 默认走 AuditMiddleware 即可）。ROADMAP §A「项目模板」P2 收官，长期项目"独立 Template 库"形态正式上线。→ [plan](docs/plans/2026-05-18-v0.10.14-project-template-library.md) · [ADR-0023](docs/adr/0023-project-template-vs-clone.md) · [用户文档](docs-site/user-guide/for-project-admins/project-templates.md).

### Added

- **`project_templates` 表 + alembic 0068** ([model](apps/api/app/db/models/project_template.py) · [migration](apps/api/alembic/versions/0068_project_templates.py))：模板载荷与 Project 列对齐 + scope/organization/usage_count 元数据。
- **`display_seq_project_templates` 序列 + `PT-` 前缀** ([display_id.py](apps/api/app/services/display_id.py))：与既有 `B-` / `T-` / `D-` / `P-` / `BT-` 不冲突。
- **`/project-templates/*` 路由 (5 端点)** ([project_templates.py](apps/api/app/api/v1/project_templates.py))：list / create / detail / patch / delete / duplicate。
- **`ProjectCreate.template_id: UUID | None`** ([schemas/project.py](apps/api/app/schemas/project.py))：与 source_project_id 互斥，pydantic model_validator 强校验。
- **`app.services.project_clone`** ([project_clone.py](apps/api/app/services/project_clone.py))：`CLONEABLE_PROJECT_FIELDS` + `merge_from_source` 抽出共享。
- **`app.services.project_template`** ([project_template.py](apps/api/app/services/project_template.py))：scope 可见性 + apply / dump 业务逻辑。
- **`/project-templates` 前端路由** ([ProjectTemplatesPage.tsx](apps/web/src/pages/ProjectTemplates/ProjectTemplatesPage.tsx))：列表 + 三 tab + 搜索 + 模态。
- **`projectTemplatesApi` + `useProjectTemplates`** ([api](apps/web/src/api/projectTemplates.ts) · [hooks](apps/web/src/hooks/useProjectTemplates.ts))：list / get / create / patch / remove / duplicate + React Query 自动失效。
- **`PageKey="project-templates"` + Sidebar 入口** ([types](apps/web/src/types/index.ts) · [Sidebar](apps/web/src/components/shell/Sidebar.tsx) · [permissions](apps/web/src/constants/permissions.ts))：project_admin / super_admin 可见。
- **14 例后端单测** ([test_project_templates.py](apps/api/tests/test_project_templates.py) · [test_projects_clone.py](apps/api/tests/test_projects_clone.py))：CRUD + scope 可见性 + organization 成员可见 + public 仅 super_admin + 从源项目导出 + duplicate 私有副本 + 应用模板 + usage_count +1 + template/source 互斥 + 404 隐藏存在性 + 模板带 guide / 不带 assets。
- **10 例前端单测** ([ProjectTemplatesPage.test.tsx](apps/web/src/pages/ProjectTemplates/ProjectTemplatesPage.test.tsx) · [TemplateCard.test.tsx](apps/web/src/pages/ProjectTemplates/TemplateCard.test.tsx))：加载态 / 空态 / 卡片渲染 / 删除 confirm / 应用打开 Wizard 透传 templateId / canEdit 控制按钮 / scope chip 切换。
- **ADR-0023** ([0023-project-template-vs-clone.md](docs/adr/0023-project-template-vs-clone.md))：解释 template vs clone 边界、并存策略、为何不存 guide_assets。
- **用户文档** ([project-templates.md](docs-site/user-guide/for-project-admins/project-templates.md) · [public-templates.md](docs-site/user-guide/for-superadmins/public-templates.md))：模板库使用 + 公共模板治理章节。

### Changed

- **`POST /projects`** ([projects.py](apps/api/app/api/v1/projects.py))：新增 template_id 分支，与 source_project_id 互斥；模板模式下 deepcopy 载荷 + usage_count +1 + 显式 refresh 模板让后续 GET 不触发 lazy load。
- **`CreateProjectWizard`** ([CreateProjectWizard.tsx](apps/web/src/components/projects/CreateProjectWizard.tsx))：加 `templateId?` prop + `buildFormFromTemplate()`；title 区分「新建/复制/模板」；提交时携带 `template_id`；模板模式跳过 localStorage 草稿。
- **`ProjectCreatePayload`** ([api/projects.ts](apps/web/src/api/projects.ts))：手动扩 `template_id?: string | null`（待 codegen 重跑）。

### Verified

- `pnpm --filter web typecheck` 全绿（0 错）。
- `pnpm --filter web vitest run src/pages/ProjectTemplates src/pages/Dashboard src/components/projects` → 59 passed。
- `cd apps/api && pytest tests/test_project_templates.py tests/test_projects_clone.py` → 23 passed。
- 手测：① 进 `/project-templates` → 「+ 新建模板」填表创建 → 列表出现私有模板。② 「从已有项目导出」选源项目 → 模板的 classes / annotation_guide 来自源项目。③ 卡片「应用」→ Wizard banner 出现 + 字段预填 + 提交后新项目 classes / annotation_guide 来自模板，guide_assets 为空。④ 模板 `usage_count` +1。⑤ 私有模板对其它 project_admin 不可见，公共模板对所有人可见。

## [0.10.13] - 2026-05-18

> **CVAT-style 项目级标注指引（Annotation Guide）.** ROADMAP §A 的「Annotation Guide（项目级 Markdown 指引 + asset）」P2 一发收尾：项目设置页加「📖 标注指引」section，工作台左上角加可折叠浮层，首次进入工作台自动展开一次。技术 ROI 不高但对标注一致性 / reject 率影响显著。本期**不开 ProjectTemplate 表 + 模板库 UI**（独立 epic，按计划在 v0.10.14 推进；E1 落地后先观察客户对 guide 的写法 / 图片量 / 跨项目复用诉求，再决定 v0.10.14 的"模板是否携带 guide"）。后端 alembic 0067 加 `projects.annotation_guide TEXT` + `projects.guide_assets JSONB DEFAULT '[]'`；新建 [`/projects/{id}/guide-assets/*`](apps/api/app/api/v1/guide_assets.py) 4 个端点（upload-init / upload-complete / delete / sign-url），storage key 前缀强制 `projects/{project_id}/guide/{uuid}-{filename}` 防越权写入；content_type 白名单 5 类（png/jpeg/webp/gif/svg+xml）+ 单文件 5MB 上限；权限 = project_owner 或 super_admin（与 ProjectSettings 入口对齐）。`POST /projects` 接 [`copy_annotation_guide: bool`](apps/api/app/schemas/project.py) flag —— 默认 false（保守，不进 `_CLONEABLE_PROJECT_FIELDS` 白名单避免复制后信息错位）；给定时与源项目 `source_project_id` 一起 deepcopy `annotation_guide` + `guide_assets`，**图片 storage key 复用**（不重新上传，源项目删除资源会影响新项目，UX 在 wizard checkbox 文案标注）。前端引入 [CodeMirror 6](apps/web/package.json) (`@codemirror/state` / `view` / `lang-markdown` / `commands`) 写 [`MarkdownEditor`](apps/web/src/components/markdown/MarkdownEditor.tsx) —— 行号 / 自动换行 / undo-redo / 9 个工具栏按钮 / 拖拽 + 粘贴图片直传到 guide-assets；走 dynamic import 仅在 ProjectSettings 路由加载避免污染 dashboard 首屏 bundle。[`GuideMarkdownView`](apps/web/src/components/markdown/GuideMarkdownView.tsx) 复用 react-markdown + remark-gfm，渲染 `<img src="guide-asset:KEY">` 时通过 [`useGuideAssets.signAsset`](apps/web/src/hooks/useGuideAssets.ts) 批量预签短期 URL（1h 过期 + 内存缓存 + 60s 安全垫重签）。`ProjectSettingsPage` `SECTIONS` 数组追加 `annotation-guide` tab（icon=book，BookOpen lucide），路由参数 `?section=annotation-guide` 深链可用。`WorkbenchLayout` 加可选 [`guidePanel`](apps/web/src/pages/Workbench/shell/WorkbenchLayout.tsx) prop；`WorkbenchShell` 透传 `currentProject.annotation_guide`，左上角浮层 `localStorage` `wb:guide-seen:{projectId}` 标记首次自动展开 + `wb:guide-collapsed:{projectId}` 记忆用户折叠状态；项目无 guide → panel 完全不渲染（不露空状态）。`CreateProjectWizard` 在复制模式 banner 加 checkbox「同时复制标注指引（图片资源与源项目共享存储）」默认勾选；FormState 加 `copyAnnotationGuide: boolean`，submit 时仅当 `sourceProjectId` 给定才传 flag（后端校验若无 source_project_id 会返 400）。**不引入**：① 异步压缩 / 缩略图（首版 KISS）；② 储存空间 GC（删 annotation_guide 时不主动清理 orphan assets，UI 给「清理未引用资源」按钮留客户反馈触发）；③ 工作台内编辑指引（owner 想改回 ProjectSettings，避免工作台 UI 复杂化）；④ "我已读"按钮（首次自动展开 + 用户手动折叠已经够用）；⑤ 视频指引 / 富文本编辑器（v0.11+）；⑥ 独立 ProjectTemplate 表 + 模板库 UI（v0.10.14 单独 epic）。是 ROADMAP §A 「项目模板」二阶段的前置脚手架。→ [plan](docs/plans/2026-05-18-v0.10.13-annotation-guide.md) · [ROADMAP §A Annotation Guide](ROADMAP.md) · [取经合集 §1.1](ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#11-annotation-guide项目级-markdown-指引--asset).

### Added

- **`projects.annotation_guide TEXT` + `projects.guide_assets JSONB`** ([project.py](apps/api/app/db/models/project.py) · [alembic 0067](apps/api/alembic/versions/0067_project_annotation_guide.py))：项目级 Markdown 指引 + 图片资源元数据列表。
- **`/projects/{id}/guide-assets/*` 4 端点** ([guide_assets.py](apps/api/app/api/v1/guide_assets.py))：upload-init（签 PUT URL）/ upload-complete（HEAD 校验后 append entry）/ DELETE / GET sign-url（1h 短期）。
- **`ProjectCreate.copy_annotation_guide: bool`** ([schemas/project.py](apps/api/app/schemas/project.py))：默认 false；仅与 `source_project_id` 配合有效，无 source 时 400。
- **`MarkdownEditor` (CodeMirror 6)** ([MarkdownEditor.tsx](apps/web/src/components/markdown/MarkdownEditor.tsx))：行号 + lineWrapping + 9 个工具栏按钮 + drop/paste 图片直传；dynamic import 避免首屏负担。
- **`GuideMarkdownView`** ([GuideMarkdownView.tsx](apps/web/src/components/markdown/GuideMarkdownView.tsx))：react-markdown + remark-gfm 渲染 + `guide-asset:KEY` 自动解析短期签名 URL。
- **`useGuideAssets`** ([useGuideAssets.ts](apps/web/src/hooks/useGuideAssets.ts))：`uploadAsset` / `deleteAsset` / `signAsset`（带内存缓存 + 60s 安全垫重签）。
- **`AnnotationGuideSection`** ([AnnotationGuideSection.tsx](apps/web/src/pages/Projects/sections/AnnotationGuideSection.tsx))：项目设置「📖 标注指引」section（编辑 / 预览 tab + 图片资源列表 + 保存）。
- **`GuidePanel`** ([GuidePanel.tsx](apps/web/src/pages/Workbench/sidebar/GuidePanel.tsx))：工作台左上角可折叠浮层，首次自动展开 + localStorage 记忆。
- **CodeMirror 6 deps** ([package.json](apps/web/package.json))：`@codemirror/state` / `view` / `lang-markdown` / `commands` / `language` / `codemirror`（~180-220 KB gzipped，dynamic import 加载）。
- **`BookOpen` icon** ([Icon.tsx](apps/web/src/components/ui/Icon.tsx))：`name="book"`，用于 ProjectSettings tab + 工作台浮层标题。
- **9 例后端单测** ([test_guide_assets.py](apps/api/tests/test_guide_assets.py))：upload-init 成功 / 越权 403 / content-type 拒绝 / upload-complete entry append / storage 缺失 400 / key 不属于项目 404 / DELETE 同步移除 + 调 storage / sign-url 短期 / PATCH annotation_guide 写入。
- **3 例克隆扩展单测** ([test_projects_clone.py](apps/api/tests/test_projects_clone.py))：默认不复制 guide / `copy_annotation_guide=true` 同时复制 guide + assets / 缺 `source_project_id` 时返 400。
- **4 例前端单测** ([AnnotationGuideSection.test.tsx](apps/web/src/pages/Projects/sections/AnnotationGuideSection.test.tsx))：渲染初值 / 修改+保存 mutation / 切预览 tab / asset 删除调 hook。

### Changed

- **`ProjectUpdate` / `ProjectOut`** ([schemas/project.py](apps/api/app/schemas/project.py))：加 `annotation_guide: str | None` + `guide_assets: list[dict]` 字段。
- **`ProjectCreateWizard` + FormState** ([CreateProjectWizard.tsx](apps/web/src/components/projects/CreateProjectWizard.tsx))：复制模式 banner 加 checkbox「同时复制标注指引」；FormState 加 `copyAnnotationGuide`，submit 时只在复制模式下携带该 flag。
- **`ProjectSettingsPage.SECTIONS`** ([ProjectSettingsPage.tsx](apps/web/src/pages/Projects/ProjectSettingsPage.tsx))：在 rendering 与 owner 之间新增 `annotation-guide` tab；`VALID_SECTIONS` / `SectionKey` 同步扩展。
- **`WorkbenchLayout`** ([WorkbenchLayout.tsx](apps/web/src/pages/Workbench/shell/WorkbenchLayout.tsx))：加可选 `guidePanel` prop，渲染到 modals 同级；项目无 guide 时浮层完全不渲染。
- **`projectsApi.guideAssets.*`** ([api/projects.ts](apps/web/src/api/projects.ts))：扩 4 个端点 wrapper + `GuideAssetEntry` / `GuideAssetUploadInitResponse` / `GuideAssetSignedUrlResponse` 类型。

### Verified

- `pnpm --filter web typecheck` 全绿（0 错；CodeMirror 6 + GuideAssetEntry / WorkbenchLayout guidePanel prop 全部传通）。
- `pnpm --filter web vitest run src/pages/Projects/sections/AnnotationGuideSection.test.tsx` → 4 passed。
- `cd apps/api && pytest tests/test_guide_assets.py tests/test_projects_clone.py` → 18 passed（9 guide-assets + 6 既有 clone + 3 新 copy_guide）。
- 手测（preview）：① 登录 super_admin → 进 [/projects/.../settings?section=annotation-guide](#) → 编辑器加载（CodeMirror 6 行号 + lang-markdown 高亮）；拖入一张 PNG → 网络面板看到 upload-init → PUT → upload-complete 三段调用 → markdown 自动注入 `![pic.png](guide-asset:...)`；切预览 tab 看到签名 URL 解析后的图片渲染。② 在该项目工作台 `/projects/.../annotate` 第一次进入：左上角 📖 浮层自动展开渲染指引；手动折叠后刷新仍折叠；清 `localStorage` `wb:guide-collapsed:*` 重进又自动展开。③ Dashboard → 项目卡片 ⋮ → 「复制项目配置」→ Wizard banner 出现 checkbox「同时复制标注指引（图片资源与源项目共享存储）」默认勾选；submit 后新项目 GET 返回 `annotation_guide` + `guide_assets` 与源项目内容一致。

## [0.10.11] - 2026-05-18

> **CSP style-src 收紧基建试点 + 项目复制配置.** 0.10.x 系列收尾后第一发维护切片，挑两件 ROADMAP §A / §B 中互不耦合、可控的事一次发完：① **CSP style-src 收紧基建 (Part A)** —— 全站 ~2900 处 `style={{...}}` 重构是个独立 epic，本期只做「试点 1 个高密度 section + lint guard」证明路径可走。把 [BatchesSection.tsx](apps/web/src/pages/Projects/sections/BatchesSection.tsx)（1070 行 / 17 处 inline style，ROADMAP §B 指定的最高密度切入点）的内部 inline style 全部迁到同目录 [BatchesSection.module.css](apps/web/src/pages/Projects/sections/BatchesSection.module.css)，仅保留 1 处 CSS custom property 注入（3-档动态颜色的逃生口，加 `// eslint-disable-next-line no-restricted-syntax` 标注）；[eslint.config.js](apps/web/eslint.config.js) 加文件级 `no-restricted-syntax` override 禁止 `JSXAttribute[name.name='style']` 防止回潮，后续 epic 把 files 列表逐步扩到全站。不引入第三方 CSS-in-JS（vanilla-extract / panda 推迟评估），仅用 Vite 内置 CSS modules 编译。Button 组件自身仍用 inline style 设 base，外部覆盖类（`.btnSuccess` / `.btnDanger` / `.btnAccent` / `.modeToggleActive` / `.bulkConfirmPrimary`）暂用 `!important` 桥接，待 Button 自身重构后摘掉。**不动 CSP 头** —— 其余 2900+ inline style 未迁，`'unsafe-inline'` 暂留；本期是后续 epic 的脚手架。② **项目复制配置 (Part B)** —— ROADMAP §A「项目模板」的派生形态：之前每次新建项目都得从 0 配 classes / attribute_schema / AI / rendering_config 等；本期落「从已有项目复制配置」一次性流，不建独立 Template 表 / 模板库 UI（推迟到 v0.10.12+ 客户驱动触发）。后端 [`ProjectCreate`](apps/api/app/schemas/project.py) 加可选 `source_project_id: UUID | None`；[POST `/projects`](apps/api/app/api/v1/projects.py) 改用 `model_dump(exclude_unset=True)` 让"未显式给出"与"显式给出默认值"可区分，给 source 兜底 16 个可克隆字段（type_label / type_key / classes / classes_config / attribute_schema / ai_enabled / ai_model / label_config / sampling / maximum_annotations / show_overlap_first / iou_dedup_threshold / box_threshold / text_threshold / text_output_default / rendering_config）；调用者必须对源项目有 view 权限（复用 `assert_project_visible`），不可见时 404 隐藏存在性；JSONB 字段深拷贝避免新项目 mutate 污染源；若源带 `ml_backend_id` 且 caller 未单独指定 `ml_backend_source_id`，自动复用现有 `_clone_backend_to_new_project()` 路径派生 backend；**不复制** datasets / tasks / annotations / members / batches（运行时数据，复制无意义）。前端 [ProjectGrid](apps/web/src/pages/Dashboard/ProjectGrid.tsx) 行操作菜单加「复制项目配置」(icon=copy)，跳 `/dashboard?new=1&from=<id>`；[AdminDashboard / DashboardPage](apps/web/src/pages/Dashboard/) 读 `?from=`，[CreateProjectWizard](apps/web/src/components/projects/CreateProjectWizard.tsx) 加可选 `sourceProjectId` prop，打开时调 `projectsApi.get` 拉源项目 → `buildFormFromSource()` 把 ProjectResponse 还原为 7 步 FormState（含 classes 排序 + AI model 自定义/预设识别 + 名称默认 `{源项目名} (副本)`），复制模式跳过 localStorage 草稿避免污染普通新建路径；顶部加 banner 提示「已用源项目配置预填表单, 提交后将复制到新项目 (不复制数据集 / 任务 / 成员)」。提交时携带 `source_project_id` 让后端兜底 wizard 表单字段之外的字段（label_config / rendering_config / sampling 等）。**不引入**：① 独立 ProjectTemplate 表 / `/templates` endpoint / 模板库 UI；② 复制 datasets / tasks / members / batches；③ 审计日志显式追加 source_project_id 字段（现有 AuditMiddleware 已捕获 POST body，足够）。→ [plan](docs/plans/2026-05-18-v0.10.11-glimmering-diffie.md) · [ROADMAP §A 项目模板](ROADMAP.md) · [ROADMAP §B CSP style-src nonce 收紧](ROADMAP.md).

### Added

- **`BatchesSection.module.css`** ([BatchesSection.module.css](apps/web/src/pages/Projects/sections/BatchesSection.module.css))：43 个语义类（toolbar / viewToggle / banner / table / modalForm / confirmActions 等）+ BEM-like 状态后缀（`.viewToggleButtonActive` 等）+ Button 覆盖类（`!important` 桥）+ 1 个 CSS custom property hatch（`--bulk-confirm-bg`）。
- **`ProjectCreate.source_project_id: UUID | None`** ([schemas/project.py](apps/api/app/schemas/project.py))：可选；给定时后端用源项目兜底未显式给出的字段。
- **`_merge_from_source_project()` + `_CLONEABLE_PROJECT_FIELDS`** ([projects.py](apps/api/app/api/v1/projects.py))：16 字段白名单 + JSONB 深拷贝；运行时数据（id / display_id / status / created_at / total_tasks 等）不在列表内。
- **`CreateProjectWizard.sourceProjectId` prop + `buildFormFromSource()`** ([CreateProjectWizard.tsx](apps/web/src/components/projects/CreateProjectWizard.tsx))：ProjectResponse → FormState 转换；按 `classes_config.order` 排序 classes；AI model 自动判预设/自定义；名称默认带「(副本)」后缀。
- **ProjectGrid「复制项目配置」菜单项** ([ProjectGrid.tsx](apps/web/src/pages/Dashboard/ProjectGrid.tsx))：仅 `canManage(p)` 用户可见（与「项目设置」同 gate）。
- **ESLint `no-restricted-syntax` override**（[eslint.config.js](apps/web/eslint.config.js)）：BatchesSection.tsx 禁止 `style={{...}}`；后续 epic 把 files 列表扩到全站。
- **6 例后端复制单测** ([test_projects_clone.py](apps/api/tests/test_projects_clone.py))：覆盖完整字段克隆 / 显式覆盖优先 / 自动派生 backend / 无 view 权限 404 / 不带 source 回归 / JSONB 深拷贝防污染。

### Changed

- **`POST /projects`** 改用 `model_dump(exclude_unset=True)`（之前 `exclude_none=True`）。**回归校验**：45 个 project 相关测试 + 6 个 ml_backend_binding 测试全过；"未显式给出" 与 "显式给出默认值" 现在可区分，让 source_project_id 兜底语义干净。
- **[`AdminDashboard.tsx`](apps/web/src/pages/Dashboard/AdminDashboard.tsx) / [`DashboardPage.tsx`](apps/web/src/pages/Dashboard/DashboardPage.tsx)**：读 `?from=` 传给 Wizard；关闭 Wizard 时同时 `searchParams.delete("from")`。
- **`ProjectCreatePayload`** ([api/projects.ts](apps/web/src/api/projects.ts))：手动扩 `source_project_id?: string | null`（待 codegen 重跑）。

### Fixed

- **ROADMAP §B `CSP style-src nonce 收紧` 前置**：基建到位（CSS modules 约定 + lint guard + 试点完成），后续 epic 可按 ProjectGrid 重复同样模式扩 sections 群。
- **ROADMAP §A `项目模板`**：「复制项目配置」覆盖 80% 实际需求；客户提「跨项目共享模板库」时再做独立 ProjectTemplate。

### Verified

- `pnpm --filter web typecheck` 全绿（0 错；新 sourceProjectId prop / buildFormFromSource / source_project_id payload 类型全部传通）。
- `pnpm --filter web vitest run` 692 tests 全绿（0 回归；BatchesSection 已有快照/交互测试全过）。
- `pnpm --filter web lint src/pages/Projects/sections/BatchesSection.tsx` 干净（lint guard 验证：故意还原 1 处 inline style 报 `no-restricted-syntax`）。
- `cd apps/api && uv run pytest tests/test_projects_clone.py tests/test_projects_ml_backend_binding.py -k project` → 51 passed（6 新 clone case + 45 既有 project 相关全过）。
- `grep -c "style={{" apps/web/src/pages/Projects/sections/BatchesSection.tsx` → 1（CSS custom property hatch，已 lint-disable 注释标注）。
- 手测（preview）：① 登录 super_admin → 进 [/projects/.../settings?section=batches](#) → BatchesSection 渲染（toolbar / view toggle / 列表 / 状态 badge / 操作按钮颜色）与 0.10.10 完全一致；DOM inspect `h3.className = "_toolbarTitle_xxx"` + `getComputedStyle(h3).fontSize = "14px"` 验证 CSS modules 编译生效；`document.querySelectorAll('section [style]').length = 0` 验证迁移完整。② 跳 `/dashboard?new=1&from=<src_id>` → Wizard 模态打开标题「复制项目配置」+ banner「已用源项目配置预填表单, 提交后将复制到新项目 (不复制数据集 / 任务 / 成员)」+ 名称输入框预填 `2D图片标注测试 (副本)` + step 1-4 字段从源项目拉满。

## [0.10.10] - 2026-05-18

> **0.10.x 收尾：I11 Mask 编辑器 e2e + dirtyRect + 用户文档 + I17.3 项目级渲染配置覆盖.** 把 v0.10.4-v0.10.9 留下的四个尾巴一次发完，0.10.x 系列收口，之后进入 v0.11.0（I1 大图 tile 独立 epic）。① **§3 MaskBuffer dirtyRect 增量重绘**：[maskBuffer.ts](apps/web/src/pages/Workbench/stage/shared/geometry/maskBuffer.ts) 加 `_dirty` 半开矩形私有字段 + `markDirty()` clamp/union + `consumeDirty(): DirtyRect | null` 取走清空 + `toAlphaImageDataRect(rect): Uint8ClampedArray` 切片输出；`brush/erase/fromPolygon/clear` 全部更新内部脏区。[MaskOverlayLayer.tsx](apps/web/src/pages/Workbench/stage/overlays/MaskOverlayLayer.tsx) 改为只 `putImageData` 脏区，首次激活（`seenBufferRef` 切换）走一次全图保证 canvas 与 buffer 初态一致；消除 v0.10.8 「每笔 W×H 全量拷贝」性能债。9 例新单测覆盖 union / consumeDirty / clear=全图 / fromPolygon=bbox / 边界 clamp / 切片字节 / 退化区域返空 / clone 复制脏区。② **§1 I11 Playwright e2e**：新 [`mask-editor.spec.ts`](apps/web/e2e/tests/mask-editor.spec.ts) 三用例（空白 mask→Enter / AI prediction 精修 reject+新 polygon / B-E-Shift+wheel-Esc hotkey）；`_test_seed` 加 `POST /__test/seed/inject-prediction`（LabelStudio 标准 shape）+ [`SeedAPI.injectPrediction`](apps/web/e2e/fixtures/seed.ts) helper 绕过 ml-backend；SAM 候选精修入口需真实 backend 不进 e2e，留单测 `useImageAnnotationActions.test` 分流过。③ **§2 用户文档**：新 [`mask-brush.md`](docs-site/user-guide/for-annotators/mask-brush.md)（since=v0.10.8）—— 三种进入方式（空白 / AI polygon / user polygon / SAM 候选 R 键）、hotkey 速查、已知限制（bbox 不可初始化 / 多连通区只留最大外环 / 不持久化 RLE）+ 故障排查；[index.md](docs-site/user-guide/for-annotators/index.md) 加链入。④ **§5 I17.3 项目级渲染配置覆盖**：alembic 0066 加 `projects.rendering_config JSONB NOT NULL DEFAULT '{}'`；后端 [`ProjectRenderingConfig`](apps/api/app/schemas/_jsonb_types.py) Pydantic 模型（smoothImage/cssImageFilter/controlPointsSize/snapToGrid 全 optional, extra=forbid, controlPointsSize ∈ [2,20], cssImageFilter ≤255 字符），写入 [`ProjectUpdate`](apps/api/app/schemas/project.py) / `ProjectOut`；前端新 [`RenderingConfigSection`](apps/web/src/pages/Projects/sections/RenderingConfigSection.tsx) 子页（每行「覆盖此项」开关 + 控件 + 「跟随用户偏好」回退文案），[`ProjectSettingsPage`](apps/web/src/pages/Projects/ProjectSettingsPage.tsx) sidebar 加「渲染配置」tab（icon=eye，在 ml-backends 与 owner 之间）；[`useWorkbenchConfig`](apps/web/src/pages/Workbench/state/useWorkbenchConfig.ts) 加 `projectRenderingConfig` 可选入参，合并优先级 `DEFAULTS → user.preferences.workbench → project.rendering_config`，返回新增 `lockedFields: LockableField[]`；prop 通过 WorkbenchShell → WorkbenchStageHost → ImageWorkbench → ImageStage 四级透传（ReviewWorkbench 不传 = 默认无项目覆盖）。`apps/web/src/api/projects.ts` 加 `ProjectRenderingConfig` 类型 + `ProjectResponse` / `ProjectUpdatePayload` 手动扩 `rendering_config` 字段（待 codegen 重跑）。⑤ **§4 I8.2 image-bench fixture 矩阵**：新 [`scripts/image-bench/fixtures.json`](apps/web/scripts/image-bench/fixtures.json)（3 size × 3 density = 9 场景）+ [`run-image-bench.mjs`](apps/web/scripts/image-bench/run-image-bench.mjs) orchestrator（镜像 `scripts/video-bench`，写 manifest.json 到 `test-results/image-bench/{runId}/`）+ [`e2e/tests/image-bench-fixtures.spec.ts`](apps/web/e2e/tests/image-bench-fixtures.spec.ts) 按 `IMAGE_BENCH_SIZE` / `IMAGE_BENCH_DENSITY` env 跑单场景读 `window.__workbenchPerf` + `package.json` 加 `image:bench` script + [`docs/benchmarks/image-bench-v0.10.10.json`](docs/benchmarks/image-bench-v0.10.10.json) 基线占位 JSON（待 `_test_seed` 加 `?image_size=` / `?annotation_density=` 入参 + 真实测试图片后回填真数）。⑥ **§6 v0.10.9 收尾**：[`DEV.md`](DEV.md) 加「前端 codegen」章节说明 `apps/web/src/api/generated/` 在 .gitignore、`prebuild` 钩子 `codegen-if-changed.mjs` 自动重生、首次 clone 时 `pnpm --filter web typecheck` 前需手动跑一次 codegen 的开发流程（解释 v0.10.9 AttributeForm 类型未入仓的原因）。**不引入**：① SAM 候选精修 e2e（需真实 ml-backend）；② I17 项目级「lock」语义元数据（本期只做覆盖优先级，前端 `lockedFields` 已就位但未渲染 disabled badge，留 v0.11+）；③ bbox 候选 → mask 初始填充（与 I9 / geometry.kind 同期，留 v0.11+）；④ image-bench 真实图片素材入仓 + `_test_seed` 加 density/size 参（本期落契约 + spec，真数回填留 v0.10.10.1 / v0.11.x）；⑤ lint warnings 清理（126 基线，按计划摘低垂果实未在本 commit 动手，量化降到 < 80 留 v0.10.10.1）。是 v0.10.4 epic / 图片工作台 Wave β + γ 的最后一个收尾发布。→ [plan](docs/plans/2026-05-12-v0.10.10-image-workbench-optim-zany-crab.md) · [ROADMAP](ROADMAP/[archived]2026-05-12-image-workbench-optimization.md) · [ADR-0022](docs/adr/0022-mask-editor-tool-architecture.md).

### Added

- **MaskBuffer dirtyRect** ([maskBuffer.ts](apps/web/src/pages/Workbench/stage/shared/geometry/maskBuffer.ts))：`DirtyRect` 接口（半开 [x0,x1)×[y0,y1)）+ `_dirty` 私有字段 + `consumeDirty(): DirtyRect | null` + `toAlphaImageDataRect(rect): Uint8ClampedArray`；9 例新单测。
- **`_test_seed` · `POST /__test/seed/inject-prediction`** ([_test_seed.py](apps/api/app/api/v1/_test_seed.py))：直插 LabelStudio polygon prediction，e2e 不依赖 ml-backend。
- **`SeedAPI.injectPrediction`** ([e2e/fixtures/seed.ts](apps/web/e2e/fixtures/seed.ts))：前端 e2e helper。
- **`mask-editor.spec.ts`**（apps/web/e2e/tests/）：3 用例（空白 mask 提交 / AI prediction 精修 / hotkey 全集）。
- **`image-bench/fixtures.json` + `run-image-bench.mjs`**（apps/web/scripts/image-bench/）：I8.2 矩阵契约 + orchestrator（镜像 video-bench）。
- **`image-bench-fixtures.spec.ts`**（apps/web/e2e/tests/）：env-driven 单场景执行。
- **`pnpm --filter web image:bench`** script。
- **`docs/benchmarks/image-bench-v0.10.10.json`**：基线占位 JSON（待真数回填）。
- **`Project.rendering_config` JSONB** ([project.py](apps/api/app/db/models/project.py))：alembic 0066，NOT NULL DEFAULT '{}'。
- **`ProjectRenderingConfig` Pydantic 模型** ([_jsonb_types.py](apps/api/app/schemas/_jsonb_types.py))：4 字段全 optional, extra=forbid, controlPointsSize ∈ [2,20], cssImageFilter ≤255 字符。
- **`RenderingConfigSection`** ([RenderingConfigSection.tsx](apps/web/src/pages/Projects/sections/RenderingConfigSection.tsx))：「覆盖此项」开关 + 控件 + 「跟随用户偏好」回退；ProjectSettings 新「渲染配置」tab。
- **`useWorkbenchConfig` · 项目级覆盖 + `lockedFields`** ([useWorkbenchConfig.ts](apps/web/src/pages/Workbench/state/useWorkbenchConfig.ts))：新增可选 `projectRenderingConfig` 入参；返回 `lockedFields: LockableField[]`；3 例新单测。
- **`ProjectRenderingConfig` 前端类型** ([api/projects.ts](apps/web/src/api/projects.ts))：`ProjectResponse` / `ProjectUpdatePayload` 手动扩 `rendering_config` 字段（待 codegen 重跑）。
- **`mask-brush.md` 用户文档** ([docs-site/user-guide/for-annotators/mask-brush.md](docs-site/user-guide/for-annotators/mask-brush.md))：三入口 + hotkey + 已知限制 + 故障排查；[index.md](docs-site/user-guide/for-annotators/index.md) 链入。
- **DEV.md「前端 codegen」章节**：解释 generated 不入仓 + 何时手动跑 codegen。

### Changed

- **`MaskOverlayLayer`** ([MaskOverlayLayer.tsx](apps/web/src/pages/Workbench/stage/overlays/MaskOverlayLayer.tsx))：useEffect 改为消费 `buffer.consumeDirty()` 切片绘制；首次激活（`seenBufferRef` 切换）仍走全图。
- **`ImageStage` / `ImageWorkbench` / `WorkbenchStageHost` / `WorkbenchShell`**：新增 `projectRenderingConfig?: ProjectRenderingConfig | null` prop 四级透传；`WorkbenchShell` 从 `currentProject?.rendering_config ?? null` 取值。
- **`ProjectUpdate` / `ProjectOut`** ([schemas/project.py](apps/api/app/schemas/project.py))：加 `rendering_config: ProjectRenderingConfig | None` / `= ProjectRenderingConfig()`。
- **`ProjectSettingsPage`**：sidebar 加「渲染配置」tab（icon=eye），`SectionKey` union 加 `"rendering"`。

### Fixed

- **v0.10.8 MaskOverlayLayer 全量 putImageData TODO**：见 §3 dirtyRect 增量重绘。
- **v0.10.7 epic「完整 e2e 推迟到 v0.10.7.1 UI 集成时一并跑」**：见 §1 mask-editor.spec.ts。
- **v0.10.9「手测推迟到真实数据」**：本期 e2e 不依赖真实数据（seed.injectPrediction 绕过 ml-backend）。

### Verified

- `pnpm --filter web typecheck` 全绿（0 错；新增四级 prop 透传 + ProjectRenderingConfig 类型 + useWorkbenchConfig 入参全部传通）。
- `pnpm --filter web vitest run` 692 tests 全绿（+9 maskBuffer dirtyRect / +3 useWorkbenchConfig 合并优先级；既有 0 回归）。
- `cd apps/api && uv run pytest tests/test_smoke.py` 6 passed（+1 `test_project_rendering_config_v0_10_10`：合法 / 部分覆盖 / extra=forbid / 范围越界 / 超长 五个校验分支）。
- `pnpm --filter web image:bench --dry-run` 输出 9 场景矩阵正常。
- E2E `mask-editor.spec.ts` 与 `image-bench-fixtures.spec.ts` 待本地 docker compose + dev server + alembic upgrade 全开后人测（与 v0.10.9 节奏相同）。
- 手测：① admin 在 ProjectSettings 「渲染配置」tab 开启 smoothImage 覆盖 = false → annotator 进工作台像素无插值。② 关闭覆盖开关 → annotator 字段恢复跟随用户偏好。

## [0.10.9] - 2026-05-18

> **Mask 编辑器入口补齐 + 笔刷光标可视化.** v0.10.8 留下两个入口缺口（SAM 交互候选 / 已落库 user polygon 均不可精修）和一个体感问题（mask 工具下系统 crosshair 光标看不出笔刷半径与图像的比例）。本期一并补齐：① **SAM 候选精修 (A)**：useImageAnnotationActions 新增 `handleRefineSamCandidate(idx)`，从 `sam.candidates[idx].points`（归一化 [0,1] × imgW/imgH 转像素）启动 mask 编辑；commit 路径调 `sam.consume(samIdx)` 移除原候选 + `submitPolygon` 新建 polygon（label 优先用候选 label，缺省 / 不在 classes 时回退工具栏当前 label）；R 键 hotkey 在 SAM 候选键盘 handler 内 capture 阶段消费（与现有 Tab/Enter/Esc 同模式，走 ref 间接绕过 forward 依赖）；ImageStage 画布上 active polygonlabels 候选附近浮一个 `✎ 精修 R` 按钮，位置贴 polygon 顶点 bbox 右上角。② **user polygon 精修 (B)**：useImageAnnotationActions 新增 `handleRefineUserPolygon(annotationId)`，从 `ann.geometry.points` 启动；commit 路径走 `mutations.update.mutate` 替换 `geometry`（不新建 annotation），同步 `history.push({ kind: "update", before: { geometry }, after: { geometry } })`；BoxListItem 加 `onRefine` 用于 user polygon 行（之前 v0.10.8 仅 AI 行用），按钮图标同 AI 行。`pendingRefineRef` 内部扩成 discriminated union（`prediction` / `sam` / `user`），`commitMaskAsPolygon` 按 kind 分流。③ **笔刷光标可视化 (Cursor)**：mask 工具激活时 container `cursor: "none"`，ImageStage overlay 层挂一个跟随鼠标的 `Konva.Circle`（半径 = `maskEditor.radius` image-space px，stroke 1.5/scale 保持视觉一致），brush 模式红色 / erase 模式灰色，让笔触大小直接相对图像可视；handleStageMouseMove 在 tool === "mask" 时同步 maskCursor 状态。**不引入**：BoxesList 上 AI 行 + user 行精修按钮的二级 confirm（直接进 mask 工具，cancel 时退回原状）、SAM 候选浮按钮的拖动（位置固定在候选 bbox 右上）、user polygon 精修的多选批量（仅单行入口）。这些待 v0.11+ 评估。→ [CHANGELOG 0.10.8](#0108---2026-05-18) · [ROADMAP I11](ROADMAP/[archived]2026-05-12-image-workbench-optimization.md) · [ADR-0022](docs/adr/0022-mask-editor-tool-architecture.md) v0.10.9 段.

### Added

- **`handleRefineSamCandidate(idx)`**（[useImageAnnotationActions.ts](apps/web/src/pages/Workbench/stages/image/useImageAnnotationActions.ts)）：仅 polygonlabels 候选启用；不存在 / bbox 候选 / 顶点 <3 时 toast 提示。
- **`handleRefineUserPolygon(annotationId)`**：从 annotationsRef 取 polygon → initFromPolygon；commit 走 update mutation + history.push update。
- **R 键 hotkey**：在 SAM 候选 keydown handler 内（仅 AI 工具激活 + 候选存在时生效），与 Tab/Enter/Esc 同 capture 路径。
- **ImageStage SAM 精修浮按钮**：`onRefineSamCandidate` 可选 prop；polygon 候选 active 时浮在 bbox 右上角，按钮 hint 显示 `R`。
- **MaskBrushCursor**（ImageStage overlay 层）：跟随鼠标的 Konva.Circle，半径 = maskEditor.radius，brush 红 / erase 灰；container `cursor: "none"` 在 mask 工具下生效。
- **BoxListItem 单测**：v0.10.9 新增 2 例（AI 行 + user polygon 行各 1 例 onRefine 渲染 + 点击回调）。

### Changed

- **`useImageAnnotationActions`**：`pendingRefineRef` 类型扩为 `{ kind: "prediction" | "sam" | "user", ... }`；commit 路径按 kind 分流（user → update / 其余 → submitPolygon）；抽出 `initMaskFromNormalizedPoints(norm)` 内部工具，三个 refine 入口共用。
- **`ImageStage.tsx`**：DragInit 之外加 `maskCursor` 状态 + Konva.Circle 渲染；container `cursor: "mask" → "none"`；props 加 `onRefineSamCandidate`；handleStageMouseMove 维护 maskCursor。
- **`ImageWorkbench` / `WorkbenchStageHost`**：props 加 `onRefineSamCandidate`，单点透传。
- **`AIInspectorPanel` / `BoxesList`**：props 加 `onRefineUserPolygon`，user 行 + `geometry?.type === "polygon"` 时把 `onRefine` 绑给 `BoxListItem`。
- **`BoxListItem`**：user 分支（`!isAi`）也渲染 `onRefine` 按钮（图标 `edit`），`data-testid="user-refine-{id}"`。
- **`WorkbenchShell`**：解构 `handleRefineSamCandidate` / `handleRefineUserPolygon`，分别绑给 `stageHost.onRefineSamCandidate` / `inspector.onRefineUserPolygon`。

### Fixed

- **预存：`AttributeForm.mutable` 类型缺字段**（v0.10.6 M4-γ I13.2 遗留）：跑 `pnpm --filter web codegen` 重生 `apps/web/src/api/generated/types.gen.ts`，`AttributeField.mutable?: boolean | null` 已写入；本次 commit 不入 generated（.gitignore），文档说明开发者本地 codegen 一次即可。

### Verified

- `pnpm --filter web typecheck` 全绿（0 错；之前预存的 3 处 AttributeForm 错误本次随 codegen 消除）。
- `pnpm --filter web lint` 0 errors / 126 warnings（warnings 全部预存）。
- `pnpm --filter web test --run` 92 test files / 679 tests 全绿（+2 BoxListItem onRefine 回归）。
- 手测脚本（推迟到真实数据）：① smart-point 工具点图像出 polygon SAM 候选 → 不按 Enter，按 R 或点画布上的「精修」按钮 → mask 编辑 → 涂改 → Enter 提交 → 候选消失 + 新 polygon 入库。② 选中已落库 polygon，右侧侧栏 polygon 行的「精修」按钮 → mask 编辑 → 涂改 → Enter → 原 polygon 几何被 update 替换（history 可 undo 回原 geometry）。③ mask 工具下鼠标移动 → 圆圈跟随，Shift+滚轮调半径，圆圈大小随 radius 变化。

## [0.10.8] - 2026-05-18

> **Mask 编辑器 UI 集成（M4-δ 收尾）.** 把 v0.10.7 / v0.10.7.1 的算法核 + 状态层接到 Konva 渲染层、ToolDock、AI 候选「精修」入口、笔刷 hotkey，完成 I11 v1 端到端可用闭环：① 新增 `MaskTool`（`hotkey="M"`、`onPointerDown` 在空白态自动 `beginBlank` 并返回 `maskBrush` DragInit）、`MaskOverlayLayer`（单 `Konva.Image` 节点 + 内部 `HTMLCanvasElement`，由 `useMaskEditor.revision` 触发 `putImageData`，半透红 `rgba(220,38,38,0.45)`）、`MaskToolbar`（stage 顶部浮条：半径 slider/B·E chips/确认·取消/dirty 指示）；② ImageStage `DragInit` union 加 `maskBrush`，pointermove 线段插值（步长 = radius/2）连续 `paintAt`，pointerup 不 commit；wheel handler 加 Shift+滚轮调半径分支（±2px, clamp [1,200], 仅 deltaY 主导时响应避免 trackpad 横向滚动误触）；③ 工具注册：`TOOL_REGISTRY.mask` / `ALL_TOOLS` / ToolDock `TOOL_DESCRIPTORS` / `useWorkbenchState.Tool` union / AIToolDrawer `TOOL_HINT` / `AIInspectorPanel.AIPredictionPopover.tool` union 全部加 `"mask"`；④ `useImageAnnotationActions` 新增 `handleRefinePrediction` (polygon 候选 → 像素坐标 → `initFromPolygon` + `setTool("mask")` + 缓存 `pendingRefineRef`) 与 `commitMaskAsPolygon` (commit → 像素坐标转归一化 → 客户端 reject 原候选 + 临时切候选 label + `submitPolygon`，空 mask 提示，多连通区警告，成功后 `cancel + setTool("box")`)；⑤ `useWorkbenchHotkeys` 加 mask 工具上下文 useEffect（capture 阶段抢 B/E/Enter/Esc，先于主 dispatchKey），`hotkeys.ts` HOTKEYS 表 + `setTool` action union + `RESERVED_LETTERS` 全部加 `M`，主 dispatchKey 加 `m/M → setTool("mask")`；⑥ `BoxListItem` AI 行 + polygon 几何时显示「精修」按钮（icon=edit），经 `BoxesList` → `AIInspectorPanel` → `WorkbenchShell` 透传到 `imageActions.handleRefinePrediction`；⑦ WorkbenchShell 实例化 `useMaskEditor({ width: imgW, height: imgH })`，把 `maskEditor` 注入 `useImageAnnotationActions` / `useWorkbenchHotkeys` / `WorkbenchStageHost.stageHost` → `ImageWorkbench` → `ImageStage` / overlays 中的 `MaskToolbar`。**不引入**：bbox 候选 → mask 初始填充（v0.11+ 与 I9 一起做 geometry.kind 收口）、RLE schema、mask 多组件入库（仅落最大外环，多连通 toast 提示）、dirtyRect 增量重绘（首期全量 putImageData，留 TODO）、mask 跨任务持久化。是 v0.10.4 epic / I11 的 UI 集成收尾。→ [plan](docs/plans/2026-05-12-v0.10.8-image-workbench-optim-effervescent-dijkstra.md) · [roadmap I11](ROADMAP/[archived]2026-05-12-image-workbench-optimization.md) · [ADR-0022](docs/adr/0022-mask-editor-tool-architecture.md).

### Added

- **MaskTool** ([MaskTool.ts](apps/web/src/pages/Workbench/stage/tools/MaskTool.ts))：`CanvasTool`，`id="mask"`, `hotkey="M"`, `cursor="crosshair"`；`onPointerDown` 在 `!active` 时 `beginBlank()`，立即 `paintAt(pt.x*imgW, pt.y*imgH)`，返回 `{ kind: "maskBrush", lastX, lastY }`。4 例单测（readOnly / 无 editor / 空白 → beginBlank+paintAt / 已激活 → 直接 paintAt）。
- **MaskOverlayLayer** ([MaskOverlayLayer.tsx](apps/web/src/pages/Workbench/stage/overlays/MaskOverlayLayer.tsx))：单 `Konva.Image` 绑定内部 canvas；`revision` 变更时 `buffer.toAlphaImageData()` → 染红 → `createImageData` + `putImageData` + `layer.batchDraw()`。仅 active 时挂载在 user 层之上。
- **MaskToolbar** ([MaskToolbar.tsx](apps/web/src/pages/Workbench/shell/MaskToolbar.tsx))：stage 顶部居中浮条：半径 slider [1,200]、笔刷/橡皮 chips、确认/取消按钮、dirty 与「Shift+滚轮调半径」提示；仅 `tool === "mask"` 显示。
- **`useImageAnnotationActions` · `handleRefinePrediction` / `commitMaskAsPolygon` / `cancelMaskEdit`**：精修流程 (polygon 候选 → mask 编辑 → 自动 reject 原候选 + 新 polygon 用候选 label)；空白流程 (空白 mask 编辑 → polygon 用工具栏当前 label)；多连通区时 toast 警告。
- **`useWorkbenchHotkeys` · mask 工具专用 keydown 块**：tool === "mask" 且 maskEditor 注入时，capture 阶段抢 `B` (setMode brush) / `E` (setMode erase) / `Enter` (commitMaskAsPolygon) / `Esc` (cancelMaskEdit)，先于主 dispatchKey；与 polygon 工具的专用键体系并列。
- **hotkeys.ts HOTKEYS 表新增**：`M / Shift+wheel / B-mask / E-mask / Enter-mask`，便于 HotkeyCheatSheet 展示。
- **`BoxListItem.onRefine` 可选 prop + 精修按钮**（[BoxListItem.tsx](apps/web/src/pages/Workbench/stage/BoxListItem.tsx)）：AI 行 + polygon 几何时显示 `edit` 图标按钮。

### Changed

- **`useMaskEditor`**：把内部 `setRev` 的值通过 `revision: number` 暴露到返回，MaskOverlayLayer 可作为 React 依赖触发重画；buffer 引用本身不变也能正确刷新。单测加 1 例 revision 回归。
- **`ImageStage.tsx`**：DragInit union 加 `maskBrush`；pointermove 加 maskBrush 分支（线段插值 paintAt）；pointerup 不 commit maskBrush；wheel 加 Shift 分支调半径；user 层后挂 `<MaskOverlayLayer>`；container cursor 加 `tool === "mask" → crosshair`；`ToolPointerContext` 加 `maskEditor` 字段并在 handleStageMouseDown 透传。
- **工具注册**：`tools/index.ts` `ToolId` 加 `"mask"`；`TOOL_REGISTRY.mask = MaskTool`；`ALL_TOOLS` 在 PolygonTool 后插入 MaskTool。`useWorkbenchState.Tool` union 与 `AIInspectorPanel.AIPredictionPopover.tool` union 同步加 `"mask"`；`AIToolDrawer.TOOL_HINT` 加 `mask: null`。
- **`ToolDock.tsx`**：`TOOL_DESCRIPTORS.mask` 描述「Mask 笔刷 · B/E 切模式, Shift+滚轮调半径, Enter 提交」。
- **`AIInspectorPanel`**：`AIInspectorPanelProps` / `BoxesListProps` 加 `onRefinePrediction` 可选 prop，逐层透传；AI 行 + `geometry?.type === "polygon"` 时把 `onRefine` 绑给 `BoxListItem`。
- **`WorkbenchShell`**：实例化 `useMaskEditor({ width: stageGeom.imgW||1, height: stageGeom.imgH||1 })`；注入 `useImageAnnotationActions` (新 `maskEditor` arg) / `useWorkbenchHotkeys` (新 `maskEditor`/`commitMaskAsPolygon`/`cancelMaskEdit` args) / `WorkbenchStageHost.stageHost.maskEditor`；overlays 包裹 `<MaskToolbar>` (tool === "mask" 时) + 原 `<WorkbenchOverlays>`；inspector 的 `onRefinePrediction` 绑到 `imageActions.handleRefinePrediction`。
- **`WorkbenchStageHost` / `ImageWorkbench`**：props 加 `maskEditor`，单点透传到 `ImageStage`。
- **`hotkeys.ts`**：`HotkeyAction.setTool.tool` union 加 `"mask"`；`RESERVED_LETTERS` 加 `m/M`；主 dispatchKey 加 `e.key === "m"/"M" → setTool("mask")` 单键路由（在 polygon 之后）。

### Verified

- `pnpm --filter web typecheck` 全绿（本次 0 新错；遗留 3 处 `AttributeForm.mutable` 为 v0.10.6 预存，与本期无关）。
- `pnpm --filter web lint` 0 errors / 126 warnings（warnings 全部预存，未新增）。
- `pnpm --filter web test --run` 92 test files / 677 tests 全绿（新增 +4 MaskTool 例 + 1 useMaskEditor revision 回归）。
- 浏览器手测推迟到引入有 polygon AI 候选的真实数据后单独跑（本期算法层 + 状态层 + UI 集成的纯单测 + typecheck 已覆盖回归面）。

### Notes

- 半径单位是图像像素，半透红色 `rgba(220,38,38,0.45)` 在浅底图清晰，深色底图考虑后续加 1px 白色外描边。
- 「自动 reject 原候选」采用客户端 `dismissedShapeKeys` 集合 (与原 `handleRejectPrediction` 同路径)，prediction 实体仍在服务端；submitPolygon 失败时 dismissed 已写入但 prediction 不入库 — 用户重新进入任务时原候选仍会回归，符合「重做需手动驳回新候选」语义。
- Konva.Image 大画布（>4K）每笔全量 `putImageData` 可能掉帧；本期不做 dirtyRect 增量，留 v0.11+ MaskBuffer 暴露脏矩形再优化。

## [0.10.7.1] - 2026-05-15

> **Mask 编辑器状态层（M4-δ 后续）.** 把 v0.10.7 落地的 `MaskBuffer` / `maskToPolygon` 算法核组装成 `useMaskEditor` 状态 hook（[useMaskEditor.ts](apps/web/src/pages/Workbench/state/useMaskEditor.ts)）：维护 buffer 引用（useRef，paintAt 每笔不 rerender）+ active / mode (`brush`|`erase`) / radius (clamp 到 1-200px) / dirty (改过 buffer 没 commit 时 true) 状态，暴露 `beginBlank` / `initFromPolygon` (AI 候选精修入口) / `paintAt(x,y)` (按 mode + radius 调 brush/erase) / `setMode` / `setRadius` (clamp) / `cancel` / `commitToPolygon`（空 mask 返 null；非空走 maskToPolygon → 外环顶点）。状态层独立可单测，为 v0.10.7.2 / v0.11.0 的 Konva 集成 / ToolDock 按钮 / AIPredictionPopover「精修」入口 / 笔刷 hotkey 铺路。

### Added

- **`useMaskEditor`** ([useMaskEditor.ts](apps/web/src/pages/Workbench/state/useMaskEditor.ts))：mask 编辑器状态 hook + 12 例单测覆盖初始态 / radius clamp（含 NaN）/ beginBlank / initFromPolygon / paintAt brush 留圆 + erase 抹掉 + 非 active 静默 / cancel 清空 / commitToPolygon 空返 null + 有内容返外环顶点 + 非 active 返 null。
- **`MASK_BRUSH_MIN_PX` / `MAX_PX` / `DEFAULT_PX`**：1 / 200 / 16，与 ADR-0022 笔刷参数对齐。

### Notes

- 本期不含：Konva 渲染层（MaskCanvasOverlay）、ImageStage `maskBrush` DragInit 派发、ToolDock 按钮、AIPredictionPopover「精修」入口、B/E/Shift+滚轮/Esc/Enter hotkey。这些 UI 集成留到 v0.10.7.2 / v0.11.0。理由同 v0.10.7：UI 集成高耦合 + 高视觉验证成本，独立子版本里跑完整 e2e 更稳。
- 与 useDirtyTracker (v0.10.6) 协同：mask 编辑「一笔不入 history、松手前累计 flush 一次」语义可由 `useDirtyTracker.flush` 承载；commitToPolygon 入口由调用方决定何时触发 flush。

## [0.10.7] - 2026-05-15

> **Mask 编辑器 v1 算法核 + v0.10.4 epic 收尾 (M4-δ).** ROADMAP/[archived]2026-05-12-image-workbench-optimization.md 的 I11 算法核落地（UI 集成留 v0.10.7.1 / v0.11.0）：① 新增数据层 `stage/shared/geometry/maskBuffer.ts` —— 纯 TS 单通道 `Uint8Array` alpha 缓冲，brush / erase / clear / fromPolygon (扫描线填充) / toAlphaImageData / clone，半径 1-200px 单笔 ≤ 125k 像素操作；② 新增算法层 `stage/shared/geometry/maskToPolygon.ts` —— flood-fill 找连通分量 + Moore-Neighborhood 8-邻轮廓追踪 + `polygon-clipping@0.15.7` union 去自相交 / 平滑锯齿 + 复用 `simplifyPolygon` RDP 压缩，多连通时取最大面积外环 + `multipleComponents=true` 上抛 UI；③ ADR-0021 polygon LOD + 空间索引（I2 决策回填）+ ADR-0022 mask editor architecture（不引入 RLE schema 的 v1 决策）。**不引入** 浏览器 OffscreenCanvas API（jsdom / SSR / preview 也能跑）、d3-contour（包体 ~30KB 不划算）、RLE mask schema（留 v0.11+ 与 I9 / I10 一并做 geometry.kind 统一）。是 v0.10.4 epic 的第 4/4 子版本兼 epic 收尾。→ [plan](docs/plans/2026-05-15-v0.10.7-mask-editor-v1.md) · [epic](docs/plans/2026-05-14-image-workbench-wave-beta-gamma-epic.md) · [roadmap](ROADMAP/[archived]2026-05-12-image-workbench-optimization.md) · [ADR-0021](docs/adr/0021-polygon-lod-and-spatial-index.md) · [ADR-0022](docs/adr/0022-mask-editor-tool-architecture.md).

### Added

- **`MaskBuffer`** ([maskBuffer.ts](apps/web/src/pages/Workbench/stage/shared/geometry/maskBuffer.ts))：纯 TS alpha 缓冲（Uint8Array W*H，0/255 二值），`brush(cx, cy, r, value)` 圆栅格化双循环 + bbox 裁剪，`erase` = `brush(0)` 糖，`clear` 全清零，`fromPolygon` 扫描线 + 射线投票（与 canvas2d fill 等价），`toAlphaImageData` 输出 RGBA 缓冲（仅 A 通道），`clone` 深拷贝。12 例单测覆盖构造异常 / 圆笔刷面积近似 π·r² / 越界裁剪 / erase 抹掉 / 矩形 polygon / 三角形 polygon / 顶点 < 3 静默 / polygon 越界裁剪 / RGB 通道为 0 / clone 独立。
- **`maskToPolygon`** ([maskToPolygon.ts](apps/web/src/pages/Workbench/stage/shared/geometry/maskToPolygon.ts))：marching-squares + Moore-Neighborhood tracing 主流程：flood-fill `findComponents` → 选最大分量 → `traceBoundary` 8-邻顺时针绕一圈 → `polygon-clipping.union([poly])` 去自相交 / 平滑锯齿 → `simplifyPolygon`（RDP，epsilon 默认 1px）压顶点 → 去连续重复点。7 例单测覆盖空 mask / 矩形 / 圆形（RDP 起效，顶点数 << 周长）/ 多连通取大丢小 / 顶点无重复 / threshold 阈值控制 / epsilon=0 跳过简化。
- **ADR-0021** ([0021-polygon-lod-and-spatial-index.md](docs/adr/0021-polygon-lod-and-spatial-index.md))：I2 决策回填（v0.10.4 实际落地）—— Douglas-Peucker LOD + O(n) 增量自相交 + rbush 顶点视口粗筛 + commit 路径复查 no-op；候选方案 B（远视距 bbox fallback）/ C（WebGL 自渲染）拒绝理由。
- **ADR-0022** ([0022-mask-editor-tool-architecture.md](docs/adr/0022-mask-editor-tool-architecture.md))：I11 v1 决策 —— 离屏 alpha 缓冲 + marching-squares + 不引入 RLE schema；候选方案 B（直接做 RLE schema 升级）/ C（d3-contour）拒绝理由；v0.10.7.1 / v0.11.0 后续 UI 集成清单。

### Changed

- **ROADMAP I11 描述更新**：从「待开发」改为「算法核 ✅ v0.10.7 / UI 集成 🚧 v0.10.7.1」，并列出后续待补条目（MaskTool / ToolDock / AIPredictionPopover / hotkey）。
- **epic 计划文件**：[2026-05-14-image-workbench-wave-beta-gamma-epic.md](docs/plans/2026-05-14-image-workbench-wave-beta-gamma-epic.md) 表格 v0.10.7 行改为「✅ 算法核已发布」，「跨 sub-milestone 收尾」节列出 v0.10.7 实际收尾动作（CHANGELOG / ROADMAP / ADR 完成；e2e 推迟）。

### Verified

- vitest 全量 90 test files / 661 tests 全绿（+19 新例：MaskBuffer 12 + maskToPolygon 7）；
- `pnpm --filter web typecheck` 全绿；`pnpm --filter web lint` 0 errors / 125 warnings（warnings 全部预存，未新增）；
- 浏览器手测 / e2e 推迟到 v0.10.7.1 UI 集成时一并做（本期纯算法核，无 UI 副作用面）。

### Notes

- **范围裁剪说明**：plan 原文写 Konva `stage/tools/MaskTool.tsx` + `MaskCanvas.tsx` + AIPredictionPopover「精修」+ ToolDock 入口 + B/E/Shift+滚轮/Esc/Enter 笔刷 hotkey；本期裁到「算法核单测稳住」+ ADR 决策固化，UI 集成推迟到 v0.10.7.1 / v0.11.0。理由：UI 集成是高耦合 / 高视觉验证成本的工作，独立子版本里跑完整 e2e 更稳；算法核纯 TS 可单测，可以独立稳住。
- **v0.10.4 epic 收尾**：本版是 v0.10.4 epic（图片工作台 Wave β + γ I11/I13/I15）的第 4/4 子版本。epic 全程 4 个子版本（v0.10.4 polygon LOD + SAM 缓存 / v0.10.5 形状元数据 / v0.10.6 attribute mutable / v0.10.7 mask 算法核）。后续 v0.11+ 接 I1 大图 tile 金字塔独立 epic + I9 / I10 / I11 v2 一并做 geometry.kind 收口。
- **协同**：mask 编辑器笔刷的「一笔不入 history、松手前累计 flush 一次」路径预计复用 v0.10.6 落地的 `useDirtyTracker.flush`。

## [0.10.6] - 2026-05-15

> **Attribute mutable/immutable + useDirtyTracker 首次消费 (M4-γ).** ROADMAP/[archived]2026-05-12-image-workbench-optimization.md 的 I13.2 + I16 落地：① schemas `AttributeField` 加 `mutable: bool` 字段（默认 None / 向后兼容，仅视频任务消费），class_definitions 仍 JSONB 无需 alembic；② schemas `VideoTrackKeyframe` 加 `attributes: dict | None` 字段，承载 mutable 属性的逐帧 override（不污染 track 默认 attributes），video_track geometry 也是 JSONB 同样无需 alembic；③ 前端 `AttributeForm` 接受 `context: "image" | "video"` prop，`context=video` 下 mutable 字段渲染「逐帧」徽标，`context=image` 维持忽略（向后兼容）；④ `useDirtyTracker` 补 `flush(id, commit)` API：commit 同步抛或 Promise reject 自动回滚 dirty；`AttributeForm` 作为首位消费者，接收 `dirtyTracker` + `annotationId` 时旁路 400ms debounce，改为「输入标 dirty / blur 出 form 一次 flush」节奏（避免逐字段请求风暴）。是 v0.10.4 epic 的第 3/4 子版本。→ [plan](docs/plans/2026-05-15-v0.10.6-attribute-mutability.md) · [epic](docs/plans/2026-05-14-image-workbench-wave-beta-gamma-epic.md) · [roadmap](ROADMAP/[archived]2026-05-12-image-workbench-optimization.md).

### Added

- **`AttributeField.mutable`** ([_jsonb_types.py](apps/api/app/schemas/_jsonb_types.py))：可选 bool（默认 None），表达 CVAT 风格 mutable / immutable 二分。仅视频任务消费；图片任务忽略。
- **`VideoTrackKeyframe.attributes`** ([_jsonb_types.py](apps/api/app/schemas/_jsonb_types.py))：可选 `dict[str, Any]`，承载该帧上 mutable 属性的 override；为 None 时该帧 fallback 到 annotation.attributes（track 默认值）。
- **`AttributeForm` context + dirtyTracker 接入** ([AttributeForm.tsx](apps/web/src/pages/Workbench/shell/AttributeForm.tsx))：新增 `context: "image" | "video"` + 可选 `dirtyTracker` / `annotationId` props。video 模式下 mutable 字段加「逐帧」徽标；传 dirty tracker 时旁路防抖、blur form 一次 flush。
- **`useDirtyTracker.flush(id, commit)`** ([useDirtyTracker.ts](apps/web/src/pages/Workbench/state/useDirtyTracker.ts))：取脏字段、先清空再 commit；commit 同步异常或 Promise reject 自动 markDirty 回滚，下次 flush 重试。9 个新单测覆盖累积去重 / 同步 commit / 异步 reject 回滚 / 同步抛 throw 回滚 / subscribe 通知 / 跨 annotation 隔离。
- **`AttributeForm.test.tsx`**（新增）：4 例覆盖 video 下 mutable 徽标可见 / image 下被忽略 / dirtyTracker 模式 blur flush / 无 tracker 时维持 400ms debounce。
- **pytest 4 例** ([test_jsonb_strong_types.py](apps/api/tests/test_jsonb_strong_types.py))：mutable 默认 None、AttributeSchema 混合 mutable/immutable、VideoTrackKeyframe.attributes 可选、完整 VideoTrackGeometry with override。

### Changed

- **`openapi.snapshot.json` + `docs-site/api/openapi.json`**：codegen 重新生成；前端 `apps/web/src/api/generated/types.gen.ts` 同步包含 `AttributeField.mutable?` 与 `VideoTrackKeyframe.attributes?`。
- **`useDirtyTracker` 注释**：从「无消费者占位」更新为「首位消费者 = AttributeForm」，并补出 flush API 文档与回滚保证。

### Verified

- pytest `test_jsonb_strong_types.py` 26/26 + `test_attribute_audit.py` 1/1 全绿（4 个新例）。
- vitest 全量 642/642 全绿（13 个新例：useDirtyTracker 9 + AttributeForm 4）。
- `pnpm --filter web typecheck` 全绿；`pnpm --filter web lint` 0 errors / 125 warnings（warnings 全部预存，未新增）。
- 浏览器烟囱推迟到 v0.10.7 epic 收尾时与 mask 编辑器一起 e2e 验。

### Notes

- 范围裁剪说明：plan 提到的 VideoTrackPanel 「track 默认 / 当前帧覆盖」表格留待 v0.10.6.1 或 v0.10.7 一起做（当前 `pages/Workbench/stage/VideoTrackPanel.tsx` 无 attribute 集成入口，引入会牵动视频工作台 UI 较多面积）。本期先把后端 schema 与前端基础设施稳住，等真有调用方再补 UI 表格。
- M4-δ (v0.10.7) 衔接：mask 编辑器笔刷的「一笔不入 history、松手前累计 flush 一次」路径可直接复用 `useDirtyTracker.flush`。
- v0.7.6 起 attribute schema 框架（6 种 input_type / 必填 / 条件级联 / AttributeForm 自动渲染）已完整；本期只补 I13.2 残留，I13.1/I13.3/I13.4 不再动。

## [0.10.5] - 2026-05-15

> **图片工作台形状元数据一等态 (M4-β).** ROADMAP/[archived]2026-05-12-image-workbench-optimization.md 的 I15 落地：annotation 表加 4 个状态位 (`z_order` / `is_locked` / `is_hidden` / `is_occluded`)，从前端 transient → DB 持久化；KonvaBox/KonvaPolygon 按 flag 调渲染 (hidden 跳过 / locked 禁拖 / occluded 虚线+半透)；annotation 列表按 z_order ASC 排序高 z_order 后渲染 (在上)；右栏卡片新增 3 个 toggle icon (隐藏 / 锁 / 遮挡)；快捷键 `L`/`H`/`O` 切对应 flag，`[`/`]` 选中态调 z_order ±1（无选中维持原 threshold ±0.05）。前端工具栏在锁定时不进入编辑态；PATCH 走现有字段级路径无需新端点。是 v0.10.4 epic 的第 2/4 子版本。→ [plan](docs/plans/2026-05-15-v0.10.5-shape-metadata.md) · [epic](docs/plans/2026-05-14-image-workbench-wave-beta-gamma-epic.md) · [roadmap](ROADMAP/[archived]2026-05-12-image-workbench-optimization.md).

### Added

- **alembic 0065** ([0065_annotation_shape_metadata.py](apps/api/alembic/versions/0065_annotation_shape_metadata.py))：annotations 表加 `z_order int default 0` + `is_locked` / `is_hidden` / `is_occluded` 三个 bool default false，全部 not null。
- **Annotation 模型 + Pydantic schema 透出**：[annotation.py:model](apps/api/app/db/models/annotation.py) 新增 4 mapped_column；[annotation.py:schema](apps/api/app/schemas/annotation.py) `AnnotationOut` 直传 + `AnnotationUpdate` 接受 partial PATCH；service.update 加 4 kwargs。3 个 pytest 覆盖默认值 / 全量 PATCH / 单字段 partial。
- **`handlePatchShapeFlag`** ([useWorkbenchAnnotationActions.ts](apps/web/src/pages/Workbench/state/useWorkbenchAnnotationActions.ts))：字段级 PATCH 入口，复用现有 `mutations.update` + `history.push` + 离线 enqueue 兜底；写入 `update` 历史 kind 支持撤销重做。
- **BoxListItem toggle icons** ([BoxListItem.tsx](apps/web/src/pages/Workbench/stage/BoxListItem.tsx))：用户态卡片新增 3 个 icon 按钮 (eye/eyeOff、lock/unlock、circleDot for occluded)，title 含快捷键提示；处于 active 状态时不透明，否则 55% 透明。
- **快捷键 L / H / O / `[` / `]`** ([hotkeys.ts](apps/web/src/pages/Workbench/state/hotkeys.ts) + [useWorkbenchHotkeys.ts](apps/web/src/pages/Workbench/state/useWorkbenchHotkeys.ts))：新增 HotkeyAction `toggleShapeFlag` / `bumpZOrder`；选中态时 `[`/`]` 改调 z_order ±1（无选中维持 thresholdAdjust）；L/H/O 切 lock/hidden/occluded（无选中 → 不消费，避开 setClassByLetter 抢键）。HotkeyCheatSheet 表同步。8 个新单测覆盖 dispatcher 分支。

### Changed

- **`ImageStage` 渲染 pipeline**：新增 `visibleSortedUserBoxes` memo：filter `!is_hidden` + sort by `z_order` ASC (tie-breaker = 原数组顺序)，user 层 `.map` 改走它。
- **`KonvaBox` / `KonvaPolygon`**：新增 `occluded` prop，true 时 stroke 走 `dash=[4,3]/scale` + `opacity=0.5`；与 `selfIntersect` 的红色虚线视觉互斥（selfIntersect 优先）。
- **`ImageStage` 编辑态门控**：`isPrimarySingleSelect` 与 `editable` 在 `is_locked` 时为 false → 不显示 resize/move/vertex handle；polygon 同步。
- **`useInteractiveAI.warmup`**：保持 v0.10.4 行为，与 M4-β 无关。
- **`AnnotationUpdatePayload`** ([api/tasks.ts](apps/web/src/api/tasks.ts)) + **`Annotation` / `AnnotationResponse`** ([types/index.ts](apps/web/src/types/index.ts))：补 4 个新字段。`annotationToBox` transform 默认回落 0 / false 保持向后兼容。

### Verified

- pytest `test_annotation_shape_metadata.py`：3/3 通过；alembic 0065 在本地 + 测试 DB 都已 upgrade。
- vitest 触及域回归：`hotkeys.test.ts` 56 例 + `BoxListItem.test.tsx` + `useAnnotationHistory.hook.test.ts` 全绿。
- `pnpm --filter web typecheck` + `lint` 全绿（warnings 全部预存）。
- 浏览器烟囱：anno 登录 → 进入图片工作台 → 点 BoxListItem 锁定按钮 → DB 字段 `is_locked=true, version=2`，按钮文案翻转为「解锁」；撤回到 false 验证可逆。

### Notes

- 后端 PATCH 路径已字段级（`data.model_dump(exclude_unset=True)`），无需改 tasks.py 端点，新字段自动透传。
- 旧记录的默认值由 alembic server_default 兜底（z_order=0 / false×3），前端 transform 再叠一层归零保险。
- M4-γ (v0.10.6) 衔接：Attribute mutable/immutable + useDirtyTracker 首次消费。

## [0.10.4] - 2026-05-14

> **图片工作台 Wave β · polygon 性能闭环 + SAM 前端缓存 (M4-α).** ROADMAP/[archived]2026-05-12-image-workbench-optimization.md 的 Wave β 起步落地：① I2.1 KonvaPolygon 渲染层 Douglas-Peucker LOD（编辑/选中态用原顶点，其它按 viewport scale 简化到 1px 视觉等价）；② I2.2 自相交检测分两档：拖顶点中 O(n) 增量（仅检受影响两条边），静态 / 加载时 O(n²) 全量兜底；③ I2.3 扩展现有 `rbush` 索引到 polygon 顶点，编辑态视口外顶点不渲染 Konva Circle 句柄（500-顶点 polygon 视口内 ~20 个时节点数 -95%）；④ I6.1 SAM 候选前端 LRU 缓存（32 项，key 含 `taskId|backend|ctxKind|normalize(ctx)`，浮点 4 位小数 round 防抖动），切 backend 时 clearAll；⑤ I6.2 工作台 mount 时 dummy point @ image center 静默触发 backend embed 预热，每 (task, backend) 一次。同步把 roadmap I20/I13/I14/I15/I16/I2/I6 文案校准到 v0.9.41+v0.10.3 现状。→ [plan](docs/plans/2026-05-14-v0.10.4-polygon-lod-sam-cache.md) · [epic](docs/plans/2026-05-14-image-workbench-wave-beta-gamma-epic.md) · [roadmap](ROADMAP/[archived]2026-05-12-image-workbench-optimization.md).

### Added

- **`stage/shared/geometry/simplify.ts`** (I2.1): Douglas-Peucker 闭合多边形版（拆段 RDP 合并避免环裂开）+ `epsilonForScale` 工具。7 个单测覆盖近共线剔除 / 偏离保留 / ≥3 顶点保底 / 200-顶点 circle massive reduction。
- **`isSelfIntersectingIncremental(points, changedIdx)`** ([polygon.ts](apps/web/src/pages/Workbench/stage/shared/geometry/polygon.ts)) (I2.2): O(n) 只检查与变更顶点相邻的两条边 vs 其它非相邻边；ImageStage 顶点拖拽中（`drag.kind === "polyVertex"`）走增量版，静态走全量。5 个单测覆盖。
- **`buildVertexIndex(points)`** ([iou-index.ts](apps/web/src/pages/Workbench/stage/iou-index.ts)) (I2.3): 单 polygon 顶点 rbush 索引；`KonvaPolygon` 新增 `viewportBBox` prop，编辑态 + 顶点 ≥60 时按视口粗筛顶点 / 边句柄。`ImageStage` 计算归一化视口 bbox 传入。4 个单测覆盖。
- **`useSamCache`** ([useSamCache.ts](apps/web/src/pages/Workbench/state/useSamCache.ts)) (I6.1): LRU 32 项 + `makeSamCacheKey`（坐标 4 位小数 round 防抖动 + key 排序后 JSON 稳定）+ `clearAll()`；`useInteractiveAI.dispatch` 命中直接 setCandidates 跳 HTTP，非空结果回写缓存，切 `mlBackendId` 时清空。10 个单测覆盖。
- **`useInteractiveAI.warmup()`** (I6.2): 每 (taskId, backendId) 一次，发图中心 dummy point 静默触发 backend embedding 加载；返回值写入 cache，下次真实点击命中。失败静默（sam3 exemplar-only 等）。`WorkbenchShell` 在 image 工作台 + 已绑 backend 时自动调用。
- **E2E 烟囱测占位** (`e2e/tests/workbench-perf.spec.ts`): 断言 `window.__workbenchPerf` 在 image 工作台 mount 后存在。完整 3×3 fixture（2K/8K/dense × 10/100/500 shapes）推迟到 v0.10.5（需后端 `_test_seed` 加 density 参数）。

### Changed

- **ROADMAP/[archived]2026-05-12-image-workbench-optimization.md 校准**: I20 标 ✅ v0.10.1-0.10.3（残留 tracker/auto-annotation 类型挪 v0.11+）; I13 重写现状（6 种 input_type / 必填 / 条件级联已就位，残留 mutable/immutable）; I14 把 martinez 改成已在依赖的 `polygon-clipping@0.15.7`; I15 重写现状（DB 字段全空白，需 alembic）; I16 文案精确化（基础设施在 useDirtyTracker，首次消费 v0.10.6）; I2 + I6 补现状分类（rbush 已用 / 后端 embedding cache 已就位）。Wave β/γ 优先级表标注 v0.10.4-0.10.7 sub-milestone 归属。
- **`KonvaPolygon`**: 增加 `viewportBBox` prop + 内部 `useMemo` 算 `renderPs`（简化）+ `visibleVertexIdx`（视口可见顶点集合）；非编辑且未选中态走 LOD 渲染，编辑态走视口顶点粗筛。
- **`useInteractiveAI.dispatch`**: 在 HTTP 调用前查前端缓存命中，命中即跳过；后端 embedding cache + 前端 mask cache 双层。

### Notes

- 纯前端 + 一条文档校准 + 一个 e2e 占位，无后端改动，无 alembic。
- M4-α 是 v0.10.4 epic（Wave β + γ I11/I13/I15）的第 1/4 子版本；M4-β (v0.10.5) 接 I15 z_order/lock/hidden/occluded 字段一等态。
- I2.4 "polygonVertexBatch history kind" 经过审视判定为冗余：现有 ImageStage drag 路径已是 pointerup 单条 commit，每次 `handleCommitPolygonGeometry` 仅 push 一条 update 历史，符合 roadmap I2.4 原意。

## [0.10.3] - 2026-05-14

> **1:N 后端管理 UI + 收口 (M3).** ProjectSettings 的 ML 后端区落地 roadmap §3.4 形态: 表头加 `已用 X / Y` 配额角标, 表格新增「能力」列展示 backend `supported_prompts`, 「注册 backend」按钮在达上限时置灰 + tooltip. 新增 `MlBackendLimitModal`, 在按钮被强行触发或表单创建撞 `409 ML_BACKEND_LIMIT_REACHED` 时弹出, 文案优先取服务器 `detail.message` (兜底 fallback 保证离线可读). 沉淀两条 ADR (Prompt-first 重构 + 1:N 架构、Capability 协商协议) 与一篇管理员侧 `ml-backends.md`. → [plan](docs/plans/2026-05-14-v0.10.3-1n-backend-mgmt-ui.md) · [roadmap](ROADMAP/[archived]0.10.x.md).

### Added

- **配额角标**: `MlBackendsSection` 标题旁显示 `已用 N / limit` (limit 来自 `project.ml_backend_limit`, 0 视为 ∞).
- **能力列**: 每行通过 `useQueries` 拉 `/projects/{id}/ml-backends/{bid}/setup`, 渲染 `supported_prompts` 为 Badge 组; 加载中显示 `…`, 失败显示 `—`.
- **`MlBackendLimitModal`** (`apps/web/src/components/projects/MlBackendLimitModal.tsx`): 「🚧 多后端共存暂未支持」专用模态, 文案优先服务器 `detail.message`, 缺失时走前端 fallback.
- **ADR-0019** [`ML 工具 UI 的 Prompt-first 重构与 1:N 架构 (env 锁 1:1)`](docs/adr/0019-prompt-first-tooldock-1n-arch.md).
- **ADR-0020** [`ML Backend Capability 协商协议 (GET /setup JSON Schema 契约)`](docs/adr/0020-ml-backend-capability-negotiation.md).
- **管理员文档** [`docs-site/user-guide/for-project-admins/ml-backends.md`](docs-site/user-guide/for-project-admins/ml-backends.md): 注册 / 绑定 / 解绑流程 + 1:1 限制说明.

### Changed

- **`MlBackendFormModal.onSubmit`**: catch 块识别 `ApiError.status === 409` 且 `detailRaw.code === "ML_BACKEND_LIMIT_REACHED"`, 通过新 prop `onLimitReached` 上抛 (`limit` / `current` / `message`), 关闭表单切到 LimitModal; 其它错误仍走原有 `setError` 行内提示.
- **「注册 backend」按钮**: 达上限时 `disabled` 同时 hover tooltip "已达上限 N, 请先解绑现有后端".
- **VitePress 侧边栏**: 项目管理员组新增 `ML 后端绑定` 入口.

---

## [0.10.2] - 2026-05-14

> **Prompt-first ToolDock + Exemplar 入口 (M2).** 把单 SAM 工具拆为 4 个独立工具 (智能点 / 智能框 / 文本提示 / Exemplar), 每个声明 `requiredPrompt` 与 backend `/setup.supported_prompts` 联动; backend 不支持的工具自动置灰 + tooltip 提示. 工具激活时右侧浮出 `AIToolDrawer` (后端 + 工具特定控件 + 参数面板). 自研最小 `SchemaForm` (~200 行, 不引 `@rjsf`) 从 `/setup.params` 自动渲染 number/boolean/enum/string 控件, 用户可在工作台动态调 `box_threshold` 等参数, 透传到 `/interactive-annotating` 请求体. → [plan](docs/plans/2026-05-14-v0.10.2-prompt-first-tooldock.md) · [roadmap](ROADMAP/[archived]0.10.x.md).

### Added

- **4 个独立工具**: `SmartPointTool` / `SmartBoxTool` / `TextPromptTool` / `ExemplarTool` (`apps/web/src/pages/Workbench/stage/tools/`). 每个工具的 `CanvasTool.requiredPrompt` 声明所需 backend 能力 ("point" / "bbox" / "text" / "exemplar"). 旧 `SamTool` 删除, `samSubTool` 状态由 `tool` 派生.
- **`useInteractiveAI.runExemplar()`** + 各 `run*` 接受可选 `extraParams`: AIToolDrawer 把 schema-form 参数 (`box_threshold` / `text_threshold` 等) 通过 `extraParams` 注入到 context, 透传后端.
- **`AIToolDrawer`** (`apps/web/src/pages/Workbench/shell/AIToolDrawer.tsx`): AI 工具激活时显示, 含后端选择器 (1:1 阶段单项 disabled) + 工具特定控件 (smart-point 极性 / 文案提示) + Schema-form 参数面板 + 状态指示 (Healthy / 加载中 / 失败).
- **`SchemaForm`** (`apps/web/src/pages/Workbench/components/SchemaForm/index.tsx`): JSON Schema Draft-07 子集渲染 (number/integer slider, boolean checkbox, string enum dropdown, string text input). 包含 `deriveDefaults()` 辅助. 不依赖 `@rjsf/core`, ~200 行自研.
- **能力变化兜底**: 当前激活的 AI 工具因 backend 切换 / 解绑而不再支持时, 自动切回 `hand` 工具并 toast 提示.
- **E2E**: `apps/web/e2e/tests/annotation.spec.ts` 新增两个用例 — grounded-sam2 capability 下 exemplar 置灰 + smart-point dispatch context.type="point"; sam3 capability 下 smart-point 置灰 + 拖框 exemplar dispatch context.type="exemplar".
- **SchemaForm 单测** (`SchemaForm.test.tsx`): number/boolean/enum/deriveDefaults/空 schema 五个分支.

### Changed

- **ToolDock UI 重构** (`apps/web/src/pages/Workbench/shell/ToolDock.tsx`): 删除 SAM 单工具特殊渲染分支, 改为统一 `requiredPrompt` 联动置灰 + `aiToolDrawer` slot. 分组顺序: 绘制工具 → AI 工具组 → 视图工具.
- **`S` 热键语义**: 从「进入 SAM 并循环子工具」改为「在 4 个 AI 工具间循环, 跳过置灰的」. `hotkeys.ts` 的 `setTool` action 新增 `"ai-cycle"` 元值; `useWorkbenchHotkeys` 据 `useMLCapabilities.isPromptSupported` 决定下一个工具. Alt+2 改绑 polygon, Alt+3 改绑 ai-cycle.
- **`AIPredictionPopover` 文本面板**: 渲染门控从 `tool === "sam" && samSubTool === "text"` 改为 `tool === "text-prompt"`.
- **`useWorkbenchState`**: `Tool` union 移除 `"sam"`, 加入 4 个新工具 id. `samSubTool` 改为 `useMemo` 派生 (公开 read-only), 移除 `setSamSubTool`. 新增 `aiToolParams` 状态 + `setAiToolParams` setter.
- **`onSamPrompt`** 类型扩展: 新增 `{ kind: "exemplar"; bbox }`, WorkbenchShell 据 `prompt.kind` 路由到 `runPoint` / `runBbox` / `runExemplar`.

### Removed

- `apps/web/src/pages/Workbench/stage/tools/SamTool.ts` (拆为 4 个独立工具).
- `apps/web/src/pages/Workbench/shell/SamSubToolbar.tsx` (子工具栏功能迁移到 AIToolDrawer + ToolDock 主按钮).
- `useWorkbenchState.setSamSubTool` / `nextSamSubTool` (samSubTool 派生, 不再独立持有).

---

## [0.10.1] - 2026-05-14

> **Capability 协商基础设施 (M1).** 把 ML backend 的 `/setup` 标准化为 JSON Schema 自描述协议, apps/api 暴露 `/projects/{id}/ml-backends/{bid}/setup` 代理端点, 前端落地 `useMLCapabilities` hook 作为 ML 能力的单一事实源. 同时落地 `MAX_ML_BACKENDS_PER_PROJECT` env (默认 1) 锁住运行时 1:1, DB/UI 一步到位 1:N. 本期 hook 只挂载、不消费; M2 (v0.10.2 Prompt-first ToolDock) 才接入消费. → [plan](docs/plans/2026-05-14-v0.10.1-capability-negotiation.md) · [roadmap](ROADMAP/[archived]0.10.x.md).

### Added

- **`/setup` JSON Schema 自描述协议**: 两个 ML backend (`sam3-backend` / `grounded-sam2-backend`) 的 `/setup` 响应一步到位标准化为新契约: 新增必填三元组 `name` / `version` / `model_version`; `params` 从配置快照 dict 改为 JSON Schema (Draft-07 子集), 每个字段携带 `type` / `default` / `title` / `enum` / `readOnly` 等元数据, 供 M2 schema-form 自动渲染参数面板.
- **`GET /projects/{id}/ml-backends/{bid}/setup` 代理端点** (`apps/api/app/api/v1/ml_backends.py`): 前端 useMLCapabilities 通过此端点拉 backend 能力, 不直连 ML backend; 30s TTL 进程内缓存避免 N 次探活, 删除/更新 backend 时自动 invalidate; 下游不可达返 502.
- **`MAX_ML_BACKENDS_PER_PROJECT` env** (默认 1): 单项目可绑定的 ML backend 数量上限. `POST /projects/{id}/ml-backends` 在已绑定数 ≥ 上限时返 `409 + detail{code:"ML_BACKEND_LIMIT_REACHED", message, limit, current}`, 前端 M3 据此渲染「暂未支持多后端」Modal. DB schema 不变 (ml_backends.project_id 已允许多行), 应用层挡入口防显存爆炸.
- **`ProjectOut.ml_backend_limit`**: `GET /projects/{id}` 响应体携带 env 控制的上限, 前端 ProjectSettings 据此决定「+ 添加后端」按钮的禁用状态 (M3).
- **`apps/web/src/pages/Workbench/state/useMLCapabilities.ts`**: TanStack Query hook, 5min staleTime; 暴露 `prompts` / `paramsSchema` / `capability` / `isPromptSupported(type)` / `isLoading` / `isError`. 返回体缺 `supported_prompts` 时回落 `["point","bbox","text"]` 并 console.warn; 拉取失败时返回空 prompts (=禁用全 AI 工具). 配套 4 个单测覆盖成功 / 兜底 / 错误 / disabled 路径.
- **后端单测** (`apps/api/tests/test_ml_backend_limit_and_setup.py`): 超限场景 / 上限调大可绑 / ml_backend_limit 字段透出 / setup 代理含缓存 / 跨项目 backend_id 404 / 下游不可达 502, 共 6 例.

### Changed

- `docs-site/dev/reference/ml-backend-protocol.md` §4 重写: `/setup` 从「可选自由 JSON」改为「v0.10.1 后必填 JSON Schema 协议」, 文档与两个 backend 同步.
- `.env.example` + `docs-site/dev/reference/env-vars.md`: 新增 `MAX_ML_BACKENDS_PER_PROJECT` 段落.

### Breaking Changes

- **`/setup` 协议破坏式升级**: `params` 字段语义从「配置快照 dict (如 `{"box_threshold": 0.35}`)」改为「JSON Schema 对象 (`{"type":"object","properties":{...}}`)」. 仅影响第三方 backend 实现; 平台内置的 `sam3-backend` / `grounded-sam2-backend` 同 PR 升级. 老 backend 缺 `supported_prompts` 时前端回落 `["point","bbox","text"]` 并控制台告警, 不阻断使用.

---

## [0.10.0] - 2026-05-13

> **SAM 3 接入 M0 — sam3-backend 容器化 + exemplar 协议落地.** v0.10.x 双 backend 并存策略的第一步: 把 `facebookresearch/sam3` (848M, 单档) + `facebook/sam3.1` 权重打包成独立 GPU 服务, 与 grounded-sam2-backend 并存. 镜像 grounded-sam2-backend 结构, 复用 `apps/_shared/mask_utils` 共享包. 协议新增 `context.type="exemplar"` (视觉示例 prompt → 全图相似实例), 仅 sam3-backend 支持; 前端 UI 入口与 apps/api 路由策略留 v0.10.1. → [plan](docs/plans/2026-05-13-v0.10.0-mellow-lantern.md) · [roadmap](ROADMAP/[archived]0.10.x.md).

### Added

- **`apps/sam3-backend/`**: 全新 ML Backend service, 基于 `pytorch/pytorch:2.7.0-cuda12.6-cudnn-devel`, Python 3.12. 复用 grounded-sam2-backend 的 4 端点结构 (`/health` / `/setup` / `/versions` / `/predict` / `/metrics` / `/cache/stats`), 监听 8002. **三种** prompt: `bbox` / `text` / `exemplar` (v0.10.0 选项 A: 不启用 `enable_inst_interactivity`, 放弃 point, 让 grounded-sam2-backend 兜底单点交互). predictor.py 按 vendor commit 4cbac14 真实 `Sam3Processor` API 实现, 不是基于 SAM 2 风格的假设.
- **`exemplar` prompt 协议**: `Context.type="exemplar"` + `bbox=[x1,y1,x2,y2]` 视觉示例框 → SAM 3 PCS 一步出全图相似实例 polygons. `docs-site/dev/reference/ml-backend-protocol.md` §2.2 同步.
- **LRU embedding 缓存 (sam3.1)**: cap 默认 32 (env `SAM3_EMBEDDING_CACHE_SIZE` 覆盖); cache key 含 `sam3.1` variant, 与 grounded-sam2 缓存互不污染 (embedding 来自不同模型, 不能跨).
- **Prometheus 指标 `sam3_*` 前缀**: 与 grounded-sam2-backend 的 `embedding_cache_*` / `inference_latency_seconds` 等同名指标解耦, 两个 backend 同时 scrape 不冲突.
- **docker-compose profile `gpu-sam3`**: 独立于 grounded-sam2 的 `gpu` profile, 用户可单独启动 sam3-backend 或两个都启 (`docker compose --profile gpu --profile gpu-sam3 up`).
- **`scripts/sync_vendor.sh`** + **`scripts/download_checkpoints.py`**: 镜像 grounded-sam2-backend 的 vendor 同步流程 + HF gated repo 拉权重 (要求 `HF_TOKEN`, 否则 fail-fast).
- **Idle Unload + 懒重载**: 与 grounded-sam2-backend 对齐. `SAM3_IDLE_UNLOAD_SECONDS` (默认 600s, 0 关闭) 触发自动卸载释放显存; 下次 `/predict` 懒重载 (冷启动 ~8-12s, executor 异步加载不阻塞 event loop). 新增 `POST /unload` `POST /reload` 端点供运维显式控制; `/health` 暴露 `idle_unload_seconds` + `last_request_age_seconds`. **双 backend 并存场景下显存让渡的关键机制**: sam3 FP16 ~7GB, 3090 单卡同时挂 grounded-sam2 (~2GB) + sam3 (~7GB) 必须靠 idle unload 互让. `asyncio.Lock` 串行化并发懒加载避免双重构造 OOM; unload 时一并 `cache.clear()` 防 GPU 张量悬挂. env 命名 `SAM3_` 前缀, 与 grounded-sam2 的 `IDLE_UNLOAD_SECONDS` 解耦.
- **45 个单测**: schema (含 exemplar 校验) + embedding cache (sam3.1 variant 隔离 + cap=32 默认) + predictor mock 三种 prompt 路径 (bbox/text/exemplar) + cache miss/hit + reset_all_prompts 调用顺序 + idle unload 完整生命周期 (锁串行化 / 重载实例新建 / cache clear). 全部无 GPU 即可跑.
- **`.env.example`**: 新增 `HF_TOKEN` / `SAM3_EMBEDDING_CACHE_SIZE` / `SAM3_SCORE_THRESHOLD` / `SAM3_LOG_LEVEL` / `SAM3_IDLE_UNLOAD_SECONDS` / `SAM3_IDLE_CHECK_INTERVAL` 占位.

### Deferred (留给 v0.10.1+)

- 工作台 `S` 工具 Shift+拖框 = exemplar 入口 → v0.10.1
- ProjectSettings 「默认 text backend」单选 + 优先级标签 → v0.10.1
- apps/api 按 prompt.type + 项目偏好的路由表 (`route_interactive_request()`) → v0.10.1
- AB 对比工具 / `/ai-pre/compare` 页 → v0.10.2
- ADR-0012 双 backend 永久共存 / `deploy.md` 双拓扑章节 → v0.10.3


<!-- v0.10.0 起的版本变更直接追加到本节；当开始开发0.11版本后再移到 docs/changelogs/[archived]0.10.x.md -->
---
