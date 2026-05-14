// v0.10.7 M4-δ · I11 · Mask 编辑器 v1 数据层：离屏 alpha 缓冲 + 笔刷 / 橡皮 / clear /
// fromPolygon / toAlphaImageData。
//
// 设计取舍：
// - 数据存 `Uint8Array(W*H)` 单通道 alpha（0/255 二值，无中间灰度）；环境无 OffscreenCanvas
//   依赖（vitest jsdom 也能跑）。真正展示叠加靠 Konva.Image 拉这块 ImageData 即可。
// - 笔刷形状只做圆（CVAT 也是默认圆；方笔刷可后续扩）。圆心 + 半径用栅格化双循环画，
//   半径上限 200px 时单笔 ≤ ~125k 像素操作，远低于 1 帧预算。
// - polygon → mask 用扫描线填充（ray casting），与浏览器 canvas2d 的 fill 等价；
//   v1 不引入 d3-contour / scanline 库依赖。

export interface MaskBufferOptions {
  width: number;
  height: number;
}

/**
 * 离屏 alpha mask 缓冲。坐标系 = 归一化前的像素 (0..width, 0..height)。
 *
 * - `data[y*width + x]` 取值 0 或 255。
 * - 笔刷 / 橡皮 / fromPolygon 都改 in-place；调用方按需复制。
 */
export class MaskBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor({ width, height }: MaskBufferOptions) {
    if (!Number.isInteger(width) || width <= 0) throw new Error("MaskBuffer: width 必须正整数");
    if (!Number.isInteger(height) || height <= 0) throw new Error("MaskBuffer: height 必须正整数");
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height);
  }

  /** 全清零。 */
  clear(): void {
    this.data.fill(0);
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
   * 圆笔刷：以 (cx, cy) 为中心、半径 r 画一个实心圆（v=255）或擦除（v=0）。
   * 半径 < 1 时仍至少改中心点；越界部分裁掉。
   */
  brush(cx: number, cy: number, r: number, value: 0 | 255 = 255): void {
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
        if (dx * dx + dy2 <= rSq) {
          this.data[row + x] = value;
        }
      }
    }
  }

  /** 橡皮 = brush(cx, cy, r, 0) 的语义糖。 */
  erase(cx: number, cy: number, r: number): void {
    this.brush(cx, cy, r, 0);
  }

  /**
   * polygon 顶点 (image-space) → 填充到 alpha mask。
   *
   * - 用扫描线算法（射线投票判内外）；环不必闭合，会自动连首尾。
   * - 顶点 < 3 时静默不画。
   * - 与已有 mask 是「OR」叠加，调用方要清零先 `clear()`。
   */
  fromPolygon(points: ReadonlyArray<readonly [number, number]>): void {
    if (points.length < 3) return;
    const { width, height } = this;
    // 计算 y 范围裁剪迭代上下界
    let yMin = Infinity, yMax = -Infinity;
    for (const [, py] of points) {
      if (py < yMin) yMin = py;
      if (py > yMax) yMax = py;
    }
    const y0 = Math.max(0, Math.floor(yMin));
    const y1 = Math.min(height - 1, Math.ceil(yMax));
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
        const xa = Math.max(0, Math.floor(xs[i]));
        const xb = Math.min(width - 1, Math.ceil(xs[i + 1]));
        const row = y * width;
        for (let x = xa; x <= xb; x++) this.data[row + x] = 255;
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

  /** 拷贝。 */
  clone(): MaskBuffer {
    const c = new MaskBuffer({ width: this.width, height: this.height });
    c.data.set(this.data);
    return c;
  }
}
