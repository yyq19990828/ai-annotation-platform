import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_ANNOTATION_VISUAL } from "./annotationVisual";
import { maskVisualOpacity, RasterMaskVisual } from "./RasterMaskVisual";

describe("RasterMaskVisual", () => {
  it("选中态增强真实 Mask 填充并显示统一类别标签，不再渲染矩形框", () => {
    render(
      <RasterMaskVisual
        id="mask-1"
        image={{} as CanvasImageSource}
        bounds={{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }}
        sourceWidth={1000}
        sourceHeight={500}
        scale={2}
        color="#336699"
        selected
        opacity={0.4}
        visual={DEFAULT_ANNOTATION_VISUAL}
        labelText="车辆"
        showLabel
      />,
    );

    const fill = document.querySelector('[data-testid="raster-mask-fill"]');
    expect(fill?.getAttribute("data-x")).toBe("100");
    expect(fill?.getAttribute("data-y")).toBe("100");
    expect(fill?.getAttribute("data-width")).toBe("300");
    expect(fill?.getAttribute("data-height")).toBe("200");
    expect(Number(fill?.getAttribute("data-opacity"))).toBeCloseTo(0.58);
    expect(fill?.getAttribute("data-shadowenabled")).toBe("true");
    expect(fill?.getAttribute("data-shadowcolor")).toBe("#336699");
    expect(document.querySelector('[data-konva="Rect"]')).toBeNull();
    expect(screen.getByText("车辆")).toBeInTheDocument();
  });

  it("透明度始终限制在有效范围", () => {
    expect(maskVisualOpacity(-1, false)).toBe(0);
    expect(maskVisualOpacity(0.6, true)).toBe(0.72);
    expect(maskVisualOpacity(2, false)).toBe(1);
  });
});
