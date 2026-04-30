import type { CanvasTool, DragInit, ToolPointerContext } from "./index";

/** 顶点点击距离首点 <= 此阈值（归一化）时自动闭合。约等于 8px @ 1000px 图。 */
const CLOSE_DISTANCE = 0.008;

/**
 * 多边形工具（v0.5.3）。
 * 交互：左键逐点落点；点击距首点 < CLOSE_DISTANCE 时自动闭合提交；
 *        Enter / 双击 → 闭合；Esc → 取消；Backspace → 撤销最后一点（由 Shell hotkey 派生）。
 *
 * 注意：本工具不返回 DragInit；落点行为通过 ctx.polygonDraft.addPoint 直接 mutate
 *       Shell 维护的草稿状态。空白处按下时其它工具的 setDrag 路径不触发。
 */
export const PolygonTool: CanvasTool = {
  id: "polygon",
  hotkey: "P",
  label: "多边形",
  icon: "polygon",
  cursor: "crosshair",
  onPointerDown: ({ pt, evt, readOnly, pendingDrawing, polygonDraft }: ToolPointerContext): DragInit | null => {
    if (readOnly || pendingDrawing || !polygonDraft) return null;
    if (evt.button !== 0) return null; // 仅左键落点
    const points = polygonDraft.points;
    // 距首点近 → 闭合
    if (points.length >= 3) {
      const [fx, fy] = points[0];
      const dx = pt.x - fx;
      const dy = pt.y - fy;
      if (Math.hypot(dx, dy) <= CLOSE_DISTANCE) {
        polygonDraft.close();
        return null;
      }
    }
    polygonDraft.addPoint([pt.x, pt.y]);
    return null;
  },
};

export { CLOSE_DISTANCE };
