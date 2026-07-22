import type {
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
