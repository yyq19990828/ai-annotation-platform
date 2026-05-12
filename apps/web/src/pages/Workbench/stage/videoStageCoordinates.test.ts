import { describe, expect, it, vi } from "vitest";
import { clientPointToVideoPoint, videoPointToClientPoint } from "./videoStageCoordinates";

function fakeSvg(): SVGSVGElement {
  return {
    getBoundingClientRect: vi.fn(() => ({
      left: 10,
      top: 20,
      width: 200,
      height: 100,
      right: 210,
      bottom: 120,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    })),
    getScreenCTM: vi.fn(() => null),
  } as unknown as SVGSVGElement;
}

describe("videoStageCoordinates", () => {
  it("maps client points into normalized video coordinates", () => {
    expect(clientPointToVideoPoint(fakeSvg(), { x: 110, y: 70 }, 0.5)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("maps normalized video points back to client coordinates", () => {
    expect(videoPointToClientPoint(fakeSvg(), { x: 0.5, y: 0.5 }, 0.5)).toEqual({ x: 110, y: 70 });
  });

  it("clamps client points outside the video surface", () => {
    expect(clientPointToVideoPoint(fakeSvg(), { x: 250, y: -10 }, 0.5)).toEqual({ x: 1, y: 0 });
  });
});
