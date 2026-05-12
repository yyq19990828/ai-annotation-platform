import type { Annotation } from "@/types";

const HANDLE_SIZE = 9;

type Direction = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const DIRECTIONS: { dir: Direction; cx: number; cy: number; cursor: string }[] = [
  { dir: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
  { dir: "n",  cx: 0.5, cy: 0, cursor: "ns-resize" },
  { dir: "ne", cx: 1, cy: 0, cursor: "nesw-resize" },
  { dir: "e",  cx: 1, cy: 0.5, cursor: "ew-resize" },
  { dir: "se", cx: 1, cy: 1, cursor: "nwse-resize" },
  { dir: "s",  cx: 0.5, cy: 1, cursor: "ns-resize" },
  { dir: "sw", cx: 0, cy: 1, cursor: "nesw-resize" },
  { dir: "w",  cx: 0, cy: 0.5, cursor: "ew-resize" },
];

type ResizeBox = Pick<Annotation, "x" | "y" | "w" | "h">;

interface ResizeHandlesProps {
  b: Annotation;
  onResizeStart: (dir: Direction, e: React.PointerEvent) => void;
}

export function ResizeHandles({ b, onResizeStart }: ResizeHandlesProps) {
  return (
    <>
      {DIRECTIONS.map(({ dir, cx, cy, cursor }) => (
        <div
          key={dir}
          onPointerDown={(e) => { e.stopPropagation(); onResizeStart(dir, e); }}
          style={{
            position: "absolute",
            left: `calc(${(b.x + b.w * cx) * 100}% - ${HANDLE_SIZE / 2}px)`,
            top: `calc(${(b.y + b.h * cy) * 100}% - ${HANDLE_SIZE / 2}px)`,
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            background: "white",
            border: "1.5px solid var(--color-accent)",
            borderRadius: 2,
            cursor,
            zIndex: 10,
          }}
        />
      ))}
    </>
  );
}

export type ResizeDirection = Direction;

/**
 * 给定起始 box + 拖动起点 + 当前点 + 方向，返回拖动后 box（已 clamp 到 [0,1]）。
 *
 * v0.8.7 F6 · 修饰键：
 *   - shiftKey: 锁定起始 aspect ratio（newW/newH = origW/origH）
 *   - altKey:   以 bbox 中心为 anchor 反向 mirror（拖一边等价两边对称变化）
 *   - 两键叠加：先按 aspect ratio 锁定，再以中心 mirror
 */
export function applyResize(
  start: ResizeBox,
  startPt: { x: number; y: number },
  curPt: { x: number; y: number },
  dir: Direction,
  modifiers?: { shiftKey?: boolean; altKey?: boolean },
): { x: number; y: number; w: number; h: number } {
  const dx = curPt.x - startPt.x;
  const dy = curPt.y - startPt.y;
  let { x, y, w, h } = start;

  if (dir.includes("e")) w = start.w + dx;
  if (dir.includes("w")) { x = start.x + dx; w = start.w - dx; }
  if (dir.includes("s")) h = start.h + dy;
  if (dir.includes("n")) { y = start.y + dy; h = start.h - dy; }

  // ── v0.8.7 F6 · Shift 锁纵横比 ──────────────────────────────
  if (modifiers?.shiftKey && start.w > 0 && start.h > 0) {
    const aspect = start.w / start.h;
    // 以 |dx| 与 |dy * aspect| 中较大者为主轴，其他方向按比例同步
    const wByDx = w;
    const hByDx = wByDx / aspect;
    const hByDy = h;
    const wByDy = hByDy * aspect;
    if (Math.abs(wByDx - start.w) >= Math.abs(wByDy - start.w)) {
      w = wByDx;
      // 调整 h，保留 anchor 位置不变（与 dir 一致：n*y / w*x 的边）
      const oldH = h;
      h = hByDx;
      if (dir.includes("n")) y += oldH - h;
    } else {
      h = hByDy;
      w = wByDy;
      const oldW = wByDx;
      if (dir.includes("w")) x += oldW - w;
    }
  }

  // ── v0.8.7 F6 · Alt 中心扩展（mirror 对称变化） ─────────────
  if (modifiers?.altKey) {
    const cx = start.x + start.w / 2;
    const cy = start.y + start.h / 2;
    if (dir.includes("e") || dir.includes("w")) {
      const dw = w - start.w;
      // 一边变化 dw → 总宽度变 2dw
      w = start.w + 2 * dw;
      x = cx - w / 2;
    }
    if (dir.includes("s") || dir.includes("n")) {
      const dh = h - start.h;
      h = start.h + 2 * dh;
      y = cy - h / 2;
    }
  }

  // 处理负向拖动（翻转）
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }

  // clamp 到 [0,1]
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;

  return { x, y, w, h };
}
