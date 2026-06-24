import type { CanvasTool, ToolPointerContext } from "./index";

// 选择工具：画布上唯一可点选 / 移动已有标注与预标注 (AI 候选) 的工具。
// 默认工具，ESC 回退到它。点击空白处清除选中 (Shift 叠加多选时不清)。
// 不绘制、不平移 —— 平移走 Space+拖拽 / 右键拖拽。
export const SelectTool: CanvasTool = {
  id: "select",
  hotkey: "V",
  label: "选择",
  icon: "cursor",
  cursor: "default",
  onPointerDown: ({ evt, onClearSelection }: ToolPointerContext) => {
    if (!evt.shiftKey) onClearSelection();
    return null;
  },
};
