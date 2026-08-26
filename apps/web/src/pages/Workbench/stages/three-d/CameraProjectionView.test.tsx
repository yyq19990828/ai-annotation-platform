import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CameraProjectionView } from "./CameraProjectionView";

describe("CameraProjectionView frame loading", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hides the previous frame image and overlay until the new URL loads", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const view = render(
      <CameraProjectionView
        name="front"
        imageUrl="/frame-0.jpg"
        boxes={[]}
        highlightedIds={new Set()}
        onSelectBox={vi.fn()}
      />,
    );
    const image = screen.getByRole("img", { name: "front" });
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 640 },
      naturalHeight: { configurable: true, value: 480 },
    });
    fireEvent.load(image);
    expect(image.className).not.toContain("opacity-0");

    view.rerender(
      <CameraProjectionView
        name="front"
        imageUrl="/frame-1.jpg"
        boxes={[]}
        highlightedIds={new Set()}
        onSelectBox={vi.fn()}
      />,
    );

    expect(image.className).toContain("opacity-0");
    expect(screen.getByText("加载相机…")).toBeTruthy();
    expect(screen.getByLabelText("front 相机投影").className).toContain("pointer-events-none");
  });

  it("expands the image together with its positioning container", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    render(
      <CameraProjectionView
        name="front"
        imageUrl="/frame-0.jpg"
        boxes={[]}
        highlightedIds={new Set()}
        onSelectBox={vi.fn()}
        expanded
      />,
    );

    const image = screen.getByRole("img", { name: "front" });
    const view = image.parentElement;
    expect(image.className).toContain("h-[70vh]");
    expect(image.className).toContain("max-w-full");
    expect(image.className).not.toContain("w-[190px]");
    expect(view?.className).toContain("w-fit");
    expect(view?.className).toContain("max-w-full");
    expect(view?.className).not.toContain("w-[190px]");
  });

  it("creates a normalized persistent camera bbox by dragging in manual mode", () => {
    vi.stubGlobal(
      "PointerEvent",
      class extends MouseEvent {
        pointerId: number;

        constructor(type: string, init: PointerEventInit) {
          super(type, init);
          this.pointerId = init.pointerId ?? 0;
        }
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      setLineDash: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    const onCommit = vi.fn();
    render(
      <CameraProjectionView
        name="front"
        imageUrl="/frame-0.jpg"
        boxes={[]}
        highlightedIds={new Set()}
        onSelectBox={vi.fn()}
        manualBboxMode
        onManualBboxCommit={onCommit}
      />,
    );

    const image = screen.getByRole("img", { name: "front" });
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 640 },
      naturalHeight: { configurable: true, value: 480 },
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    });
    fireEvent.load(image);
    const canvas = screen.getByLabelText("front 相机投影，拖动创建 2D 成员");
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480 }),
      },
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => false },
    });

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: 64, clientY: 48 });
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 320, clientY: 240 });
    fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 320, clientY: 240 });

    expect(onCommit).toHaveBeenCalledWith({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 });
  });

  it("moves an existing persistent camera bbox and commits once", () => {
    vi.stubGlobal(
      "PointerEvent",
      class extends MouseEvent {
        pointerId: number;

        constructor(type: string, init: PointerEventInit) {
          super(type, init);
          this.pointerId = init.pointerId ?? 0;
        }
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      setLineDash: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    const onCommit = vi.fn();
    render(
      <CameraProjectionView
        name="front"
        imageUrl="/frame-0.jpg"
        boxes={[]}
        highlightedIds={new Set()}
        onSelectBox={vi.fn()}
        manualBbox={{ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }}
        manualBboxMode
        onManualBboxCommit={onCommit}
      />,
    );

    const image = screen.getByRole("img", { name: "front" });
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 640 },
      naturalHeight: { configurable: true, value: 480 },
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    });
    fireEvent.load(image);
    const canvas = screen.getByLabelText("front 相机投影，拖动框体或手柄编辑 2D 成员");
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480 }),
      },
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => false },
    });

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 8, clientX: 192, clientY: 144 });
    fireEvent.pointerMove(canvas, { pointerId: 8, clientX: 256, clientY: 192 });
    fireEvent.pointerUp(canvas, { pointerId: 8, clientX: 256, clientY: 192 });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0][0];
    expect(committed.x).toBeCloseTo(0.2);
    expect(committed.y).toBeCloseTo(0.2);
    expect(committed.w).toBeCloseTo(0.4);
    expect(committed.h).toBeCloseTo(0.4);
  });
});
