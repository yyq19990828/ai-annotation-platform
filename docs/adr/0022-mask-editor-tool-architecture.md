# 0022 — Mask 编辑器 v1：离屏 alpha 缓冲 + marching-squares + 不引入 RLE schema

- **Status:** Accepted
- **Date:** 2026-05-15
- **Deciders:** core team
- **Supersedes:** —

## Context

SAM（grounded-sam2 / sam3）的候选 mask 一直走「polygon 化 → 用户接受 → 入库」单向流程：

- 候选 polygon 在视觉上若有少量像素错位（如脖子被切断、轮廓尖角缺角），用户没有像素级笔刷工具修补，只能整体接受或弃用；
- CVAT 的 `masksHandler.ts` 用独立离屏 canvas 承载 alpha mask，支持圆/方笔刷、橡皮、polygon-plus / polygon-minus 布尔操作、Shift+滚轮调笔刷半径，最后 RLE 压缩落库；
- 但 RLE 落库牵涉 DB schema 改造（`geometry.kind="mask"` + `mask_rle blob`），与 I9 Ellipse / I10 Skeleton 一并做才合算。

候选：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **A. v1 仅做「mask 临时态 + 转 polygon 落库」** | 不动 DB / 协议；polygon 已是一等态；polygon-clipping 已在依赖里 | 复杂 mask（多连通、有 hole）落库时丢信息，用户得手动选最大分量或合并 |
| B. 直接做完整 RLE schema 升级 | 数据保真度高，与 CVAT 对齐 | 牵动 geometry.kind 字段集合，DB / 协议 / 前端 / 后端转换一起改，落不下 v0.10.x |
| C. d3-contour 替代自写 marching-squares | 算法成熟 | 包体 ~30KB，且 d3-contour 主要做密度等值线，不是逐 pixel 二值轮廓追踪，转换层反而复杂 |

## Decision

**采纳方案 A**：v1 仅做「mask 临时态 + 转 polygon 入库」。

### A.1 数据层：`MaskBuffer`（纯 TS）

[`stage/shared/geometry/maskBuffer.ts`](../../apps/web/src/pages/Workbench/stage/shared/geometry/maskBuffer.ts)：

- 单通道 `Uint8Array(W*H)`，alpha 0 / 255 二值；不引入中间灰度（CVAT v1 也没有灰度笔刷）；
- 不依赖浏览器 OffscreenCanvas API（vitest jsdom 能跑、SSR / preview 也能跑）；
- 操作：
  - `brush(cx, cy, r, value=255)` 圆笔刷栅格化（半径上限 200px → 单笔 ≤ ~125k 像素操作，单帧预算内）；
  - `erase(cx, cy, r)` = `brush(..., 0)` 的糖；
  - `clear()` 全清零；
  - `fromPolygon(points)` 扫描线填充（射线投票，与浏览器 canvas2d fill 等价）作为「polygon → mask」初始化路径，给 AI 候选精修入口用；
  - `toAlphaImageData()` 输出 RGBA 缓冲（仅 A 通道有效），调用方 Konva.Image 拉这块 ImageData 即可叠色；
  - `clone()` 深拷贝（用于 history snapshot）。

### A.2 算法层：`maskToPolygon`（marching-squares + polygon-clipping）

[`stage/shared/geometry/maskToPolygon.ts`](../../apps/web/src/pages/Workbench/stage/shared/geometry/maskToPolygon.ts)：

1. **找连通分量**：从左上扫到第一个实心像素，4-邻 flood-fill 计算每个分量像素数；
2. **多连通取最大**：v1 不支持 multipolygon 落库，多分量时取面积最大外环并把 `multipleComponents=true` 抛给 UI，提示用户先 mask 编辑合并；
3. **轮廓追踪**：Moore-Neighborhood 8-邻顺时针从分量左上起点绕一圈得到闭环；
4. **去自相交**：调用 `polygon-clipping@0.15.7`（已在 deps）做 `union([poly])`，把 marching-squares 输出的相邻像素锯齿平滑为有效简单多边形；
5. **简化**：用 v0.10.4 的 [`simplifyPolygon`](../../apps/web/src/pages/Workbench/stage/shared/geometry/simplify.ts)（RDP 闭合多边形版）按 `epsilon` 压缩顶点（默认 1px）；
6. **去重相邻同点**：返回前剔除连续重复顶点。

落库路径：转出的 polygon 走现有 `submitPolygon` 路径，与手画 polygon 等价；不需要新的 API endpoint。

### A.3 v1 不引入的项

- **不引入 RLE schema**：`annotation.geometry.kind="mask"` + `mask_rle blob` 字段留 v0.11+ 与 I9 Ellipse / I10 Skeleton 一起做 geometry.kind 统一收口，独立 epic；
- **不引入 d3-contour**：marching-squares 自写实现 < 200 行，包体增量 ~0；d3-contour 30KB 体积不划算；
- **不引入方笔刷 / polygon-plus / polygon-minus 工具**：v1 只有圆笔刷 + 橡皮；其它 v2 再补。

### A.4 UI 接入位（v0.10.7 起，分步落地）

- **入口 1：SAM 候选精修**：[`stage/AIPredictionPopover.tsx`](../../apps/web/src/pages/Workbench/stage/AIPredictionPopover.tsx) 候选 polygon 旁加「精修」按钮 → MaskTool 模式，`MaskBuffer.fromPolygon(候选顶点)` 作为起点；
- **入口 2：ToolDock 独立 mask 工具**：[`shell/ToolDock.tsx`](../../apps/web/src/pages/Workbench/shell/ToolDock.tsx) 加 mask 图标 → 空白 buffer 开始画；
- **控件**：`Shift+滚轮` 调笔刷半径（5px-200px）；`B` / `E` 切笔刷/橡皮；`Esc` 取消、`Enter` 确认转 polygon。

> v0.10.7 实际落地范围说明：本期先稳数据层 (`MaskBuffer`) + 算法层 (`maskToPolygon`)；
> Konva 集成 / ToolDock 按钮 / AIPredictionPopover 入口推迟到 v0.10.7.1 或 v0.11.0 — 数据层与算法
> 层独立可单测，UI 集成是高耦合 / 高视觉验证成本的工作，独立子版本里跑完整 e2e 更稳。

## Consequences

正向：

- 不动 DB / 协议，纯前端可回滚；
- polygon-clipping 已在 deps，体积 0 增量；
- `MaskBuffer` / `maskToPolygon` 纯 TS 可在 vitest 跑（jsdom 不需要 OffscreenCanvas），单测覆盖直接捕回归（v0.10.7 + 19 例）；
- 与 SAM 候选 polygon 链路平接，精修结果不写 `useSamCache`（cache 仅针对 prompt → 后端响应，用户笔刷修改属于本地后处理）。

负向：

- 多连通 / 带 hole 的 mask 落库丢信息：v1 用「取最大面积外环」+ UI 提示规避；
- marching-squares 输出锯齿依赖 `polygon-clipping.union` 平滑，遇到极端窄连接（1px 宽桥）时 union 结果可能拆分两片，再 `pickLargest` 选其中一片；这是设计取舍，标注员若不接受可继续 mask 编辑后再转；
- Konva 集成层（MaskTool / MaskCanvas 组件）的 v0.10.7 v1 范围被有意压缩成「算法核」，全功能 UX 推迟到 v0.10.7.1 / v0.11.0。

## Alternatives Considered（详）

**方案 B（直接做完整 RLE schema 升级）**：技术正确但工程量与 I9 / I10 强耦合（geometry.kind 字段集合一起改）；v0.10.x 节奏（每子版本 1-2 周）放不下；放 v0.11+ 独立 epic 时与 Ellipse / Skeleton 一起改更合算。

**方案 C（d3-contour）**：d3-contour 主要做密度场等值线，不是逐像素二值轮廓追踪；做我们的场景反而要写「density grid 适配层」。包体 30KB 比自写 200 行 marching-squares 不划算。

## Notes

- 实现代码位置：
  - `apps/web/src/pages/Workbench/stage/shared/geometry/maskBuffer.ts`（+ `.test.ts`，12 例）
  - `apps/web/src/pages/Workbench/stage/shared/geometry/maskToPolygon.ts`（+ `.test.ts`，7 例）
- 相关 ROADMAP / ADR：
  - `ROADMAP/2026-05-12-image-workbench-optimization.md` I11 Mask 编辑器
  - ADR-0013 mask-to-polygon-server-side（后端把 SAM mask 转 polygon 的服务侧决策，本文是其前端对偶面）
  - ADR-0021 polygon-lod-and-spatial-index（本文借用了 `simplifyPolygon`）
- 后续可能演进 / 触发条件：
  - v0.10.7.1 / v0.11.0：Konva MaskTool 组件 + ToolDock 按钮 + AIPredictionPopover「精修」入口 + hotkey 路径；
  - v0.11+：RLE mask schema 与 I9 Ellipse / I10 Skeleton 一并做 geometry.kind 统一；
  - 引入方笔刷、polygon-plus / polygon-minus 布尔工具与 multipolygon 落库（依赖 RLE schema）。
