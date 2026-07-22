import { describe, expect, it } from "vitest";
import { decodeCocoRle, encodeCocoRle } from "./geometry/maskRle";
import {
  buildRasterMaskWorkerSession,
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
});
