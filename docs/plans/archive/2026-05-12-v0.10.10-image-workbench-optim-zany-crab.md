# v0.10.10 — 图片工作台 0.10.x 收尾（I11 e2e + dirtyRect + I8.2 fixture + I17.3 项目级渲染配置）

> 对应 roadmap：[ROADMAP/[archived]2026-05-12-image-workbench-optimization.md](../../ROADMAP/[archived]2026-05-12-image-workbench-optimization.md)
> 前置：v0.10.4-v0.10.9（Wave β + Wave γ 关键能力已落地，I11 Mask 编辑器三入口齐全）

## Context

v0.10.x 的 ML 工具 UI 重构（v0.10.0-v0.10.3）与图片工作台 Wave β/γ（v0.10.4-v0.10.9）已基本落地。剩余「0.10.x 范围内能收的尾巴」集中在四块：

1. **I11 Mask 编辑器**：v0.10.7 epic 明确承诺「完整 e2e 推迟到 v0.10.7.1」，v0.10.9 又把手测推迟到「真实数据」；同时 v0.10.8 留下 dirtyRect TODO（每笔全量 `putImageData`，大图掉帧风险），用户文档 `docs-site/user-guide/for-annotators/` 还没 mask 笔刷条目。
2. **I8.2 基准 fixture**：Wave α 起一直未做；`apps/web/e2e/tests/workbench-perf.spec.ts` 本身就挂着 TODO 注释。`useWorkbenchPerf` hook 已就位 + `ImageStage` 已 wire，差「批量生成 fixture + dump 基准 JSON」。
3. **I17.3 项目级渲染配置**：Wave α 只交付了用户级 preferences（`User.preferences.workbench`），项目级覆盖未做；医学影像场景需要项目级强制「无插值 + 灰度反色」。
4. **v0.10.9 收尾小修**：126 lint warnings（务实配置，逐步收紧）+ AttributeForm codegen 类型未入仓（generated 在 .gitignore，开发流程未文档化）。

单版本 v0.10.10 一次发，CHANGELOG 一段。版本号是 0.10.x 最后一发，之后进入 v0.11.0（I1 大图 tile 独立 epic）。

## 范围与不做

**做**：
- §1 I11 Mask Playwright e2e（3 入口 + B/E/Enter/Esc/Shift+滚轮）
- §2 I11 Mask user-guide 文档（`docs-site/user-guide/for-annotators/mask-brush.md`）
- §3 I11 MaskBuffer dirtyRect 增量重绘
- §4 I8.2 image-bench 脚本（镜像 scripts/video-bench）+ `_test_seed` 加 density/size 入参
- §5 I17.3 `Project.rendering_config` JSONB + ProjectSettings UI + `useWorkbenchConfig` 合并链
- §6 收尾：codegen 流程写进 DEV.md；lint warnings 摘低垂果实（不追零）

**不做**（明确推迟）：
- I1 大图 tile 金字塔 → v0.11.0 独立 epic（后端切片 worker 重）
- I9 Ellipse / I10 Skeleton / I11 v2 RLE → v0.11.x（与 geometry.kind 收口同期）
- I11 bbox 候选 → mask 初始填充 → v0.11+（与 I9 一起）
- mask 跨任务持久化、mask 多组件入库 → v0.11+
- I17 项目级「lock」语义（防止用户级 override 项目锁定字段） → 本期只做覆盖优先级，不引入显式 lock 元数据；用户级若与项目级冲突直接 silent override，UI 提示「该字段由项目锁定」即可
- Tracker / Auto-Annotation 协议统一收口（I20 残留） → v0.11+

---

## §1 · I11 Mask Playwright e2e

**目标**：覆盖三个精修入口 + mask 工具内 hotkey 全集，CI 单 worker 跑得稳。

**文件**：
- 新增 [`apps/web/e2e/tests/mask-editor.spec.ts`](../../apps/web/e2e/tests/mask-editor.spec.ts)
- 复用：[`apps/web/e2e/fixtures/seed.ts`](../../apps/web/e2e/fixtures/seed.ts) `SeedAPI.reset()` / `SeedAPI.injectToken()`；[`apps/web/e2e/tests/annotation.spec.ts`](../../apps/web/e2e/tests/annotation.spec.ts) 的工具按钮 + 拖拽手势模板

**e2e 用例**（最小集）：

1. **空白 mask → polygon 入库**：annotator 登录 → 进 task → 按 M 切 mask 工具 → 鼠标在画布上画一笔（拖拽 ~50px）→ 按 Enter → 断言 `BoxesList` 多一行 polygon
2. **user polygon 精修**：先用 PolygonTool 画一个 polygon → 右侧侧栏点「精修」按钮 → mask 工具激活 + buffer 已从原 polygon 初始化 → 用 erase（按 E）擦一块 → 按 Enter → 断言原 annotation `geometry` 已变化（同一 ID）
3. **AI prediction 精修**：通过 `SeedAPI` 注入一条预设 polygon prediction（在 fixture seed 里加 helper）→ 在 AIInspector 行点「精修」→ mask 编辑 → Enter → 断言原 prediction 已 reject + 新 polygon annotation 入库
4. **hotkey 全集**：在 mask 工具激活态依次按 B（切笔刷）/ E（切橡皮）/ Esc（取消）/ Shift+滚轮（半径变化）→ 断言 MaskToolbar UI 文案/半径 slider 同步

**Seed 扩展**（最小）：
- [`apps/api/app/api/v1/_test_seed.py`](../../apps/api/app/api/v1/_test_seed.py) 增 `POST /__test/seed/inject-prediction`，body `{ task_id, geometry, label_id }`，绕过 AI backend 直接 INSERT `predictions` 行；只供 e2e + dev

**风险与决策**：
- **SAM 候选精修入口（v0.10.9 加的第三入口）**：需要真实 ml-backend 才能产出 SAM 候选，e2e 太脆；本期 **不覆盖** SAM 入口的 e2e，只在用户文档里写明操作步骤；单测层面 `useImageAnnotationActions.test.ts` 已经分流测过 kind=`sam`/`user`/`prediction`，e2e 覆盖另两条入口即可
- Konva 像素操作 vs Playwright 坐标：用 `page.mouse.down/move/up` 直接走 page coords；不依赖 Konva 命中

---

## §2 · I11 Mask user-guide 文档

**文件**：新增 [`docs-site/user-guide/for-annotators/mask-brush.md`](../../docs-site/user-guide/for-annotators/mask-brush.md)

**结构**（镜像 [`sam-tool.md`](../../docs-site/user-guide/for-annotators/sam-tool.md)）：
- frontmatter：`audience: annotator, type: how-to, since: 0.10.8, last_reviewed: 2026-05-19`
- §「什么时候用」：粗结果 → 笔刷细修场景（AI 候选过糙 / user polygon 局部修正）
- §「三种进入方式」：① M 键 / ToolDock 直接空白 mask；② AIInspector 行「精修」（AI polygon 候选）；③ 已落库 polygon 侧栏「精修」（user polygon）；④ SAM 候选画布浮按钮 + R 键（v0.10.9 加）
- §「快捷键」：M / B / E / Enter / Esc / Shift+滚轮（直接引用 [`hotkeys.generated.md`](../../docs-site/user-guide/for-annotators/hotkeys.generated.md) 不重复表）
- §「已知限制」：bbox 候选不支持初始化（v0.11+）/ 多连通区只保留最大外环（多连通时 toast 警告）/ 大画布性能（链到 v0.10.10 dirtyRect 优化）
- 索引：[`docs-site/user-guide/for-annotators/index.md`](../../docs-site/user-guide/for-annotators/index.md) 补一行链入

---

## §3 · I11 MaskBuffer dirtyRect 增量重绘

**目标**：消除 v0.10.8 留的全量 `putImageData` 性能债，大画布（>4K）笔刷拖动 ≥30fps。

**改动点**：

1. **MaskBuffer API 扩展**（[`apps/web/src/pages/Workbench/stage/shared/geometry/maskBuffer.ts`](../../apps/web/src/pages/Workbench/stage/shared/geometry/maskBuffer.ts)）：
   - 新增私有字段 `private _dirty: { x0, y0, x1, y1 } | null = null`（半开区间，`null` 表示无脏区）
   - `brush() / erase() / fromPolygon() / clear()` 内部按操作影响范围 union 进 `_dirty`（brush/erase 是 `cx±r` 的方框 clamp 到 0..width/height；fromPolygon 是 polygon bbox；clear 是全图）
   - 新增 `consumeDirty(): DirtyRect | null` —— 返回当前脏区并清空（典型用法：渲染层读完就 reset）
   - 新增 `toAlphaImageDataRect(rect): ImageData` —— 只切片返回 rect 区域的 alpha；签名与 `toAlphaImageData()` 平行
   - 单测加：① brush 后 consumeDirty 返回正确 rect ② 两次 brush 后 union 正确 ③ consumeDirty 后 buffer 数据无变化、再次 consume 返 null ④ clear 后 dirty = 全图 ⑤ fromPolygon 的 dirty 是 polygon bbox ⑥ toAlphaImageDataRect 子区域字节正确

2. **MaskOverlayLayer 改为增量绘制**（[`apps/web/src/pages/Workbench/stage/overlays/MaskOverlayLayer.tsx`](../../apps/web/src/pages/Workbench/stage/overlays/MaskOverlayLayer.tsx)）：
   - useEffect 触发条件不变（仍跟 `revision`）；内部改为 `const rect = buffer.consumeDirty(); if (!rect) return;` → `buffer.toAlphaImageDataRect(rect)` → 染红 → `ctx.putImageData(imageData, rect.x0, rect.y0)` → `layer.batchDraw()`
   - 首次激活（`active` 从 false → true）走一次全量（rect = 全图）确保渲染层与 buffer 初态一致

3. **useMaskEditor 不变**：`revision` 计数器保留，作为「有改动需要重画」的通知信号；脏区数据从 `buffer.consumeDirty()` 取，不进 React state（避免不必要 re-render）

4. **回归**：BoxListItem / MaskTool 现有单测无需改；useMaskEditor 单测加 1 例 `revision` 在 brush 后递增（应该已有，确认即可）

**衡量**：v0.10.10 CHANGELOG 「Verified」段记录手测——8K 画布 brush 拖动顺畅；不强求 perf fixture 出数（perf fixture 在 §4 才落地）

---

## §4 · I8.2 image-bench 基准 fixture

**目标**：建 3 张图（2K / 8K / polygon-密集）× 3 套标注密度（10 / 100 / 500 shapes）的固定 fixture，跑 Playwright 出 `useWorkbenchPerf` longtask + FPS 基准 JSON。

**文件**（镜像 [`apps/web/scripts/video-bench/`](../../apps/web/scripts/video-bench/)）：
- 新增 [`apps/web/scripts/image-bench/fixtures.json`](../../apps/web/scripts/image-bench/fixtures.json)：3×3 场景矩阵（`{ name, imageSize: "2k"|"8k"|"polygon-dense", density: 10|100|500 }`）
- 新增 [`apps/web/scripts/image-bench/run-image-bench.mjs`](../../apps/web/scripts/image-bench/run-image-bench.mjs)：orchestrate 矩阵 → 每场景 reset seed + `?density=&imageSize=` → spawn Playwright spec → 收集 `window.__workbenchPerf` 写 `test-results/image-bench/{runId}/summary.json`
- 新增 [`apps/web/e2e/tests/image-bench-fixtures.spec.ts`](../../apps/web/e2e/tests/image-bench-fixtures.spec.ts)：单一 test，按环境变量 `IMAGE_BENCH_DENSITY` / `IMAGE_BENCH_SIZE` 读 seed → 进工作台 → 模拟 pan/zoom/select 各 N 次 → `page.evaluate(() => window.__workbenchPerf)` 输出
- package.json 加 script：`"image:bench": "node scripts/image-bench/run-image-bench.mjs"`

**后端 seed 扩展**（[`apps/api/app/api/v1/_test_seed.py`](../../apps/api/app/api/v1/_test_seed.py)）：
- `POST /__test/seed/reset` 接受可选 query：`?image_size=2k|8k|polygon-dense&annotation_density=10|100|500`
- 实现：
  - `image_size`：预生成三张 PNG 放 `apps/web/e2e/fixtures/assets/`（2k = 2048×2048 渐变 / 8k = 8192×8192 同一渐变 / polygon-dense = 2k 但贴满复杂边界的图），seed 时写入 MinIO 对应 bucket，task `file_path` 指向
  - `annotation_density`：raw SQL `INSERT INTO annotations` 批量生成；polygon 顶点用 Python 随机闭合多边形（10/100 是 bbox+polygon 混合，500 全 polygon、每个 50 顶点逼近 polygon-dense 场景）
- 不修改 `Annotation` model；走现有 `geometry` JSONB

**不做**：CI 集成（image:bench 只人工触发，输出 baseline JSON 入仓 `docs/benchmarks/image-bench-v0.10.10.json` 作为基线快照）。后续版本对比时 diff 这份 JSON。

**衡量**：`pnpm --filter web image:bench` 成功跑完 9 个场景，summary.json 每场景含 longTaskCount / longTaskMaxMs / 操作总耗时；2k×10shapes 场景 `longTaskCount == 0` 作 sanity。

---

## §5 · I17.3 项目级渲染配置覆盖

**目标**：项目管理员可在 ProjectSettings 设置项目级 `rendering_config`，工作台合并优先级 = **项目级 > 用户级 > 内置默认**。本期不引入显式「lock」字段；项目级有值即覆盖（前端 UI 提示 badge）。

**Schema**（与 `WorkbenchPreferences` 字段同集，便于复用 form 控件）：
- `smoothImage?: bool`
- `cssImageFilter?: string`
- `controlPointsSize?: int (2..20)`
- `snapToGrid?: bool`
- 所有字段 optional —— `null/undefined` 表示「项目不覆盖，沿用用户级」
- 不含 `longTaskSampleRate`（perf 取样属于用户/环境层，不该被项目锁）

**后端改动**：

1. [`apps/api/app/db/models/project.py`](../../apps/api/app/db/models/project.py)：新增 `rendering_config: dict = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))`
2. [`apps/api/app/schemas/_jsonb_types.py`](../../apps/api/app/schemas/_jsonb_types.py)：新增 `ProjectRenderingConfig(BaseModel)`，字段同上，`model_config = {"extra": "forbid"}`
3. [`apps/api/app/schemas/project.py`](../../apps/api/app/schemas/project.py)：`ProjectUpdate` / `ProjectOut` 加 `rendering_config: ProjectRenderingConfig | None`
4. PATCH `/projects/{id}` 不改 handler（已 generic setattr）；但加一层 Pydantic 校验：拿到 `rendering_config` 时 `ProjectRenderingConfig.model_validate(payload)` 严格防 typo
5. Alembic 新 migration `apps/api/alembic/versions/006X_project_rendering_config.py`（X = 现有最大 +1），模式参考 [`0048_project_dino_thresholds.py`](../../apps/api/alembic/versions/0048_project_dino_thresholds.py)
6. 后端单测：① ProjectUpdate 接受合法 rendering_config ② 拒绝 extra key ③ 拒绝 controlPointsSize 越界 ④ GET 返回带新字段

**前端改动**：

1. [`apps/web/src/pages/Projects/sections/RenderingConfigSection.tsx`](../../apps/web/src/pages/Projects/sections/RenderingConfigSection.tsx)（新）：mirror `WorkbenchPreferencesSection` 字段控件；每行加「覆盖此项」开关 + 控件本身；未开覆盖时显示「跟随用户偏好」文案
2. [`apps/web/src/pages/Projects/ProjectSettingsPage.tsx`](../../apps/web/src/pages/Projects/ProjectSettingsPage.tsx)：sidebar 加「渲染配置」tab（在 general 与 ml-backends 之间）
3. [`apps/web/src/pages/Workbench/state/useWorkbenchConfig.ts`](../../apps/web/src/pages/Workbench/state/useWorkbenchConfig.ts)：合并链改为 `DEFAULTS → user.preferences.workbench → project.rendering_config`；新增 `lockedFields: string[]`（项目级有值的字段名集合）随 hook 返回
4. [`apps/web/src/pages/Settings/SettingsPage.tsx`](../../apps/web/src/pages/Settings/SettingsPage.tsx) `WorkbenchPreferencesSection`：被项目锁定的字段加「项目锁定」灰色 badge + disabled（消费 `lockedFields`）；hover tooltip 链到项目设置
5. 前端需 `pnpm --filter web codegen` 重生 generated types（项目响应体新字段）；本期不入仓，开发流程文档化在 §6
6. 单测：① useWorkbenchConfig 合并优先级 ② lockedFields 计算 ③ RenderingConfigSection 切换覆盖开关 ④ SettingsPage 字段在项目锁定下 disabled

**衡量**：手测——admin 设置项目 `smoothImage = false` → annotator 进工作台像素无插值；annotator Settings 中 smoothImage 字段灰显「项目锁定」。

---

## §6 · v0.10.9 收尾小修

1. **AttributeForm codegen 流程文档化**：
   - [`DEV.md`](../../DEV.md) 加章节「前端 codegen」：明确 `apps/web/src/api/generated/` 在 .gitignore；`pnpm --filter web codegen` 何时跑（OpenAPI 变更后）；`prebuild` 自动 codegen-if-changed（已有 `apps/web/scripts/codegen-if-changed.mjs`），所以本地 dev / CI 不会漏；只有「typecheck 前」开发者首次 clone 需手动 codegen 一次
   - 不做：把 generated 文件入仓（背离现有 .gitignore 决策，且每次 PR 会 diff 噪声）

2. **Lint warnings 摘低垂果实**：
   - 跑 `pnpm --filter web lint` 看 126 条 warning 分类
   - 摘 unused-vars（`argsIgnorePattern: "^_"` 通常可加下划线快速消）
   - 摘明显的 `no-explicit-any`（改成具体类型或 `unknown`）
   - 不动 `react-refresh/only-export-components`（涉及组件文件结构重构，超 scope）
   - 目标：把 126 降到 < 80；不追零

---

## §7 · 复用清单

| 复用 | 来源 | 用法 |
|---|---|---|
| `useWorkbenchPerf` | `stage/shared/useWorkbenchPerf.ts` | §4 image-bench 直接读 `window.__workbenchPerf` |
| `SeedAPI.reset/injectToken` | `e2e/fixtures/seed.ts` | §1 mask e2e + §4 image-bench |
| `_test_seed` router | `apps/api/app/api/v1/_test_seed.py` | §1 加 inject-prediction；§4 加 density/size 参 |
| `WorkbenchPreferencesSection` | `pages/Settings/SettingsPage.tsx` | §5 RenderingConfigSection 镜像字段控件 |
| `GeneralSection` PATCH 模式 | `pages/Projects/sections/GeneralSection.tsx` | §5 RenderingConfigSection 复用 `useUpdateProject` |
| `0048_project_dino_thresholds.py` | `apps/api/alembic/versions/` | §5 新 migration 模板 |
| `scripts/video-bench/run-video-bench.mjs` | `apps/web/scripts/video-bench/` | §4 镜像为 image-bench |
| `sam-tool.md` frontmatter + 结构 | `docs-site/user-guide/for-annotators/` | §2 mask-brush.md 模板 |

---

## §8 · 验证方案

**自动化**：
- `pnpm --filter web typecheck` 全绿（generated 本地 codegen 后）
- `pnpm --filter web test --run` 全绿（mask buffer dirtyRect 新增 ~6 例 + useWorkbenchConfig 合并新增 ~3 例 + RenderingConfigSection 新增 ~2 例 + 后端 schema 新增 ~4 例）
- `pnpm --filter web test:e2e` 包含新 mask-editor.spec.ts（4 用例）全绿
- `cd apps/api && uv run pytest tests/test_projects.py -k rendering_config` 全绿
- `pnpm --filter web lint` warning 数 < 80（基线 126）

**手测**（CHANGELOG「Verified」段记录）：
- §1 e2e 在本地 docker compose 起完整栈跑通
- §3 dirtyRect：seed 一张 8K 图，mask brush 连续拖动 ≥ 3 秒，肉眼无卡顿 / `useWorkbenchPerf` longTaskCount 较 v0.10.9 基线下降
- §4 `pnpm --filter web image:bench`：9 场景全跑完，`docs/benchmarks/image-bench-v0.10.10.json` 入仓
- §5：① admin 在 ProjectSettings 设 `smoothImage = false` → 进工作台像素无插值 ② annotator Settings 中该字段 disabled + 「项目锁定」 badge ③ admin 关闭覆盖 → annotator 字段恢复可调

---

## §9 · 文档同步清单（提交前自检）

- [ ] CHANGELOG.md 顶端加 v0.10.10 段（沿用 v0.10.9 详尽风格，链到本 plan + roadmap + ADR 如有新增）
- [ ] ROADMAP/[archived]2026-05-12-image-workbench-optimization.md：Wave β I8.2 → ✅ v0.10.10；Wave γ I17.3 → ✅ v0.10.10；I11 dirtyRect TODO → ✅ v0.10.10；e2e 推迟 → ✅ v0.10.10
- [ ] docs-site/user-guide/for-annotators/index.md：加 mask-brush 链接
- [ ] docs-site/user-guide/for-annotators/mask-brush.md：新增（§2）
- [ ] DEV.md：加「前端 codegen」章节（§6）
- [ ] docs/benchmarks/image-bench-v0.10.10.json：基线 JSON 入仓（§4）
- [ ] 不新增 ADR（本期都是已有决策的兑现）

---

## §10 · 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| §1 e2e 在 CI 环境 mask brush 像素操作不稳（坐标对齐） | 中 | 用例 flaky | 用 `page.mouse` 走 page coords + 拖拽前后做 `await expect(mask buffer toast)` 等显式断言；CI workers=1 已规避并发 |
| §3 dirtyRect union 边界 off-by-one | 中 | mask 边缘 1px 错位 | 单测覆盖：① 紧贴边界的 brush ② 跨边界的连续 brush ③ consumeDirty 后再 brush |
| §4 8K 图入仓 ~15MB 一张 × 3 = 45MB+ | 高 | 仓库膨胀 | 用 git-lfs；如果团队还没 lfs，则改为 build-time 程序生成（PIL 渐变 + polygon 贴图，run-image-bench.mjs 启动时输出到 test-results/） |
| §5 lockedFields 在工作台与 Settings 间不同步（缓存） | 低 | annotator 看到旧锁定态 | useWorkbenchConfig + Settings 都走同一 `useProject(projectId)` query；project PATCH 后 invalidate |
| §6 lint 修复引入意外行为变化 | 中 | 回归 | 每条 warning 单独 commit；只动 unused-vars 加下划线 + no-explicit-any 明确类型，不重构逻辑 |
