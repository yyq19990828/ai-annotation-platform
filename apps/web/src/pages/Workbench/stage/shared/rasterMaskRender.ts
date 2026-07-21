export type RasterMaskPoint = { x: number; y: number };

export type RasterMaskNormalizedBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export interface RasterMaskAlphaCrop {
  /** Crop origin in source-image pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Row-major alpha for the cropped rectangle. */
  alpha: Uint8Array;
}

export interface RasterMaskAnalysis {
  sourceWidth: number;
  sourceHeight: number;
  /** Number of non-zero pixels. */
  area: number;
  /** Number of 4-connected foreground components. */
  componentCount: number;
  bounds: RasterMaskNormalizedBounds;
  crop: RasterMaskAlphaCrop;
}

export interface RasterMaskPickSurface {
  sourceWidth: number;
  sourceHeight: number;
  crop: RasterMaskAlphaCrop;
}

/** Shared committed-mask view model for image and video renderers. */
export interface RasterMaskRenderRecord<TSource extends string = string>
  extends RasterMaskPickSurface {
  id: string;
  source: TSource;
  image: CanvasImageSource;
  bounds: RasterMaskNormalizedBounds;
  area: number;
  componentCount: number;
  zOrder: number;
  selected: boolean;
  cacheKey: string;
}

export interface RasterMaskCroppedImage {
  image: CanvasImageSource;
  x: number;
  y: number;
  width: number;
  height: number;
}

type RowRun = { start: number; end: number; label: number };

function assertAlphaPlane(alpha: Uint8Array, width: number, height: number) {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error("raster mask width must be a positive integer");
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error("raster mask height must be a positive integer");
  }
  if (alpha.length !== width * height) {
    throw new Error("raster mask alpha length must equal width * height");
  }
}

function scanRasterMaskAlpha(alpha: Uint8Array, width: number, height: number) {
  assertAlphaPlane(alpha, width, height);

  let area = 0;
  let componentCount = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let nextLabel = 1;
  let previousRuns: RowRun[] = [];
  let parents = new Map<number, number>();

  const find = (label: number): number => {
    let root = label;
    while (parents.get(root) !== root) root = parents.get(root) ?? root;
    let cursor = label;
    while (cursor !== root) {
      const parent = parents.get(cursor);
      parents.set(cursor, root);
      if (parent == null || parent === cursor) break;
      cursor = parent;
    }
    return root;
  };

  const union = (left: number, right: number): number => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return leftRoot;
    const root = Math.min(leftRoot, rightRoot);
    parents.set(Math.max(leftRoot, rightRoot), root);
    return root;
  };

  for (let y = 0; y < height; y += 1) {
    const currentRuns: RowRun[] = [];
    let x = 0;
    while (x < width) {
      while (x < width && alpha[y * width + x] === 0) x += 1;
      if (x >= width) break;
      const start = x;
      while (x + 1 < width && alpha[y * width + x + 1] !== 0) x += 1;
      const end = x;

      area += end - start + 1;
      minX = Math.min(minX, start);
      maxX = Math.max(maxX, end);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      const overlappingLabels: number[] = [];
      for (const run of previousRuns) {
        if (run.end < start) continue;
        if (run.start > end) break;
        overlappingLabels.push(find(run.label));
      }

      let label: number;
      if (overlappingLabels.length === 0) {
        label = nextLabel;
        nextLabel += 1;
        parents.set(label, label);
      } else {
        label = overlappingLabels[0];
        for (let index = 1; index < overlappingLabels.length; index += 1) {
          label = union(label, overlappingLabels[index]);
        }
      }
      currentRuns.push({ start, end, label });
      x += 1;
    }

    for (const run of currentRuns) run.label = find(run.label);
    const activeRoots = new Set(currentRuns.map((run) => run.label));
    const previousRoots = new Set(previousRuns.map((run) => find(run.label)));
    for (const root of previousRoots) {
      if (!activeRoots.has(root)) componentCount += 1;
    }

    // Only labels represented by the current row can connect to a later row.
    // Dropping finalized labels keeps component analysis bounded by one scanline.
    parents = new Map([...activeRoots].map((root) => [root, root]));
    previousRuns = currentRuns;
  }

  componentCount += new Set(previousRuns.map((run) => run.label)).size;
  const empty = maxX < minX || maxY < minY;
  return {
    area,
    componentCount,
    pixelBounds: empty
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

function normalizedBounds(
  pixelBounds: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
): RasterMaskNormalizedBounds {
  return {
    x: pixelBounds.x / sourceWidth,
    y: pixelBounds.y / sourceHeight,
    w: pixelBounds.width / sourceWidth,
    h: pixelBounds.height / sourceHeight,
  };
}

/**
 * Analyze a row-major binary alpha plane and return its exact cropped truth.
 * Foreground connectivity is 4-neighbour; holes do not create components.
 */
export function analyzeRasterMaskAlpha(
  alpha: Uint8Array,
  width: number,
  height: number,
): RasterMaskAnalysis {
  const scanned = scanRasterMaskAlpha(alpha, width, height);
  const { x, y, width: cropWidth, height: cropHeight } = scanned.pixelBounds;
  const croppedAlpha = new Uint8Array(cropWidth * cropHeight);
  for (let row = 0; row < cropHeight; row += 1) {
    const sourceStart = (y + row) * width + x;
    croppedAlpha.set(alpha.subarray(sourceStart, sourceStart + cropWidth), row * cropWidth);
  }
  return {
    sourceWidth: width,
    sourceHeight: height,
    area: scanned.area,
    componentCount: scanned.componentCount,
    bounds: normalizedBounds(scanned.pixelBounds, width, height),
    crop: { x, y, width: cropWidth, height: cropHeight, alpha: croppedAlpha },
  };
}

/** Bounds-only compatibility helper for existing renderers. */
export function rasterMaskAlphaBounds(
  alpha: Uint8Array,
  width: number,
  height: number,
): RasterMaskNormalizedBounds {
  const scanned = scanRasterMaskAlpha(alpha, width, height);
  return normalizedBounds(scanned.pixelBounds, width, height);
}

function parseHexColor(color: string): [number, number, number] {
  const normalized = color.startsWith("#") ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return [168, 85, 247];
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

export function buildTintedMaskRgba(alpha: Uint8Array, color: string): Uint8ClampedArray {
  const [red, green, blue] = parseHexColor(color);
  const rgba = new Uint8ClampedArray(alpha.length * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] === 0) continue;
    const offset = index * 4;
    rgba[offset] = red;
    rgba[offset + 1] = green;
    rgba[offset + 2] = blue;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

/** Build a bitmap/canvas containing only the non-empty crop. */
export async function createTintedRasterMaskImage(
  analysis: RasterMaskAnalysis,
  color: string,
): Promise<RasterMaskCroppedImage | null> {
  const { crop } = analysis;
  if (crop.width === 0 || crop.height === 0) return null;
  const rgba = buildTintedMaskRgba(crop.alpha, color);
  const imageData = new ImageData(rgba, crop.width, crop.height);
  const image = typeof createImageBitmap === "function"
    ? await createImageBitmap(imageData)
    : (() => {
        if (typeof document === "undefined") {
          throw new Error("canvas is unavailable");
        }
        const canvas = document.createElement("canvas");
        canvas.width = crop.width;
        canvas.height = crop.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2D canvas context is unavailable");
        context.putImageData(imageData, 0, 0);
        return canvas;
      })();
  return { image, x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

export function closeRasterMaskImage(image: CanvasImageSource | null | undefined) {
  if (image && typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
}

function surfaceContainsPoint(surface: RasterMaskPickSurface, point: RasterMaskPoint): boolean {
  const { sourceWidth, sourceHeight, crop } = surface;
  if (
    sourceWidth <= 0
    || sourceHeight <= 0
    || crop.width <= 0
    || crop.height <= 0
    || crop.alpha.length !== crop.width * crop.height
  ) {
    return false;
  }
  const sourceX = Math.min(sourceWidth - 1, Math.floor(point.x * sourceWidth));
  const sourceY = Math.min(sourceHeight - 1, Math.floor(point.y * sourceHeight));
  if (
    sourceX < crop.x
    || sourceX >= crop.x + crop.width
    || sourceY < crop.y
    || sourceY >= crop.y + crop.height
  ) {
    return false;
  }
  const cropX = sourceX - crop.x;
  const cropY = sourceY - crop.y;
  return crop.alpha[cropY * crop.width + cropX] > 0;
}

/**
 * Pick the highest z-order foreground pixel. Equal z-order records keep render
 * order semantics: the later input record is on top.
 */
export function pickTopRasterMaskAt<T extends { zOrder: number }>(
  records: readonly T[],
  point: RasterMaskPoint,
  surfaceFor?: (record: T) => RasterMaskPickSurface,
): T | null {
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
  let picked: T | null = null;
  let pickedZ = Number.NEGATIVE_INFINITY;
  let pickedIndex = -1;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const surface = surfaceFor
      ? surfaceFor(record)
      : record as T & RasterMaskPickSurface;
    if (!surfaceContainsPoint(surface, point)) continue;
    if (record.zOrder > pickedZ || (record.zOrder === pickedZ && index > pickedIndex)) {
      picked = record;
      pickedZ = record.zOrder;
      pickedIndex = index;
    }
  }
  return picked;
}
