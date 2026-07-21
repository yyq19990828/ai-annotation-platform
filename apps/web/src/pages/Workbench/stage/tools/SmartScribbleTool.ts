import type { CanvasTool, DragInit, ToolPointerContext } from "./index";

/**
 * 在选中的已存 Mask 上画正 / 负归一化笔迹。笔迹只是 AI prompt，
 * 不直接修改已存像素；服务端返回候选后仍需显式接纳。
 */
export const SmartScribbleTool: CanvasTool = {
  id: "smart-scribble",
  hotkey: "",
  label: "智能笔迹",
  icon: "edit",
  cursor: "crosshair",
  requiredPrompt: "scribble",
  onPointerDown: ({
    pt,
    evt,
    spacePan,
    readOnly,
    pendingDrawing,
    onClearSelection,
    preserveSelectionForPrompt,
    samPolarity = "positive",
  }: ToolPointerContext): DragInit | null => {
    if (pendingDrawing) return null;
    if (spacePan || readOnly) {
      if (readOnly) onClearSelection();
      return { kind: "pan", sx: pt.x, sy: pt.y };
    }
    if (!preserveSelectionForPrompt) return null;
    const negative = !!evt.altKey || samPolarity === "negative";
    return { kind: "samScribble", points: [[pt.x, pt.y]], alt: negative };
  },
};
