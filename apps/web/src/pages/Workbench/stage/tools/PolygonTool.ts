import type { CanvasTool, DragInit, ToolPointerContext } from "./index";

/** 顶点点击距离首点 <= 此阈值（归一化）时自动闭合。约等于 8px @ 1000px 图。 */
const CLOSE_DISTANCE = 0.008;

/**
 * 多边形工具。
 * 交互：左键逐点落点；点击距首点 < CLOSE_DISTANCE 时自动闭合提交；
 *        Enter / 双击 → 闭合；Esc → 取消；Backspace → 撤销最后一点（由 Shell hotkey 派生）。
 *
 * 普通落点直接追加到 Shell 草稿；Shift 拖动交给 ImageStage 按屏幕距离批量追加。
 * 两者都不产生其它工具的 DragInit。
 */
export const PolygonTool: CanvasTool = {
  id: "polygon",
  hotkey: "P",
  label: "多边形",
  icon: "annotationPolygon",
  cursor: "crosshair",
  onPointerDown: ({
    pt,
    evt,
    readOnly,
    pendingDrawing,
    spacePan,
    polygonDraft,
    snapPoint,
    startPolygonAutoPoints,
  }: ToolPointerContext): DragInit | null => {
    if (readOnly || pendingDrawing || spacePan || !polygonDraft) return null;
    if (evt.button !== 0) return null; // 仅左键落点
    const target = snapPoint?.(pt, evt) ?? pt;
    if (evt.shiftKey && startPolygonAutoPoints) {
      startPolygonAutoPoints([target.x, target.y], evt);
      return null;
    }
    const points = polygonDraft.points;
    // 距首点近 → 闭合
    if (points.length >= 3) {
      const [fx, fy] = points[0];
      const dx = target.x - fx;
      const dy = target.y - fy;
      if (Math.hypot(dx, dy) <= CLOSE_DISTANCE) {
        polygonDraft.close();
        return null;
      }
    }
    polygonDraft.addPoint([target.x, target.y]);
    return null;
  },
};

export { CLOSE_DISTANCE };
