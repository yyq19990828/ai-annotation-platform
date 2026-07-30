import { describe, expect, it } from "vitest";
import { encodeCocoRle } from "./geometry/maskRle";
import { RasterMaskPackedBaseCache } from "./rasterMaskPackedBaseCache";
import {
  buildRasterMaskWorkerSession,
  preparePackedRasterMaskMorphologyRoi,
  prepareRasterMaskMorphologyRoi,
} from "./rasterMaskWorkerRuntime";

function transferred(alpha: Uint8Array, width: number, height: number) {
  const rle = encodeCocoRle(alpha, width, height);
  return { size: rle.size, counts: Uint32Array.from(rle.counts) };
}

function unpackRows(
  words: Uint32Array,
  width: number,
  height: number,
  wordsPerRow: number,
): Uint8Array {
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (((words[y * wordsPerRow + (x >>> 5)] >>> (x & 31)) & 1) !== 0) {
        alpha[y * width + x] = 255;
      }
    }
  }
  return alpha;
}

function requestFor(
  width: number,
  height: number,
  core: { x: number; y: number; width: number; height: number },
  dirtyOverrides: Array<{
    tileX: number;
    tileY: number;
    x: number;
    y: number;
    width: number;
    height: number;
    revision: number;
    bits: Uint8Array;
  }> = [],
) {
  const radius = 1;
  const inputX = Math.max(0, core.x - radius);
  const inputY = Math.max(0, core.y - radius);
  const inputX1 = Math.min(width, core.x + core.width + radius);
  const inputY1 = Math.min(height, core.y + core.height + radius);
  return {
    sourceRevision: 1,
    core,
    input: {
      x: inputX,
      y: inputY,
      width: inputX1 - inputX,
      height: inputY1 - inputY,
    },
    operation: { operation: "dilate", kernelShape: "square", radius } as const,
    dirtyOverrides,
    backendPolicy: "webgpu-candidate" as const,
    computeBudgetBytes: 128 * 1024 * 1024,
  };
}

describe("RasterMaskPackedBaseCache", () => {
  it("reuses immutable packed base tiles and preserves exact dirty set/clear semantics", () => {
    const width = 517;
    const height = 7;
    const base = Uint8Array.from({ length: width * height }, (_, index) =>
      (index * 17 + Math.floor(index / width) * 3) % 11 < 4 ? 255 : 0,
    );
    const current = new Uint8Array(base);
    const tileWidth = 512;
    const bits = new Uint8Array(Math.ceil((tileWidth * height) / 8));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        const enabled = (x + y * 5) % 7 === 0;
        current[y * width + x] = enabled ? 255 : 0;
        if (enabled) {
          const index = y * tileWidth + x;
          bits[index >>> 3] |= 1 << (index & 7);
        }
      }
    }
    const session = buildRasterMaskWorkerSession("sha", transferred(base, width, height));
    const request = requestFor(width, height, { x: 31, y: 1, width: 483, height: 5 }, [
      {
        tileX: 0,
        tileY: 0,
        x: 0,
        y: 0,
        width: tileWidth,
        height,
        revision: 1,
        bits,
      },
    ]);
    const cache = new RasterMaskPackedBaseCache();

    const first = cache.prepare("session", session, request, 1024 * 1024);
    const second = cache.prepare("session", session, request, 1024 * 1024);
    const dense = prepareRasterMaskMorphologyRoi(session, request).source;

    expect(
      unpackRows(first.sourceWords, request.input.width, request.input.height, first.wordsPerRow),
    ).toEqual(dense);
    expect(
      unpackRows(second.sourceWords, request.input.width, request.input.height, second.wordsPerRow),
    ).toEqual(dense);
    expect(first).toMatchObject({
      prepareStrategy: "packed-cache",
      baseCacheHitTiles: 0,
      baseCacheMissTiles: 2,
    });
    expect(second).toMatchObject({
      prepareStrategy: "packed-cache",
      baseCacheHitTiles: 2,
      baseCacheMissTiles: 0,
    });
    expect(cache.snapshot()).toMatchObject({ entries: 2, hits: 2, misses: 2, fills: 2 });
  });

  it.each([1, 31, 32, 33, 511, 512, 513])(
    "matches direct packed preparation at width %i",
    (width) => {
      const height = 5;
      const base = Uint8Array.from({ length: width * height }, (_, index) =>
        (index * 13 + Math.floor(index / width) * 7) % 9 < 3 ? 255 : 0,
      );
      const session = buildRasterMaskWorkerSession("sha", transferred(base, width, height));
      const request = requestFor(width, height, { x: 0, y: 0, width, height });
      const cache = new RasterMaskPackedBaseCache();
      const cached = cache.prepare("session", session, request, 1024 * 1024);
      const direct = preparePackedRasterMaskMorphologyRoi(session, request);

      expect(cached.wordsPerRow).toBe(direct.wordsPerRow);
      expect(cached.sourceWords).toEqual(direct.sourceWords);
    },
  );

  it("overwrites a non-word-aligned edge dirty tile exactly", () => {
    const width = 517;
    const height = 9;
    const base = Uint8Array.from({ length: width * height }, (_, index) =>
      (index * 5 + 3) % 7 < 3 ? 255 : 0,
    );
    const edgeWidth = 5;
    const bits = new Uint8Array(Math.ceil((edgeWidth * height) / 8));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < edgeWidth; x += 1) {
        if ((x + y) % 3 !== 0) continue;
        const index = y * edgeWidth + x;
        bits[index >>> 3] |= 1 << (index & 7);
      }
    }
    const session = buildRasterMaskWorkerSession("sha", transferred(base, width, height));
    const request = requestFor(width, height, { x: 510, y: 1, width: 7, height: 7 }, [
      {
        tileX: 1,
        tileY: 0,
        x: 512,
        y: 0,
        width: edgeWidth,
        height,
        revision: 4,
        bits,
      },
    ]);
    const cache = new RasterMaskPackedBaseCache();
    const cached = cache.prepare("session", session, request, 1024 * 1024);
    const direct = preparePackedRasterMaskMorphologyRoi(session, request);

    expect(cached.sourceWords).toEqual(direct.sourceWords);
  });

  it("evicts the least-recently-used tile within its hard byte cap", () => {
    const width = 1024;
    const height = 8;
    const base = Uint8Array.from({ length: width * height }, (_, index) =>
      index % 5 === 0 ? 255 : 0,
    );
    const session = buildRasterMaskWorkerSession("sha", transferred(base, width, height));
    const left = requestFor(width, height, { x: 0, y: 0, width: 511, height });
    const right = requestFor(width, height, { x: 513, y: 0, width: 511, height });
    const cache = new RasterMaskPackedBaseCache();
    const oneTileBytes = (512 / 32) * height * 4;

    cache.prepare("session", session, left, oneTileBytes);
    cache.prepare("session", session, right, oneTileBytes);

    expect(cache.snapshot()).toMatchObject({
      entries: 1,
      retainedBytes: oneTileBytes,
      misses: 2,
      evictions: 1,
    });
    const leftAgain = cache.prepare("session", session, left, oneTileBytes);
    expect(leftAgain.baseCacheMissTiles).toBe(1);
    expect(cache.snapshot().evictions).toBe(2);
  });

  it("purges one session independently and clears scratch at final teardown", () => {
    const width = 64;
    const height = 8;
    const base = Uint8Array.from({ length: width * height }, (_, index) =>
      index % 7 === 0 ? 255 : 0,
    );
    const session = buildRasterMaskWorkerSession("sha", transferred(base, width, height));
    const request = requestFor(width, height, { x: 0, y: 0, width, height });
    const cache = new RasterMaskPackedBaseCache();

    cache.prepare("first", session, request, 1024 * 1024);
    cache.prepare("second", session, request, 1024 * 1024);
    const before = cache.snapshot();
    expect(before.entries).toBe(2);
    expect(before.sourceScratchCapacityBytes).toBeGreaterThan(0);

    cache.releaseSession("first");
    expect(cache.snapshot()).toMatchObject({ entries: 1, sessionPurges: 1 });
    cache.clear();
    expect(cache.snapshot()).toMatchObject({
      entries: 0,
      retainedBytes: 0,
      maxBytes: 0,
      sourceScratchCapacityBytes: 0,
    });
  });

  it("clears reused scratch bits when a large request is followed by a small one", () => {
    const width = 513;
    const height = 5;
    const full = new Uint8Array(width * height).fill(255);
    const empty = new Uint8Array(width * height);
    const fullSession = buildRasterMaskWorkerSession("full", transferred(full, width, height));
    const emptySession = buildRasterMaskWorkerSession("empty", transferred(empty, width, height));
    const large = requestFor(width, height, { x: 0, y: 0, width, height });
    const small = requestFor(width, height, { x: 500, y: 1, width: 4, height: 3 });
    const cache = new RasterMaskPackedBaseCache();

    cache.prepare("full", fullSession, large, 1024 * 1024);
    const result = cache.prepare("empty", emptySession, small, 1024 * 1024);

    expect([...result.sourceWords]).toEqual(new Array(result.sourceWords.length).fill(0));
  });
});
