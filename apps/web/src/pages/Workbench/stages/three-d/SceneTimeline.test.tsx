import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SceneTimelineFrameSummary, SceneTimelineResponse } from "@/api/generated";

const useSceneTimelineMock = vi.hoisted(() => vi.fn());
const getPointCloudManifestMock = vi.hoisted(() => vi.fn());
const prefetchPointCloudFrameAssetsMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useSceneTimeline", () => ({
  useSceneTimeline: useSceneTimelineMock,
}));

vi.mock("@/api/tasks", () => ({
  tasksApi: { getPointCloudManifest: getPointCloudManifestMock },
}));

vi.mock("./pointCloudAssetCache", () => ({
  prefetchPointCloudFrameAssets: prefetchPointCloudFrameAssetsMock,
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

function timelineData(): SceneTimelineResponse & { frames: SceneTimelineFrameSummary[] } {
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
    getPointCloudManifestMock.mockReset().mockResolvedValue({
      task_id: "task-1",
      point_cloud_url: "https://assets.test/frame-1.pcd",
      cameras: [],
      expires_in: 900,
    });
    prefetchPointCloudFrameAssetsMock.mockReset().mockResolvedValue(undefined);
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

  it("waits for the target frame prefetch before switching tasks", async () => {
    let finishTargetPrefetch!: () => void;
    const targetPrefetch = new Promise<void>((resolve) => {
      finishTargetPrefetch = resolve;
    });
    prefetchPointCloudFrameAssetsMock.mockImplementation(async (manifest: { task_id: string }) => {
      if (manifest.task_id === "task-1") await targetPrefetch;
    });
    const navigate = vi.fn().mockResolvedValue(true);
    renderTimeline({ taskId: "task-0", trackId: null, onNavigateFrame: navigate });
    await waitFor(() =>
      expect(prefetchPointCloudFrameAssetsMock).toHaveBeenCalledWith(
        expect.objectContaining({ task_id: "task-1" }),
        { depthRasters: false },
      ),
    );

    fireEvent.click(screen.getByTestId("scene-timeline-frame-1"));
    expect(navigate).not.toHaveBeenCalled();

    finishTargetPrefetch();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("task-1", "ann-1"));
  });

  it("starts warming the following frame as soon as navigation succeeds", async () => {
    let finishNavigation!: (allowed: boolean) => void;
    const navigate = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishNavigation = resolve;
        }),
    );
    const data = timelineData();
    data.frames[2] = {
      frame_index: 2,
      state: "available",
      task_id: "task-2",
      task_status: "in_progress",
      annotation_count: 0,
      selected_track: null,
    };
    useSceneTimelineMock.mockReturnValue({
      data,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    getPointCloudManifestMock.mockImplementation(async (requestedTaskId: string) => ({
      task_id: requestedTaskId,
      point_cloud_url: `https://assets.test/${requestedTaskId}.pcd`,
      cameras: [],
      expires_in: 900,
    }));
    renderTimeline({ taskId: "task-0", trackId: null, onNavigateFrame: navigate });

    fireEvent.click(screen.getByTestId("scene-timeline-frame-1"));
    expect(getPointCloudManifestMock).not.toHaveBeenCalledWith("task-2");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("task-1", "ann-1"));

    finishNavigation(true);

    await waitFor(() => expect(getPointCloudManifestMock).toHaveBeenCalledWith("task-2"));
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

  it.each([
    [false, false],
    [true, true],
  ])("only requests adjacent depth rasters for real WebGPU (%s)", async (enabled, expected) => {
    renderTimeline({
      taskId: "task-0",
      trackId: null,
      prefetchDepthRasters: enabled,
      onNavigateFrame: vi.fn(),
    });

    await waitFor(() =>
      expect(prefetchPointCloudFrameAssetsMock).toHaveBeenCalledWith(
        expect.objectContaining({ task_id: "task-1" }),
        { depthRasters: expected },
      ),
    );
  });

  it("automatically prefetches only the next frame", async () => {
    const data = timelineData();
    data.current_frame_index = 1;
    data.frames[2] = {
      frame_index: 2,
      state: "available",
      task_id: "task-2",
      task_status: "in_progress",
      annotation_count: 0,
      selected_track: null,
    };
    useSceneTimelineMock.mockReturnValue({
      data,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    getPointCloudManifestMock.mockImplementation(async (requestedTaskId: string) => ({
      task_id: requestedTaskId,
      point_cloud_url: `https://assets.test/${requestedTaskId}.pcd`,
      cameras: [],
      expires_in: 900,
    }));

    renderTimeline({ taskId: "task-1", trackId: null, onNavigateFrame: vi.fn() });

    await waitFor(() =>
      expect(prefetchPointCloudFrameAssetsMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ task_id: "task-2" }),
        { depthRasters: false },
      ),
    );
    expect(getPointCloudManifestMock).not.toHaveBeenCalledWith("task-0");
  });
});
