# v0.10.4 — 图片工作台 Wave β + γ 关键能力收口

## Context

`ROADMAP/2026-05-12-image-workbench-optimization.md` 写于 2026-05-12（v0.9.40 时点），之后落地 v0.9.41 (Wave α) 与 v0.10.0-0.10.3（SAM 3 接入 / Capability 协商 / Prompt-first ToolDock / 1:N 后端管理 UI）。多条 roadmap 条目状态过时或被新版本覆盖，且 Wave β（必做）与 Wave γ 关键能力（I11/I13/I15）一直没动，工作台在性能与形状能力两侧都有明显缺口。

本计划做两件事：
1. **Roadmap 现状校准**：把过时描述更新成与代码一致的口径，标记已覆盖项。
2. **v0.10.4 epic 开发**：Wave β 全套（I1 + I2 + I6）+ Wave γ 中 I15 / I13 / I11 三条用户钦点。按 sub-milestone 拆 4 个子版本 v0.10.4-v0.10.7 落地，沿用 v0.10.x 的 M-letter 工作流。

## Roadmap 校准（独立 commit，先落，不绑死 v0.10.4 epic 推进节奏）

逐项改 `ROADMAP/2026-05-12-image-workbench-optimization.md` 后再同步 [`docs/plans/2026-05-13-v0.9.41-image-workbench-wave-alpha.md`](docs/plans/2026-05-13-v0.9.41-image-workbench-wave-alpha.md) 的引用：

| 条目 | 当前 roadmap 描述 | 校准为 | 依据 |
|---|---|---|---|
| I20 Interactor 协议 | 待做 (M) | **✅ v0.10.1 已落地 ~90%**：`GET /setup` JSON Schema + `supported_prompts` + `params` schema + setup proxy + useMLCapabilities hook 已对齐 roadmap I20.1-3。残留 `auto-annotation / tracker` 类型扩展挪 v0.11+。 | [docs/adr/0020-ml-backend-capability-negotiation.md](docs/adr/0020-ml-backend-capability-negotiation.md)、[apps/api/app/api/v1/ml_backends.py:27](apps/api/app/api/v1/ml_backends.py:27)、[apps/web/src/pages/Workbench/state/useMLCapabilities.ts](apps/web/src/pages/Workbench/state/useMLCapabilities.ts) |
| I13 Attribute Schema | "当前只有简单 select" | **现状**：已支持 6 种 input_type (text/number/boolean/select/multiselect/range) + 必填校验高亮 + 条件级联 (`visible_if`) + 按 schema 自动 Form。**残留**：mutable/immutable 标记字段 + 视频 track 属性的"逐帧编辑"UI。 | [apps/web/src/pages/Workbench/shell/AttributeForm.tsx:47](apps/web/src/pages/Workbench/shell/AttributeForm.tsx:47)、[apps/api/app/schemas/_jsonb_types.py:29](apps/api/app/schemas/_jsonb_types.py:29) |
| I14 Autoborder | "依赖 martinez" | 改为"基于已有依赖 `polygon-clipping@0.15.7`"（iou.ts 已用作 IoU 求交）。 | [apps/web/package.json:39](apps/web/package.json:39)、`apps/web/src/pages/Workbench/.../iou.ts` |
| I15 z_order/lock/hidden/occluded | "目前只有 lock/hidden 部分支持" | **现状**：仅前端 transient 显示状态；**DB schema 字段全空白**（annotation 表无 group_id/z_order/lock/hidden/occluded）。需新加字段+持久化。 | [apps/api/app/db/models/annotation.py:9](apps/api/app/db/models/annotation.py:9) |
| I16 脏标记 | ✅ v0.9.41 | 现版本"基础设施已就位 (`useDirtyTracker`) 但无消费方"，由 v0.10.4 M4-γ 的 I13 mutable 属性批量编辑首次消费。 | [apps/web/src/pages/Workbench/state/useDirtyTracker.ts](apps/web/src/pages/Workbench/state/useDirtyTracker.ts) |
| I2 R-tree | 待做 | 文案补"扩展现有 `rbush` 索引（iou-index.ts 已用于 IoU 排除）到 polygon 顶点命中测试"。 | `apps/web/src/pages/Workbench/.../iou-index.ts:9` |
| I6 SAM 缓存 | 待做 | 拆分：**后端 embedding LRU 已就位**（grounded-sam2 + sam3 都有 `EmbeddingCache`，`/cache/stats`）；**前端 mask cache + 进入工作台 embed 预热未做**。 | `apps/grounded-sam2-backend/embedding_cache.py`、`apps/sam3-backend/...embedding_cache.py` |

校准 commit 文案：`docs: 校准 image-workbench-optimization roadmap 与现状对齐 (I20/I13/I14/I15/I16/I2/I6)`。

---

## v0.10.4 epic（sub-milestone 拆分）

沿用 v0.10.x epic 的子版本节奏（v0.10.0 M0 / v0.10.1 M1 / ... v0.10.3 M3）。本 epic 即 M4，按交付节奏拆 4 个子版本：

| 子版本 | 范围 | 估时 | 关键风险 |
|---|---|---|---|
| **v0.10.4 (M4-α)** | I2 polygon LOD/命中/差量 + I6.1 前端 mask cache + I6.2 embed 预热 | 1-2 周 | 纯前端 + 性能基线 fixture；最低 |
| **v0.10.5 (M4-β)** | I15 z_order/lock/hidden/occluded 字段一等态 + UI | 1 周 | 一条 alembic + 现有快捷键扩展；中 |
| **v0.10.6 (M4-γ)** | I13 mutable/immutable + 视频 track 属性逐帧 UI（消费 useDirtyTracker） | 1-2 周 | 视频 track 已有数据形态，前端 UI 工作量大；中 |
| **v0.10.7 (M4-δ)** | I11 Mask 编辑器（笔刷/橡皮/polygon-plus-minus + RLE）+ SAM mask→mask 二次精修 | 2-3 周 | 全新工具 + 离屏 canvas 像素层 + 后端 RLE schema；高 |
| **v0.10.8 (M4-ε，可选)** | I1 大图 tile（金字塔 + 前端 tile 加载） | 2-3 周 | 后端切片 worker 新写；很高，建议挪 v0.11.0 独立 epic |

> **建议**：I1 大图 tile（M4-ε）因体量与后端 schema 重，独立到 v0.11.0 而不是塞进 v0.10.x epic 尾部。Roadmap 校准时把 M4-ε 标 "deferred to v0.11.0"，本计划不展开 M4-ε 细节。

---

### M4-α (v0.10.4)：polygon 性能闭环 + SAM 缓存

**目标**：500 顶点 polygon 拖动 ≥60fps、100 polygon 同屏选择 <100ms、SAM 重复点击 <100ms。

**I2.1 Douglas-Peucker LOD（顶点简化）**
- 新增 `apps/web/src/pages/Workbench/stage/shared/geometry/simplify.ts`，实现 RDP 算法（输入：原 points + epsilon；输出：简化后 points）。
- 在 [ImageStageShapes.tsx](apps/web/src/pages/Workbench/stage/ImageStageShapes.tsx) 的 `KonvaPolygon` 里：渲染 path 用 `useMemo(() => simplify(points, 1/scale), [points, scale])`；编辑模式（选中态）跳过简化，用原顶点。
- 工具：viewport 的 `scale` 从已有 [useViewportTransform](apps/web/src/pages/Workbench/stage/shared/useViewportTransform.ts) 拿。

**I2.2 自相交检测增量化**
- 改 [polygon.ts:28 `isSelfIntersecting`](apps/web/src/pages/Workbench/stage/shared/geometry/polygon.ts:28)：保留 O(n²) 旧函数作 `isSelfIntersectingFull`；新增 `isSelfIntersectingIncremental(prevPolygon, changedIdx, newPt)` 只检测受影响的 2 条新边 vs 其他边 = O(n)。
- 调用方：PolygonTool 的 commit/preview 路径只在新加点或拖顶点时调增量版；保留全量版用于"加载已有 polygon"一次性校验。

**I2.3 R-tree 顶点命中粗筛**
- 扩 [iou-index.ts](apps/web/src/pages/Workbench/stage/iou-index.ts)：新增 `buildVertexIndex(annotations)`，每个 polygon 顶点入 rbush（按 ±5px viewport buffer）。
- 配合 polygon 选中态的顶点拖拽：viewport pointermove 时先查 rbush 候选顶点，再精确距离判定。<100 polygon 同屏时观测命中测试耗时是否下降 ≥50%。

**I2.4 顶点拖拽 history batch kind**
- 改 [useAnnotationHistory](apps/web/src/pages/Workbench/state/useAnnotationHistory.ts)（若不存在则查实际历史栈位置）：新增 history kind `"polygonVertexBatch"`，commit 时压栈一条 `{ before: polygon, after: polygon, vertices: [...idx] }`。
- ImageStage.tsx 的 pointerup 路径（[L379-384 onCommitPolygonGeometry](apps/web/src/pages/Workbench/stage/ImageStage.tsx:379)）：改为传 `{ kind: "polygonVertexBatch" }`。
- 验收：连续拖 5 个顶点后 Cmd+Z 一次回到拖动前。

**I6.1 前端 mask cache**
- 新增 `apps/web/src/pages/Workbench/state/useSamCache.ts`：LRU 32 项，key = `${imageId}|${promptKind}|${normalize(prompts)}`，value = `{ candidate: PendingCandidate, timestamp }`。
- 接入 [useInteractiveAI.ts:22](apps/web/src/pages/Workbench/state/useInteractiveAI.ts:22) 的 `runPoint / runBbox / runExemplar`：发请求前查缓存；命中直接 resolve；miss 命中后写入。
- 切换 backend / `/setup` capability 变更时 `clearAll()`（订阅 useMLCapabilities）。

**I6.2 embed 预热**
- 工作台 mount 时（[WorkbenchShell.tsx](apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx)），任务是 image 类型 + 有绑定 backend 时，异步触发一次 `runPoint`/`runBbox` 等价的"warmup ping"。当前 ML backend 协议没有专门 warmup 端点，采用低成本 prompt（dummy point @ image center）丢弃结果的策略。
- 限速：每个 (image_id, backend_id) 一次性，由 useSamCache 自然命中防重复。

**I8.2 基准 fixture**
- 新增 `apps/web/e2e/fixtures/workbench-perf/`：3 张图片（2K / 8K / dense-polygon）+ 3 套 annotation 密度（10 / 100 / 500 shapes），seed 脚本可上传。
- Playwright e2e `apps/web/e2e/tests/workbench-perf.spec.ts`：每个 fixture 跑 viewport 缩放、polygon 拖动、SAM 点击三个动作，断言 `window.__workbenchPerf.longTaskMaxMs < 100`。

**关键文件**：
- 新增：`stage/shared/geometry/simplify.ts`, `state/useSamCache.ts`, `e2e/fixtures/workbench-perf/`, `e2e/tests/workbench-perf.spec.ts`
- 修改：`stage/shared/geometry/polygon.ts`, `stage/ImageStageShapes.tsx`, `stage/ImageStage.tsx`, `stage/iou-index.ts`, `state/useInteractiveAI.ts`, `shell/WorkbenchShell.tsx`, `state/useAnnotationHistory.ts`

---

### M4-β (v0.10.5)：形状元数据一等态（I15）

**目标**：`z_order / lock / hidden / occluded` 字段持久化 + UI 切换 + 快捷键。

**后端**
- 新增 alembic `0065_annotation_shape_metadata.py`：annotation 表加 `z_order int default 0`、`is_locked bool default false`、`is_hidden bool default false`、`is_occluded bool default false`。
- 改 [apps/api/app/db/models/annotation.py](apps/api/app/db/models/annotation.py) 加 mapped_column。
- 改 [apps/api/app/schemas/annotation.py](apps/api/app/schemas/annotation.py) 的 `AnnotationCreate / AnnotationUpdate / AnnotationOut` 透出字段。
- PATCH 路径已字段级，无需改 [tasks.py:845](apps/api/app/api/v1/tasks.py:845)；只 ensure 4 个新字段进 allowed_fields。

**前端**
- 改 [ImageStageShapes.tsx](apps/web/src/pages/Workbench/stage/ImageStageShapes.tsx)：`KonvaBox / KonvaPolygon` 按 `is_hidden` 跳过渲染、`is_locked` 禁用 drag/resize、`is_occluded` 改虚线 dash + 50% opacity。
- 渲染顺序：annotation 列表按 `z_order` 排序后再渲染（高 z_order 在上），保留同序按 array 顺序兜底。
- 右栏 ObjectList / 形状卡片加 4 个 toggle icon（lock / eye / occluded / z_order 上下移）。
- 快捷键：`L` 切 lock、`H` 切 hidden、`O` 切 occluded、`[` `]` z_order 上下。注册到 [hotkeys.ts](apps/web/src/pages/Workbench/hotkeys.ts) 的现有 action 表。
- E2E：扩 `apps/web/e2e/tests/annotation.spec.ts` 加 4 个新 action 的回归用例。

**关键文件**：
- 新增：`apps/api/alembic/versions/0065_annotation_shape_metadata.py`
- 修改：`apps/api/app/db/models/annotation.py`、`apps/api/app/schemas/annotation.py`、`apps/web/src/pages/Workbench/stage/ImageStageShapes.tsx`、`shell/ObjectList.tsx`（实际路径待确认）、`hotkeys.ts`

---

### M4-γ (v0.10.6)：Attribute Schema 进阶（I13）

**目标**：mutable/immutable 区分 + 视频 track 属性逐帧编辑 + useDirtyTracker 首次消费。

**后端**
- 新增 alembic `0066_attribute_mutability.py`：扩 [`AttributeField` schema](apps/api/app/schemas/_jsonb_types.py:29) 加 `mutable: bool = False`（默认 immutable）。无需新列，因为 class_definitions 已是 JSONB；仅需 schema 兼容性处理（旧数据缺字段时回落 `mutable=False`）。
- 视频 track 属性：现 track 表（[apps/api/app/db/models/video_track.py](apps/api/app/db/models/video_track.py)，若存在）的 `attributes` 已是 JSONB；新增 `track_keyframes` 的 attribute override 字段（key=attribute_name, value=逐帧覆盖值）。

**前端**
- 改 [AttributeForm.tsx](apps/web/src/pages/Workbench/shell/AttributeForm.tsx)：mutable 字段在 form 上加帧导航按钮 + diff 视图。
- 视频侧 [VideoTrackPanel](apps/web/src/pages/Workbench/shell/VideoTrackPanel.tsx)（如有）：mutable 属性表格列展示「track 默认值 / 当前帧覆盖」。
- 首次消费 [useDirtyTracker.ts](apps/web/src/pages/Workbench/state/useDirtyTracker.ts)：批量改 mutable 属性时累积 dirty bits，pointerup/blur 时一次 PATCH。
- 单测：覆盖 mutable 属性变更生成正确 PATCH payload；immutable 属性变更影响整 track。

**关键文件**：
- 新增：`apps/api/alembic/versions/0066_attribute_mutability.py`
- 修改：`apps/api/app/schemas/_jsonb_types.py`、`apps/web/src/pages/Workbench/shell/AttributeForm.tsx`、`apps/web/src/pages/Workbench/shell/VideoTrackPanel.tsx`（若存在）、`apps/web/src/pages/Workbench/state/useDirtyTracker.ts`（接消费）

---

### M4-δ (v0.10.7)：Mask 编辑器（I11）

**目标**：SAM 出 mask → 笔刷/橡皮二次精修 → 落地为 polygon（v1）/ RLE mask（v2，留 v0.11+）。

**v0.10.7 范围（v1: mask 临时态 + 转 polygon）**：
- 新增 `apps/web/src/pages/Workbench/stage/tools/MaskTool.tsx`：基于离屏 `<canvas>` 元素（不入 Konva 主层，避免 hit-test 拖累）维护一个像素 alpha mask；笔刷/橡皮通过 pointermove 在 canvas 上画 / 擦。
- 接入：SAM 候选 mask 出来后，`AIPredictionPopover` 增加「精修」按钮，进入 MaskTool 模式，把 polygon → 离屏 canvas alpha mask 作为起点；用户笔刷修改后，按"确认"调 marching-squares（用现有 `polygon-clipping` 或新增 `d3-contour`）回到 polygon 落库。
- Brush 控件：Shift+滚轮调笔刷半径（参考 CVAT masksHandler.ts）；`B` / `E` 切笔刷/橡皮。
- 不改后端 schema，最终态仍是 polygon 入库；mask 是中间精修工作态。

**v0.11+ 范围（v2: RLE mask 独立形状，留待后续 epic）**：annotation 表新增 `geometry.kind="mask"` + `mask_rle blob` 字段。这一步与 I9 Ellipse / I10 Skeleton 一起做 geometry.kind 统一收口。

**关键文件**：
- 新增：`apps/web/src/pages/Workbench/stage/tools/MaskTool.tsx`、`stage/shared/MaskCanvas.tsx`（离屏 canvas 元件）、`stage/shared/geometry/maskToPolygon.ts`（marching-squares）
- 修改：`stage/AIPredictionPopover.tsx`（增「精修」按钮）、`stage/tools/index.ts`、`shell/ToolDock.tsx`

---

## 验证

每个 sub-milestone 单独验证；epic 收尾时跑完整回归。

**M4-α**：
- `pnpm --filter web test` 含 simplify / isSelfIntersectingIncremental / useSamCache 单测；
- `pnpm --filter web e2e -- workbench-perf` 跑 3×3 fixture，longTaskMaxMs<100。
- Chrome Performance 录 500-顶点 polygon 拖动 ≥60fps（手动）。

**M4-β**：
- `docker exec ai-annotation-platform-api-1 uv run alembic upgrade head` 跑 0065；
- `docker exec ai-annotation-platform-api-1 uv run pytest apps/api/tests -k annotation` 覆盖新字段 PATCH；
- Playwright 跑 `annotation.spec.ts` 新增 4 个 action。

**M4-γ**：
- pytest 覆盖 mutable schema 校验、视频 track keyframe override；
- 前端单测覆盖 useDirtyTracker 在 mutable 属性下的累积 + flush。

**M4-δ**：
- 浏览器手测：SAM 出 polygon → 进 MaskTool 精修 → 转回 polygon 落地；
- 单测覆盖 maskToPolygon 与 polygon-clipping 衔接。

**epic 收尾**（v0.10.7 发布前）：
- 完整 e2e 跑两次；
- 把 4 条 changelog 段统一归到 CHANGELOG.md 顶（沿用 v0.10.x 节奏）；
- v0.10.7 commit 顺手把 ROADMAP `Wave β / γ I11/I13/I15` 标 ✅；
- 新写 ADR：`docs/adr/0021-polygon-lod-and-spatial-index.md`（I2 决策）+ `docs/adr/0022-mask-editor-tool-architecture.md`（I11 决策）。

## 节奏建议（不写进交付物，仅供安排）

- **第 1-2 周**：v0.10.4 M4-α（性能闭环）；roadmap 校准并入这一波单独 PR 先合。
- **第 3 周**：v0.10.5 M4-β（shape 元数据）。
- **第 4-5 周**：v0.10.6 M4-γ（attribute mutable）。
- **第 6-8 周**：v0.10.7 M4-δ（Mask 编辑器 v1）。
- I1 大图 tile → v0.11.0 独立 epic，本计划不展开。
