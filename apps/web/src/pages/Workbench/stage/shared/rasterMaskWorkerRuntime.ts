import type {
  RasterMaskCompareMode,
  RasterMaskCompareMetrics,
  RasterMaskTileOverride,
  RasterMaskTileRect,
  RasterMaskTransferredRle,
} from "./rasterMaskWorkerProtocol";

export interface RasterMaskWorkerSession {
  sha256: string;
  size: [number, number];
  counts: Uint32Array;
  runEnds: Uint32Array;
}

/** Exact whole-mask metrics by merging immutable RLE runs without dense pixels. */
export function compareRasterMaskSessionMetrics(
  current: RasterMaskWorkerSession,
  baseline: RasterMaskWorkerSession,
): RasterMaskCompareMetrics {
  if (current.size[0] !== baseline.size[0] || current.size[1] !== baseline.size[1]) {
    throw new Error("mask comparison sessions have different dimensions");
  }
  const pixels = current.size[0] * current.size[1];
  let currentIndex = 0;
  let baselineIndex = 0;
  let offset = 0;
  let currentAreaPixels = 0;
  let baselineAreaPixels = 0;
  let intersectionPixels = 0;
  while (offset < pixels) {
    while (current.runEnds[currentIndex] === offset) currentIndex += 1;
    while (baseline.runEnds[baselineIndex] === offset) baselineIndex += 1;
    const next = Math.min(current.runEnds[currentIndex], baseline.runEnds[baselineIndex]);
    if (!Number.isSafeInteger(next) || next <= offset || next > pixels) {
      throw new Error("mask comparison RLE is invalid");
    }
    const span = next - offset;
    const currentOn = (currentIndex & 1) === 1;
    const baselineOn = (baselineIndex & 1) === 1;
    if (currentOn) currentAreaPixels += span;
    if (baselineOn) baselineAreaPixels += span;
    if (currentOn && baselineOn) intersectionPixels += span;
    offset = next;
  }
  const unionPixels = currentAreaPixels + baselineAreaPixels - intersectionPixels;
  const addedPixels = currentAreaPixels - intersectionPixels;
  const removedPixels = baselineAreaPixels - intersectionPixels;
  return {
    currentAreaPixels,
    baselineAreaPixels,
    intersectionPixels,
    unionPixels,
    changedPixels: addedPixels + removedPixels,
    addedPixels,
    removedPixels,
  };
}

function checkedDimensions(size: [number, number]): { height: number; width: number; pixels: number } {
  const [height, width] = size;
  if (!Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(width) || width <= 0) {
    throw new Error("mask size must contain positive integers");
  }
  const pixels = height * width;
  if (!Number.isSafeInteger(pixels) || pixels > 0xffff_ffff) {
    throw new Error("mask pixel count exceeds the transferable RLE limit");
  }
  return { height, width, pixels };
}

export function buildRasterMaskWorkerSession(
  sha256: string,
  rle: RasterMaskTransferredRle,
): RasterMaskWorkerSession {
  const { pixels } = checkedDimensions(rle.size);
  if (!(rle.counts instanceof Uint32Array) || rle.counts.length === 0) {
    throw new Error("mask counts must be a non-empty Uint32Array");
  }
  const runEnds = new Uint32Array(rle.counts.length);
  let total = 0;
  for (let index = 0; index < rle.counts.length; index += 1) {
    total += rle.counts[index];
    if (total > pixels) throw new Error("sum(counts) exceeds height * width");
    runEnds[index] = total;
  }
  if (total !== pixels) throw new Error("sum(counts) must equal height * width");
  return {
    sha256,
    size: [rle.size[0], rle.size[1]],
    counts: rle.counts,
    runEnds,
  };
}

export function decodeRasterMaskTransferredRle(rle: RasterMaskTransferredRle): Uint8Array {
  const { height, width, pixels } = checkedDimensions(rle.size);
  if (!(rle.counts instanceof Uint32Array) || rle.counts.length === 0) {
    throw new Error("mask counts must be a non-empty Uint32Array");
  }
  const alpha = new Uint8Array(width * height);
  let offset = 0;
  for (let runIndex = 0; runIndex < rle.counts.length; runIndex += 1) {
    const runLength = rle.counts[runIndex];
    if (offset + runLength > pixels) throw new Error("sum(counts) exceeds height * width");
    if ((runIndex & 1) === 1) {
      for (let index = offset; index < offset + runLength; index += 1) {
        const x = Math.floor(index / height);
        const y = index % height;
        alpha[y * width + x] = 255;
      }
    }
    offset += runLength;
  }
  if (offset !== pixels) throw new Error("sum(counts) must equal height * width");
  return alpha;
}

function validateTileRect(
  session: RasterMaskWorkerSession,
  rect: RasterMaskTileRect,
): void {
  const [height, width] = session.size;
  if (
    !Number.isSafeInteger(rect.x)
    || !Number.isSafeInteger(rect.y)
    || !Number.isSafeInteger(rect.width)
    || !Number.isSafeInteger(rect.height)
    || rect.x < 0
    || rect.y < 0
    || rect.width <= 0
    || rect.height <= 0
    || rect.x + rect.width > width
    || rect.y + rect.height > height
  ) {
    throw new Error("mask tile rectangle is outside the session bounds");
  }
}

function runIndexAt(runEnds: Uint32Array, offset: number): number {
  let low = 0;
  let high = runEnds.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (runEnds[mid] <= offset) low = mid + 1;
    else high = mid;
  }
  if (low >= runEnds.length) throw new Error("mask RLE offset is outside the session");
  return low;
}

export function decodeRasterMaskSessionTile(
  session: RasterMaskWorkerSession,
  rect: RasterMaskTileRect,
): Uint8Array {
  validateTileRect(session, rect);
  const [sourceHeight] = session.size;
  const alpha = new Uint8Array(rect.width * rect.height);
  for (let localX = 0; localX < rect.width; localX += 1) {
    let sourceOffset = (rect.x + localX) * sourceHeight + rect.y;
    let runIndex = runIndexAt(session.runEnds, sourceOffset);
    for (let localY = 0; localY < rect.height; localY += 1) {
      while (sourceOffset >= session.runEnds[runIndex]) runIndex += 1;
      if ((runIndex & 1) === 1) alpha[localY * rect.width + localX] = 255;
      sourceOffset += 1;
    }
  }
  return alpha;
}

const CELL_BASELINE_ONLY = 1;
const CELL_CURRENT_ONLY = 2;
const CELL_OVERLAP = 4;

function mergeColumnComparisonCells(
  current: RasterMaskWorkerSession,
  baseline: RasterMaskWorkerSession,
  rect: RasterMaskTileRect,
  sampleStep: number,
  flags: Uint8Array,
  rasterWidth: number,
): void {
  const [sourceHeight] = current.size;
  const rectEndY = rect.y + rect.height;
  for (let sourceX = rect.x; sourceX < rect.x + rect.width; sourceX += 1) {
    const columnStart = sourceX * sourceHeight;
    let offset = columnStart + rect.y;
    const columnEnd = columnStart + rectEndY;
    let currentIndex = runIndexAt(current.runEnds, offset);
    let baselineIndex = runIndexAt(baseline.runEnds, offset);
    const localX = Math.floor((sourceX - rect.x) / sampleStep);
    while (offset < columnEnd) {
      while (current.runEnds[currentIndex] <= offset) currentIndex += 1;
      while (baseline.runEnds[baselineIndex] <= offset) baselineIndex += 1;
      const next = Math.min(
        columnEnd,
        current.runEnds[currentIndex],
        baseline.runEnds[baselineIndex],
      );
      const localY0 = Math.floor((offset - columnStart - rect.y) / sampleStep);
      const localY1 = Math.floor((next - 1 - columnStart - rect.y) / sampleStep);
      const currentOn = (currentIndex & 1) === 1;
      const baselineOn = (baselineIndex & 1) === 1;
      const flag = currentOn
        ? (baselineOn ? CELL_OVERLAP : CELL_CURRENT_ONLY)
        : (baselineOn ? CELL_BASELINE_ONLY : 0);
      if (flag !== 0) {
        for (let localY = localY0; localY <= localY1; localY += 1) {
          flags[localY * rasterWidth + localX] |= flag;
        }
      }
      offset = next;
    }
  }
}

function markCellYRange(
  flags: Uint8Array,
  rasterWidth: number,
  rect: RasterMaskTileRect,
  sampleStep: number,
  sourceX: number,
  sourceY0: number,
  sourceY1: number,
  bit: number,
): void {
  if (
    sourceX < rect.x
    || sourceX >= rect.x + rect.width
    || sourceY1 <= rect.y
    || sourceY0 >= rect.y + rect.height
  ) return;
  const clippedY0 = Math.max(rect.y, sourceY0);
  const clippedY1 = Math.min(rect.y + rect.height, sourceY1);
  if (clippedY1 <= clippedY0) return;
  const localX = Math.floor((sourceX - rect.x) / sampleStep);
  const localY0 = Math.floor((clippedY0 - rect.y) / sampleStep);
  const localY1 = Math.floor((clippedY1 - 1 - rect.y) / sampleStep);
  for (let localY = localY0; localY <= localY1; localY += 1) {
    flags[localY * rasterWidth + localX] |= bit;
  }
}

function markSessionBoundaryCells(
  session: RasterMaskWorkerSession,
  rect: RasterMaskTileRect,
  sampleStep: number,
  flags: Uint8Array,
  rasterWidth: number,
  bit: number,
): void {
  const [sourceHeight, sourceWidth] = session.size;
  const rectEndY = rect.y + rect.height;

  // Vertical foreground run endpoints are exact top/bottom boundary pixels.
  for (let sourceX = rect.x; sourceX < rect.x + rect.width; sourceX += 1) {
    const columnStart = sourceX * sourceHeight;
    const columnEnd = columnStart + sourceHeight;
    let offset = columnStart;
    let runIndex = runIndexAt(session.runEnds, offset);
    while (offset < columnEnd) {
      while (session.runEnds[runIndex] <= offset) runIndex += 1;
      const next = Math.min(columnEnd, session.runEnds[runIndex]);
      if ((runIndex & 1) === 1) {
        const sourceY0 = offset - columnStart;
        const sourceY1 = next - columnStart;
        if (sourceY0 === 0 || offset > columnStart) {
          markCellYRange(
            flags,
            rasterWidth,
            rect,
            sampleStep,
            sourceX,
            sourceY0,
            sourceY0 + 1,
            bit,
          );
        }
        if (sourceY1 === sourceHeight || next < columnEnd) {
          markCellYRange(
            flags,
            rasterWidth,
            rect,
            sampleStep,
            sourceX,
            sourceY1 - 1,
            sourceY1,
            bit,
          );
        }
      }
      offset = next;
    }
  }

  // Merge adjacent columns as intervals, marking only the foreground side of
  // each horizontal transition. Include transitions just outside the tile so
  // a boundary pixel on the tile edge is still rendered.
  const firstRightX = Math.max(1, rect.x);
  const lastRightX = Math.min(sourceWidth - 1, rect.x + rect.width);
  for (let rightX = firstRightX; rightX <= lastRightX; rightX += 1) {
    const leftX = rightX - 1;
    const leftColumnStart = leftX * sourceHeight;
    const rightColumnStart = rightX * sourceHeight;
    let sourceY = rect.y;
    let leftIndex = runIndexAt(session.runEnds, leftColumnStart + sourceY);
    let rightIndex = runIndexAt(session.runEnds, rightColumnStart + sourceY);
    while (sourceY < rectEndY) {
      const leftOffset = leftColumnStart + sourceY;
      const rightOffset = rightColumnStart + sourceY;
      while (session.runEnds[leftIndex] <= leftOffset) leftIndex += 1;
      while (session.runEnds[rightIndex] <= rightOffset) rightIndex += 1;
      const nextY = Math.min(
        rectEndY,
        session.runEnds[leftIndex] - leftColumnStart,
        session.runEnds[rightIndex] - rightColumnStart,
      );
      const leftOn = (leftIndex & 1) === 1;
      const rightOn = (rightIndex & 1) === 1;
      if (leftOn !== rightOn) {
        markCellYRange(
          flags,
          rasterWidth,
          rect,
          sampleStep,
          leftOn ? leftX : rightX,
          sourceY,
          nextY,
          bit,
        );
      }
      sourceY = nextY;
    }
  }

  if (rect.x === 0) {
    let offset = rect.y;
    let runIndex = runIndexAt(session.runEnds, offset);
    while (offset < rectEndY) {
      while (session.runEnds[runIndex] <= offset) runIndex += 1;
      const next = Math.min(rectEndY, session.runEnds[runIndex]);
      if ((runIndex & 1) === 1) {
        markCellYRange(flags, rasterWidth, rect, sampleStep, 0, offset, next, bit);
      }
      offset = next;
    }
  }
  if (rect.x + rect.width === sourceWidth) {
    const sourceX = sourceWidth - 1;
    const columnStart = sourceX * sourceHeight;
    let offset = columnStart + rect.y;
    const end = columnStart + rectEndY;
    let runIndex = runIndexAt(session.runEnds, offset);
    while (offset < end) {
      while (session.runEnds[runIndex] <= offset) runIndex += 1;
      const next = Math.min(end, session.runEnds[runIndex]);
      if ((runIndex & 1) === 1) {
        markCellYRange(
          flags,
          rasterWidth,
          rect,
          sampleStep,
          sourceX,
          offset - columnStart,
          next - columnStart,
          bit,
        );
      }
      offset = next;
    }
  }
}

function boundaryAt(
  alpha: Uint8Array,
  expanded: RasterMaskTileRect,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
): boolean {
  const localX = x - expanded.x;
  const localY = y - expanded.y;
  if (alpha[localY * expanded.width + localX] === 0) return false;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    const neighborX = x + dx;
    const neighborY = y + dy;
    if (neighborX < 0 || neighborX >= sourceWidth || neighborY < 0 || neighborY >= sourceHeight) {
      return true;
    }
    const neighborLocalX = neighborX - expanded.x;
    const neighborLocalY = neighborY - expanded.y;
    if (alpha[neighborLocalY * expanded.width + neighborLocalX] === 0) return true;
  }
  return false;
}

/**
 * Compare two immutable sessions into a compact 2-bit tile: bit 0 is baseline,
 * bit 1 is current. Boundary mode decodes a clipped one-pixel halo so adjacent
 * tiles produce the same edges as a single larger tile.
 */
export function compareRasterMaskSessionTile(
  current: RasterMaskWorkerSession,
  baseline: RasterMaskWorkerSession,
  rect: RasterMaskTileRect,
  mode: RasterMaskCompareMode,
  sampleStep = 1,
): Uint8Array {
  validateTileRect(current, rect);
  validateTileRect(baseline, rect);
  if (current.size[0] !== baseline.size[0] || current.size[1] !== baseline.size[1]) {
    throw new Error("mask comparison sessions have different dimensions");
  }
  if (!Number.isSafeInteger(sampleStep) || sampleStep < 1) {
    throw new Error("mask comparison sample step must be a positive integer");
  }
  if (sampleStep > 1) {
    const rasterWidth = Math.ceil(rect.width / sampleStep);
    const rasterHeight = Math.ceil(rect.height / sampleStep);
    const codes = new Uint8Array(rasterWidth * rasterHeight);
    if (mode === "boundary") {
      markSessionBoundaryCells(baseline, rect, sampleStep, codes, rasterWidth, 1);
      markSessionBoundaryCells(current, rect, sampleStep, codes, rasterWidth, 2);
      return codes;
    }
    const flags = new Uint8Array(codes.length);
    mergeColumnComparisonCells(current, baseline, rect, sampleStep, flags, rasterWidth);
    for (let index = 0; index < flags.length; index += 1) {
      const flag = flags[index];
      if (mode === "overlay") {
        codes[index] = ((flag & (CELL_BASELINE_ONLY | CELL_OVERLAP)) ? 1 : 0)
          | ((flag & (CELL_CURRENT_ONLY | CELL_OVERLAP)) ? 2 : 0);
      } else if (mode === "xor") {
        codes[index] = ((flag & CELL_BASELINE_ONLY) ? 1 : 0)
          | ((flag & CELL_CURRENT_ONLY) ? 2 : 0);
      } else if (mode === "added") {
        codes[index] = (flag & CELL_CURRENT_ONLY) ? 2 : 0;
      } else {
        codes[index] = (flag & CELL_BASELINE_ONLY) ? 1 : 0;
      }
    }
    return codes;
  }
  const [sourceHeight, sourceWidth] = current.size;
  const expanded = mode === "boundary"
    ? {
        x: Math.max(0, rect.x - 1),
        y: Math.max(0, rect.y - 1),
        width: Math.min(sourceWidth, rect.x + rect.width + 1) - Math.max(0, rect.x - 1),
        height: Math.min(sourceHeight, rect.y + rect.height + 1) - Math.max(0, rect.y - 1),
      }
    : rect;
  const currentAlpha = decodeRasterMaskSessionTile(current, expanded);
  const baselineAlpha = decodeRasterMaskSessionTile(baseline, expanded);
  const codes = new Uint8Array(rect.width * rect.height);
  for (let localY = 0; localY < rect.height; localY += 1) {
    for (let localX = 0; localX < rect.width; localX += 1) {
      const x = rect.x + localX;
      const y = rect.y + localY;
      const expandedIndex = (y - expanded.y) * expanded.width + x - expanded.x;
      const currentOn = mode === "boundary"
        ? boundaryAt(currentAlpha, expanded, sourceWidth, sourceHeight, x, y)
        : currentAlpha[expandedIndex] > 0;
      const baselineOn = mode === "boundary"
        ? boundaryAt(baselineAlpha, expanded, sourceWidth, sourceHeight, x, y)
        : baselineAlpha[expandedIndex] > 0;
      let code = (baselineOn ? 1 : 0) | (currentOn ? 2 : 0);
      if (mode === "xor" && code === 3) code = 0;
      if (mode === "added" && code !== 2) code = 0;
      if (mode === "removed" && code !== 1) code = 0;
      codes[localY * rect.width + localX] = code;
    }
  }
  return codes;
}

interface TileColumnInterval {
  start: number;
  end: number;
  tile: RasterMaskTileOverride;
  localX: number;
}

/** Merge sparse tile overrides without materializing the untouched base plane. */
export function mergeRasterMaskSessionTiles(
  session: RasterMaskWorkerSession,
  tiles: readonly RasterMaskTileOverride[],
): RasterMaskTransferredRle {
  const [height, width] = session.size;
  const intervals: TileColumnInterval[] = [];
  for (const tile of tiles) {
    validateTileRect(session, tile);
    if (!(tile.alpha instanceof Uint8Array) || tile.alpha.length !== tile.width * tile.height) {
      throw new Error("mask tile alpha length does not match its rectangle");
    }
    for (const value of tile.alpha) {
      if (value !== 0 && value !== 255) throw new Error("mask tile alpha must be binary");
    }
    for (let localX = 0; localX < tile.width; localX += 1) {
      const start = (tile.x + localX) * height + tile.y;
      intervals.push({ start, end: start + tile.height, tile, localX });
    }
  }
  intervals.sort((left, right) => left.start - right.start || left.end - right.end);
  let previousEnd = 0;
  for (let index = 1; index < intervals.length; index += 1) {
    previousEnd = Math.max(previousEnd, intervals[index - 1].end);
    if (intervals[index].start < previousEnd) {
      throw new Error("mask tile overrides overlap");
    }
  }

  const counts: number[] = [];
  let outputForeground = false;
  let outputRunLength = 0;
  const append = (foreground: boolean, length: number) => {
    if (length <= 0) return;
    if (foreground === outputForeground) outputRunLength += length;
    else {
      counts.push(outputRunLength);
      outputRunLength = length;
      outputForeground = foreground;
    }
  };

  let cursor = 0;
  let baseRunIndex = 0;
  const advanceBaseTo = (target: number, emit: boolean) => {
    while (cursor < target) {
      while (baseRunIndex < session.runEnds.length && cursor >= session.runEnds[baseRunIndex]) {
        baseRunIndex += 1;
      }
      if (baseRunIndex >= session.runEnds.length) throw new Error("mask RLE ended before the image boundary");
      const length = Math.min(target, session.runEnds[baseRunIndex]) - cursor;
      if (emit) append((baseRunIndex & 1) === 1, length);
      cursor += length;
    }
  };

  for (const interval of intervals) {
    advanceBaseTo(interval.start, true);
    const { tile, localX } = interval;
    let localY = 0;
    while (localY < tile.height) {
      const foreground = tile.alpha[localY * tile.width + localX] > 0;
      let endY = localY + 1;
      while (
        endY < tile.height
        && (tile.alpha[endY * tile.width + localX] > 0) === foreground
      ) endY += 1;
      append(foreground, endY - localY);
      localY = endY;
    }
    advanceBaseTo(interval.end, false);
  }
  advanceBaseTo(width * height, true);
  counts.push(outputRunLength);
  return {
    size: [session.size[0], session.size[1]],
    counts: Uint32Array.from(counts),
  };
}
