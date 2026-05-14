import type { CanvasTool, DragInit, ToolPointerContext } from "./index";

/**
 * v0.10.2 · 拆自旧 SamTool / sub-tool="bbox".
 * 拖框作为 SAM bbox prompt; 小拖动 (< 0.5%) ImageStage 自然忽略.
 * requiredPrompt = "bbox".
 */
export const SmartBoxTool: CanvasTool = {
  id: "smart-box",
  hotkey: "S",
  label: "智能框",
  icon: "rect",
  cursor: "crosshair",
  requiredPrompt: "bbox",
  onPointerDown: ({
    pt,
    spacePan,
    readOnly,
    pendingDrawing,
    onClearSelection,
  }: ToolPointerContext): DragInit | null => {
    if (pendingDrawing) return null;
    if (spacePan || readOnly) {
      if (readOnly) onClearSelection();
      return { kind: "pan", sx: pt.x, sy: pt.y };
    }
    onClearSelection();
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
