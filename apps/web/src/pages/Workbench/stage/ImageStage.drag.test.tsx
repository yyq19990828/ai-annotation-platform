import { useState, type ComponentProps, type MutableRefObject } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-konva", async () => {
  const React = await import("react");
  const components = await import("@/test/konvaMock");
  type StageProps = {
    children?: React.ReactNode;
    onMouseDown?: (event: { target: unknown; evt: MouseEvent }) => void;
    onMouseMove?: (event: { target: unknown; evt: MouseEvent }) => void;
  };
  return {
    ...components,
    Stage: React.forwardRef((props: StageProps, ref) => {
      const stage = React.useMemo(() => ({ draw: vi.fn() }), []);
      React.useImperativeHandle(ref, () => stage, [stage]);
      return (
        <div
          data-testid="konva-stage"
          onMouseDown={(event) => props.onMouseDown?.({ target: stage, evt: event.nativeEvent })}
          onMouseMove={(event) => props.onMouseMove?.({ target: stage, evt: event.nativeEvent })}
        >
          {props.children}
        </div>
      );
    }),
  };
});

vi.mock("../state/useWorkbenchConfig", async () => {
  const { DEFAULT_WORKBENCH_PREFERENCES } = await import("@/api/auth");
  return { useWorkbenchConfig: () => ({ config: DEFAULT_WORKBENCH_PREFERENCES }) };
});
vi.mock("../state/useViewportTransform", () => ({
  useElementSize: (ref: MutableRefObject<HTMLDivElement | null>) => ({
    ref: (node: HTMLDivElement | null) => {
      ref.current = node;
    },
    size: { w: 100, h: 100 },
  }),
}));
vi.mock("./useImageStageFit", () => ({
  useImageStageFit: () => ({ fitted: true, fitNow: vi.fn() }),
}));
vi.mock("./useAbortableImage", () => ({
  useAbortableImage: () => [undefined, "loaded"],
}));

import { ImageStage } from "./ImageStage";

const commit = vi.fn();
const emptyBoxes: [] = [];
const defaults: ComponentProps<typeof ImageStage> = {
  fileUrl: "/image.png",
  mediaKey: "image-a",
  imageWidth: 100,
  imageHeight: 100,
  tool: "box",
  activeClass: "car",
  selectedId: null,
  userBoxes: emptyBoxes,
  aiBoxes: emptyBoxes,
  spacePan: false,
  vp: { scale: 1, tx: 0, ty: 0 },
  setVp: vi.fn(),
  fitTick: 0,
  onSelectBox: vi.fn(),
  onCursorMove: vi.fn(),
  onCommitDrawing: commit,
};

function CursorOwner() {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <output data-testid="cursor">{cursor ? `${cursor.x},${cursor.y}` : "none"}</output>
      <ImageStage
        {...defaults}
        onCursorMove={setCursor}
        onCommitDrawing={(geometry) => commit(geometry, cursor)}
      />
    </>
  );
}

describe("ImageStage drag scheduling", () => {
  let frames: Map<number, FrameRequestCallback>;
  beforeEach(() => {
    commit.mockReset();
    frames = new Map();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const flushFrame = () => {
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(16);
    });
  };

  it("keeps the pending drag update when cursor feedback rebuilds parent callbacks", () => {
    render(<CursorOwner />);
    const canvas = screen.getByTestId("konva-stage");
    const stage = screen.getByTestId("workbench-stage");
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 20, button: 0 });
    expect(stage).toHaveAttribute("data-drag-kind", "draw");
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 80, buttons: 1 });
    expect(screen.getByTestId("cursor")).toHaveTextContent("0.6,0.8");
    flushFrame();
    expect(stage).toHaveAttribute("data-drag-changed", "true");
    fireEvent.mouseUp(canvas, { clientX: 60, clientY: 80, button: 0 });
    expect(commit).toHaveBeenCalledWith(
      { x: 0.1, y: 0.2, w: 0.5, h: 0.6000000000000001 },
      { x: 0.6, y: 0.8 },
    );
  });

  it("commits the last pointer position when release happens before the animation frame", () => {
    render(<ImageStage {...defaults} />);
    const canvas = screen.getByTestId("konva-stage");
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 20, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 80, buttons: 1 });
    fireEvent.mouseUp(canvas, { clientX: 60, clientY: 80, button: 0 });
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0]).toMatchObject({ x: 0.1, y: 0.2, w: 0.5 });
    flushFrame();
    expect(commit).toHaveBeenCalledOnce();
    expect(screen.getByTestId("workbench-stage")).toHaveAttribute("data-drag-kind", "none");
  });

  it("drops a pending move when the stage unmounts", () => {
    const view = render(<ImageStage {...defaults} />);
    const canvas = screen.getByTestId("konva-stage");
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 20, button: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 80, buttons: 1 });
    expect(frames.size).toBeGreaterThan(0);
    view.unmount();
    expect(frames.size).toBe(0);
    flushFrame();
    fireEvent.mouseUp(window);
    expect(commit).not.toHaveBeenCalled();
  });

  it.each([{ mediaKey: "image-b" }, { tool: "select" as const }, { readOnly: true }])(
    "ends the drag when its editing context changes: %j",
    (next) => {
      const view = render(<ImageStage {...defaults} />);
      const canvas = screen.getByTestId("konva-stage");
      fireEvent.mouseDown(canvas, { clientX: 10, clientY: 20, button: 0 });
      fireEvent.mouseMove(canvas, { clientX: 60, clientY: 80, buttons: 1 });
      flushFrame();
      expect(screen.getByTestId("workbench-stage")).toHaveAttribute("data-drag-changed", "true");
      fireEvent.mouseMove(canvas, { clientX: 80, clientY: 90, buttons: 1 });
      expect(frames.size).toBeGreaterThan(0);
      view.rerender(<ImageStage {...defaults} {...next} />);
      flushFrame();
      expect(screen.getByTestId("workbench-stage")).toHaveAttribute("data-drag-kind", "none");
      fireEvent.mouseUp(canvas, { clientX: 60, clientY: 80, button: 0 });
      expect(commit).not.toHaveBeenCalled();
    },
  );
});
