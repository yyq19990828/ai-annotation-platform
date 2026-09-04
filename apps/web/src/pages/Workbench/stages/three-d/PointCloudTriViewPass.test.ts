import { describe, expect, it } from "vitest";

import {
  clientRectToCanvasClipPath,
  clientRectToRendererViewport,
  PointCloudTriViewPass,
} from "./PointCloudTriViewPass";

const canvas = { left: 100, top: 50, width: 800, height: 600 };

describe("clientRectToRendererViewport", () => {
  it("uses a top-left origin for WebGPU and its WebGL2 fallback", () => {
    const rect = { left: 620, top: 140, width: 240, height: 120 };
    expect(clientRectToRendererViewport(rect, canvas, "webgpu")).toEqual({
      x: 520,
      y: 90,
      width: 240,
      height: 120,
    });
    expect(clientRectToRendererViewport(rect, canvas, "webgl2-fallback")).toEqual({
      x: 520,
      y: 90,
      width: 240,
      height: 120,
    });
  });

  it("converts the same client rect to WebGL's lower-left origin", () => {
    expect(
      clientRectToRendererViewport(
        { left: 620, top: 140, width: 240, height: 120 },
        canvas,
        "legacy-webgl2",
      ),
    ).toEqual({ x: 520, y: 390, width: 240, height: 120 });
  });

  it("clamps a floating panel to the renderer canvas", () => {
    expect(
      clientRectToRendererViewport(
        { left: 60, top: 20, width: 120, height: 100 },
        canvas,
        "webgpu",
      ),
    ).toEqual({ x: 0, y: 0, width: 80, height: 70 });
    expect(
      clientRectToRendererViewport(
        { left: 920, top: 700, width: 50, height: 50 },
        canvas,
        "webgpu",
      ),
    ).toBeNull();
  });
});

describe("clientRectToCanvasClipPath", () => {
  it("clips an elevated shared renderer canvas to the floating tri-view panel", () => {
    expect(
      clientRectToCanvasClipPath({ left: 620, top: 140, width: 240, height: 360 }, canvas),
    ).toBe("inset(90px 40px 150px 520px)");
  });

  it("returns null when the floating panel is outside the renderer canvas", () => {
    expect(
      clientRectToCanvasClipPath({ left: 920, top: 700, width: 50, height: 50 }, canvas),
    ).toBeNull();
  });
});

describe("PointCloudTriViewPass layout invalidation", () => {
  it("ignores subpixel DOM measurement jitter", () => {
    const pass = new PointCloudTriViewPass("legacy-webgl2", 1);
    const layout = {
      panel: { left: 100, top: 200, width: 320, height: 420 },
      views: [{ view: "top" as const, left: 108, top: 240, width: 304, height: 120 }],
    };

    expect(pass.setLayout(layout)).toBe(true);
    expect(
      pass.setLayout({
        panel: { ...layout.panel, top: layout.panel.top + 0.5 },
        views: [{ ...layout.views[0], top: layout.views[0].top + 0.5 }],
      }),
    ).toBe(false);
    expect(
      pass.setLayout({
        panel: { ...layout.panel, top: layout.panel.top + 1 },
        views: [{ ...layout.views[0], top: layout.views[0].top + 1 }],
      }),
    ).toBe(true);

    pass.dispose();
  });
});
