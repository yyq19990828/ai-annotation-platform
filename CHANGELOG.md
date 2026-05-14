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

## [0.10.2] - 2026-05-14

> **Prompt-first ToolDock + Exemplar 入口 (M2).** 把单 SAM 工具拆为 4 个独立工具 (智能点 / 智能框 / 文本提示 / Exemplar), 每个声明 `requiredPrompt` 与 backend `/setup.supported_prompts` 联动; backend 不支持的工具自动置灰 + tooltip 提示. 工具激活时右侧浮出 `AIToolDrawer` (后端 + 工具特定控件 + 参数面板). 自研最小 `SchemaForm` (~200 行, 不引 `@rjsf`) 从 `/setup.params` 自动渲染 number/boolean/enum/string 控件, 用户可在工作台动态调 `box_threshold` 等参数, 透传到 `/interactive-annotating` 请求体. → [plan](docs/plans/2026-05-14-v0.10.2-prompt-first-tooldock.md) · [roadmap](ROADMAP/0.10.x.md).

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

> **Capability 协商基础设施 (M1).** 把 ML backend 的 `/setup` 标准化为 JSON Schema 自描述协议, apps/api 暴露 `/projects/{id}/ml-backends/{bid}/setup` 代理端点, 前端落地 `useMLCapabilities` hook 作为 ML 能力的单一事实源. 同时落地 `MAX_ML_BACKENDS_PER_PROJECT` env (默认 1) 锁住运行时 1:1, DB/UI 一步到位 1:N. 本期 hook 只挂载、不消费; M2 (v0.10.2 Prompt-first ToolDock) 才接入消费. → [plan](docs/plans/2026-05-14-v0.10.1-capability-negotiation.md) · [roadmap](ROADMAP/0.10.x.md).

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

> **SAM 3 接入 M0 — sam3-backend 容器化 + exemplar 协议落地.** v0.10.x 双 backend 并存策略的第一步: 把 `facebookresearch/sam3` (848M, 单档) + `facebook/sam3.1` 权重打包成独立 GPU 服务, 与 grounded-sam2-backend 并存. 镜像 grounded-sam2-backend 结构, 复用 `apps/_shared/mask_utils` 共享包. 协议新增 `context.type="exemplar"` (视觉示例 prompt → 全图相似实例), 仅 sam3-backend 支持; 前端 UI 入口与 apps/api 路由策略留 v0.10.1. → [plan](docs/plans/roadmap-0-10-x-md-0-10-0-mellow-lantern.md) · [roadmap](ROADMAP/0.10.x.md).

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


<!-- v0.10.0 起的版本变更直接追加到本节；当开始开发0.11版本后再移到 docs/changelogs/0.10.x.md -->
---
