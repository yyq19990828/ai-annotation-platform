// v0.10.8 M4-δ 收尾 · I11 · Mask 编辑器 UI 集成。
//
// 工具职责仅声明：用户按下指针时，若 mask 编辑器未激活则以空白 buffer 入场，并向
// ImageStage 返回 maskBrush DragInit；其余（连续 paintAt / commit / hotkey）由
// ImageStage / WorkbenchShell / useMaskEditor 协同处理。
//
// 注意：实际 buffer 状态在 useMaskEditor (state/useMaskEditor.ts)；本工具与之耦合
// 走 ctx.maskEditor（v0.10.8 在 ToolPointerContext 上扩展的字段）。

import type { CanvasTool as CanvasToolMeta, DragInit } from "./index";

export const MaskTool: CanvasToolMeta = {
  id: "mask",
  hotkey: "M",
  label: "Mask 笔刷",
  icon: "edit",
  cursor: "crosshair",
  onPointerDown: ({ pt, readOnly, imgW, imgH, maskEditor }) => {
    if (readOnly) return null;
    if (!maskEditor) return null;
    // 像素坐标（pixel-space）— 与 maskBuffer / paintAt 单位一致。
    const px = pt.x * imgW;
    const py = pt.y * imgH;
    if (!maskEditor.active) {
      maskEditor.beginBlank();
    }
    // 立即落第一笔；连续 paintAt 由 ImageStage 在 pointermove 中线段插值。
    maskEditor.paintAt(px, py);
    return { kind: "maskBrush", lastX: px, lastY: py } as DragInit;
  },
};
