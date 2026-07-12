export interface CocoRle {
  encoding: "coco_rle";
  size: [number, number];
  counts: number[];
}

export const MAX_MASK_DIMENSION = 4096;
export const MAX_MASK_PIXELS = MAX_MASK_DIMENSION * MAX_MASK_DIMENSION;
export const MAX_MASK_RUNS = 1_000_000;

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value as number;
}

export function validateCocoRle(rle: unknown): CocoRle {
  if (!rle || typeof rle !== "object") throw new Error("RLE must be an object");
  const value = rle as Partial<CocoRle>;
  if (value.encoding !== "coco_rle") throw new Error("encoding must be 'coco_rle'");
  if (!Array.isArray(value.size) || value.size.length !== 2) {
    throw new Error("size must be [height, width]");
  }
  const height = positiveInteger(value.size[0], "height");
  const width = positiveInteger(value.size[1], "width");
  if (height > MAX_MASK_DIMENSION || width > MAX_MASK_DIMENSION) {
    throw new Error(`mask dimensions must be <= ${MAX_MASK_DIMENSION}`);
  }
  const pixelCount = height * width;
  if (pixelCount > MAX_MASK_PIXELS) throw new Error(`mask pixels must be <= ${MAX_MASK_PIXELS}`);
  if (!Array.isArray(value.counts) || value.counts.length === 0) {
    throw new Error("counts must be a non-empty integer array");
  }
  if (value.counts.length > MAX_MASK_RUNS) throw new Error(`mask runs must be <= ${MAX_MASK_RUNS}`);
  let total = 0;
  for (let index = 0; index < value.counts.length; index += 1) {
    const count = value.counts[index];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`counts[${index}] must be a non-negative integer`);
    }
    total += count;
    if (total > pixelCount) throw new Error("sum(counts) exceeds height * width");
  }
  if (total !== pixelCount) throw new Error("sum(counts) must equal height * width");
  return { encoding: "coco_rle", size: [height, width], counts: [...value.counts] };
}

export function encodeCocoRle(pixelsRowMajor: ArrayLike<number>, width: number, height: number): CocoRle {
  const checkedWidth = positiveInteger(width, "width");
  const checkedHeight = positiveInteger(height, "height");
  if (checkedWidth > MAX_MASK_DIMENSION || checkedHeight > MAX_MASK_DIMENSION) {
    throw new Error(`mask dimensions must be <= ${MAX_MASK_DIMENSION}`);
  }
  if (pixelsRowMajor.length !== checkedWidth * checkedHeight) {
    throw new Error("pixel buffer length must equal width * height");
  }
  const counts: number[] = [];
  let foreground = false;
  let runLength = 0;
  for (let x = 0; x < checkedWidth; x += 1) {
    for (let y = 0; y < checkedHeight; y += 1) {
      const value = Boolean(pixelsRowMajor[y * checkedWidth + x]);
      if (value === foreground) runLength += 1;
      else {
        counts.push(runLength);
        runLength = 1;
        foreground = value;
      }
    }
  }
  counts.push(runLength);
  if (counts.length > MAX_MASK_RUNS) throw new Error(`mask runs must be <= ${MAX_MASK_RUNS}`);
  return { encoding: "coco_rle", size: [checkedHeight, checkedWidth], counts };
}

export function decodeCocoRle(rle: unknown): Uint8Array {
  const checked = validateCocoRle(rle);
  const [height, width] = checked.size;
  const out = new Uint8Array(width * height);
  let offset = 0;
  let foreground = false;
  for (const runLength of checked.counts) {
    if (foreground) {
      for (let index = offset; index < offset + runLength; index += 1) {
        const x = Math.floor(index / height);
        const y = index % height;
        out[y * width + x] = 255;
      }
    }
    offset += runLength;
    foreground = !foreground;
  }
  return out;
}
