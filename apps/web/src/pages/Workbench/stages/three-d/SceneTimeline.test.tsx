import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useSceneTimelineMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useSceneTimeline", () => ({
  useSceneTimeline: useSceneTimelineMock,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 3) }, (_, index) => ({
        index,
        key: index,
        start: index * 40,
        end: (index + 1) * 40,
        size: 40,
        lane: 0,
      })),
    getTotalSize: () => count * 40,
    scrollToIndex: vi.fn(),
  }),
}));

import { SceneTimeline } from "./SceneTimeline";

function renderTimeline(props: ComponentProps<typeof SceneTimeline>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SceneTimeline {...props} />
    </QueryClientProvider>,
  );
}

function timelineData() {
  return {
    summary_version: 1 as const,
    scene_id: "scene-1",
    scene_name: "nuScenes mini scene-0061",
    current_frame_index: 0,
    scene_start_frame: 0,
    scene_end_frame: 9999,
    populated_frame_count: 2,
    window_start_frame: 0,
    window_end_frame: 2,
    frames: [
      {
        frame_index: 0,
        state: "available" as const,
        task_id: "task-0",
        task_status: "in_progress",
        annotation_count: 2,
        selected_track: {
          annotation_id: "ann-0",
          source: "manual",
          class_name: "car",
        },
      },
      {
        frame_index: 1,
        state: "available" as const,
        task_id: "task-1",
        task_status: "in_progress",
        annotation_count: 1,
        selected_track: {
          annotation_id: "ann-1",
          source: "manual",
          class_name: "car",
        },
      },
      {
        frame_index: 2,
        state: "missing" as const,
        task_id: null,
        task_status: null,
        annotation_count: 0,
        selected_track: null,
      },
    ],
  };
}

describe("SceneTimeline", () => {
  beforeEach(() => {
    useSceneTimelineMock.mockReturnValue({
      data: timelineData(),
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
  });

  it("renders only virtual cells for a 10000-frame scene and exposes track presence", () => {
    renderTimeline({ taskId: "task-0", trackId: "trk_car", onNavigateFrame: vi.fn() });

    expect(screen.getByTestId("three-d-scene-timeline")).toBeTruthy();
    expect(screen.getByText("nuScenes mini scene-0061")).toBeTruthy();
    expect(screen.getAllByTestId(/^scene-timeline-frame-/)).toHaveLength(3);
    expect(screen.getByTestId("scene-timeline-track-frame-0")).toBeTruthy();
    expect(screen.getByTestId("scene-timeline-frame-0").getAttribute("aria-current")).toBe("step");
    expect(screen.getByTestId("scene-timeline-frame-2")).toBeDisabled();
  });

  it("navigates to an available frame with the matching annotation", async () => {
    const navigate = vi.fn().mockResolvedValue(true);
    renderTimeline({ taskId: "task-0", trackId: "trk_car", onNavigateFrame: navigate });

    fireEvent.click(screen.getByTestId("scene-timeline-frame-1"));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("task-1", "ann-1"));
  });

  it("collapses to the compact header and expands again", () => {
    renderTimeline({ taskId: "task-0", trackId: null, onNavigateFrame: vi.fn() });

    const toggle = screen.getByTestId("scene-timeline-toggle");
    fireEvent.click(toggle);
    expect(screen.queryByTestId("scene-timeline-virtual-canvas")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(screen.getByTestId("scene-timeline-virtual-canvas")).toBeTruthy();
  });

  it("stays hidden for tasks without a multi-frame scene", () => {
    useSceneTimelineMock.mockReturnValue({
      data: { scene_id: null, frames: [] },
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderTimeline({ taskId: "task-single", trackId: null, onNavigateFrame: vi.fn() });
    expect(screen.queryByTestId("three-d-scene-timeline")).toBeNull();
  });
});
