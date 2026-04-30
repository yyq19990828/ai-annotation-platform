import type { CanvasTool, DragInit, ToolPointerContext } from "./index";

export const HandTool: CanvasTool = {
  id: "hand",
  hotkey: "V",
  label: "平移",
  icon: "move",
  cursor: "grab",
  onPointerDown: ({ pt, readOnly, onClearSelection }: ToolPointerContext): DragInit | null => {
    if (readOnly) onClearSelection();
    return { kind: "pan", sx: pt.x, sy: pt.y };
  },
};
