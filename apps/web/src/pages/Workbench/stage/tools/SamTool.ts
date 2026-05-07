import type { CanvasTool, DragInit, ToolPointerContext } from "./index";

/**
 * v0.9.2 · SAM 智能工具.
 * v0.9.4 phase 2 · 子工具拆分:
 *   - point: 单击产生 positive point prompt; Alt+点击 / polarity=negative 产生 negative.
 *   - bbox:  拖框产生 bbox prompt (单击实际拖动距离 ~0 也归 point? **不**, 此版本严格按子工具,
 *            bbox 子工具下小拖动仍走 bbox 路径; 如距离过小 ImageStage 自然忽略).
 *   - text:  画布事件不响应 (返回 null), 焦点切到右栏 SamTextPanel 输入框.
 *
 * stage 在 onCommitDrawing 时把 samProbe DragInit 派发到 useInteractiveAI;
 * mode 字段直接来自 ctx.samSubTool, 不再按几何尺寸隐式分流.
 */
export const SamTool: CanvasTool = {
  id: "sam",
  hotkey: "S",
  label: "SAM 智能",
  icon: "sparkles",
  cursor: "crosshair",
  onPointerDown: ({
    pt,
    evt,
    spacePan,
    readOnly,
    pendingDrawing,
    onClearSelection,
    samSubTool = "point",
    samPolarity = "positive",
  }: ToolPointerContext): DragInit | null => {
    if (pendingDrawing) return null;
    if (spacePan || readOnly) {
      if (readOnly) onClearSelection();
      return { kind: "pan", sx: pt.x, sy: pt.y };
    }
    onClearSelection();

    // text 子工具不响应画布点击 (UI: 用户应在右栏 SamTextPanel 输入文本).
    if (samSubTool === "text") return null;

    // point: alt = (键修饰 || polarity 反转) — 任一为 negative 即 negative point.
    if (samSubTool === "point") {
      const negative = !!evt.altKey || samPolarity === "negative";
      return {
        kind: "samProbe",
        mode: "point",
        sx: pt.x,
        sy: pt.y,
        cx: pt.x,
        cy: pt.y,
        alt: negative,
      };
    }

    // bbox: 拖框, alt 字段无意义.
    return {
      kind: "samProbe",
      mode: "bbox",
      sx: pt.x,
      sy: pt.y,
      cx: pt.x,
      cy: pt.y,
      alt: false,
    };
  },
};
