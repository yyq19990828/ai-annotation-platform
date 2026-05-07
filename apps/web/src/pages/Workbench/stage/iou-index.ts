/**
 * v0.9.3 · IoU 候选裁剪索引（rbush 同类分桶）。
 *
 * 用途：WorkbenchShell 计算 dimmedAiIds 时，避免对每个 AI 框扫全部 user 框。
 * 仅在同类 (cls) 内做空间分桶；跨类不会产生候选。
 *
 * 调用方仍走 iouShape 精确判定，候选裁剪只解决"包围盒不可能交"的快速排除。
 */
import RBush, { type BBox } from "rbush";

import type { ShapeForIoU } from "./iou";

interface IndexedShape extends BBox {
  shape: ShapeForIoU;
}

function shapeBBox(s: ShapeForIoU): BBox {
  if (s.polygon && s.polygon.length >= 3) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of s.polygon) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }
  return { minX: s.x, minY: s.y, maxX: s.x + s.w, maxY: s.y + s.h };
}

export interface IoUClassIndex {
  /** 返回与 query 包围盒可能相交的同类 shape 候选（不含 query 自身）。 */
  candidatesForBox: (
    query: ShapeForIoU & { cls: string },
  ) => ShapeForIoU[];
}

/**
 * 按 cls 分桶建 rbush。每桶独立树；查询时仅在 query.cls 桶内 search。
 * 输入 boxes.length === 0 时返回空索引（candidatesForBox 直接返 []）。
 */
export function buildIoUIndex(
  boxes: Array<ShapeForIoU & { cls: string }>,
): IoUClassIndex {
  const trees = new Map<string, RBush<IndexedShape>>();
  for (const b of boxes) {
    let tree = trees.get(b.cls);
    if (!tree) {
      tree = new RBush<IndexedShape>();
      trees.set(b.cls, tree);
    }
    tree.insert({ ...shapeBBox(b), shape: b });
  }
  return {
    candidatesForBox(query) {
      const tree = trees.get(query.cls);
      if (!tree) return [];
      const hits = tree.search(shapeBBox(query));
      return hits.map((h) => h.shape);
    },
  };
}
