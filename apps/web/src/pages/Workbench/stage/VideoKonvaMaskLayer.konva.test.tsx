import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_ANNOTATION_VISUAL } from "./annotationVisual";
import { VideoKonvaMaskLayer } from "./VideoKonvaMaskLayer";
import type { VideoMaskRenderRecord } from "./videoMaskFrames";

describe("VideoKonvaMaskLayer", () => {
  it("按 Mask 的真实裁剪范围渲染并用类别色轮廓表达选中", () => {
    const record: VideoMaskRenderRecord = {
      id: "mask-1",
      source: "annotation",
      image: {} as CanvasImageSource,
      alpha: new Uint8Array(8),
      width: 4,
      height: 2,
      geom: { x: 0.25, y: 0, w: 0.5, h: 1 },
      color: "#ff6600",
      zOrder: 1,
      selected: true,
      isTrack: false,
      cacheKey: "mask-1:v1",
    };

    const visual = {
      ...DEFAULT_ANNOTATION_VISUAL,
      fillOpacity: 0.24,
      fillOpacitySelected: 0.62,
    };
    render(
      <VideoKonvaMaskLayer
        records={[record]}
        size={{ w: 1000, h: 500 }}
        scale={2}
        visual={visual}
      />,
    );

    const fill = document.querySelector('[data-testid="raster-mask-fill"]');
    expect(fill?.getAttribute("data-x")).toBe("250");
    expect(fill?.getAttribute("data-width")).toBe("500");
    expect(Number(fill?.getAttribute("data-opacity"))).toBeCloseTo(0.62);
    expect(fill?.getAttribute("data-shadowcolor")).toBe("#ff6600");
    expect(document.querySelector('[data-konva="Rect"]')).toBeNull();
  });
});
