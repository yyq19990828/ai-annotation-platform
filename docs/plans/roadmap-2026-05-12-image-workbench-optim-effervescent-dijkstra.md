---
roadmap: ROADMAP/2026-05-12-image-workbench-optimization.md
epic: I11 · Mask 编辑器
version: v0.10.8
status: planned
date: 2026-05-18
---

# v0.10.8 — Mask 编辑器 UI 集成

## Context

v0.10.7 已落地 Mask 编辑器算法核（`MaskBuffer` + `maskToPolygon`），v0.10.7.1 已落地状态层 hook（`useMaskEditor`，含 `beginBlank / initFromPolygon / paintAt / setMode / setRadius / cancel / commitToPolygon`，buffer 内部 revision bump）。两期均显式声明 **UI 集成推迟到后续子版本**（ROADMAP I11、ADR-0022、CHANGELOG v0.10.7 / v0.10.7.1）。

本期 v0.10.8 是 M4-δ 收尾：把算法核 + 状态层接到 Konva 渲染层、ToolDock、AI 候选「精修」入口与 hotkey 体系，完成 Mask 编辑器 v1 端到端可用闭环。提交语义仍走 **mask → polygon → 入库**（v1 不引入 RLE schema，与 v0.11+ 的 geometry.kind 统一一起做）。

## 范围

**做**：MaskTool（DragInit 派发）、MaskOverlayLayer（Konva.Image 渲染）、MaskToolbar（浮条）、ToolDock mask 按钮、AIPredictionPopover「精修」入口（仅 polygon 候选）、hotkey（M / B-when-mask / E / Enter-when-mask / Esc / Shift+滚轮）、commit 时自动 reject 原候选并以候选 label 落新 polygon。

**不做**：bbox 候选 → mask 初始填充（v0.11+ 与 I9 Ellipse 一起评估）、RLE schema、mask 多组件入库、dirtyRect 增量重绘（首期全量 `putImageData`，留 TODO）、mask 跨任务持久化。

---

## 关键决策（已与用户对齐）

1. **全局工具 hotkey** = `M`；mask 工具内部 `B`=brush 模式、`E`=erase 模式。
2. **精修 commit 后**：自动 `rejectPredictionMut`(原候选) → 写入新 polygon annotation（原 prediction 不残留）。
3. **新 polygon label**：精修流程沿用 `candidate.label_id`；空白工具流程用工具栏当前 label（与 PolygonTool 一致）。
4. **子工具条**：新建独立 `MaskToolbar.tsx` 浮条，贴 stage 顶部居中；仅 `tool === "mask"` 显示。
5. **Konva 渲染**：`MaskOverlayLayer` 用单个 `Konva.Image` + 内部 `HTMLCanvasElement`，由 `useMaskEditor.revision` 触发重画。
6. **commit 不在 pointerup**：mask 编辑是多笔累积，只通过 Enter / MaskToolbar「确认」显式提交。

---

## 实施清单

### 新增文件

| 文件 | 说明 |
| --- | --- |
| [apps/web/src/pages/Workbench/stage/tools/MaskTool.ts](apps/web/src/pages/Workbench/stage/tools/MaskTool.ts) | `CanvasTool`：`id="mask"`, `hotkey="M"`, `cursor="crosshair"`；`onPointerDown` 在 `!active` 时 `beginBlank()`，返回 `{ kind: "maskBrush", x, y }` |
| `apps/web/src/pages/Workbench/stage/overlays/MaskOverlayLayer.tsx` | 单 `Konva.Image` 绑定内部 canvas；`revision` 变更时 `putImageData(buffer.toAlphaImageData())` + `layer.batchDraw()`；brush 区域 `rgba(220,38,38,0.45)` |
| `apps/web/src/pages/Workbench/shell/MaskToolbar.tsx` | 浮条：半径 slider [1,200] / brush·erase chips / 确认 / 取消 / dirty 指示；仅 `tool === "mask"` 显示 |
| `apps/web/src/pages/Workbench/stage/tools/MaskTool.test.ts` | 断言 `onPointerDown` 返回 maskBrush DragInit 且空白态自动 `beginBlank` |
| `apps/web/src/pages/Workbench/stage/overlays/MaskOverlayLayer.test.tsx` | mock buffer，revision++ 后断言 `putImageData` 调用 |

### 修改文件

| 文件 | 改动 |
| --- | --- |
| [apps/web/src/pages/Workbench/state/useMaskEditor.ts](apps/web/src/pages/Workbench/state/useMaskEditor.ts) | **暴露 `revision: number`** 供 MaskOverlayLayer 作为 React 依赖；其余 API 不变 |
| [apps/web/src/pages/Workbench/stage/ImageStage.tsx](apps/web/src/pages/Workbench/stage/ImageStage.tsx) | DragInit union 加 `{ kind: "maskBrush"; lastX; lastY }`；pointerdown→paintAt+返回 DragInit；pointermove→线段插值（步长=radius/2）连续 paintAt；pointerup 不 commit；wheel handler 加 Shift 分支调 `setRadius(±2)`，clamp [1,200]；在 overlay 层之上挂 `<MaskOverlayLayer>`（仅 active 时） |
| [apps/web/src/pages/Workbench/state/useWorkbenchState.ts](apps/web/src/pages/Workbench/state/useWorkbenchState.ts) L8-16 | `Tool` union 加 `"mask"` |
| [apps/web/src/pages/Workbench/stage/tools/index.ts](apps/web/src/pages/Workbench/stage/tools/index.ts) | `TOOL_REGISTRY.mask = MaskTool`；`ALL_TOOLS` 在 polygon 后插入 mask |
| [apps/web/src/pages/Workbench/shell/ToolDock.tsx](apps/web/src/pages/Workbench/shell/ToolDock.tsx) L33-42 | `TOOL_DESCRIPTORS.mask = { hotkey:"M", label:"Mask 笔刷", group:"draw", icon:... }` |
| [apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx](apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx) `AIPredictionPopover` L292-309 | 若 `candidate.geometry.type === "polygon"`：新增「精修」按钮，调 `actions.refinePredictionMask(candidate)` |
| [apps/web/src/pages/Workbench/stages/image/useImageAnnotationActions.ts](apps/web/src/pages/Workbench/stages/image/useImageAnnotationActions.ts) | 新增 `refinePredictionMask(candidate)`：缓存 `pendingRefineRef = { predictionId, shapeIndex, labelId }` → `maskEditor.initFromPolygon(candidate.geometry.points)` → `setTool("mask")`。新增 `commitMaskAsPolygon()`：调 `commitToPolygon()`；null→toast 提示 mask 为空；非 null→若 `pendingRefineRef` 存在则 `rejectPredictionMut.mutate(...)` + 用 `pendingRefineRef.labelId` 创建 polygon，否则用 `currentLabelId` 创建；成功后 `maskEditor.cancel()` + `setTool("box")` + 清 `pendingRefineRef`；polygon 创建复用现有 PolygonTool commit 路径（`submitPolygon` / polygon create mutation） |
| [apps/web/src/pages/Workbench/state/hotkeys.ts](apps/web/src/pages/Workbench/state/hotkeys.ts) | HOTKEYS 表加 `M / B / E / Enter / Esc`（在 group="draw" 注明 mask context）；reducer/handler 加 tool-context 分支：tool==="mask" → `B`=setMode("brush") / `E`=setMode("erase") / `Enter`=`commitMaskAsPolygon()` / `Esc`=`cancel()+setTool("box")`；否则走现有逻辑 |

### 测试

- 单测（vitest + renderHook + @testing-library/react）：
  - `MaskTool.test.ts`：返回 DragInit shape + 自动 `beginBlank`。
  - `MaskOverlayLayer.test.tsx`：mock buffer，revision++ → `putImageData` 调用。
  - `useImageAnnotationActions.refine.test.ts`：`refinePredictionMask(polygonCandidate)` → 验证 `initFromPolygon` + `setTool("mask")` + 缓存 pending。
  - `useImageAnnotationActions.commitMask.test.ts`：① pending 存在 + commit 非 null → `rejectPredictionMut` + polygon create（用 candidate label） ② pending 空 + commit → polygon create（用 current label） ③ commit null → toast 提示且不入库。
  - `useMaskEditor` revision 暴露后的 dependency-firing 回归。

### 手测脚本

1. 打开有 polygon AI 候选的图片任务 → 点候选「精修」 → 笔刷涂 → E 切橡皮 → 擦 → Shift+滚轮调半径 → Enter → 断言新 polygon 出现 + 原候选消失。
2. 按 M 切 mask 空白工具 → 涂一笔 → Enter → 用工具栏当前 label 创建 polygon。
3. mask 编辑中 Esc → 退出且 buffer 清空，tool 回 box。
4. Ctrl+滚轮仍 zoom；Shift+滚轮只改 radius。
5. bbox 候选 popover 不出现「精修」按钮。

---

## 风险与权衡

1. **Konva.Image 全量重绘性能**：大画布（>4K）每笔 `toAlphaImageData` 全量拷贝可能掉帧。v0.10.8 先全量，留 TODO 让 MaskBuffer 暴露 dirtyRect。
2. **B / Enter 上下文切换可读性**：MaskToolbar 上必须明确显示当前 mode + hotkey 提示；hotkeys.ts 改动需写清注释。
3. **半透明红色可见度**：深色底图下不显眼。v1 固定 `rgba(220,38,38,0.45)`，后续考虑加 1px 白色外描边。
4. **自动 reject 失败**：若 `rejectPredictionMut` 报错而 polygon create 已成功，会出现「重复 annotation」。需在 actions 内串行 await（reject 成功后再 create）；reject 失败时不 create 并 toast 错误。
5. **Shift+滚轮 vs trackpad 横向滚动**：仅在 `deltaY` 主导时响应（`Math.abs(deltaY) > Math.abs(deltaX)`）。

---

## 验证

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test -- maskBuffer maskToPolygon useMaskEditor MaskTool MaskOverlayLayer useImageAnnotationActions
pnpm --filter web dev    # 手测脚本 1-5
```

后端无改动，无需 alembic / 重启 worker。

---

## 收尾文档

- `CHANGELOG.md` 新增 `[0.10.8] - 2026-05-XX` 段：Added (MaskTool / MaskOverlayLayer / MaskToolbar / refinePredictionMask + commitMaskAsPolygon + hotkey)、Changed (useMaskEditor 暴露 revision、ToolDock 新增 mask 按钮、AIPredictionPopover 新增精修)、Verified。
- `ROADMAP/2026-05-12-image-workbench-optimization.md` I11 节：把「🚧 v0.10.7.1 / v0.11.0 待补」改为「✅ v0.10.8」；Wave γ 表格 I11 行加「v0.10.8 UI 集成 ✅」。
- ADR-0022：在「v0.10.7 实际落地范围」段后追加 v0.10.8 收尾说明（label 来源 / 自动 reject 语义 / Shift+滚轮 / B 上下文切换决策）。
- 不新建 ADR（无新架构决策点，均为已记录方案的执行）。

## 关键文件锚点

- [useMaskEditor.ts](apps/web/src/pages/Workbench/state/useMaskEditor.ts)
- [ImageStage.tsx](apps/web/src/pages/Workbench/stage/ImageStage.tsx)
- [useImageAnnotationActions.ts](apps/web/src/pages/Workbench/stages/image/useImageAnnotationActions.ts)
- [hotkeys.ts](apps/web/src/pages/Workbench/state/hotkeys.ts)
- [AIInspectorPanel.tsx](apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx)
- [ToolDock.tsx](apps/web/src/pages/Workbench/shell/ToolDock.tsx)
- [tools/index.ts](apps/web/src/pages/Workbench/stage/tools/index.ts)
- [useWorkbenchState.ts](apps/web/src/pages/Workbench/state/useWorkbenchState.ts)
- [maskBuffer.ts](apps/web/src/pages/Workbench/stage/shared/geometry/maskBuffer.ts)
- [maskToPolygon.ts](apps/web/src/pages/Workbench/stage/shared/geometry/maskToPolygon.ts)
