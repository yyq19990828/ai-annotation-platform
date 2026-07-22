// v0.10.7 M4-δ · I11 · Mask 编辑器 v1 数据层：离屏 alpha 缓冲 + 笔刷 / 橡皮 / clear /
// fromPolygon / toAlphaImageData。
//
// 设计取舍：
// - 数据存 `Uint8Array(W*H)` 单通道 alpha（0/255 二值，无中间灰度）；环境无 OffscreenCanvas
//   依赖（vitest jsdom 也能跑）。真正展示叠加靠 Konva.Image 拉这块 ImageData 即可。
// - 笔刷支持圆 / 方硬边。圆心 + 半径用栅格化双循环画，
//   半径上限 200px 时单笔 ≤ ~125k 像素操作，远低于 1 帧预算。
// - polygon → mask 用扫描线填充（ray casting），与浏览器 canvas2d 的 fill 等价；
//   v1 不引入 d3-contour / scanline 库依赖。

import { decodeCocoRle, encodeCocoRle, type CocoRle } from "./maskRle";

export interface MaskBufferOptions {
  width: number;
  height: number;
}

/**
 * 脏区半开矩形 [x0, x1) × [y0, y1)，像素坐标。供渲染层增量 putImageData 用。
 * v0.10.10 加入；典型用法：`const rect = buffer.consumeDirty(); if (rect) ctx.putImageData(...)`。
 */
export interface DirtyRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type MaskBrushShape = "circle" | "square";

export interface MaskBufferChange {
  changedPixels: number;
  bounds: DirtyRect | null;
}

/**
 * 离屏 alpha mask 缓冲。坐标系 = 归一化前的像素 (0..width, 0..height)。
 *
 * - `data[y*width + x]` 取值 0 或 255。
 * - 笔刷 / 橡皮 / fromPolygon 都改 in-place；调用方按需复制。
 * - 内部维护 `_dirty` 半开矩形，所有写操作 union 进去；渲染层 `consumeDirty()` 取走并清零。
 */
export class MaskBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  private _dirty: DirtyRect | null = null;

  constructor({ width, height }: MaskBufferOptions) {
    if (!Number.isInteger(width) || width <= 0) throw new Error("MaskBuffer: width 必须正整数");
    if (!Number.isInteger(height) || height <= 0) throw new Error("MaskBuffer: height 必须正整数");
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height);
  }

  static fromRle(rle: CocoRle): MaskBuffer {
    const [height, width] = rle.size;
    const buffer = new MaskBuffer({ width, height });
    buffer.data.set(decodeCocoRle(rle));
    buffer.markDirty(0, 0, width, height);
    return buffer;
  }

  toRle(): CocoRle {
    return encodeCocoRle(this.data, this.width, this.height);
  }

  /** 把 [x0, x1) × [y0, y1) 与当前脏区 union；空区间静默忽略。坐标会 clamp 到画布。 */
  private markDirty(x0: number, y0: number, x1: number, y1: number): void {
    const cx0 = Math.max(0, Math.floor(x0));
    const cy0 = Math.max(0, Math.floor(y0));
    const cx1 = Math.min(this.width, Math.ceil(x1));
    const cy1 = Math.min(this.height, Math.ceil(y1));
    if (cx1 <= cx0 || cy1 <= cy0) return;
    if (!this._dirty) {
      this._dirty = { x0: cx0, y0: cy0, x1: cx1, y1: cy1 };
      return;
    }
    const d = this._dirty;
    if (cx0 < d.x0) d.x0 = cx0;
    if (cy0 < d.y0) d.y0 = cy0;
    if (cx1 > d.x1) d.x1 = cx1;
    if (cy1 > d.y1) d.y1 = cy1;
  }

  /** 取走当前脏区并清零；无脏区返 null。渲染层每次重画后调一次。 */
  consumeDirty(): DirtyRect | null {
    const d = this._dirty;
    this._dirty = null;
    return d;
  }

  /** 全清零；脏区 = 全图。 */
  clear(): void {
    this.data.fill(0);
    this.markDirty(0, 0, this.width, this.height);
  }

  /** Replace the full binary alpha plane and mark only actually changed pixels dirty. */
  replaceAlpha(alpha: Uint8Array): MaskBufferChange {
    if (alpha.length !== this.data.length) {
      throw new Error("MaskBuffer: replacement alpha length must match the buffer");
    }
    for (const value of alpha) {
      if (value !== 0 && value !== 255) {
        throw new Error("MaskBuffer: replacement alpha must be binary (0 or 255)");
      }
    }
    let changedPixels = 0;
    let minX = this.width;
    let minY = this.height;
    let maxX = -1;
    let maxY = -1;
    for (let index = 0; index < alpha.length; index += 1) {
      const value = alpha[index];
      if (this.data[index] === value) continue;
      this.data[index] = value;
      changedPixels += 1;
      const x = index % this.width;
      const y = Math.floor(index / this.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const bounds = changedPixels === 0
      ? null
      : { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
    if (bounds) this.markDirty(bounds.x0, bounds.y0, bounds.x1, bounds.y1);
    return { changedPixels, bounds };
  }

  /** 当前非零像素数（调试 / 测试用，O(N)）。 */
  countSet(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i]) n++;
    return n;
  }

  /** 单点查询。越界返回 0。 */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[Math.floor(y) * this.width + Math.floor(x)];
  }

  /**
   * 硬边笔刷：以 (cx, cy) 为中心、半径 r 画实心圆 / 方形（v=255）或擦除（v=0）。
   * 半径 < 1 时仍至少改中心点；越界部分裁掉。
   */
  brush(
    cx: number,
    cy: number,
    r: number,
    value: 0 | 255 = 255,
    shape: MaskBrushShape = "circle",
  ): void {
    const radius = Math.max(0.5, r);
    const rSq = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const dy2 = dy * dy;
      const row = y * this.width;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (
          (shape === "square" && Math.abs(dx) <= radius && Math.abs(dy) <= radius)
          || (shape === "circle" && dx * dx + dy2 <= rSq)
        ) {
          this.data[row + x] = value;
        }
      }
    }
    // 脏区 = brush 整个外接方框（半开区间，xCount+1 / yCount+1 是因为上面循环用闭区间）
    this.markDirty(x0, y0, x1 + 1, y1 + 1);
  }

  /** 橡皮 = brush(cx, cy, r, 0) 的语义糖。 */
  erase(cx: number, cy: number, r: number, shape: MaskBrushShape = "circle"): void {
    this.brush(cx, cy, r, 0, shape);
  }

  /**
   * polygon 顶点 (image-space) → 填充到 alpha mask。
   *
   * - 用扫描线算法（射线投票判内外）；环不必闭合，会自动连首尾。
   * - 顶点 < 3 时静默不画。
   * - value=255 与已有 Mask 做 add，value=0 做 subtract；调用方要全量替换时先 `clear()`。
   */
  fromPolygon(points: ReadonlyArray<readonly [number, number]>, value: 0 | 255 = 255): void {
    if (points.length < 3) return;
    const { width, height } = this;
    // 计算 x/y 范围（x 用于脏区，y 用于裁剪迭代上下界）
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const [px, py] of points) {
      if (px < xMin) xMin = px;
      if (px > xMax) xMax = px;
      if (py < yMin) yMin = py;
      if (py > yMax) yMax = py;
    }
    const y0 = Math.max(0, Math.ceil(yMin - 0.5));
    const y1 = Math.min(height - 1, Math.ceil(yMax - 0.5) - 1);
    // 脏区 = polygon bbox（已 clamp）
    this.markDirty(xMin, yMin, xMax + 1, yMax + 1);
    const n = points.length;
    for (let y = y0; y <= y1; y++) {
      // 收集所有与 y 行相交的 x 值
      const xs: number[] = [];
      const yc = y + 0.5;
      for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        const [, ay] = a;
        const [, by] = b;
        // 半开区间判交：[min, max) 避免顶点重交两次
        const lower = Math.min(ay, by);
        const upper = Math.max(ay, by);
        if (yc < lower || yc >= upper) continue;
        const [ax, _ay] = a;
        const [bx, _by] = b;
        const t = (yc - ay) / (by - ay);
        xs.push(ax + t * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.max(0, Math.ceil(xs[i] - 0.5));
        const xb = Math.min(width - 1, Math.ceil(xs[i + 1] - 0.5) - 1);
        const row = y * width;
        for (let x = xa; x <= xb; x++) this.data[row + x] = value;
      }
    }
  }

  /**
   * 输出为 RGBA ImageData 兼容缓冲：A 通道 = alpha mask；R/G/B 在调用方可叠色。
   * 返回 Uint8ClampedArray 长度 = width * height * 4。
   *
   * 仅 alpha 通道有效；调用方画 Konva.Image 时用 putImageData 即可。
   */
  toAlphaImageData(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    for (let i = 0; i < this.data.length; i++) {
      out[i * 4 + 3] = this.data[i];
    }
    return out;
  }

  /**
   * 切片版 toAlphaImageData：只输出 [x0, x1) × [y0, y1) 区域的 RGBA 缓冲。
   * v0.10.10 新增，配合 `consumeDirty()` 让渲染层做增量 `putImageData`。
   *
   * 长度 = (x1-x0) * (y1-y0) * 4；R/G/B = 0，A = mask alpha。
   * rect 必须已 clamp 到画布（与 `consumeDirty` 返回的脏区一致）；越界静默返空。
   */
  toAlphaImageDataRect(rect: DirtyRect): Uint8ClampedArray {
    const { x0, y0, x1, y1 } = rect;
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return new Uint8ClampedArray(0);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const srcRow = (y0 + y) * this.width + x0;
      const dstRow = y * w;
      for (let x = 0; x < w; x++) {
        out[(dstRow + x) * 4 + 3] = this.data[srcRow + x];
      }
    }
    return out;
  }

  /** 拷贝。脏区一并复制。 */
  clone(): MaskBuffer {
    const c = new MaskBuffer({ width: this.width, height: this.height });
    c.data.set(this.data);
    if (this._dirty) c._dirty = { ...this._dirty };
    return c;
  }
}
