import { describe, expect, it } from "vitest";
import { tintSparseMaskTile } from "./TiledMaskOverlayLayer";

describe("tintSparseMaskTile", () => {
  it("creates RGBA only for one bounded tile", () => {
    const rgba = tintSparseMaskTile(Uint8Array.of(0, 255, 255, 0), 2, 2, [10, 20, 30], 127);
    expect(Array.from(rgba)).toEqual([0, 0, 0, 0, 10, 20, 30, 127, 10, 20, 30, 127, 0, 0, 0, 0]);
  });

  it("rejects a full-plane length mismatch", () => {
    expect(() => tintSparseMaskTile(new Uint8Array(3), 2, 2, [1, 2, 3], 255)).toThrow(/length/);
  });
});
