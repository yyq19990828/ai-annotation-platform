import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, MouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "@/types";
import type { AiBox } from "../state/transforms";
import type { VideoSelectionCommand } from "../state/videoSelectionCommand";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 68,
        size: 68,
        key: index,
      })),
    getTotalSize: () => count * 68,
    measureElement: () => {},
  }),
}));

vi.mock("../stage/BoxListItem", () => ({
  BoxListItem: ({
    b,
    onSelect,
  }: {
    b: Annotation | AiBox;
    onSelect: (event: MouseEvent) => void;
  }) => (
    <button type="button" data-testid={`select-${b.id}`} onClick={onSelect}>
      {b.cls}
    </button>
  ),
}));

import { AIInspectorPanel } from "./AIInspectorPanel";

function annotation(geometry: Annotation["geometry"]): Annotation {
  return {
    id: "object-a",
    cls: "Target",
    annotation_type: geometry!.type,
    geometry,
    x: 0.1,
    y: 0.1,
    w: 0.2,
    h: 0.2,
    conf: 1,
    source: "manual",
  };
}

function setup(overrides: Partial<ComponentProps<typeof AIInspectorPanel>> = {}) {
  const onSelect = vi.fn();
  const onSeekFrame = vi.fn();
  const onClearSelection = vi.fn();
  const props: ComponentProps<typeof AIInspectorPanel> = {
    open: true,
    width: 300,
    onResize: vi.fn(),
    aiBoxes: [],
    userBoxes: [],
    selectedId: null,
    imageWidth: 800,
    imageHeight: 600,
    onSelect,
    onSeekFrame,
    onClearSelection,
    onAcceptPrediction: vi.fn(),
    onDeleteUserBox: vi.fn(),
    ...overrides,
  };
  const view = render(<AIInspectorPanel {...props} />);
  return { ...view, onSelect, onSeekFrame, onClearSelection };
}

describe("AIInspectorPanel video selection commands", () => {
  it.each(["video_track_polygon", "video_track_polyline"] as const)(
    "%s sends frame zero and selection together without running either legacy callback",
    (type) => {
      const onSelectVideoObject = vi.fn<VideoSelectionCommand>();
      const object = annotation({
        type,
        track_id: "track-a",
        keyframes: [0, 10].map((frame_index) => ({
          frame_index,
          source: "manual",
          points: [
            [0.1, 0.1],
            [0.4, 0.1],
            [0.3, 0.4],
          ],
        })),
      });
      const view = setup({ userBoxes: [object], currentFrameIndex: 8, onSelectVideoObject });
      const button = view.getByTestId("select-object-a");
      expect(button.closest("[data-workbench-video-tool-command]")).not.toBeNull();
      fireEvent.click(button);
      expect(onSelectVideoObject).toHaveBeenCalledWith("object-a", { shift: false, frameIndex: 0 });
      expect(view.onSelect).not.toHaveBeenCalled();
      expect(view.onSeekFrame).not.toHaveBeenCalled();
    },
  );

  it.each(["manual", "prediction"])(
    "routes a single-frame %s row through the same command",
    (source) => {
      const onSelectVideoObject = vi.fn<VideoSelectionCommand>();
      const object = annotation({
        type: "video_bbox",
        frame_index: 4,
        x: 0.1,
        y: 0.1,
        w: 0.2,
        h: 0.2,
      });
      const ai: AiBox = {
        ...object,
        source: "prediction_based",
        predictionId: "prediction-a",
        shapeIndex: 0,
        predictionSource: "ml_backend",
      };
      const view = setup({
        userBoxes: source === "manual" ? [object] : [],
        aiBoxes: source === "prediction" ? [ai] : [],
        currentFrameIndex: 4,
        onSelectVideoObject,
      });
      fireEvent.click(view.getByTestId("select-object-a"));
      expect(onSelectVideoObject).toHaveBeenCalledWith("object-a", { shift: false, frameIndex: 4 });
      expect(view.onSelect).not.toHaveBeenCalled();
      expect(view.onSeekFrame).not.toHaveBeenCalled();
    },
  );

  it("keeps Shift selection on the current frame", () => {
    const onSelectVideoObject = vi.fn<VideoSelectionCommand>();
    const view = setup({
      userBoxes: [
        annotation({ type: "video_bbox", frame_index: 4, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
      ],
      currentFrameIndex: 4,
      onSelectVideoObject,
    });
    fireEvent.click(view.getByTestId("select-object-a"), { shiftKey: true });
    expect(onSelectVideoObject).toHaveBeenCalledWith("object-a", {
      shift: true,
      frameIndex: undefined,
    });
    expect(view.onSeekFrame).not.toHaveBeenCalled();
  });

  it("resets the frame filter to current when the task changes", () => {
    const makeAi = (id: string, frameIndex: number): AiBox => ({
      ...annotation({
        type: "video_bbox",
        frame_index: frameIndex,
        x: 0.1,
        y: 0.1,
        w: 0.2,
        h: 0.2,
      }),
      id,
      source: "prediction_based",
      predictionId: `prediction-${id}`,
      shapeIndex: 0,
      predictionSource: "ml_backend",
    });
    const props: ComponentProps<typeof AIInspectorPanel> = {
      open: true,
      width: 300,
      onResize: vi.fn(),
      taskId: "task-a",
      aiBoxes: [makeAi("frame-0", 0), makeAi("frame-1", 1)],
      userBoxes: [],
      selectedId: null,
      imageWidth: 800,
      imageHeight: 600,
      currentFrameIndex: 0,
      onSelect: vi.fn(),
      onAcceptPrediction: vi.fn(),
      onClearSelection: vi.fn(),
      onDeleteUserBox: vi.fn(),
    };
    const { rerender } = render(<AIInspectorPanel {...props} />);
    expect(screen.getByTestId("select-frame-0")).toBeInTheDocument();
    expect(screen.queryByTestId("select-frame-1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(screen.getByTestId("select-frame-1")).toBeInTheDocument();

    rerender(<AIInspectorPanel {...props} taskId="task-b" />);
    expect(screen.getByTestId("select-frame-0")).toBeInTheDocument();
    expect(screen.queryByTestId("select-frame-1")).toBeNull();
  });

  it("sends multi-selection clearing through admission and marks only video commands", () => {
    const onSelectVideoObject = vi.fn<VideoSelectionCommand>();
    const view = setup({ selectedIds: ["a", "b"], onSelectVideoObject });
    const button = view.getByRole("button", { name: "清除" });
    expect(button).toHaveAttribute("data-workbench-video-tool-command");
    fireEvent.click(button);
    expect(onSelectVideoObject).toHaveBeenCalledWith(null);
    expect(view.onClearSelection).not.toHaveBeenCalled();
  });

  it("preserves legacy video seeking and image selection without command markers", () => {
    const events: string[] = [];
    const view = setup({
      userBoxes: [
        annotation({ type: "video_bbox", frame_index: 4, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
      ],
      onSeekFrame: (frame) => events.push(`seek:${frame}`),
      onSelect: (id) => events.push(`select:${id}`),
    });
    const button = view.getByTestId("select-object-a");
    expect(button.closest("[data-workbench-video-tool-command]")).toBeNull();
    fireEvent.click(button);
    expect(events).toEqual(["seek:4", "select:object-a"]);
    view.unmount();

    const image = setup({
      userBoxes: [annotation({ type: "bbox", x: 0.1, y: 0.1, w: 0.2, h: 0.2 })],
    });
    const imageButton = image.getByTestId("select-object-a");
    expect(imageButton.closest("[data-workbench-video-tool-command]")).toBeNull();
    fireEvent.click(imageButton);
    expect(image.onSelect).toHaveBeenCalledWith("object-a", { shift: false });
    expect(image.onSeekFrame).not.toHaveBeenCalled();
  });
});
