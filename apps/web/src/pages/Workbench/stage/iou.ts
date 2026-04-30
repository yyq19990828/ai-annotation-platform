export type Geom = { x: number; y: number; w: number; h: number };

/** 用于 IoU 计算的形状：bbox 或 polygon。polygon 走包围盒近似（v0.5.3 暂用）。 */
export type ShapeForIoU = Geom & { polygon?: [number, number][] };

/** axis-aligned IoU on normalized geometry. 0 when 不重叠。 */
export function iou(a: Geom, b: Geom): number {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w);
  const iy2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = ix2 - ix1;
  const ih = iy2 - iy1;
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

/**
 * 形状无关 IoU（v0.5.3）：
 * - bbox vs bbox：精确
 * - 任一为 polygon：用各自包围盒近似
 *
 * polygon-vs-polygon 精确 IoU 需要 polygon-clipping（如 SAT 或 Sutherland-Hodgman），
 * 当前视觉去重精度足够，留 TODO 后续接库。
 */
export function iouShape(a: ShapeForIoU, b: ShapeForIoU): number {
  // polygon 自动取包围盒（Annotation 已在 transforms 阶段填好 x/y/w/h）
  return iou(a, b);
}
