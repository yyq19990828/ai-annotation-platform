import { describe, expect, it } from "vitest";
import { classColor, colorToHex, getTrackColor, TRACK_COLOR_PALETTE } from "./colors";

function parseOklch(color: string): { lightness: string; chroma: string; hue: number } {
  const match = color.match(/^oklch\((\d+\.\d+) (\d+\.\d+) (\d+\.\d+)\)$/);
  if (!match) throw new Error(`Unexpected color: ${color}`);
  return { lightness: match[1], chroma: match[2], hue: Number(match[3]) };
}

describe("getTrackColor", () => {
  it("falls back to stable per-track colors when no override matches", () => {
    expect(getTrackColor("trk-1", "商品")).toBe(getTrackColor("trk-1", "商品", {}));
    expect(getTrackColor("trk-1", "商品", { "other": "oklch(0.5 0 0)" })).toBe(getTrackColor("trk-1", "商品"));
    expect(getTrackColor("trk-1", "商品")).not.toBe(classColor("商品"));
    expect(getTrackColor("trk-1", "商品")).not.toBe(getTrackColor("trk-2", "商品"));
  });

  it("uses the override color when the trackId is present", () => {
    const override = TRACK_COLOR_PALETTE[0].value;
    expect(getTrackColor("trk-1", "商品", { "trk-1": override })).toBe(override);
  });

  it("spreads hundreds of default tracks across hue, lightness, and chroma", () => {
    const colors = Array.from({ length: 500 }, (_, index) => getTrackColor(`trk-${index}`, "商品"));
    const parsed = colors.map(parseOklch);
    const lightnessBands = new Set(parsed.map((color) => color.lightness));
    const chromaBands = new Set(parsed.map((color) => color.chroma));
    const coarseHueBands = new Set(parsed.map((color) => Math.floor(color.hue / 10)));

    expect(new Set(colors).size).toBeGreaterThanOrEqual(495);
    expect(lightnessBands.size).toBeGreaterThanOrEqual(4);
    expect(chromaBands.size).toBeGreaterThanOrEqual(3);
    expect(coarseHueBands.size).toBeGreaterThanOrEqual(35);
  });

  it("exposes a non-empty palette of oklch colors", () => {
    expect(TRACK_COLOR_PALETTE.length).toBeGreaterThan(0);
    for (const entry of TRACK_COLOR_PALETTE) {
      expect(entry.value.startsWith("oklch(")).toBe(true);
    }
  });
});

describe("colorToHex", () => {
  it("normalizes hex colors without requiring canvas", () => {
    expect(colorToHex("#f00")).toBe("#ff0000");
    expect(colorToHex("#00FF80")).toBe("#00ff80");
  });

  it("parses rgb colors without requiring canvas", () => {
    expect(colorToHex("rgb(255, 0, 128)")).toBe("#ff0080");
    expect(colorToHex("rgba(0 128 255 / 0.5)")).toBe("#0080ff");
  });
});
