import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_ANNOTATION_VISUAL } from "./annotationVisual";
import { RasterMaskVisual } from "./RasterMaskVisual";

describe("RasterMaskVisual", () => {
  it("选中态使用统一选中填充透明度并显示类别标签，不再渲染矩形框", () => {
    const visual = {
      ...DEFAULT_ANNOTATION_VISUAL,
      fillOpacity: 0.21,
      fillOpacitySelected: 0.63,
    };
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
        visual={visual}
        labelText="车辆"
        showLabel
      />,
    );

    const fill = document.querySelector('[data-testid="raster-mask-fill"]');
    expect(fill?.getAttribute("data-x")).toBe("100");
    expect(fill?.getAttribute("data-y")).toBe("100");
    expect(fill?.getAttribute("data-width")).toBe("300");
    expect(fill?.getAttribute("data-height")).toBe("200");
    expect(Number(fill?.getAttribute("data-opacity"))).toBeCloseTo(0.63);
    expect(fill?.getAttribute("data-shadowenabled")).toBe("true");
    expect(fill?.getAttribute("data-shadowcolor")).toBe("#336699");
    expect(document.querySelector('[data-konva="Rect"]')).toBeNull();
    expect(screen.getByText("车辆")).toBeInTheDocument();
  });

  it("未选中态使用统一普通填充透明度", () => {
    const visual = {
      ...DEFAULT_ANNOTATION_VISUAL,
      fillOpacity: 0.21,
      fillOpacitySelected: 0.63,
    };
    render(
      <RasterMaskVisual
        id="mask-1"
        image={{} as CanvasImageSource}
        bounds={{ x: 0, y: 0, w: 1, h: 1 }}
        sourceWidth={100}
        sourceHeight={100}
        scale={1}
        color="#336699"
        selected={false}
        visual={visual}
      />,
    );

    const fill = document.querySelector('[data-testid="raster-mask-fill"]');
    expect(Number(fill?.getAttribute("data-opacity"))).toBeCloseTo(0.21);
    expect(fill?.getAttribute("data-shadowenabled")).toBe("false");
  });
});
