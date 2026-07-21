export interface CocoRle {
  encoding: "coco_rle";
  size: [number, number];
  counts: number[];
}

export const MAX_MASK_DIMENSION = 4096;
export const MAX_MASK_PIXELS = MAX_MASK_DIMENSION * MAX_MASK_DIMENSION;
export const MAX_MASK_RUNS = 1_000_000;
export const MAX_MASK_GZIP_COMPRESSED_BYTES = 8 * 1024 * 1024;
export const MAX_MASK_GZIP_UNCOMPRESSED_BYTES = 4 * 1024 * 1024;
export const MAX_MASK_GZIP_EXPANSION_RATIO = 20;
export const MASK_GZIP_MIN_BYTES = 64 * 1024;

type GzipCompressor = (input: Uint8Array) => Promise<Uint8Array>;

export interface PreparedCocoRleGzipUpload {
  body: Blob;
  compressedBytes: number;
  uncompressedBytes: number;
}

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

async function compressWithBrowserStream(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    throw new Error("CompressionStream is unavailable");
  }
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 为 mask-content 上传准备真实 HTTP gzip 正文。
 *
 * 返回 null 表示必须走普通 JSON：小正文、浏览器不支持 gzip、任一绝对上限超出，或
 * 展开比超过后端 reader 的 20× 安全合同。对象存储偏好与 RLE 正文编码分离，故压缩
 * 前正文仍保持 encoding=coco_rle，仅额外携带 storage_encoding=gzip。
 */
export async function prepareCocoRleGzipUpload(
  rle: CocoRle,
  options: { minBytes?: number; compress?: GzipCompressor } = {},
): Promise<PreparedCocoRleGzipUpload | null> {
  const checked = validateCocoRle(rle);
  const json = JSON.stringify({ ...checked, storage_encoding: "gzip" });
  const raw = new TextEncoder().encode(json);
  const minBytes = options.minBytes ?? MASK_GZIP_MIN_BYTES;
  if (raw.byteLength < minBytes || raw.byteLength > MAX_MASK_GZIP_UNCOMPRESSED_BYTES) {
    return null;
  }
  const compress = options.compress
    ?? (typeof CompressionStream === "undefined" ? null : compressWithBrowserStream);
  if (!compress) return null;
  let compressed: Uint8Array;
  try {
    compressed = await compress(raw);
  } catch {
    return null;
  }
  if (
    compressed.byteLength === 0
    || compressed.byteLength > MAX_MASK_GZIP_COMPRESSED_BYTES
    || raw.byteLength > compressed.byteLength * MAX_MASK_GZIP_EXPANSION_RATIO
  ) {
    return null;
  }
  return {
    body: new Blob([compressed], { type: "application/json" }),
    compressedBytes: compressed.byteLength,
    uncompressedBytes: raw.byteLength,
  };
}
