import { expect, type Page } from "@playwright/test";

interface NormalizedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FrameExpectation {
  frame_index: number;
  background_luma: number;
  corner_bits: number[];
  pts_ms?: number;
  duration_ms?: number;
  is_keyframe?: boolean;
  decode_index?: number;
}

export interface FrameExpectations {
  width: number;
  height: number;
  frame_count: number;
  sample_regions: {
    background: NormalizedRegion;
    corners: Array<NormalizedRegion & { bit: number }>;
  };
  frames: FrameExpectation[];
}

export async function sampleFrameMarkers(
  page: Page,
  regions: FrameExpectations["sample_regions"],
): Promise<{
  background: { luma: number; alpha: number };
  corners: Array<{ bit: number; luma: number; alpha: number }>;
}> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return page.evaluate((sampleRegions) => {
    const stage = document.querySelector<HTMLElement>('[data-testid="video-konva-stage"]');
    const canvas = stage?.querySelector<HTMLCanvasElement>(".konvajs-content > canvas");
    if (!canvas) throw new Error("Konva media canvas not found");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Konva media canvas 2D context unavailable");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels.data[(y * canvas.width + x) * 4 + 3] < 200) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) throw new Error("Konva media canvas has no opaque pixels");
    const mediaWidth = maxX - minX + 1;
    const mediaHeight = maxY - minY + 1;
    const average = (region: NormalizedRegion) => {
      const insetX = region.w * 0.2;
      const insetY = region.h * 0.2;
      const left = Math.max(minX, Math.floor(minX + (region.x + insetX) * mediaWidth));
      const top = Math.max(minY, Math.floor(minY + (region.y + insetY) * mediaHeight));
      const right = Math.min(maxX, Math.ceil(minX + (region.x + region.w - insetX) * mediaWidth));
      const bottom = Math.min(maxY, Math.ceil(minY + (region.y + region.h - insetY) * mediaHeight));
      let lumaTotal = 0;
      let alphaTotal = 0;
      let count = 0;
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const r = pixels.data[offset];
          const g = pixels.data[offset + 1];
          const b = pixels.data[offset + 2];
          lumaTotal += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          alphaTotal += pixels.data[offset + 3];
          count += 1;
        }
      }
      if (count === 0) throw new Error("pixel sample region is empty");
      return { luma: lumaTotal / count, alpha: alphaTotal / count };
    };
    return {
      background: average(sampleRegions.background),
      corners: sampleRegions.corners.map((region) => ({
        bit: region.bit,
        ...average(region),
      })),
    };
  }, regions);
}

export async function expectVideoFramePixels(
  page: Page,
  expectations: FrameExpectations,
  targetFrame: number,
): Promise<void> {
  const expected = expectations.frames.find((frame) => frame.frame_index === targetFrame);
  expect(expected, `missing frame expectation ${targetFrame}`).toBeDefined();
  const sampled = await sampleFrameMarkers(page, expectations.sample_regions);
  expect(sampled.background.alpha).toBeGreaterThan(240);
  expect(Math.abs(sampled.background.luma - expected!.background_luma)).toBeLessThanOrEqual(40);
  for (const corner of sampled.corners) {
    expect(corner.alpha).toBeGreaterThan(240);
    const expectedBit = expected!.corner_bits[corner.bit];
    if (expectedBit === 1) expect(corner.luma).toBeGreaterThan(160);
    else expect(corner.luma).toBeLessThan(95);
  }
}
