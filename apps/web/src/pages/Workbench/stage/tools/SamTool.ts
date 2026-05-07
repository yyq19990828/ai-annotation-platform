import type { CanvasTool, DragInit, ToolPointerContext } from "./index";

/**
 * v0.9.2 · SAM 智能工具。
 *
 * 行为对齐 BboxTool（拖框 → 画布拖动），但 stage 在 onCommitDrawing 时
 * 把几何派发到 useInteractiveAI 而非进 ClassPickerPopover。
 * 单击（拖动距离 ~0）= positive point；Alt+click = negative point；
 * 拖框 = bbox prompt。三种 prompt 由 ImageStage 根据松手时几何尺寸分流。
 */
export const SamTool: CanvasTool = {
  id: "sam",
  hotkey: "S",
  label: "SAM 智能",
  icon: "sparkles",
  cursor: "crosshair",
  onPointerDown: ({ pt, evt, spacePan, readOnly, pendingDrawing, onClearSelection }: ToolPointerContext): DragInit | null => {
    if (pendingDrawing) return null;
    if (spacePan || readOnly) {
      if (readOnly) onClearSelection();
      return { kind: "pan", sx: pt.x, sy: pt.y };
    }
    onClearSelection();
    return { kind: "samProbe", sx: pt.x, sy: pt.y, cx: pt.x, cy: pt.y, alt: !!evt.altKey };
  },
};
