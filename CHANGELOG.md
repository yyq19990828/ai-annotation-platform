# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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

## 最新版本

<!-- 0.14.x 版本变更按版本段追加到本区；进入 0.15.x 后整体移到 docs/changelogs/0.14.x.md -->

## [0.14.14] - 2026-06-08

预标注可观测性 · 把 v0.14.13 的「前端 sessionStorage 猜测是否首次冷启动」换成「backend 真信号」。`PredictionResult` 加 `cache_hit / model_load_ms / pool_state` 三可选字段；`/health.pool` 三 backend 统一为 `PoolStatus`（cap / current_size / loaded_keys[] / last_evict）；新协议端点 `POST /warmup` 让前端 / 运维显式预热权重。计划见 `docs/plans/2026-06-08-v0.14.14-predict-observability.md`。

### Added

- **协议字段 `PredictionResult.{cache_hit, model_load_ms, pool_state}` (v0.14.14)**：可选三元组。`cache_hit=True` 表本次推理命中 pool 内权重，`False` 表触发加载（冷启动 / pool evict / 首次拉 ckpt）；`model_load_ms` 是本次 disk→GPU 加载毫秒（`cache_hit=True` 时 `None`）；`pool_state` 是轻量 pool 快照（按需）。三 backend `/predict` 全部上报。
- **`/health.pool` 统一 `PoolStatus` schema (v0.14.14)**：`{cap, current_size, loaded_keys: [{key, loaded_at, last_used_at, hit_count}], last_evict: {key, at, reason}|null}`。`key` 是 backend-defined opaque 字符串（yolo `{series}/{size}/{task}`、gsam2 `sam=X/dino=Y`、sam3 `sam3.1`）。`last_evict.reason` 受控为 `lru | manual | idle_timeout`。gsam2 兼容期同时输出老字段 (`loaded_variants/evict_count/per_variant_lru_ts`)，让旧消费方过渡。
- **协议端点 `POST /warmup` (v0.14.14)**：把指定 variant 权重加载到 pool 不跑 forward。yolo / gsam2 / sam3 三 backend 全部实现：body 由 backend 自定义（yolo `{task, variants}` / gsam2 `{variants:{sam,dino}}` / sam3 可空），统一响应 `WarmupResponse {ok, model_load_ms, cache_hit, evicted}`。`/setup` 顶层加 `warmup_endpoint: true` 自声明。pool 满时按 LRU 淘汰并把 evicted key 回填响应字段供前端 toast 提示。
- **API 代理 `POST /api/v1/projects/{pid}/ml-backends/{bid}/warmup`**：body 原样转发，权限沿用 RBAC，upstream 4xx 透传 / 5xx 502 兜底，含 AuditService 日志。
- **前端真信号 Map (v0.14.14)**：`sessionVariantCache.ts` 加 `recordPredictCacheHit` / `isVariantHot`。`predict` 响应回来后写 Map<key, cache_hit>，下次同 variant 调用前查 Map 决定按钮文案。`isVariantHot=true` ⇒ "推理中"；`false` ⇒ "加载中"；`undefined` ⇒ 老 sessionStorage 猜测作 fallback。

### Changed

- **三 backend ModelPool**：yolo / gsam2 加 `_loaded_at / _last_used_at / _hit_count / _last_evict` 运行时元数据；`get()` 改返回 `(model, cache_hit, load_ms)` 三元组；新 `warmup()` 方法不增 `hit_count` 且 pool 满时回填 evicted；新 `pool_status()` 输出协议 §4.3 PoolStatus 格式。sam3 无 ModelPool 走 module-level 等价改造。`unload_all/clear_all(reason=)` 区分 `manual / idle_timeout / lru`。
- **yolo predictor**：`predict_one` 返回签名扩展为 `(results, cache_hit, model_load_ms, inference_time_ms)`，main `/predict` 透传到 PredictionResult。
- **gsam2 `_run_prompt`**：返回 6 元组 `(results, embedding_hit, sv, dv, pool_cache_hit, model_load_ms)`，区分图像 embedding 缓存命中（v0.9.x）与 model pool 权重命中（v0.14.14）。
- **API `BackendCapabilities` + `CapabilityInstance` schema**：加 `warmup_endpoint: bool`（缺省 False）；`ModelCapability` 补 v0.14.12-13 字段（`variant_combinations / variants_shared_across_tasks / default_variants`）。`ml_capabilities.extract_capabilities` 透传 `warmup_endpoint`；`capability_instances._load_*` 同步透传。
- **前端 `ProjectDetailPanel.isCurrentVariantWarm` / `useWorkbenchShellModel.currentVariantIsWarm`**：改为「真信号优先（`isVariantHot != undefined`）→ fallback 老 sessionStorage 猜测」两段式。

### Tests

- **Backend (40+ 新测)**: yolo 加 `test_pool_observability` 11 个（cache_hit/warmup/evict/idle_timeout/manual reason/key string）+ `test_warmup_and_health` 5 个（端点契约）+ `test_setup` 1 个 warmup_endpoint。gsam2 加 `test_pool_observability_v14_14` 11 个 + setup 1 个；sam3 加 `test_pool_status_v14_14` 8 个 + setup 1 个；改 idle_unload 3 个测匹配新 tuple 签名。protocol_v2 加 7 个新 schema 测试（PoolStatus / LoadedKey / EvictRecord / WarmupResponse / PredictionResult v14.14 字段）。
- **API (6 新测)**: `test_ml_capabilities.py` 加 2 个 warmup_endpoint 透传测；`test_capability_instances.py` 加 2 个（env-only / 缺字段）；`test_ml_backend_warmup_proxy.py` 新文件 4 个（路由转发 / 404 / 4xx 透传 / connection 502）。
- **前端 (7 新测)**: `sessionVariantCache.test.ts` 加 7 个真信号 Map 用例（未知/true/false/evict 自我修正/null 缺省/跨 backend/null id）。
- **回归**: yolo 84 (67→84) / gsam2 63 (51→63) / sam3 53 (41→53) / protocol_v2 18 (11→18) / API capability+warmup 50 (44→50) / web sessionVariantCache 14 + VariantSelector 8 全过；`pnpm tsc --noEmit` 0 error。

### Docs

- 协议文档 `docs-site/dev/reference/ml-backend-protocol.md` §2.1 `PredictionResult` 加 cache_hit / model_load_ms / pool_state 字段，§4.1.1 顶层加 `warmup_endpoint`，新建 §4.2（PredictionResult 运行时观测语义）/ §4.3（PoolStatus 统一格式）/ §4.4（POST /warmup 端点 + 三 backend 请求示例）。§1 `/health.pool` 概览句改指 §4.3。

### Migration

- **后端协议向后兼容**: v0.14.14 字段全部可选，老消费方（仅读 `inference_time_ms / pool.loaded_variants`）零改动。gsam2 `/health.pool` 双发新老字段，老 admin / ModelMarket VariantPanel 继续可用。
- **未删字段**: `projects.ai_model` 等冗余字段保留至 v0.14.15（协议字段名统一时一起清）。`ModelMarket "运行时列 / ⚡ 预热按钮 / 卡片 evict 提示"` 留 v0.14.15。

## [0.14.13] - 2026-06-08

预标注交互闭环 · 把 v0.14.12 在能力目录展示的 variant 富表达贯通到实际预标注链路，让用户在 AI 预标注页 / 工作台都能选 yolo `series/size` (或 gsam2 `sam_variant/dino_variant`、sam3 `model_variant`) 并持久化为项目级偏好。计划见 `docs/plans/2026-06-08-v0.14.13-predict-ux-refinement.md`，配套 v0.14.14 / v0.14.15 路线在 `docs/plans/2026-06-08-v0.14.14-predict-observability.md` / `2026-06-08-v0.14.15-protocol-field-unification.md`。

### Added

- **协议字段 `default_variants` (model 级, v0.14.13)**: backend `/setup` 每个 model 自报默认 variant 组合 (扁平 `dict[axis_key, value]`)，前端 VariantSelector 在用户未选时取此作初值。优先级链：项目级 `projects.default_variants[backend_id]` > backend 自报 > backend 启动 env 默认。三 backend 实现：
  - yolo: 4 task 均默认 `{series: yolo11, size: s}` (推荐组合, 跨 task 全覆盖)
  - gsam2: 按 task 暴露相应轴 (detection→`{dino_variant}`, segmentation→`{sam_variant, dino_variant}`, interactive_seg/tracker→`{sam_variant}`)
  - sam3: 单档 `{model_variant: sam3.1}`，保持跨 backend 协议对称
- **`projects.default_variants` 字段 (alembic 0100)**: 项目级 variant 偏好持久化，按 `ml_backend_id` 分桶存 JSONB。前端 PATCH 写回后跨设备 / 协作仍保留偏好。
- **VariantSelector 通用化 (v0.14.13)**: 从「sam_variant / dino_variant 白名单」升级为协议 v2 通用消费，axis_key 任意。新增 props `variantCombinations` (yolo 非笛卡尔积联动约束, series=yolov9 → size 受限到 t/s/m/c/e) + `defaults` (backend / 项目级合并后的默认值)；初值优先级 value > defaults > recommended > schema.default > 第一项。
- **冷启动 UX 本地猜测 (sessionStorage 命中集合, v0.14.13)**: 后端 `/predict` 暂未暴露 `cache_hit`，前端维护"本会话见过的 variant 组合"集合，没见过 → 按钮文案显示"加载模型中…（首次约 5-15s）"，见过 → "推理中"。AIPreAnnotate / Workbench 两路均接入。等 v0.14.14 后端 cache_hit 真信号替换。

### Changed

- **AI 预标注页 ProjectDetailPanel**: VariantSelector 数据源从 backend 顶层 `supported_variants` (4 task 并集) 切到 model 级 (yolo 各 task 自己的轴 / gsam2 按 task 暴露相应轴)，避免渲染冗余轴。用户切换变体 PATCH `project.default_variants` debounced (与项目当前偏好 diff, 无变化不打 API)。
- **Workbench AIInspectorPanel**: 同样取 model 级 `supported_variants / variant_combinations / default_variants`；`setAiVariant` 包装为 `setAiVariantAndPersist`，session state + PATCH project 双写。下次进 AI 预标注页 / 工作台直接显示用户偏好。
- **API 透传链**: `apps/api/app/services/{ml_capabilities,capability_instances}.py` 加 `default_variants` 透传；`apps/api/app/schemas/{ml_capabilities,project}.py` 加字段；`apps/api/app/db/models/project.py` 加 `default_variants` mapped_column。
- **前端类型**: `apps/web/src/api/{ml-backends,mlCapabilities,projects}.ts` 加 `default_variants?: Record<string, string>` (类型, ProjectUpdatePayload 字段)。
- **compose 拆分 ML backend (运维侧命令变化)**: 3 个 GPU backend (grounded-sam2 / sam3 / yolo) 及其命名卷从 `docker-compose.yml` 拆到叠加文件 `docker-compose.ml.yml` (三者 profile-gated、与核心 infra 无 depends_on / 不共享卷，独立维护)。**启动命令改为叠加两个文件**：`docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu up -d grounded-sam2-backend` (或在 `.env` 设 `COMPOSE_FILE=docker-compose.yml:docker-compose.ml.yml` 省去 `-f`)。同步删除点云分支专用的 `docker-compose.pcwb.yml`。README / DEV / docs-site / 各 backend README / `.env.example` (+ 重新生成 `env-vars.md`) 命令同步更新。

### Tests

- **Backend 协议 (12+ 新测)**: yolo 加 `test_setup_each_model_has_default_variants` / `test_setup_default_variants_legal` / `test_setup_default_variants_prefer_yolo11_s`；gsam2 加 `test_setup_default_variants_per_task_axes` / `test_setup_default_variants_match_env_defaults`；sam3 加 `test_setup_default_variants_present_on_each_model` / `test_setup_default_variants_match_env_model_variant`。yolo 28 / gsam2 13 / sam3 11 setup 测试全过。
- **API 派生 (1 新测)**: `test_ml_capabilities.py::test_default_variants_passthrough` 验证 backend 自报 + 缺省 (空 dict) 两种路径透传。
- **前端 VariantSelector (5 新测)**: yolo series/size 渲染 / sam3 单档 / variantCombinations 过滤 / 联动清除非法值 / defaults 优先级。
- **冷启动 cache (7 新测)**: isWarm 默认 false / markWarm 后 true / variant 互不影响 / backend 互不影响 / null/undefined noop / axis_key 顺序无关 / 非 string value 忽略。
- **回归**: 全 web `pnpm tsc --noEmit` 0 error；309 个 Workbench shell+state 测试 + 35 个 AIPreAnnotate 测试 0 回归；API 33 个 capability + project 测试 0 回归。
- **顺手 fix**: sam3 `test_setup_supported_variants_empty` 自 v0.14.12 单档 backend 暴露 model_variant 轴后即失效，重写为 `declare_single_axis`；gsam2 test 旧 vram_gb 断言 (v0.14.12 删字段时遗漏)。

### Docs

- 协议文档 `docs-site/dev/reference/ml-backend-protocol.md` §4.1.2 模型条目结构加 `default_variants` 字段，§4.1.6 新子段含 yolo / gsam2 / sam3 三个 backend 示例 + 优先级链 + 校验说明。
- v0.14.13 / v0.14.14 / v0.14.15 三份独立 plan 文档落地：
  - 本版主体 plan: `docs/plans/2026-06-08-v0.14.13-predict-ux-refinement.md`
  - 下版可观测性: `docs/plans/2026-06-08-v0.14.14-predict-observability.md` (cache_hit / pool 状态统一 / `/warmup` 端点)
  - 协议规范化: `docs/plans/2026-06-08-v0.14.15-protocol-field-unification.md` (`model_variants` 扁平 dict / HTTP 422/503 / 删 `projects.ai_model`)

## [0.14.12] - 2026-06-08

接入第三个 ML backend：**yolo-backend**（ultralytics 多任务多系列）。计划见 `docs/plans/2026-06-08-v0.14.12-yolo-backend.md`，抽象层决策见 [ADR-0038](docs/adr/0038-defer-ml-backend-base-class.md)。本版交付：协议 v2 第一个「批量预标 backend」真实实例，covers detection / segmentation(instance) / keypoint / obb 四任务 × v8/v9/v10/v11/v12/v26/rt-detr 七系列预训练矩阵（共 80 个有效组合）。

### Added

- **yolo-backend**：新增 `apps/yolo-backend/`，FastAPI 进程暴露协议 v2 合规的 `/health` `/setup` `/versions` `/predict` `/unload` `/metrics`。
  - `/setup` 暴露 4 个 model 条目（`detect` / `segment` / `pose` / `obb`），每个条目 `supported_variants` 走两轴 `series × size`，series 选项按预训练矩阵严格过滤（v10/v12/rtdetr 只在 detect 出现；v9 在 segment 仅 c/e 两 size）。
  - `supported_prompts: ["none"]` —— 纯批量预标，不进交互式 workbench；ToolDock 据此把 yolo 排除出工作台交互工具栏。
  - 零 adapter：det → `rectanglelabels` / seg → `polygonlabels` / pose → `keypointlabels` / obb → `rectanglelabels + value.rotation`，命中 `apps/api/app/services/prediction.py::to_internal_shape` 现有分支（v0.10.28 已就位的 Geometry union）。
  - `model_pool.py`：`(task, series, size)` LRU 池，默认容量 `YOLO_MODEL_POOL_CAP=2`，单 GPU 显存可控；`YOLO_IDLE_UNLOAD_SECONDS=600` 触发空闲卸载。
  - `model_registry.py`：80 组合矩阵 + 文件名解析（`yolo11s-seg.pt` / `yolov9c-seg.pt` / `rtdetr-l.pt` 等命名规则）。
  - `scripts/download_weights.py`：离线预下载脚本，`STRICT_OFFLINE=1` 部署前用。
- **协议 v2 共享包**：抽 `apps/_shared/protocol_v2/`（`schemas` + `vocab` 受控词表常量），sam3-backend / grounded-sam2-backend / yolo-backend 三家共用，单一来源避免协议字段在 backend 之间漂移。
- **docker-compose**：新增 `yolo-backend` service（profile `gpu-yolo`，端口 **8003**），与 `gpu` / `gpu-sam3` 完全独立，可三 backend 并存或独立启停。新增 `yolo_checkpoints` 持久卷。

### Changed

- `apps/sam3-backend/schemas.py` / `apps/grounded-sam2-backend/schemas.py`：`TaskItem` / `PredictionResult` / `BatchPredictResponse` 三个跨 backend 一字不差的 Pydantic 模型从本地定义改为 `from aap_protocol_v2 import ...`。`Context` / `AnnotationResult` / 各 backend 特有字段保持原地不动。两 backend `pyproject.toml` 加 `pythonpath` 指向新共享包，Dockerfile 加 `_shared/protocol_v2/` editable install（与既有 `mask_utils` 同款约定）。/setup 字典字面量零改动，行为完全 byte-for-byte 一致。
- `.env.example`：新增 `YOLO_*` 环境变量段；`ML_BACKEND_OBSERVE_URLS` 注释补充 8003 端口。

### Added (continued · 模型市场 UI 适配协议 v2)

- **协议字段 `variant_combinations` + `variants_shared_across_tasks`**：在 model 条目级新增两个可选字段（详见 `ml-backend-protocol.md` §4.1.2 / §4.1.6）。
  - `variant_combinations`：多轴非真笛卡尔积时显式列举合法 `[axis0_value, axis1_value, ...]` 组合，避免目录展示虚假权重。yolo 用之表达 MODEL_MATRIX 约束（rtdetr 只有 `l/x`、yolov9 detect 只有 `t/s/m/c/e` 等）。字段缺省 ⇒ 前端按 axes 笛卡尔积处理。
  - `variants_shared_across_tasks`：布尔，缺省 `false`。`true` 表同 backend 内多 task 共享同一份物理权重（gsam2 的 SAM 2.1 Tiny 一份 `.pt` 同时服务 seg/iseg/tracker；sam3 的 sam3.1 同时服务 3 task），前端列表按 `(backend, axis_key, axis_value)` 聚合到一行；`false` 表每 task 独立权重（yolo 的 yolov8n-det.pt vs yolov8n-obb.pt），每 task 一行 + 任务后缀。
- **gsam2 / sam3 跟进协议 v2 富表达**：
  - `apps/grounded-sam2-backend/main.py`：每个 model 只声明该 task **真正用到的 axes**（detection 只 `dino_variant`、interactive_seg / tracker 只 `sam_variant`、segmentation 才两轴），并设 `variants_shared_across_tasks=True`。
  - `apps/sam3-backend/main.py`：从 `supported_variants: []` 升级为暴露单档 `model_variant: sam3.1`（让模型市场展示该具体权重），每个 model 设 `variants_shared_across_tasks=True`，3 task 聚合到 1 行。
- **API 层透传**：`extract_capabilities`（`services/ml_capabilities.py`）/ `_shape_models`（`services/capability_instances.py`）/ `InstanceModelItem`（`schemas/ml_capabilities.py`）/ `BackendCapabilities`（`schemas/ml_backend.py`）链路全部支持新字段。`extract_capabilities` 同时透传 `setup.name`，让前端能在列表展示「源 backend 名」而非用户项目别名。

### Changed (continued · 模型市场 UI)

- **能力目录列表视图重构**（`apps/web/src/pages/ModelMarket/CapabilityCatalogPanel.tsx`）：
  - **每行 = 一个物理权重**：列表行单位从「task model」改为「具体加载的 .pt 权重」。两条渲染路径按 `variants_shared_across_tasks` 自动切换。yolo 17 行（YOLOv8-Det / YOLOv8-Seg / RT-DETR-Det 等），gsam2 6 行（SAM 2.1 ×4 + Swin-T/B），sam3 1 行（SAM 3.1 聚合 3 task）。
  - **合并 env-only 与 registered**：`flatModels` 同时消费 admin overview（项目级注册）+ `/ml-capabilities/instances`（env-only docker-compose 自带），让 `groupBy=backend` / `infra` / `none` 视图也能看到 docker-compose 自带 backend，而不只在协议卡视图（`groupBy=task`）出现。
  - **按 URL 合并跨项目同 backend**：同一 ML backend URL 注册到多项目时，`backendRefs` 按 URL 去重（避免 N 倍 `/capabilities` fetch + 重复 group）；新增「注册状态」列展示项目列表（多项目时显示 `项目甲 +2`，hover 列出全部）。
  - **`backendName` 取 cap.name（源 backend 名）**：替代 `backend.name`（用户取的项目别名），让能力目录展示「grounded-sam2」而非「gsam2.1」。
- **删除 yolo / gsam2 假 `vram_gb` 数据**：`apps/yolo-backend/model_registry.py SIZE_META` 与 `apps/grounded-sam2-backend/main.py {SAM2,DINO}_VARIANT_METADATA` 移除粗估占位（yolov8n .pt 实际加载 ~300MB 远小于声称的 2GB，gsam2 SAM2 同理）。`tier`（fast / balanced / accurate）作为粗粒度档位保留。
- **`.env.example` `ML_BACKEND_OBSERVE_URLS`**：注释中三 backend 端口列表加入 8003（yolo-backend），并提示 8001=grounded-sam2、8002=sam3。

### Tests

- `apps/_shared/protocol_v2/tests/`：11 个单测（schema round-trip + vocab 词表一致性）。
- `apps/yolo-backend/tests/`：58 + 7 个单测覆盖 `model_registry`（矩阵 + 文件名解析，含 v9 conditional sizes、rtdetr 特殊命名、unsupported 组合 reject）、`schemas`（pydantic 入参校验）、`predictor`（四 task 结果映射 + 像素归一化 + OBB 弧度转度数 + keypoint 三档可见性）、`setup`（协议 v2 输出形态全字段断言 + `variant_combinations` 4 task 矩阵规模断言 + 每条组合合法性回归 MODEL_MATRIX）。
- `apps/web/src/pages/ModelMarket/CapabilityCatalogPanel.test.tsx`：新增「同 URL 跨多项目注册时 groupBy=backend 只渲染一组 + 注册状态列聚合项目名 + capabilities API 只调一次」单测（防止退化）。

### Docs

- 新增 [ADR-0038 — ML backend 基类抽象推迟到 N≥4](docs/adr/0038-defer-ml-backend-base-class.md)：写明本版只抽 schema + vocab，不抽 base class 的决策与未来触发条件。
- 计划文件 `docs/plans/2026-06-08-v0.14.12-yolo-backend.md`：包含完整设计、80 组合矩阵核对、PR 拆分、验收清单、风险与回退。
- `docs-site/dev/reference/ml-backend-protocol.md` §4.1.2 / §4.1.6：补 `variant_combinations` + `variants_shared_across_tasks` 字段说明，给出 yolo（非真笛卡尔积）+ gsam2/sam3（跨 task 共享）两类范例。

## [0.14.11] - 2026-06-08

协议能力目录与 ML Backend 注册解耦。计划见 `docs/plans/2026-06-08-v0.14.11-protocol-capability-catalog.md`，决策见 [ADR-0037](docs/adr/0037-protocol-capability-catalog-decoupling.md)。本版只解决一件事：「能力目录」从「已注册 backend 实例清单」抽离为「协议级能力定义 + 实例填充」双层视图，零接入用户也能完整看到平台支持的 9 类 AI 标注能力。

### Added

- **协议能力注册表 SSOT**：新增 `apps/api/app/services/capability_registry.py`，集中维护 task / infra / modality / geometry 四张受控词表 + 每条 task 的人类可读元数据（label / summary / protocol_notes / typical_models / suggested_backends）。`services/ml_capabilities.py` 中的受控词表与 `_TASK_DEFAULT_GEOMETRY` 改为从该 SSOT 派生，`extract_capabilities` / `derive_modalities` 行为零变化。
- **协议能力目录端点**：新增 `GET /api/v1/ml-capabilities/protocol`，无 project 作用域、登录用户即可访问，返回 9 个 task / 6 个 infra / 3 个 modality / 8 个 geometry 受控词表 + 元数据；`Cache-Control: private, max-age=300` + ETag 304 支持。
- **协议卡视图**：`CapabilityCatalogPanel` 新增 `ProtocolCapabilityCard` 子组件，默认 `groupBy=task` 时遍历 protocol.tasks 渲染 9 张协议卡——已注册 backend 的 model 按 `model.task` 字段挂载到对应卡，空卡显示「暂无接入」徽标 + 典型模型列表 + 推荐 backend（含 GitHub 直达）+ 「去注册 backend」CTA（跳 `?tab=registry`）。
- **零接入横幅**：新增 `EmptyCatalogBanner`，0 backend 注册时在协议卡上方展示「平台支持 9 类 AI 标注能力，当前还没有 backend 接入」+ 接入引导按钮。
- **gsam2 / sam3 升级到协议 v2 多模型目录**：
  - `apps/grounded-sam2-backend/main.py` 的 `/setup.models[]` 从 1 条扩到 4 条（`grounded-sam2-detection` / `-segmentation` / `-interactive-seg` / `-tracker`），每条独立声明 task / prompts / geometry，匹配 gsam2 实际四能力。
  - `apps/sam3-backend/main.py` 的 `/setup.models[]` 从 1 条扩到 3 条（`sam3-detection` / `-segmentation` / `-interactive-seg`，全部走 PCS 路径），detection / segmentation 走 text prompt，interactive_seg 走 exemplar prompt。
  - 顶层 `supported_prompts` / `supported_trackers` / `/predict` 协议不动，已绑定的项目和工作台无回归；新增能力卡视图下，已注册的 gsam2 / sam3 会自动挂载到对应的多个协议卡。
- **实例层与项目级注册解耦**：新增 `GET /v1/ml-capabilities/instances`（登录用户可访问），返回「平台已知 backend 实例」清单——env-only 容器（探测 `ml_backend_observe_urls` 配的 `/setup`）+ 项目级注册 backend（读 `health_meta.capabilities` 快照）合并去重。字段裁剪：只暴露 `source / display_name / infra / models[]`，**不返回 url / gpu_info / cache / pool** 等运维敏感信息。前端 `CapabilityCatalogPanel` 协议卡视图改为消费 instances，不再依赖 admin overview——零项目注册时，只要 docker-compose 自带的 gsam2 / sam3 在跑，普通登录用户就能在能力目录里直接看到它们的 model 清单。每个 model 子卡按来源显示「自带」/「已注册」徽标。

### Changed

- **能力目录默认视角切换**：`CapabilityCatalogPanel` 默认 `groupBy` 从 `backend` 改为 `task`（「协议能力 (默认)」），切到 `backend / infra / 不分组` 时退回 v0.14.10 的 model-centric 视图，零接入时空态文案补充提示「切到分组：task 可查看平台协议层支持的全部能力」。
- **受控词表派生统一**：`ml_capabilities.INFRA_VALUES / TASK_VALUES / GEOMETRY_VALUES / _TASK_DEFAULT_GEOMETRY` 改为 re-export `capability_registry` 派生值，移除原硬编码元组；外部调用方零回归。

### Compatibility

- 不动 `/setup` / `/predict` / `/projects/{pid}/ml-backends/{bid}/capabilities` / `health_meta` 任何字段。`extract_capabilities` / 合成隐式单 model / 现有 backend（echo / grounded-sam2 / sam3）跑通的路径全部保留。
- 无 alembic 迁移。
- 前端 URL state `?tab=catalog` 不变；用户保存的 `groupBy=backend` 深链仍按 v0.14.10 渲染。

### Docs / Tests

- 协议文档 `docs-site/dev/reference/ml-backend-protocol.md` 新增 §4.1.11「协议能力目录端点（v0.14.11）」，说明端点契约、响应 schema、缓存语义，并补「协议层 vs 实例层」职责对照表。
- 新增 ADR-0037「协议能力目录与 backend 注册解耦」，记录候选方案对比（后端 SSOT / 前端常量 / OpenAPI 派生）与决策细节。
- 超管手册 `docs-site/user-guide/superadmin/model-market.md` 重写「能力目录」section，强调「协议层 + 实例层双层视图」+ 零接入引导。
- 后端单测：`test_capability_registry`（9 例，含 research_link 路径有效性校验）+ `test_ml_capabilities_protocol`（5 例，含 ETag 304）。
- 前端单测：`ProtocolCapabilityCard.test`（4 例：空态徽标 / N model 挂载 / CTA 回调 / stale 标记）+ `CapabilityCatalogPanel.test`（3 例：0 backend 9 张协议卡 / 切 backend 分组退回旧空态 / 搜索 "ocr" 仅 OCR 卡可见）。

## [0.14.10] - 2026-06-07

画布精细交互 Part A + 模型市场前端重构 Part B。计划见 `docs/plans/2026-06-07-v0.14.10-canvas-precision-tools-and-attribute-mode.md`。

### Added

- **Snap 画布吸附**:新增 `stage/shared/geometry/snap.ts`,覆盖点候选、线段投影候选与 polygon / multi_polygon snap index 构建;polygon / polyline 绘制和 polygon 顶点拖拽会在 8px 屏幕距离内吸附到可见 polygon / multi_polygon 顶点或边界,并显示吸附指示点。按住 `Alt` 可临时关闭吸附。
- **Polygon Join**:图片工作台多选同类别、未锁定 polygon / multi_polygon 后,可从浮条或右键菜单合并为一个新的 polygon / multi_polygon。合并复用 `polygon-clipping.union`,以 create + delete 批量历史命令记录,可一次撤销。
- **属性模式**:图片工作台顶部新增属性模式栏,支持当前属性 schema 中 boolean / select / multiselect 字段。开启后点击 bbox、旋转框或 polygon / multi_polygon 会把当前字段值写入该标注属性并入 history;`[`/`]` 切字段,`1`-`9` 选值,`N` 跳到下一个未填对象。
- **模型市场三视图**:`/model-market` 改为 `?tab=catalog|runtime|registry` 分段视图,顶部显示已连 backend、使用项目数与模型条目数。能力目录支持卡片/列表、backend/task/infra 分组、搜索和列表排序。
- **运行时观测独立**:新增运行时观测面,以已注册 backend 为主键展示 observe 实时指标并保留健康检查、卸载、预热与变体面板;env-only 容器单独展示,不再把生命周期动作放在注册表。

### Deferred

- Slice 切割工具暂缓。当前 polygon 编辑器以单环编辑为主,可靠切割需要更多拓扑处理与失败回滚设计。
- 通用多轴 `supported_variants` 的 warm / smoke 动作暂缓。运行时观测已只读展示通用变体,但仅 SAM/DINO 旧 `variant_catalog` 启用试启动。

### Changed

- **注册管理瘦身**:项目级 backend 表只保留 CRUD、状态和跳项目设置;GPU/cache/model_version/pool 与 health/unload/reload 迁到运行时观测。
- **observe 泛化**:`GET /admin/ml-integrations/observe` 双发旧 `variant_catalog` 与新 `supported_variants`;`POST /observe/smoke-test` 接收 `variant` axis→value 字典并按占位协议返回 `skipped=true`。

### Docs / Tests

- 更新 Workbench polygon 与总览文档,补充 Join 和属性模式说明。
- 更新模型市场超管手册与 ML Backend 协议文档,补充三视图、运行时观测 keying 和 observe 通用变体说明。
- 新增 `snap`、`polygonOps`、`attributeMode` 纯函数单测,并补充右键菜单 Join 可用性测试。
- 补充 admin observe / smoke-test 后端单测与注册表瘦身组件测试。

## [0.14.9] - 2026-06-07

ML Backend 能力声明协议 v2(多模型目录 + infra)地基 + OCR / Doc Layout 首发模型族。计划见 `docs/plans/2026-06-07-v0.14.9-model-capability-catalog-and-ocr-doclayout.md`。本版把能力建模从单模型快照升级到 model 粒度,并在协议 v2 之下落地 OCR / Doc Layout 输出约定;`/predict` 请求/响应 schema 不变,不新增 prediction 表。

### Added

- **能力声明协议 v2**:`/setup` 顶层新增 `infra` 与 `models[]`,把能力声明下沉到 model 粒度——一个 backend 可暴露 N 个 model,每个 model 自带 `task` / `model_family` / `infra` / `supported_geometric_outputs` / `output_attribute_types` / `supported_variants` / `default_thresholds` / `resource_profile` / `params`。受控 task:detection / obb / segmentation / keypoint / classification / ocr / doc_layout / tracker / interactive_seg;受控 infra:pytorch / onnx / paddle / tensorrt / openvino / other。
- **模型能力目录视图**:新增 `GET /projects/{pid}/ml-backends/{bid}/capabilities` 与 `POST …/capabilities/refresh`,作为 `health_meta` 能力快照的派生视图,返回 model 目录(含 infra / task / 输出几何 / 输出属性 / variants),供模型市场与工作台多模型选择器消费。
- **OCR / Doc Layout 能力**:作为协议 v2 首发模型族,约定 OCR result 几何带 `attributes.text`(可选 `language` / `orientation`),doc_layout 以 `class_name` 落版面类别(title / paragraph / table / figure / formula / list / header / footer);统一 adapter 映射,不新增 prediction 表。

### Changed

- `extract_capabilities` / `derive_modalities`(`services/ml_capabilities.py`)从抽单层快照升级为遍历 `models[]` 派生 + backend 汇总;能力快照仍写 `ml_backends.health_meta["capabilities"]`(JSONB,零迁移),并保留顶层「扁平并集」字段(所有 model 的 prompts / geometry 去重合并)。

### Compatibility

- 向后兼容硬约束:无 `models[]` 的老 backend 由平台合成隐式单 model(`id="default"`,`task` 按 `supported_trackers`→tracker、含 point/bbox/text/exemplar→interactive_seg、否则 detection 推断),无 `infra` 标 `unknown`。grounded-sam2 / sam3 / echo 零改动继续工作。`infra` 是纯元数据,不改 `/predict` 协议、不参与硬校验。

### Docs

- 协议文档 `docs-site/dev/reference/ml-backend-protocol.md` 新增 §4.1「能力声明协议 v2」(顶层结构、model 条目、受控词表、向后兼容规则、YOLO / ONNX 范例、OCR / doc_layout 约定、capabilities 端点)，并在 §4.1.10 指向 v2 可跑参考实现 `docs-site/dev/examples/mock-v2-backend/`。
- 新增 ADR-0036「ML Backend 能力声明协议 v2(多模型目录 + infra)」。
- 补全能力协议 v2 下游消费面文档:API guide `ml-backend.md` 增加 capabilities 端点说明;超管手册 `model-market.md` 增加「能力目录(多模型)」面板;项目手册 `ai-preannotate.md` 增加「OCR / 文档版面预标」入口;工作台 `sam-tool.md` 增加「多模型选择与兼容性提示」。

## [0.14.8] - 2026-06-07

Data Manager 保存视图 + 受控过滤 DSL + 只读项目任务运营面。计划见 `docs/plans/2026-06-07-v0.14.8-data-manager-saved-views-filter-dsl.md`。本版只做视图、过滤、排序、列显隐与计数列,不做筛选结果批量写操作。

### Added

- **项目任务保存视图**:新增 `project_task_views` 表,支持 private / project 可见性、保存 `filter_json` / `sort_json` / `columns_json`,并提供创建、更新、删除和复制 API。
- **受控 Filter DSL**:新增 `POST /projects/{project_id}/tasks/query` 与 `GET /projects/{project_id}/task-views/{view_id}/tasks`,支持任务状态、标注计数/类别、预测模型版本/来源/置信度、未解决反馈、scene 名称/帧号和数据集类型等白名单字段。
- **Data Manager 前端页**:新增 `/projects/:id/data-manager`,从项目设置页进入;左侧展示内置/保存视图,顶部提供 and-only 过滤行、列显隐和保存视图操作,主表展示任务计数列和最近活动时间。
- **内置视图**:提供全部任务、待标注、待审核、有未解决反馈、有预测候选 5 个只读默认入口;修改后保存会创建私有副本。

### Security / Permissions

- 所有 Data Manager 查询先执行项目可见性校验。私有视图仅 owner 可见;项目共享视图对成员可见,但只有项目负责人或超级管理员可编辑。
- DSL 不开放任意 SQL 或任意 JSONB key 查询;未知字段、未知操作符和错误类型返回 422。

### Docs / Tests

- 新增 `docs-site/user-guide/projects/data-manager.md`,并更新项目手册与 API guide。
- 新增 `tests/test_task_views.py`,覆盖未知字段拒绝、未解决反馈查询、预测模型版本查询、私有/共享视图可见性和共享视图编辑权限。
- 更新 OpenAPI snapshot 与前端 generated types。

## [0.14.7] - 2026-06-07

点云标注导出标准训练格式补丁。计划见 `docs/plans/2026-06-07-v0.14.7-pointcloud-export-standard-formats.md`。本版为纯新增 serializer 和导出路由,不新增表/列/迁移。

### Added

- **KITTI 3D 导出**:lidar 项目新增 `kitti` 目标,输出 `label_2/<frame>.txt` 与 `calib/<frame>.txt`;3D 框固定映射到 KITTI camera 坐标,并消费 `occluded` / `truncated` 属性,缺失时降级默认值。
- **nuScenes JSON 子集导出**:新增 `nuscenes` 目标,输出 `sample_annotation` / `category` / `attribute` / `calibrated_sensor` / `sample_data` / `ego_pose` 等轻量表。当前为单帧 sample 风格、ego/ISO 坐标和占位 `ego_pose`,完整 global 轨迹留待 v0.15.0。
- **point_mask_3d 逐点导出**:新增 `pointmask` 目标,输出 little-endian uint32 `segmentation/<frame>.label` 与 `category_map.json`,类别 id 1-based,0 表示背景。
- **多相机标定与回源 manifest**:三种标准点云目标随包写入 `calib_raw/<camera>/<frame>.json`、`images_manifest.json`、`pointclouds_manifest.json`、`fetch_images.py` 与 `fetch_pointclouds.py`。

### Changed

- `clean_export_targets` 为 `data_type="lidar"` 增加专属目标集合 `{aap_json,kitti,nuscenes,pointmask}`,lidar 项目请求 COCO/YOLO 等跨模态目标会在端点层返回 400。
- Dashboard 导出弹窗为 lidar 项目显示 AAP JSON / KITTI 3D / nuScenes JSON / Point Mask,不再复用图片项目目标列表。

### Docs / Tests

- 新增 `docs-site/dev/reference/lidar-export-formats.md`,并更新用户导出格式页与批次导出说明。
- 新增 lidar serializer 与 ZIP 打包测试,覆盖 KITTI 属性映射、nuScenes 占位 ego_pose、pointmask label 和 lidar 目标校验。

## [0.14.6] - 2026-06-07

6 相机实测体验 + 点云上色性能 + `point_mask_3d` 分割工具深化补丁。计划见 `docs/plans/2026-06-07-v0.14.6-six-camera-experience-and-performance.md`。本版为纯前端切片,不新增后端表/列/端点。

### Added

- **相机面板自由拖动**:悬浮相机面板保留默认物理朝向锚点,标题条可拖动临时避让;拖动位置按 camera role 写入 localStorage,双击标题条或点「归位」可回到默认锚点。
- **point_mask 多模式选点**:分割工具新增矩形 / 套索 / 多边形三种选点模式。矩形保持默认;套索拖动闭合;多边形逐点点击后双击或 Enter 闭合。
- **point_mask 增删编辑**:选中已有 `point_mask_3d` 标注后使用分割工具再次圈选可加点,按 Alt 圈选可减点;点集仍写回原有 `point_indices`。
- **point_mask 类别编辑面板**:单选分割标注时可在 3D 工作台右上面板改类、查看点数、删除分割。

### Changed

- **相机面板窄屏默认折叠**:在中等窄屏下相机面板默认收为小标签,用户手动展开 / 收起状态优先,不会被自动折叠覆盖。
- **相机同锚点稳定堆叠**:相机组内按 role 稳定排序,同一锚点超过 2 个时尾部默认折叠为小标签,避免异常外参或命名退化时挤满视图。
- **相机上色 worker 化**:`colorizePoints` 与上色前深度栅格构建移到 Vite module worker 中执行;worker 不可用、构造失败或超时时自动回退主线程同步实现,输出仍来自同一份纯函数。

### Docs / Tests

- 新增 `pointInPolygon` 与 `pointcloudCompute` 单测,覆盖多边形选点边界和 worker 缺失 / 失败兜底。
- 更新 `docs-site/user-guide/workbench/pointcloud-view.md`、`docs-site/user-guide/workbench/3d-box.md` 与工作台总览,同步相机拖动、上色 worker 化和分割编辑行为。

## [0.14.5] - 2026-06-07

3D 标注属性 + 标注效率补丁:补齐点云 3D 框属性编辑、多选批量操作、撤销/重做与复制/粘贴能力。计划见 `docs/plans/2026-06-07-v0.14.5-3d-annotation-attributes-and-efficiency.md`。本版为纯前端切片,不新增后端表/列/端点。

### Added

- **3D 框属性面板**:3D 工作台右上编辑面板接入 `lidar_box_3d` 工具单位的 `attribute_schema`,可编辑遮挡、截断、可见度及自定义属性,并持久化到标注 `attributes`。
- **3D 多选与批量操作**:`Shift + 点击`主视图框或相机投影框可多选;类别下拉和 Delete/Backspace 可批量改类或删除全部已选且未锁定的 3D 框。
- **3D 撤销/重做**:放置、删除、PSR 编辑、自动贴合、改类、改属性进入本地 history,支持 `Ctrl/Cmd+Z` 与 `Ctrl/Cmd+Y` / `Ctrl/Cmd+Shift+Z`。
- **3D 复制/粘贴/duplicate**:`Ctrl/Cmd+C` 复制当前 3D 框,`Ctrl/Cmd+V` 按世界坐标偏移粘贴同类同属性新框,`Ctrl/Cmd+D` 直接 duplicate。

### Changed

- 多选时 3D 主视图和相机投影 overlay 同时高亮全部已选框;PSR 数值、gizmo、三正交视图和自动贴合仅在单选时可编辑。
- 共享 history 的 delete-undo 路径现在会把 annotation `tool_unit_id` 与 `attributes` 一并带回 create payload,避免撤销删除 3D 框后丢工具单位或属性。

### Docs / Tests

- 更新 `docs-site/user-guide/workbench/3d-box.md`,补充 3D 属性、多选、撤销和复制快捷键说明。
- 新增 `box3dAttributes`、`box3dClipboard`、`useThreeDHistory` 单测,并补充 `WorkbenchStageHost` 对 3D `selectedIds` 透传断言。

## [0.14.4] - 2026-06-06

scene 模式项目 + scene 感知分包补丁:把 scene 提升为项目级显式声明,补上 `by_scene` 分包、数据集 `has_scenes` 过滤与项目/数据集 kind 硬门。计划见 `docs/plans/2026-06-06-v0.14.4-scene-mode-projects.md`。

### Added

- **项目级 scene 模式**:`Project.scene_mode` 落库并透出到项目创建/更新/响应。图片和 3D 点云项目可开启;视频项目拒绝开启。scene 模式项目创建时默认开启 `prefer_same_scene_continuation`。
- **数据集时序声明与派生 has_scenes**:`Dataset.is_temporal` 用于导入期校验;`DatasetOut.has_scenes` 由 `scenes` 实时派生。`GET /datasets?has_scenes=true|false` 支持按 scene 存在性过滤。
- **按 scene 分包**:`POST /batches/split` 支持 `strategy="by_scene"`。一个 scene 生成一个批次,批次内 task 按 `frame_index` 排序,并写 `sequence_order=frame_index`。
- **前端 scene 模式向导**:项目创建 Step1 增加 scene 模式开关;Step5 按项目媒体类型与 `has_scenes` 过滤数据集,scene 项目默认选择按 scene 分包。

### Changed

- **项目-数据集关联收紧**:`POST /datasets/{id}/link` 新增 kind 对称硬门。项目媒体类型必须匹配数据集媒体类型,且 `project.scene_mode` 必须等于数据集派生的 `has_scenes`;不匹配返回 422。存量关联不追溯。
- **nuScenes 导入脚本**:脚本创建的数据集标记为时序数据集,配套项目标记为 scene 模式并默认开启 scene 连续调度。

### Fixed

- **scene 被随机分包切碎**:scene 模式项目可直接按 scene 分包,避免同一 scene 的连续帧被拆到不同 batch/owner,从源头减少跨帧 propagate 与调度被 batch 可见性打断。

### Tests

- 新增 `tests/test_batch_split_by_scene.py`、`tests/test_dataset_link_kind_match.py`、`tests/test_project_scene_mode.py`、`tests/test_datasets_list_has_scenes.py`。
- 新增 `Step5Datasets.test.tsx`,并更新 `datasetsApi` query string 测试。

## [0.14.3] - 2026-06-06

点云导入鲁棒性 + 跨帧 UX 补丁:把 v0.14.2 真实 nuScenes 实测暴露的硬编码目录名、sensor/ego 坐标混用、跨 batch 跳转、sniffer 分歧不可见、overlay 档位偏小和 ZIP 多 scene 提示问题补齐。不新增表/列,不做数据迁移。计划见 `docs/plans/2026-06-06-v0.14.3-import-robustness-and-crossframe-gaps.md`。

### Changed

- **角色目录 pattern 单一真值**:`pointcloud_import.group_frames` 与 `scene_inference` 共用 `role_patterns.py`,默认继续识别 `lidar/ camera/ calib/`,并新增 `lidar_point_cloud_*`、`camera_image_*`、`velodyne`、`points`、`calibration` 等常见别名。scene inference 的顶层角色判断同步使用同一套边界匹配,避免 xtreme1 风格目录被误判为多 scene。
- **nuScenes 默认 ego/ISO 导入**:`import_nuscenes_scene.py` 新增 `--frame {ego,sensor}`,默认 `ego`:点云逐点乘 `T_ego_from_lidar`,dataset 写 `axis_convention=iso_8855`,相机标定写 `cam_from_ego`。显式 `--frame sensor` 保留 v0.14.2 的 raw LIDAR_TOP + `axis_convention=apollo` + `cam_from_lidar` 行为;同一 dataset 发现两种 frame 混用时拒绝继续导入。
- **跨帧 propagate 可跳到未加载 task**:Workbench 在 `Shift+→/←` 或 `Alt+→/←` 延续到当前任务列表未加载的邻帧时,按 taskId 直接加载目标 task 并补选中新标注,不再被当前 batch/分页列表回退到第一页。
- **邻帧 overlay 增加 7 档**:`CrossFrameOverlayToggle` 从 0/1/3/5 扩为 0/1/3/5/7,localStorage 白名单同步接受 7。

### Added

- **sniffer 分歧透出**:`SniffAxisConventionResponse` 新增可选 `per_camera[]` 和 `agreement`,前端 `AxisConventionPicker` 在多相机判断不一致时显示一致相机数量,帮助用户识别侧/后相机对坐标系嗅探的干扰。
- **ZIP 上传错误提示细化**:上传包超过 200MB 时明确提示浏览器向导只适合单个原生 scene,多 scene/nuScenes 应走转换脚本;顶层混用保留角色目录与 scene 目录时,`scene_inference_notes` 指出冲突并链接 `import-formats.md`。

### Fixed

- **nuScenes 长 dataset_name 导入**:`import_nuscenes_scene.py` 的 dataset/project display_id 现在会在超过数据库 20 字符限制时稳定截断并追加 hash,避免 `DS-NU-...` / `P-NU-...` 因真实验证名称较长而入库失败;短名称保持旧 display_id 不变,幂等行为不变。

### Docs

- `docs-site/user-guide/datasets/import-formats.md`:补充角色目录别名、nuScenes `--frame ego|sensor` 行为、dataset frame 混用保护、sniffer `per_camera/agreement` 和 ZIP 多 scene 提示。

## [0.14.2] - 2026-06-06

点云导入格式收敛 + 多相机/多 scene 实测:把"进数据"这一头的两个真实阻塞拆掉。修 ZIP 上传拍平路径(D1),让点云 scene ZIP 真能从向导上传;新增 nuScenes-mini 转换脚本(D2),作为 v0.14.0 scene 模型的第一个真实多 scene 消费者,scene_token 1:1 落到 `scenes.name`。不引入插件注册表 / 通用 importer 抽象,按"自家格式 + 一次性转换脚本"路线(与 SUSTechPOINTS / xtreme1 一致)。计划见 `docs/plans/2026-06-05-v0.14.2-import-format-and-multicam.md`。

### Fixed

- **ZIP 上传保留子目录(D1)**:`POST /api/v1/datasets/{id}/items/upload-zip` 此前用 `os.path.basename` 把每个文件拍平到 `{ds.name}/{basename}`,丢掉 ZIP 内子目录 → 点云 scene ZIP(`lidar/ camera/<cam>/ calib/camera/`)上传后 `group_frames` 找不到段名,整批不被识别为 scene。改为经新增的 `_normalize_zip_relpath` 规范化相对路径并保留子目录(`{ds.name}/lidar/000970.pcd`),附 zip-slip 防护(拒 `..` 段 / 绝对路径 / 隐藏文件 / `__MACOSX/`)。**该修复全局生效**,非点云 dataset 同样保留子目录。
- **去重键改 content_hash-only**:同一 scene 内 `camera/front/000970.jpg` 与 `camera/left/000970.jpg` 的 basename 相同但属合法的跨相机同帧;删掉原"同名追加 -1/-2 后缀"逻辑,仅当 content_hash 完全相同才去重,跨子目录同名不再误改名 / 误去重。
- **轴向 sniffer 多相机鲁棒性**(v0.13.12 端点,实测 nuScenes 6 相机暴露):`sniff-axis-convention` 此前 `_is_front_role` 用 `"front" in haystack` 把 `CAM_FRONT_LEFT/RIGHT` 也当正前,并在并列里按 `created_at` 选 → 同一份数据随相机建序漂(CAM_FRONT_RIGHT 把 apollo 误判成 iso_8855)。改为:正前判定收紧为含 front/forward 且不含 left/right/back/rear;选择全程确定性——有正前相机取分最高(稳定 tiebreak),无则跨相机按 best 约定投票取众数。不改响应 schema。真实多 scene dataset 现稳定返回 `apollo`(`camera_CAM_FRONT`),与相机顺序无关。
- **3D 相机面板四角布局**(nuScenes 6 相机实测调整):`front_left/right` 与 `back_left/right` 此前钉在左/右竖边的上下两端,6 相机装置下过散;改为沿各自竖边纵向收拢到中段(`top/bottom: 30%`),更贴物理朝向环绕直觉。

### Added

- **nuScenes-mini 转换脚本(D2)**:`apps/api/scripts/import_nuscenes_scene.py`,自读 nuScenes JSON(不依赖 `nuscenes-devkit`,只用 numpy + Pillow),把一个或多个 scene 转成平台原生目录 + 直接入库,并**显式调 v0.14.0 `scene_svc.create_scene` + `assign_items_to_scene`**:scene_token → `scenes.name`,sample 顺序 → `frame_index`,`.pcd.bin` 转 ASCII PCD,6 路相机 jpg + 每相机一份 lidar→camera 外参/内参标定。支持 `--scene-tokens a,b,c` 多 scene 共用一个 dataset。`axis_convention=apollo`(**实测发现**:上传的是未变换的 LIDAR_TOP 传感器系点,实测其约定 +X 右/+Y 前/+Z 天 = apollo;nuScenes 仅 **ego** 系才是 ISO,计划原假设"原生 ISO"对 raw lidar 点不成立。已用 LIDAR_TOP→ego 标定旋转独立印证)。幂等(dataset 按 display_id、scene 按 name 复用)。

### Verified(真实 nuScenes-mini 端到端)

- **单 scene(scene-0061)**:279 items(39 帧 ×7 传感器 + 6 calib),1 scene,lidar `frame_index` 0..38;末帧 `neighbors.next` 为空。
- **多 scene(scene-0061/0103/0553 共用一个 dataset)**:858 items,3 scene,各自 `frame_index` 独立 0..N-1(39/40/41);`scenes?dataset_id=` 返回 3 个;**跨 scene 不串**:scene-0061 末帧 `next=[]`、scene-0103 首帧 `prev=[]`,直接验证 v0.14.0 判据 6 在真实多 scene 数据上成立。
- **帧 stem 全局唯一修复有效**:多 scene 同号帧因带 scene 前缀未撞键,每 scene 的 task 都正确建出。

### 已知问题 / 后续(实测暴露)

- **nuScenes 点未变换到 ego 系**:本版直接上传 LIDAR_TOP 传感器系点 + `axis_convention=apollo`(前端旋转到 ISO 显示)。若要点云直接落在 ego/ISO 系,需逐点乘 `T_ego_from_lidar` 并把外参改为 `cam_from_ego`,留后续。
- **多 scene 帧 stem 全局唯一**:每个 scene 的帧号都从 0 起,而 `group_frames` 以文件名 stem 作帧键——多 scene 共用 dataset 时同号帧会撞键漏建 task。脚本给帧文件名加 `<scene_name>_` 前缀保证 stem 全局唯一(不动 `group_frames`);scene 内 `frame_index` 仍由 `assign_items_to_scene` 按顺序赋值,与文件名解耦。

### Verified / Tests

- `tests/test_datasets_upload_zip.py`(新):子目录保留、zip-slip 拒绝、跨子目录同名按 hash 去重、SUSTech 布局自动建 1 scene + `frame_index` 0..N、伪多 scene zip 建 2 scene。
- `tests/test_import_nuscenes_lite.py`(新):用 tmp_path 造极小 fake nuScenes 根目录(2 scene × 3 sample × 1 cam,不依赖真 4GB 数据),验证脚本骨架跑通 + 产生 2 个 scene + `frame_index` 按 sample 顺序 + **跨 scene neighbors 不串**。
- nuScenes 真实数据端到端(6 相机投影对齐 / BEV 车头朝上 / 跨 scene 隔离)走脚本 docstring 里的手动 checklist(dev 工具,CI 不跑真数据)。

### Docs

- `docs-site/user-guide/datasets/import-formats.md`(新):平台原生目录约定 + 多 scene 边界 + 标定 JSON schema + nuScenes/KITTI 转换索引;明确"只接受原生格式,其他走转换脚本"。sidebar 加入口。

### 未尽事项(留后续)

- 多 lidar 数据集(Waymo 5 路 lidar)、同 sample 跨相机微秒级 timestamp 偏差补偿(`ego_pose` 插值)、`group_frames` 路径段名抽象化(角色 pattern 配置):留 v0.15+。
- ZIP 单包 200MB 上限不放宽;多 scene 批量请走转换脚本而非向导。

## [0.14.1] - 2026-06-06

跨帧目标延续 UX:把 v0.14.0 的 scene + neighbors API 变成可用的标注效率特性。3D 工作台 `Shift+→` / `Shift+←` 一键把选中 box_3d 延续到同 scene 邻帧 task(共享 `group_id`),跳过去自动选中新框;三视图 / 主视图可叠加显示同 group_id 的前后 K 帧参考框。2D 图像序列同等用 `Alt+→` / `Alt+←`(2D 的 `Shift+方向` 已被 10px nudge 占用)。配套加 scheduler scene 连续标注调度开关。计划见 `docs/plans/2026-06-05-v0.14.1-cross-frame-ux.md`。

### Added

- **跨帧 propagate 端点**:`POST /api/v1/tasks/{task_id}/annotations/{annotation_id}/propagate-to-task`,body `{ target_task_id, override_psr? }`。复制源 annotation 的 geometry / class / attributes / tool_unit_id 到目标 task(同 project 才允许,否则 422),共享 `group_id`。仅支持静态几何(`box_3d` / `bbox` / `polygon` / `multi_polygon` / `rotated_bbox` / `polyline` / `keypoint`);`video_*` / `point_mask_3d` 拒(422)。
- **共享 group_id 序列**:跨帧链的 `group_id` 在源无 group 时从新建全局序列 `cross_frame_group_seq`(START 1000000000)分配并写回源,高位起始保证与 per-task `tasks.next_group_seq`(小整数)永不冲突,同 scene 跨帧 overlay 按 `group_id` 匹配不误命中无关分组。migration `0097`。
- **box_3d convention 安全网联动**:propagate 时 `box_3d.convention_at_create` 取**目标** dataset 的 `axis_convention`(DB 内 PSR 永远 ISO 字节,原值复制即对齐世界坐标;写目标 convention 仅为前端 banner 不误报,延续 v0.13.11 契约)。
- **前端跨帧 hook**:`useFrameNeighbors(taskId, k)` 包 neighbors 端点 + `refresh()` 强刷;`useNeighborAnnotations(taskIds, groupId)` 用 `useQueries` 跨邻帧 task 拉同 group_id 标注(复用 `["annotations",taskId]` 缓存,group=null 短路)。`api/tasks.ts` 加 `getNeighbors` / `propagateToTask`。
- **3D 工作台跨帧 UX**:`Shift+→` / `Shift+←` 把选中 box_3d propagate 到邻帧并跳转自动选中;`CrossFrameOverlayToggle`(0/1/3/5,localStorage 持久化)控制邻帧叠加 K;`PointCloudScene.setReferenceBoxes` 渲染半透明 dashed、不可拾取的参考框层;首/末帧给"已是该 scene 首/末帧" toast。
- **2D 图像序列跨帧 UX**:`Alt+→` / `Alt+←` 跨帧 propagate 选中 bbox / polygon(统一中央 hotkey,与 3D 共用壳层 orchestration);3D 额外保留 `Shift+→` / `Shift+←` 别名。

### Changed

- **scheduler scene 连续标注**:`Project` 加 `prefer_same_scene_continuation`(默认 `false`)+ `scene_continuation_window_min`(默认 30)。打开后 `get_next_task` 在套用既有 sampling 前,优先返回"用户窗口内最近标注 task 的同 scene 下一帧"(未锁、未由本人标过、可见);找不到回退既有策略。**默认 OFF,既有项目零回归**(关闭时整段不进入)。`PATCH /projects/{id}` 透出该开关。

### Docs

- `docs-site/user-guide/workbench/3d-box.md`:跨帧 propagate + 邻帧叠加操作说明。
- `docs-site/dev/concepts/scene-and-frame-index.md`:新增"跨帧 UX 如何消费 neighbors API"+ scheduler scene 优先小节。

### 未尽事项(留后续)

- 视频多段(case C)段内/段间 `Alt+→` 分流到 `video_tracker_runner`:本期未接(videoMode 下暂无动作)。
- 跨帧自动插值 / Kalman 预测、多目标批量 propagate、`point_mask_3d` 跨帧、邻帧 overlay K>5:留 v0.15+。

## [0.14.0] - 2026-06-06

跨 task 帧序列地基:`scenes` 模型 + `dataset_items.scene_id/frame_index` + neighbors API + 导入端口对齐 + manifest 透出。把 3D 点云逐帧 / 2D 抽帧序列 / 多段 mp4 拼接长录像统一到同一抽象,为 v0.14.1 跨帧 UX(`Shift+→` propagate / 邻帧叠加 / `useFrameNeighbors`)备好合法 backing。计划见 `docs/plans/2026-06-05-v0.14.0-scene-and-frame-index-foundation.md`。

### Added

- **`scenes` 表 + 两列**:新建 `scenes`(`display_id` SCN-N、`dataset_id` FK CASCADE、同 dataset name 唯一)+ `dataset_items.scene_id`(FK SET NULL)+ `frame_index`(int);复合索引 `idx_dataset_items_scene_frame` 给 neighbors 查询。migration `0096_scenes_and_frame_index.py`。
- **Scene service**(`services/scene.py`):`create_scene` / `assign_items_to_scene` / `list_for_dataset` / `get_neighbors_for_task`;双路径反查 task(`task.dataset_item_id` 直链 + `TaskDatasetItemLink role=primary_lidar`)。
- **Scene inference**(`services/scene_inference.py`):`infer_and_apply(mode=single|per_subdirectory|auto, dry_run)`;auto 模式按"顶层是否全为已知角色名"自适应单/多 scene。点云布局走 `group_frames` + 自然排序;非点云按 `file_name` 自然排序赋 0..N-1。幂等 + > 100 scene 安全阀。
- **Neighbors 端点**:`GET /api/v1/tasks/{id}/neighbors?k=1`,k ∈ [1,20]。响应 `{ scene_id, scene_name, frame_index, scene_total_frames, prev[], next[] }`;历史未 backfill task → 200 全空。
- **Scenes CRUD API**:`GET /api/v1/scenes?dataset_id=` / `GET /api/v1/scenes/{id}` / `PATCH /api/v1/scenes/{id}`。create 由 importer / backfill 自动发起。
- **Backfill 端点 + 脚本**:`POST /api/v1/datasets/{id}/scenes/backfill?mode=auto&dry_run=` + `scripts/backfill_scenes.py --dataset-id / --all-missing / --dry-run / --mode`。
- **导入端口对齐**:`pointcloud_import.build_pointcloud_tasks_for_link` 顶部自动跑 `single`-mode inference;`POST /datasets/{id}/items/upload-zip` 末尾跑 `auto`-mode,响应附 `scene_inference_notes[]`。
- **Manifest 透出**:`TaskPointCloudManifestResponse` 增 `scene_id` / `scene_name` / `frame_index` / `scene_total_frames`;前端 codegen 自动跟随。`ThreeDWorkbench` 写 `console.debug` 追踪,本期不消费 UX。
- **文档**:[`docs-site/dev/concepts/scene-and-frame-index.md`](docs-site/dev/concepts/scene-and-frame-index.md)。

### 不在本期(留后)

- 跨帧 UX(`useFrameNeighbors` / `Shift+→` propagate / 邻帧叠加)→ v0.14.1
- 跨 scene 段内段间无感导航(case C)→ v0.14.2+
- `get_next_task` 的 `prefer_same_scene_continuation` flag → v0.14.1+
- nuScenes 多 scene 转换脚本 → v0.14.2
- scene 跨多 dataset / ego_pose / 时间戳 → v0.15+

### 不动

- `services/scheduler.py` 一行不动;`get_next_task` 行为完全不变(既有项目零回归)。
- `VideoFrameIndex` / `VideoChunk` / `VideoFrameCache` / `video_tracker_runner.py`:case A 内部跨帧栈不动。
