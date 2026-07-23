export type MaskRasterBrushShape = "circle" | "square";

export interface MaskRasterBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MaskRasterChange {
  changedPixels: number;
  touchedBounds: MaskRasterBounds | null;
}

function assertPlane(alpha: Uint8Array, width: number, height: number): void {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("mask raster dimensions must be positive integers");
  }
  if (alpha.length !== width * height) {
    throw new Error("mask raster alpha length must match its dimensions");
  }
}

export function rasterizeMaskBrush(
  alpha: Uint8Array,
  width: number,
  height: number,
  options: {
    cx: number;
    cy: number;
    radius: number;
    value: 0 | 255;
    shape: MaskRasterBrushShape;
    originX?: number;
    originY?: number;
  },
): MaskRasterChange {
  assertPlane(alpha, width, height);
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const radius = Math.max(0.5, options.radius);
  const globalX0 = Math.max(originX, Math.floor(options.cx - radius));
  const globalX1 = Math.min(originX + width - 1, Math.ceil(options.cx + radius));
  const globalY0 = Math.max(originY, Math.floor(options.cy - radius));
  const globalY1 = Math.min(originY + height - 1, Math.ceil(options.cy + radius));
  if (globalX1 < globalX0 || globalY1 < globalY0) {
    return { changedPixels: 0, touchedBounds: null };
  }
  const radiusSquared = radius * radius;
  let changedPixels = 0;
  for (let globalY = globalY0; globalY <= globalY1; globalY += 1) {
    const dy = globalY - options.cy;
    const row = (globalY - originY) * width;
    for (let globalX = globalX0; globalX <= globalX1; globalX += 1) {
      const dx = globalX - options.cx;
      if (
        (options.shape === "circle" && dx * dx + dy * dy > radiusSquared) ||
        (options.shape === "square" && (Math.abs(dx) > radius || Math.abs(dy) > radius))
      )
        continue;
      const index = row + globalX - originX;
      if (alpha[index] === options.value) continue;
      alpha[index] = options.value;
      changedPixels += 1;
    }
  }
  return {
    changedPixels,
    touchedBounds: {
      x0: globalX0 - originX,
      y0: globalY0 - originY,
      x1: globalX1 - originX + 1,
      y1: globalY1 - originY + 1,
    },
  };
}

export function rasterizeMaskPolygon(
  alpha: Uint8Array,
  width: number,
  height: number,
  points: ReadonlyArray<readonly [number, number]>,
  value: 0 | 255,
  originX = 0,
  originY = 0,
): MaskRasterChange {
  assertPlane(alpha, width, height);
  if (points.length < 3) return { changedPixels: 0, touchedBounds: null };
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("mask polygon points must be finite");
    }
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }
  const firstGlobalY = Math.max(originY, Math.ceil(yMin - 0.5));
  const lastGlobalY = Math.min(originY + height - 1, Math.ceil(yMax - 0.5) - 1);
  let changedPixels = 0;
  for (let globalY = firstGlobalY; globalY <= lastGlobalY; globalY += 1) {
    const intersections: number[] = [];
    const pixelCenterY = globalY + 0.5;
    for (let index = 0; index < points.length; index += 1) {
      const [ax, ay] = points[index];
      const [bx, by] = points[(index + 1) % points.length];
      if (pixelCenterY < Math.min(ay, by) || pixelCenterY >= Math.max(ay, by)) continue;
      intersections.push(ax + ((pixelCenterY - ay) / (by - ay)) * (bx - ax));
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const firstGlobalX = Math.max(originX, Math.ceil(intersections[index] - 0.5));
      const lastGlobalX = Math.min(
        originX + width - 1,
        Math.ceil(intersections[index + 1] - 0.5) - 1,
      );
      const row = (globalY - originY) * width;
      for (let globalX = firstGlobalX; globalX <= lastGlobalX; globalX += 1) {
        const alphaIndex = row + globalX - originX;
        if (alpha[alphaIndex] === value) continue;
        alpha[alphaIndex] = value;
        changedPixels += 1;
      }
    }
  }
  const touchedX0 = Math.max(originX, Math.floor(xMin));
  const touchedY0 = Math.max(originY, Math.floor(yMin));
  const touchedX1 = Math.min(originX + width, Math.ceil(xMax + 1));
  const touchedY1 = Math.min(originY + height, Math.ceil(yMax + 1));
  return {
    changedPixels,
    touchedBounds:
      touchedX1 <= touchedX0 || touchedY1 <= touchedY0
        ? null
        : {
            x0: touchedX0 - originX,
            y0: touchedY0 - originY,
            x1: touchedX1 - originX,
            y1: touchedY1 - originY,
          },
  };
}
