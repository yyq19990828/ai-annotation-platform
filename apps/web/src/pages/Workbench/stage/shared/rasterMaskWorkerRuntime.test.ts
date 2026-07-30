import { describe, expect, it } from "vitest";
import { decodeCocoRle, encodeCocoRle } from "./geometry/maskRle";
import { applyMaskMorphology } from "./geometry/maskOperations";
import { MASK_HISTORY_TILE_SIZE, type MaskHistoryPatch } from "./maskHistory";
import {
  buildRasterMaskWorkerSession,
  buildRasterMaskMorphologyPatchesFromXorWords,
  compareRasterMaskSessionMetrics,
  compareRasterMaskSessionTile,
  decodeRasterMaskSessionTile,
  decodeRasterMaskTransferredRle,
  mergeRasterMaskSessionTiles,
  morphologyRasterMaskSessionRoi,
  preparePackedRasterMaskMorphologyRoi,
  prepareRasterMaskMorphologyRoi,
} from "./rasterMaskWorkerRuntime";

function transferred(alpha: Uint8Array, width: number, height: number) {
  const rle = encodeCocoRle(alpha, width, height);
  return { size: rle.size, counts: Uint32Array.from(rle.counts) };
}

function applyPatches(
  alpha: Uint8Array,
  width: number,
  patches: readonly MaskHistoryPatch[],
): Uint8Array {
  const result = new Uint8Array(alpha);
  for (const patch of patches) {
    for (let index = 0; index < patch.width * patch.height; index += 1) {
      if ((patch.xorBits[index >> 3] & (1 << (index & 7))) === 0) continue;
      const x = patch.tileX * MASK_HISTORY_TILE_SIZE + (index % patch.width);
      const y = patch.tileY * MASK_HISTORY_TILE_SIZE + Math.floor(index / patch.width);
      const target = y * width + x;
      result[target] = result[target] === 0 ? 255 : 0;
    }
  }
  return result;
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

describe("rasterMaskWorkerRuntime", () => {
  it("decodes transferred Uint32 counts without a JS number-array copy", () => {
    const alpha = Uint8Array.from([0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 255, 255]);
    expect(decodeRasterMaskTransferredRle(transferred(alpha, 4, 3))).toEqual(alpha);
  });

  it("decodes a non-aligned tile from a registered run index", () => {
    const alpha = Uint8Array.from([0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 255, 255]);
    const session = buildRasterMaskWorkerSession("sha", transferred(alpha, 4, 3));

    expect(decodeRasterMaskSessionTile(session, { x: 1, y: 1, width: 3, height: 2 })).toEqual(
      Uint8Array.from([255, 0, 255, 0, 255, 255]),
    );
  });

  it("merges sparse overrides while preserving untouched base pixels", () => {
    const base = Uint8Array.from([0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 255, 255]);
    const expected = new Uint8Array(base);
    expected[1 * 4 + 1] = 0;
    expected[1 * 4 + 2] = 255;
    expected[2 * 4 + 1] = 255;
    expected[2 * 4 + 2] = 0;
    const session = buildRasterMaskWorkerSession("sha", transferred(base, 4, 3));
    const merged = mergeRasterMaskSessionTiles(session, [
      {
        x: 1,
        y: 1,
        width: 2,
        height: 2,
        alpha: Uint8Array.from([0, 255, 255, 0]),
      },
    ]);

    expect(
      decodeCocoRle({
        encoding: "coco_rle",
        size: merged.size,
        counts: Array.from(merged.counts),
      }),
    ).toEqual(expected);
  });

  it("computes a clipped-halo ROI and returns exact cross-tile XOR patches", () => {
    const width = 513;
    const height = 5;
    const base = new Uint8Array(width * height);
    base[2 * width + 511] = 255;
    const session = buildRasterMaskWorkerSession("sha", transferred(base, width, height));
    const result = morphologyRasterMaskSessionRoi(session, {
      sourceRevision: 7,
      core: { x: 510, y: 1, width: 3, height: 3 },
      input: { x: 509, y: 0, width: 4, height: 5 },
      operation: { operation: "dilate", kernelShape: "square", radius: 1 },
      dirtyOverrides: [],
      backendPolicy: "cpu",
      computeBudgetBytes: 0,
    });
    const expected = applyMaskMorphology(base, width, height, {
      operation: "dilate",
      kernelShape: "square",
      radius: 1,
    }).alpha;

    expect(result).toMatchObject({
      sourceRevision: 7,
      backend: "cpu",
      fallbackReason: "gate-disabled",
      changedPixels: 8,
      changedBounds: { x: 510, y: 1, width: 3, height: 3 },
    });
    expect(result.patches.map((patch) => patch.tileX)).toEqual([0, 1]);
    expect(applyPatches(base, width, result.patches)).toEqual(expected);
  });

  it("materializes packed dirty overrides before morphology", () => {
    const width = 513;
    const height = 5;
    const base = new Uint8Array(width * height);
    const current = new Uint8Array(base);
    current[2 * width + 511] = 255;
    const bits = new Uint8Array(Math.ceil((512 * height) / 8));
    const tileIndex = 2 * 512 + 511;
    bits[tileIndex >> 3] |= 1 << (tileIndex & 7);
    const session = buildRasterMaskWorkerSession("sha", transferred(base, width, height));
    const result = morphologyRasterMaskSessionRoi(session, {
      sourceRevision: 1,
      core: { x: 510, y: 1, width: 3, height: 3 },
      input: { x: 509, y: 0, width: 4, height: 5 },
      operation: { operation: "dilate", kernelShape: "square", radius: 1 },
      dirtyOverrides: [
        {
          tileX: 0,
          tileY: 0,
          x: 0,
          y: 0,
          width: 512,
          height,
          revision: 1,
          bits,
        },
      ],
      backendPolicy: "cpu",
      computeBudgetBytes: 0,
    });
    const expected = applyMaskMorphology(current, width, height, {
      operation: "dilate",
      kernelShape: "square",
      radius: 1,
    }).alpha;

    expect(result.changedPixels).toBe(8);
    expect(applyPatches(current, width, result.patches)).toEqual(expected);
  });

  it("directly prepares a row-aligned packed ROI with exact set and clear overrides", () => {
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
          const tileIndex = y * tileWidth + x;
          bits[tileIndex >>> 3] |= 1 << (tileIndex & 7);
        }
      }
    }
    const session = buildRasterMaskWorkerSession("sha", transferred(base, width, height));
    const request = {
      sourceRevision: 3,
      core: { x: 31, y: 1, width: 483, height: 5 },
      input: { x: 30, y: 0, width: 485, height: 7 },
      operation: { operation: "dilate", kernelShape: "square", radius: 1 } as const,
      dirtyOverrides: [
        {
          tileX: 0,
          tileY: 0,
          x: 0,
          y: 0,
          width: tileWidth,
          height,
          revision: 3,
          bits,
        },
      ],
      backendPolicy: "webgpu-candidate" as const,
      computeBudgetBytes: 128 * 1024 * 1024,
    };

    const dense = prepareRasterMaskMorphologyRoi(session, request).source;
    const packed = preparePackedRasterMaskMorphologyRoi(session, request);

    expect(packed.wordsPerRow).toBe(Math.ceil(request.input.width / 32));
    expect(
      unpackRows(packed.sourceWords, request.input.width, request.input.height, packed.wordsPerRow),
    ).toEqual(dense);
    const tailMask = 0xffff_ffff >>> (32 - (request.input.width & 31));
    for (let y = 0; y < request.input.height; y += 1) {
      expect(packed.sourceWords[y * packed.wordsPerRow + packed.wordsPerRow - 1] & ~tailMask).toBe(
        0,
      );
    }
  });

  it.each([1, 31, 32, 33, 511, 512, 513])(
    "matches dense RLE materialization at packed row width %i",
    (width) => {
      const height = 5;
      const base = Uint8Array.from({ length: width * height }, (_, index) =>
        (index * 13 + Math.floor(index / width) * 7) % 9 < 3 ? 255 : 0,
      );
      const session = buildRasterMaskWorkerSession("sha", transferred(base, width, height));
      const request = {
        sourceRevision: 0,
        core: { x: 0, y: 0, width, height },
        input: { x: 0, y: 0, width, height },
        operation: { operation: "dilate", kernelShape: "square", radius: 1 } as const,
        dirtyOverrides: [],
        backendPolicy: "webgpu-candidate" as const,
        computeBudgetBytes: 128 * 1024 * 1024,
      };
      const packed = preparePackedRasterMaskMorphologyRoi(session, request);
      expect(unpackRows(packed.sourceWords, width, height, packed.wordsPerRow)).toEqual(base);
      if ((width & 31) !== 0) {
        const tailMask = 0xffff_ffff >>> (32 - (width & 31));
        for (let y = 0; y < height; y += 1) {
          expect(
            packed.sourceWords[y * packed.wordsPerRow + packed.wordsPerRow - 1] & ~tailMask,
          ).toBe(0);
        }
      }
    },
  );

  it("builds exact cross-tile patches from non-aligned core XOR words", () => {
    const width = 517;
    const height = 7;
    const base = new Uint8Array(width * height);
    const session = buildRasterMaskWorkerSession("sha", transferred(base, width, height));
    const request = {
      sourceRevision: 4,
      core: { x: 31, y: 1, width: 484, height: 5 },
      input: { x: 30, y: 0, width: 486, height: 7 },
      operation: { operation: "dilate", kernelShape: "square", radius: 1 } as const,
      dirtyOverrides: [],
      backendPolicy: "webgpu-candidate" as const,
      computeBudgetBytes: 128 * 1024 * 1024,
    };
    const wordsPerRow = Math.ceil(request.core.width / 32);
    const xorWords = new Uint32Array(wordsPerRow * request.core.height);
    const changed = [
      [0, 0],
      [31, 0],
      [32, 1],
      [480, 2],
      [483, 4],
    ];
    for (const [x, y] of changed) {
      xorWords[y * wordsPerRow + (x >>> 5)] |= 1 << (x & 31);
    }

    const result = buildRasterMaskMorphologyPatchesFromXorWords(
      session,
      request,
      xorWords,
      wordsPerRow,
    );

    expect(result.changedPixels).toBe(changed.length);
    expect(result.changedBounds).toEqual({ x: 31, y: 1, width: 484, height: 5 });
    expect(result.patches.map(({ tileX }) => tileX)).toEqual([0, 1]);
    const expected = new Uint8Array(base);
    for (const [x, y] of changed) expected[(request.core.y + y) * width + request.core.x + x] = 255;
    expect(applyPatches(base, width, result.patches)).toEqual(expected);
    xorWords[wordsPerRow - 1] |= 0x8000_0000;
    expect(() =>
      buildRasterMaskMorphologyPatchesFromXorWords(session, request, xorWords, wordsPerRow),
    ).toThrow(/tail bits/);
  });

  it("keeps dense word-scatter exact across 8/32/512 alignment and image edges", () => {
    const coreWidths = [1, 7, 8, 9, 31, 32, 33, 511, 512, 513];
    const coreOrigins = [0, 1, 7, 8, 31, 32, 511, 512];
    let seed = 0x23_19_00_01;
    const nextWord = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed;
    };

    for (const coreWidth of coreWidths) {
      for (const coreX of coreOrigins) {
        const width = coreX + coreWidth + 3;
        const height = 7;
        const session = buildRasterMaskWorkerSession(
          "sha",
          transferred(new Uint8Array(width * height), width, height),
        );
        const request = {
          sourceRevision: 1,
          core: { x: coreX, y: 1, width: coreWidth, height: 5 },
          input: {
            x: Math.max(0, coreX - 1),
            y: 0,
            width: Math.min(width, coreX + coreWidth + 1) - Math.max(0, coreX - 1),
            height,
          },
          operation: { operation: "dilate", kernelShape: "square", radius: 1 } as const,
          dirtyOverrides: [],
          backendPolicy: "webgpu-candidate" as const,
          computeBudgetBytes: 128 * 1024 * 1024,
        };
        const wordsPerRow = Math.ceil(coreWidth / 32);
        const xorWords = Uint32Array.from({ length: wordsPerRow * request.core.height }, () =>
          nextWord(),
        );
        const remainder = coreWidth & 31;
        if (remainder !== 0) {
          const tailMask = 0xffff_ffff >>> (32 - remainder);
          for (let y = 0; y < request.core.height; y += 1) {
            xorWords[y * wordsPerRow + wordsPerRow - 1] &= tailMask;
          }
        }

        const perBit = buildRasterMaskMorphologyPatchesFromXorWords(
          session,
          request,
          xorWords,
          wordsPerRow,
          "dense-per-bit",
        );
        const wordScatter = buildRasterMaskMorphologyPatchesFromXorWords(
          session,
          request,
          xorWords,
          wordsPerRow,
          "dense-word-scatter",
        );

        expect(wordScatter.patches).toEqual(perBit.patches);
        expect(wordScatter.changedPixels).toBe(perBit.changedPixels);
        expect(wordScatter.changedBounds).toEqual(perBit.changedBounds);
        expect(wordScatter.xorTotalWords).toBe(xorWords.length);
        expect(wordScatter.xorNonZeroWords).toBe([...xorWords].filter((word) => word !== 0).length);
        expect(wordScatter.xorTouchedTiles).toBe(wordScatter.patches.length);
        expect(wordScatter.patches.map((patch) => [patch.tileY, patch.tileX])).toEqual(
          [...wordScatter.patches]
            .sort((left, right) => left.tileY - right.tileY || left.tileX - right.tileX)
            .map((patch) => [patch.tileY, patch.tileX]),
        );
      }
    }
  });

  it.each([
    ["empty", 0x0000_0000],
    ["lowest", 0x0000_0001],
    ["highest", 0x8000_0000],
    ["alternating", 0xaaaa_aaaa],
    ["full", 0xffff_ffff],
  ])("matches the per-bit golden for %s XOR words", (_name, word) => {
    const width = 1031;
    const height = 515;
    const session = buildRasterMaskWorkerSession(
      "sha",
      transferred(new Uint8Array(width * height), width, height),
    );
    const request = {
      sourceRevision: 2,
      core: { x: 511, y: 511, width: 33, height: 3 },
      input: { x: 510, y: 510, width: 35, height: 5 },
      operation: { operation: "dilate", kernelShape: "square", radius: 1 } as const,
      dirtyOverrides: [],
      backendPolicy: "webgpu-candidate" as const,
      computeBudgetBytes: 128 * 1024 * 1024,
    };
    const wordsPerRow = 2;
    const xorWords = new Uint32Array(wordsPerRow * request.core.height);
    for (let y = 0; y < request.core.height; y += 1) {
      xorWords[y * wordsPerRow] = word;
      xorWords[y * wordsPerRow + 1] = word & 1;
    }

    const perBit = buildRasterMaskMorphologyPatchesFromXorWords(
      session,
      request,
      xorWords,
      wordsPerRow,
      "dense-per-bit",
    );
    const wordScatter = buildRasterMaskMorphologyPatchesFromXorWords(
      session,
      request,
      xorWords,
      wordsPerRow,
      "dense-word-scatter",
    );

    expect(wordScatter.patches).toEqual(perBit.patches);
    expect(wordScatter.changedPixels).toBe(perBit.changedPixels);
    expect(wordScatter.changedBounds).toEqual(perBit.changedBounds);
  });

  it("rejects an oversized morphology ROI before allocating its dense source", () => {
    const width = 4097;
    const height = 4097;
    const session = buildRasterMaskWorkerSession("sha", {
      size: [height, width],
      counts: Uint32Array.of(width * height),
    });
    expect(() =>
      prepareRasterMaskMorphologyRoi(session, {
        sourceRevision: 0,
        core: { x: 0, y: 0, width, height },
        input: { x: 0, y: 0, width, height },
        operation: { operation: "dilate", kernelShape: "square", radius: 1 },
        dirtyOverrides: [],
        backendPolicy: "cpu",
        computeBudgetBytes: 0,
      }),
    ).toThrow(/pixel budget/);
  });

  it.each([
    ["dilate", "square"],
    ["dilate", "disk"],
    ["erode", "square"],
    ["erode", "disk"],
    ["open", "square"],
    ["open", "disk"],
    ["close", "square"],
    ["close", "disk"],
  ] as const)("matches production %s/%s morphology exactly", (operation, kernelShape) => {
    const width = 19;
    const height = 17;
    const source = new Uint8Array(width * height);
    for (let y = 3; y < 14; y += 1) {
      for (let x = 4; x < 16; x += 1) source[y * width + x] = 255;
    }
    source[8 * width + 10] = 0;
    source[1 * width + 1] = 255;
    const session = buildRasterMaskWorkerSession("sha", transferred(source, width, height));
    const result = morphologyRasterMaskSessionRoi(session, {
      sourceRevision: 1,
      core: { x: 0, y: 0, width, height },
      input: { x: 0, y: 0, width, height },
      operation: { operation, kernelShape, radius: 2 },
      dirtyOverrides: [],
      backendPolicy: "cpu",
      computeBudgetBytes: 0,
    });
    const expected = applyMaskMorphology(source, width, height, {
      operation,
      kernelShape,
      radius: 2,
    }).alpha;
    expect(applyPatches(source, width, result.patches)).toEqual(expected);
  });

  it("matches dense replacement across deterministic sparse fixtures", () => {
    const width = 7;
    const height = 6;
    let seed = 0x23_10;
    const nextBit = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return (seed & 3) === 0 ? 255 : 0;
    };
    for (let fixture = 0; fixture < 50; fixture += 1) {
      const base = Uint8Array.from({ length: width * height }, nextBit);
      const first = {
        x: 0,
        y: 1,
        width: 2,
        height: 3,
        alpha: Uint8Array.from({ length: 6 }, nextBit),
      };
      const second = {
        x: 3,
        y: 0,
        width: 3,
        height: 2,
        alpha: Uint8Array.from({ length: 6 }, nextBit),
      };
      const expected = new Uint8Array(base);
      for (const tile of [first, second]) {
        for (let localY = 0; localY < tile.height; localY += 1) {
          for (let localX = 0; localX < tile.width; localX += 1) {
            expected[(tile.y + localY) * width + tile.x + localX] =
              tile.alpha[localY * tile.width + localX];
          }
        }
      }
      const session = buildRasterMaskWorkerSession("sha", transferred(base, width, height));
      const merged = mergeRasterMaskSessionTiles(session, [first, second]);
      expect(
        decodeCocoRle({
          encoding: "coco_rle",
          size: merged.size,
          counts: Array.from(merged.counts),
        }),
      ).toEqual(expected);
    }
  });

  it("rejects overlapping tile columns before merge", () => {
    const session = buildRasterMaskWorkerSession("sha", transferred(new Uint8Array(16), 4, 4));
    expect(() =>
      mergeRasterMaskSessionTiles(session, [
        { x: 0, y: 0, width: 2, height: 3, alpha: new Uint8Array(6) },
        { x: 1, y: 1, width: 2, height: 2, alpha: new Uint8Array(4) },
      ]),
    ).toThrow(/overlap/);
  });

  it("applies the five comparison mode truth tables", () => {
    const baseline = buildRasterMaskWorkerSession(
      "baseline",
      transferred(Uint8Array.from([0, 255, 0, 255]), 4, 1),
    );
    const current = buildRasterMaskWorkerSession(
      "current",
      transferred(Uint8Array.from([0, 0, 255, 255]), 4, 1),
    );
    const rect = { x: 0, y: 0, width: 4, height: 1 };

    expect(compareRasterMaskSessionTile(current, baseline, rect, "overlay")).toEqual(
      Uint8Array.from([0, 1, 2, 3]),
    );
    expect(compareRasterMaskSessionTile(current, baseline, rect, "xor")).toEqual(
      Uint8Array.from([0, 1, 2, 0]),
    );
    expect(compareRasterMaskSessionTile(current, baseline, rect, "added")).toEqual(
      Uint8Array.from([0, 0, 2, 0]),
    );
    expect(compareRasterMaskSessionTile(current, baseline, rect, "removed")).toEqual(
      Uint8Array.from([0, 1, 0, 0]),
    );
  });

  it("uses a one-pixel halo for boundary tiles", () => {
    const solid = new Uint8Array(5 * 5).fill(255);
    const empty = new Uint8Array(5 * 5);
    const current = buildRasterMaskWorkerSession("current", transferred(solid, 5, 5));
    const baseline = buildRasterMaskWorkerSession("baseline", transferred(empty, 5, 5));

    expect(
      compareRasterMaskSessionTile(
        current,
        baseline,
        { x: 1, y: 1, width: 3, height: 3 },
        "boundary",
      ),
    ).toEqual(new Uint8Array(9));
    expect(
      compareRasterMaskSessionTile(
        current,
        baseline,
        { x: 0, y: 0, width: 2, height: 2 },
        "boundary",
      ),
    ).toEqual(Uint8Array.from([2, 2, 2, 0]));
  });

  it("按 LOD 步长采样大视口，不物化源尺寸 tile", () => {
    const current = buildRasterMaskWorkerSession(
      "current",
      transferred(new Uint8Array(16).fill(255), 4, 4),
    );
    const baseline = buildRasterMaskWorkerSession(
      "baseline",
      transferred(new Uint8Array(16), 4, 4),
    );
    expect(
      compareRasterMaskSessionTile(
        current,
        baseline,
        { x: 0, y: 0, width: 4, height: 4 },
        "added",
        2,
      ),
    ).toEqual(Uint8Array.from([2, 2, 2, 2]));
  });

  it("LOD 对错开中心采样点的细线和边界做保守聚合", () => {
    const thinLine = Uint8Array.from({ length: 64 }, (_, index) => (index % 8 === 0 ? 255 : 0));
    const current = buildRasterMaskWorkerSession("current", transferred(thinLine, 8, 8));
    const baseline = buildRasterMaskWorkerSession(
      "baseline",
      transferred(new Uint8Array(64), 8, 8),
    );
    const rect = { x: 0, y: 0, width: 8, height: 8 };

    expect(compareRasterMaskSessionTile(current, baseline, rect, "added", 4)).toEqual(
      Uint8Array.from([2, 0, 2, 0]),
    );
    expect(compareRasterMaskSessionTile(current, baseline, rect, "boundary", 4)).toEqual(
      Uint8Array.from([2, 0, 2, 0]),
    );
  });

  it("LOD XOR 同一 cell 内双向差异仍保持可见", () => {
    const currentAlpha = new Uint8Array(16);
    const baselineAlpha = new Uint8Array(16);
    currentAlpha[0] = 255;
    baselineAlpha[1] = 255;
    const current = buildRasterMaskWorkerSession("current", transferred(currentAlpha, 4, 4));
    const baseline = buildRasterMaskWorkerSession("baseline", transferred(baselineAlpha, 4, 4));

    expect(
      compareRasterMaskSessionTile(
        current,
        baseline,
        { x: 0, y: 0, width: 4, height: 4 },
        "xor",
        4,
      ),
    ).toEqual(Uint8Array.from([3]));
  });

  it("LOD RLE 区间聚合与 1:1 真值在五种模式下一致", () => {
    const width = 7;
    const height = 6;
    let seed = 0x23_11;
    const randomAlpha = () =>
      Uint8Array.from({ length: width * height }, () => {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
        return (seed & 3) === 0 ? 255 : 0;
      });
    const modes = ["overlay", "boundary", "xor", "added", "removed"] as const;
    const rect = { x: 0, y: 0, width, height };
    for (let fixture = 0; fixture < 20; fixture += 1) {
      const current = buildRasterMaskWorkerSession(
        `current-${fixture}`,
        transferred(randomAlpha(), width, height),
      );
      const baseline = buildRasterMaskWorkerSession(
        `baseline-${fixture}`,
        transferred(randomAlpha(), width, height),
      );
      for (const mode of modes) {
        const dense = compareRasterMaskSessionTile(current, baseline, rect, mode);
        const expected = new Uint8Array(Math.ceil(width / 2) * Math.ceil(height / 2));
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            expected[Math.floor(y / 2) * Math.ceil(width / 2) + Math.floor(x / 2)] |=
              dense[y * width + x];
          }
        }
        expect(compareRasterMaskSessionTile(current, baseline, rect, mode, 2)).toEqual(expected);
      }
    }
  });

  it("直接在双 session RLE runs 上计算完整指标", () => {
    const current = buildRasterMaskWorkerSession(
      "current",
      transferred(Uint8Array.from([0, 255, 255, 0]), 4, 1),
    );
    const baseline = buildRasterMaskWorkerSession(
      "baseline",
      transferred(Uint8Array.from([255, 255, 0, 0]), 4, 1),
    );
    expect(compareRasterMaskSessionMetrics(current, baseline)).toEqual({
      currentAreaPixels: 2,
      baselineAreaPixels: 2,
      intersectionPixels: 1,
      unionPixels: 3,
      changedPixels: 2,
      addedPixels: 1,
      removedPixels: 1,
    });
  });
});
