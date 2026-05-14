// v0.10.7 M4-δ · I11 · alpha mask → 外环 polygon。
//
// 算法：朴素 marching-squares + Moore-Neighborhood tracing。
//   1. 在 mask 上以阈值 (默认 128) 二值化，找到第一个边缘像素作为起点；
//   2. 沿 8 邻域顺时针绕一圈，得到连通分量的外轮廓；
//   3. 可选用 `polygon-clipping` 做 union(self) 做去自相交 / 自动 hole 处理（在多连通时
//      取 area 最大的外环）；
//   4. 用 Douglas-Peucker 压缩顶点（与 simplify.ts 一致策略）。
//
// 决策见 ADR-0022：v1 不引入 d3-contour；不输出 hole / 多分量，多分量时取最大面积外环
// 并在调用方提示用户先 mask 编辑合并。

import polygonClipping, { type Polygon } from "polygon-clipping";

import { simplifyPolygon } from "./simplify";

export interface MaskLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export interface MaskToPolygonOptions {
  /** 二值化阈值（>= 命中）。默认 128。 */
  threshold?: number;
  /** RDP 简化 epsilon，单位 = 像素。默认 1。设 0 跳过简化。 */
  simplifyEpsilon?: number;
  /** 单连通假设；多连通时是否取最大面积外环并丢弃其它（默认 true）。 */
  pickLargest?: boolean;
}

export interface MaskToPolygonResult {
  /** 外环顶点（像素空间，未闭合）。空数组表示空 mask。 */
  points: [number, number][];
  /** 是否检测到多连通：若 true 且 pickLargest=true，则仅返回最大外环。 */
  multipleComponents: boolean;
}

/** 像素是否「实心」（>= threshold）。越界视为 0。 */
function isSolid(mask: MaskLike, x: number, y: number, threshold: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return mask.data[y * mask.width + x] >= threshold;
}

/**
 * Moore-Neighborhood tracing 走一圈外轮廓。
 *
 * 起点 (sx, sy) 是从左上扫到的第一个 solid 像素。返回闭合环（首尾相同时去重）。
 */
function traceBoundary(mask: MaskLike, sx: number, sy: number, threshold: number): [number, number][] {
  // 8 邻域顺时针：从「左」开始（上一像素 = 起点的左边）
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1],
  ];
  const out: [number, number][] = [];
  let cx = sx, cy = sy;
  // 起点的「来向」= 上一帧像素方向 = 左；记录索引 0
  let dir = 0;
  out.push([cx, cy]);
  for (let step = 0; step < mask.width * mask.height * 4; step++) {
    // 从 (dir + 1) % 8 顺时针扫到下一个 solid
    let found = false;
    for (let k = 0; k < 8; k++) {
      const di = (dir + 1 + k) % 8;
      const [dx, dy] = dirs[di];
      const nx = cx + dx, ny = cy + dy;
      if (isSolid(mask, nx, ny, threshold)) {
        // 回到起点 → 终止
        if (nx === sx && ny === sy && out.length > 1) {
          return out;
        }
        cx = nx;
        cy = ny;
        // 「来向」= di + 4（即上一次移动方向的反向，作为下一轮起点参考）
        dir = (di + 4) % 8;
        out.push([cx, cy]);
        found = true;
        break;
      }
    }
    if (!found) return out; // 孤立像素
  }
  return out;
}

/** flood-fill 找到 (sx, sy) 所在连通分量的所有像素索引（4 邻域）。 */
function floodComponent(
  mask: MaskLike,
  sx: number,
  sy: number,
  threshold: number,
  visited: Uint8Array,
): number {
  const { width, height } = mask;
  const stack: number[] = [sy * width + sx];
  let count = 0;
  while (stack.length) {
    const idx = stack.pop()!;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (!isSolid(mask, x, y, threshold)) continue;
    count++;
    if (x > 0) stack.push(idx - 1);
    if (x < width - 1) stack.push(idx + 1);
    if (y > 0) stack.push(idx - width);
    if (y < height - 1) stack.push(idx + width);
  }
  return count;
}

/** 在 mask 上找到所有连通分量起点（最左上像素）+ 像素数。 */
function findComponents(
  mask: MaskLike,
  threshold: number,
): Array<{ sx: number; sy: number; count: number }> {
  const { width, height } = mask;
  const visited = new Uint8Array(width * height);
  const out: Array<{ sx: number; sy: number; count: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      if (!isSolid(mask, x, y, threshold)) {
        visited[idx] = 1;
        continue;
      }
      const count = floodComponent(mask, x, y, threshold, visited);
      out.push({ sx: x, sy: y, count });
    }
  }
  return out;
}

/**
 * 主入口：alpha mask → polygon 外环。
 *
 * - 空 mask → points=[]
 * - 单连通 → 直接 trace + simplify
 * - 多连通 + pickLargest=true → 取面积最大的外环
 * - polygon-clipping union(self) 去自相交（marching-squares 输出本身相邻像素有锯齿，
 *   union 让 self-intersect 消失并把窄连接平滑）
 */
export function maskToPolygon(
  mask: MaskLike,
  opts: MaskToPolygonOptions = {},
): MaskToPolygonResult {
  const threshold = opts.threshold ?? 128;
  const epsilon = opts.simplifyEpsilon ?? 1;
  const pickLargest = opts.pickLargest ?? true;

  const components = findComponents(mask, threshold);
  if (components.length === 0) {
    return { points: [], multipleComponents: false };
  }
  // 多连通时挑面积最大的
  const target = components.reduce((acc, c) => (c.count > acc.count ? c : acc), components[0]);
  let ring = traceBoundary(mask, target.sx, target.sy, threshold);
  if (ring.length < 3) {
    return { points: ring, multipleComponents: components.length > 1 };
  }

  // 用 polygon-clipping union(self) 去自相交 / 修复 marching-squares 锯齿
  try {
    const closed: [number, number][] = [...ring];
    if (closed[0][0] !== closed[closed.length - 1][0] || closed[0][1] !== closed[closed.length - 1][1]) {
      closed.push([closed[0][0], closed[0][1]]);
    }
    const poly: Polygon = [closed];
    const unioned = polygonClipping.union([poly]);
    if (unioned.length > 0 && unioned[0].length > 0) {
      // 取第一个 multipolygon 的第一个 polygon 的外环
      ring = unioned[0][0].map(([x, y]) => [x, y] as [number, number]);
      // polygon-clipping 输出闭合，去掉末尾重复点
      if (
        ring.length > 1 &&
        ring[0][0] === ring[ring.length - 1][0] &&
        ring[0][1] === ring[ring.length - 1][1]
      ) {
        ring.pop();
      }
    }
  } catch {
    // polygon-clipping 失败时退回原 ring
  }

  if (epsilon > 0 && ring.length > 3) {
    ring = simplifyPolygon(ring, epsilon);
  }
  // 去掉与上一顶点完全相同的点
  const dedup: [number, number][] = [];
  for (const p of ring) {
    const last = dedup[dedup.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) dedup.push(p);
  }

  // 注意：!pickLargest 时也只返回最大分量（v1 不支持 multipolygon 落库），但 multipleComponents
  // 仍为 true 提示上层 UI。
  return {
    points: dedup,
    multipleComponents: components.length > 1,
  };
}
