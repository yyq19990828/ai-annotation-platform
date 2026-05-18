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

## [Unreleased]

### Changed

- **CSP style-src sections + Workbench + Dashboard + 基础 UI 群续推**：`pages/Projects/sections/*.tsx` 已清空 inline style，`BatchesSection` 原 1 处 CSS custom property hatch 改为三档 class 切换，也已清零；`pages/Workbench/**/*.tsx` 从 578 处 JSX `style=` 清到 0，并整体纳入 `no-restricted-syntax` guard；`pages/Dashboard/**/*.tsx` 同步清零并纳入 guard；`pages/AIPreAnnotate/**/*.tsx` 本轮清零并纳入 guard。`components/ui` 18 个基础组件自身 JSX `style=` 已清零并纳入 guard；`Button` / `Card` / `Badge` / `Icon` / `Avatar` 继续保留 public `style` prop 兼容性，但改由 `useElementStyle` ref 同步 DOM style，不再在组件 JSX 中透传。`TextOutputDefaultSelect` 补 `className` 透传，避免 GeneralSection 继续用 inline 传入控件样式。本轮继续清空 `components/shell/**/*.tsx`、`components/bugreport/**/*.tsx`、`PageLoader` / `Thumbnail` / `AnnotationHistoryTimeline`。当前全站 `rg "style\\s*=" apps/web/src --glob '*.tsx'` 为 1269 处。→ [plan](docs/plans/2026-05-18-v0.10.12-csp-style-src-sections.md) · [ROADMAP §B](ROADMAP.md) · [迁移指南](docs-site/dev/how-to/migrate-inline-style-to-css-modules.md)

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
