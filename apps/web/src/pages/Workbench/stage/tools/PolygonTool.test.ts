import { describe, expect, it, vi } from "vitest";
import { PolygonTool } from "./PolygonTool";
import type { ToolPointerContext } from "./index";

function ctx(overrides: Partial<ToolPointerContext> = {}): ToolPointerContext {
  return {
    pt: { x: 0.2, y: 0.2 },
    evt: { button: 0, altKey: false } as MouseEvent,
    vp: { scale: 1, tx: 0, ty: 0 },
    activeClass: "car",
    imgW: 800,
    imgH: 600,
    spacePan: false,
    readOnly: false,
    pendingDrawing: false,
    onClearSelection: () => {},
    polygonDraft: {
      points: [],
      addPoint: vi.fn(),
      close: vi.fn(),
      cancel: vi.fn(),
    },
    ...overrides,
  };
}

describe("PolygonTool", () => {
  it("adds the snapped point when snapPoint is provided", () => {
    const addPoint = vi.fn();
    const snapPoint = vi.fn(() => ({ x: 0.25, y: 0.3 }));
    PolygonTool.onPointerDown!(ctx({
      polygonDraft: { points: [], addPoint, close: vi.fn(), cancel: vi.fn() },
      snapPoint,
    }));

    expect(snapPoint).toHaveBeenCalledWith({ x: 0.2, y: 0.2 }, expect.objectContaining({ button: 0 }));
    expect(addPoint).toHaveBeenCalledWith([0.25, 0.3]);
  });

  it("uses the snapped point for close-distance checks", () => {
    const addPoint = vi.fn();
    const close = vi.fn();
    PolygonTool.onPointerDown!(ctx({
      polygonDraft: {
        points: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]],
        addPoint,
        close,
        cancel: vi.fn(),
      },
      snapPoint: () => ({ x: 0.1, y: 0.1 }),
    }));

    expect(close).toHaveBeenCalledTimes(1);
    expect(addPoint).not.toHaveBeenCalled();
  });

  it("ignores non-left clicks", () => {
    const addPoint = vi.fn();
    PolygonTool.onPointerDown!(ctx({
      evt: { button: 2, altKey: false } as MouseEvent,
      polygonDraft: { points: [], addPoint, close: vi.fn(), cancel: vi.fn() },
    }));

    expect(addPoint).not.toHaveBeenCalled();
  });
});
