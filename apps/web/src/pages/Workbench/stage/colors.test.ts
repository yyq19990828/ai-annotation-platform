import { describe, expect, it } from "vitest";
import { classColor, getTrackColor, TRACK_COLOR_PALETTE } from "./colors";

describe("getTrackColor", () => {
  it("falls back to classColor when no override matches", () => {
    expect(getTrackColor("trk-1", "商品")).toBe(classColor("商品"));
    expect(getTrackColor("trk-1", "商品", {})).toBe(classColor("商品"));
    expect(getTrackColor("trk-1", "商品", { "other": "oklch(0.5 0 0)" })).toBe(classColor("商品"));
  });

  it("uses the override color when the trackId is present", () => {
    const override = TRACK_COLOR_PALETTE[0].value;
    expect(getTrackColor("trk-1", "商品", { "trk-1": override })).toBe(override);
  });

  it("exposes a non-empty palette of oklch colors", () => {
    expect(TRACK_COLOR_PALETTE.length).toBeGreaterThan(0);
    for (const entry of TRACK_COLOR_PALETTE) {
      expect(entry.value.startsWith("oklch(")).toBe(true);
    }
  });
});
