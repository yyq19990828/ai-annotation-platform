import { describe, expect, it } from "vitest";
import { decodeCocoRle, encodeCocoRle } from "./geometry/maskRle";
import {
  buildRasterMaskWorkerSession,
  compareRasterMaskSessionMetrics,
  compareRasterMaskSessionTile,
  decodeRasterMaskSessionTile,
  decodeRasterMaskTransferredRle,
  mergeRasterMaskSessionTiles,
} from "./rasterMaskWorkerRuntime";

function transferred(alpha: Uint8Array, width: number, height: number) {
  const rle = encodeCocoRle(alpha, width, height);
  return { size: rle.size, counts: Uint32Array.from(rle.counts) };
}

describe("rasterMaskWorkerRuntime", () => {
  it("decodes transferred Uint32 counts without a JS number-array copy", () => {
    const alpha = Uint8Array.from([
      0, 255, 0, 0,
      255, 255, 0, 255,
      0, 0, 255, 255,
    ]);
    expect(decodeRasterMaskTransferredRle(transferred(alpha, 4, 3))).toEqual(alpha);
  });

  it("decodes a non-aligned tile from a registered run index", () => {
    const alpha = Uint8Array.from([
      0, 255, 0, 0,
      255, 255, 0, 255,
      0, 0, 255, 255,
    ]);
    const session = buildRasterMaskWorkerSession("sha", transferred(alpha, 4, 3));

    expect(decodeRasterMaskSessionTile(session, { x: 1, y: 1, width: 3, height: 2 })).toEqual(
      Uint8Array.from([
        255, 0, 255,
        0, 255, 255,
      ]),
    );
  });

  it("merges sparse overrides while preserving untouched base pixels", () => {
    const base = Uint8Array.from([
      0, 255, 0, 0,
      255, 255, 0, 255,
      0, 0, 255, 255,
    ]);
    const expected = new Uint8Array(base);
    expected[1 * 4 + 1] = 0;
    expected[1 * 4 + 2] = 255;
    expected[2 * 4 + 1] = 255;
    expected[2 * 4 + 2] = 0;
    const session = buildRasterMaskWorkerSession("sha", transferred(base, 4, 3));
    const merged = mergeRasterMaskSessionTiles(session, [{
      x: 1,
      y: 1,
      width: 2,
      height: 2,
      alpha: Uint8Array.from([0, 255, 255, 0]),
    }]);

    expect(decodeCocoRle({
      encoding: "coco_rle",
      size: merged.size,
      counts: Array.from(merged.counts),
    })).toEqual(expected);
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
      expect(decodeCocoRle({
        encoding: "coco_rle",
        size: merged.size,
        counts: Array.from(merged.counts),
      })).toEqual(expected);
    }
  });

  it("rejects overlapping tile columns before merge", () => {
    const session = buildRasterMaskWorkerSession(
      "sha",
      transferred(new Uint8Array(16), 4, 4),
    );
    expect(() => mergeRasterMaskSessionTiles(session, [
      { x: 0, y: 0, width: 2, height: 3, alpha: new Uint8Array(6) },
      { x: 1, y: 1, width: 2, height: 2, alpha: new Uint8Array(4) },
    ])).toThrow(/overlap/);
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

    expect(compareRasterMaskSessionTile(current, baseline, rect, "overlay"))
      .toEqual(Uint8Array.from([0, 1, 2, 3]));
    expect(compareRasterMaskSessionTile(current, baseline, rect, "xor"))
      .toEqual(Uint8Array.from([0, 1, 2, 0]));
    expect(compareRasterMaskSessionTile(current, baseline, rect, "added"))
      .toEqual(Uint8Array.from([0, 0, 2, 0]));
    expect(compareRasterMaskSessionTile(current, baseline, rect, "removed"))
      .toEqual(Uint8Array.from([0, 1, 0, 0]));
  });

  it("uses a one-pixel halo for boundary tiles", () => {
    const solid = new Uint8Array(5 * 5).fill(255);
    const empty = new Uint8Array(5 * 5);
    const current = buildRasterMaskWorkerSession("current", transferred(solid, 5, 5));
    const baseline = buildRasterMaskWorkerSession("baseline", transferred(empty, 5, 5));

    expect(compareRasterMaskSessionTile(
      current,
      baseline,
      { x: 1, y: 1, width: 3, height: 3 },
      "boundary",
    )).toEqual(new Uint8Array(9));
    expect(compareRasterMaskSessionTile(
      current,
      baseline,
      { x: 0, y: 0, width: 2, height: 2 },
      "boundary",
    )).toEqual(Uint8Array.from([2, 2, 2, 0]));
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
    expect(compareRasterMaskSessionTile(
      current,
      baseline,
      { x: 0, y: 0, width: 4, height: 4 },
      "added",
      2,
    )).toEqual(Uint8Array.from([2, 2, 2, 2]));
  });

  it("LOD 对错开中心采样点的细线和边界做保守聚合", () => {
    const thinLine = Uint8Array.from({ length: 64 }, (_, index) => (
      index % 8 === 0 ? 255 : 0
    ));
    const current = buildRasterMaskWorkerSession(
      "current",
      transferred(thinLine, 8, 8),
    );
    const baseline = buildRasterMaskWorkerSession(
      "baseline",
      transferred(new Uint8Array(64), 8, 8),
    );
    const rect = { x: 0, y: 0, width: 8, height: 8 };

    expect(compareRasterMaskSessionTile(current, baseline, rect, "added", 4))
      .toEqual(Uint8Array.from([2, 0, 2, 0]));
    expect(compareRasterMaskSessionTile(current, baseline, rect, "boundary", 4))
      .toEqual(Uint8Array.from([2, 0, 2, 0]));
  });

  it("LOD XOR 同一 cell 内双向差异仍保持可见", () => {
    const currentAlpha = new Uint8Array(16);
    const baselineAlpha = new Uint8Array(16);
    currentAlpha[0] = 255;
    baselineAlpha[1] = 255;
    const current = buildRasterMaskWorkerSession("current", transferred(currentAlpha, 4, 4));
    const baseline = buildRasterMaskWorkerSession("baseline", transferred(baselineAlpha, 4, 4));

    expect(compareRasterMaskSessionTile(
      current,
      baseline,
      { x: 0, y: 0, width: 4, height: 4 },
      "xor",
      4,
    )).toEqual(Uint8Array.from([3]));
  });

  it("LOD RLE 区间聚合与 1:1 真值在五种模式下一致", () => {
    const width = 7;
    const height = 6;
    let seed = 0x23_11;
    const randomAlpha = () => Uint8Array.from({ length: width * height }, () => {
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
            expected[Math.floor(y / 2) * Math.ceil(width / 2) + Math.floor(x / 2)]
              |= dense[y * width + x];
          }
        }
        expect(compareRasterMaskSessionTile(current, baseline, rect, mode, 2))
          .toEqual(expected);
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
