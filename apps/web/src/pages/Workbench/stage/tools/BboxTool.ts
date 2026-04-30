import type { CanvasTool, DragInit, ToolPointerContext } from "./index";

export const BboxTool: CanvasTool = {
  id: "box",
  hotkey: "B",
  label: "矩形框",
  icon: "rect",
  cursor: "crosshair",
  onPointerDown: ({ pt, evt, spacePan, readOnly, pendingDrawing, onClearSelection }: ToolPointerContext): DragInit | null => {
    if (pendingDrawing) return null;
    if (spacePan || readOnly) {
      if (readOnly) onClearSelection();
      return { kind: "pan", sx: pt.x, sy: pt.y };
    }
    if (!evt.shiftKey) onClearSelection();
    return { kind: "draw", sx: pt.x, sy: pt.y, cx: pt.x, cy: pt.y };
  },
};
