# 0021 — 图片工作台 polygon 渲染层 LOD + 空间索引（增量 SI）

- **Status:** Accepted
- **Date:** 2026-05-15（回填，实际决策落地于 v0.10.4）
- **Deciders:** core team
- **Supersedes:** —

## Context

v0.9.x 把 polygon 接入图片工作台后，500-顶点 polygon 拖动 / 多 polygon 同屏选择 / SAM 出 polygon 一气连续被生成等场景出现明显掉帧。同步存在的问题：

- **渲染**：`KonvaPolygon` 在非编辑态也老老实实把每个顶点画 Konva.Circle 句柄，节点数堆 N×polygon 量级，慢的是 Konva 的 hit-test 与 render diff。
- **自相交检测**：每帧拖一顶点都跑 O(n²) 的全顶点对边段 cross-check，500 顶点 ≈ 12.5 万次相交判定，主线程长任务。
- **顶点视口剔除**：所有顶点都在 Konva 渲染树里，编辑态视口拉远到 1/10 还是渲染全量。

候选：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **A. RDP LOD（按 viewport scale）+ 增量自相交 + rbush 顶点索引** | 三档独立优化，逐步上；无后端 / 协议改动；可加 perf fixture 监控 | 增加一套几何工具代码（simplify / vertex index），polygon-clipping 与 polygon-r 不同库要协调 |
| B. 把 polygon 直接 fallback 成 bbox bounding 渲染（远视距） | 实现极简 | 失去 polygon 视觉特征，不接受 |
| C. WebGL 自渲染 layer 替换 Konva.Polygon | 远期上限高 | 改造面积过大，与 Konva selection / drag 耦合，落不下 v0.10.x |

## Decision

**采纳方案 A**：三档独立、由远到近叠加：

### A.1 Douglas-Peucker LOD（渲染层简化）

[`stage/shared/geometry/simplify.ts`](../../apps/web/src/pages/Workbench/stage/shared/geometry/simplify.ts) 实现闭合多边形 RDP：

- 把闭环拆成两段（[0..mid], [mid..n-1, 0]）分别 RDP 后合并，避免对开链 RDP 直接拆环；
- `epsilonForScale(scale, dim) = 1 / (scale * max(imgW, imgH))` 把 viewport scale 反向换算成「视觉 1px 偏差」的归一化 epsilon；
- 仅在 `!editable && !selected && pointsCount > 60` 时启用；编辑态用原顶点保住手感。

落点：[`stage/ImageStageShapes.tsx`](../../apps/web/src/pages/Workbench/stage/ImageStageShapes.tsx) `KonvaPolygon` 内部 `useMemo(renderPs)`。

### A.2 自相交检测增量化

[`stage/shared/geometry/polygon.ts`](../../apps/web/src/pages/Workbench/stage/shared/geometry/polygon.ts) 提供两个 API：

- `isSelfIntersecting(points)` —— O(n²) 全量，静态 / 初始加载 / 几何稳态时用；
- `isSelfIntersectingIncremental(points, changedIdx)` —— O(n) 仅检测与 `changedIdx` 相邻的两条边 vs 其它非相邻边，500 顶点拖动单帧 < 1ms。

落点：[`stage/ImageStage.tsx`](../../apps/web/src/pages/Workbench/stage/ImageStage.tsx) 在 `drag.kind === "polyVertex"` 时走增量版，其它路径走全量。

### A.3 R-tree polygon 顶点视口粗筛

复用 [`stage/iou-index.ts`](../../apps/web/src/pages/Workbench/stage/iou-index.ts) 的 rbush 依赖，新增 `buildVertexIndex(points)`：

- 单 polygon 内部建顶点 rbush（leaf = 单点 bbox）；
- `verticesInBBox(bbox) → number[]` 按下标返回（外部排序后保留稳定 hit-test）。
- `KonvaPolygon` 编辑态 + 顶点 ≥ 60 时拿 viewportBBox（含 8px buffer）跑粗筛，屏外顶点 / 屏外边句柄不进 Konva render tree。

落点：[`stage/ImageStageShapes.tsx`](../../apps/web/src/pages/Workbench/stage/ImageStageShapes.tsx) `KonvaPolygon` 内部 `useMemo(visibleVertexIdx)`。

### A.4 commit 路径回到 pointerup（复查 no-op）

复查现有 [`ImageStage.tsx`](../../apps/web/src/pages/Workbench/stage/ImageStage.tsx) pointerup-only commit + [`handleCommitPolygonGeometry`](../../apps/web/src/pages/Workbench/state/useWorkbenchAnnotationActions.ts) 单条 `update` 历史推栈：判定为符合 roadmap I2.4 原意。新增 `polygonVertexBatch` history kind 经审视为冗余（单顶点拖拽本就是一个独立用户动作），不引入。

## Consequences

正向：

- 500-顶点 polygon 拖动 ≥ 60fps（v0.10.4 手测 Chrome Performance 录制确认）；
- 100 polygon 同屏选择 < 100ms（hit-test 通过 visibleVertexIdx 收窄）；
- 既有自相交红边视觉反馈无回归（增量与全量在同样输入下结果对齐，5 例单测覆盖一致性）；
- 不改 DB / 协议 / 后端，纯前端可回滚。

负向：

- `simplify.ts` 引入一份 RDP 实现，需要单测稳定（[`simplify.test.ts`](../../apps/web/src/pages/Workbench/stage/shared/geometry/simplify.test.ts) 7 例覆盖近共线剔除 / 偏离保留 / ≥3 顶点保底 / 200-顶点 circle massive reduction / epsilonForScale 单调性）。
- 增量自相交与全量在「拖最后一顶点后整体校验」时需要一次全量兜底；前端在 commit pointerup 时再跑一次全量，多 1 次 O(n²)，对 commit 路径影响可忽略（500 顶点 ~1ms）。
- viewport bbox 粗筛在 buffer = 8px 时极端缩放下偶尔会闪烁屏边顶点；落点改成 16px 即可（待 v0.11 视情况调）。

## Alternatives Considered（详）

**方案 B（远视距 fallback bbox）**：实现极简但用户失去 polygon 视觉。在 dense 场景下 polygon 与 bbox 不易区分（标注员要靠形状辨别 class）。不接受。

**方案 C（WebGL polygon layer）**：上限高但与 Konva 的 selection / drag / hit-test 路径深度耦合，迁移面积大。等 v0.11+ 大图 tile 金字塔（I1）一并评估。

## Notes

- 实现代码位置：
  - `apps/web/src/pages/Workbench/stage/shared/geometry/simplify.ts`（+ `.test.ts`）
  - `apps/web/src/pages/Workbench/stage/shared/geometry/polygon.ts`
  - `apps/web/src/pages/Workbench/stage/iou-index.ts`（+ `.test.ts`）
  - `apps/web/src/pages/Workbench/stage/ImageStageShapes.tsx`（KonvaPolygon LOD + viewport 粗筛）
  - `apps/web/src/pages/Workbench/stage/ImageStage.tsx`（drag 路径增量 / 全量分流）
- 相关 ROADMAP / ADR：`ROADMAP/[archived]2026-05-12-image-workbench-optimization.md` I2.1 / I2.2 / I2.3 / I2.4；ADR-0004 canvas-stack-konva（建立 Konva 基线决策）
- 后续可能演进：
  - I1 大图 tile 金字塔（v0.11+ 独立 epic）可能引入瓦片级 polygon 剪裁，与本文方案 A.3 协同；
  - 顶点视口 buffer 在极端缩放下可改 16-32px，由 useViewportTransform 提供动态值。
