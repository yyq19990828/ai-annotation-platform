import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PointCloudViewState } from "./PointCloudScene";

const mockState = vi.hoisted(() => {
  const initialView = {
    position: [0, -20, 12],
    target: [0, 0, 0],
    up: [0, 0, 1],
    mode: "orbit",
  } as PointCloudViewState;
  const instances: MockScene[] = [];
  class MockScene {
    currentView: PointCloudViewState = initialView;
    viewChangeHandler: ((view: PointCloudViewState) => void) | null = null;
    loadPcd = vi.fn(async (_url?: string, _convention?: unknown, _options?: unknown) => {
      this.viewChangeHandler?.(initialView);
      return { totalPoints: 10, renderedPoints: 10, decimated: false, decimateStride: 1 };
    });
    getViewState = vi.fn(() => this.currentView);
    applyViewState = vi.fn((view: PointCloudViewState | null | undefined) => {
      if (!view) return false;
      this.currentView = view;
      this.viewChangeHandler?.(view);
      return true;
    });
    setViewChangeHandler = vi.fn((handler: ((view: PointCloudViewState) => void) | null) => {
      this.viewChangeHandler = handler;
    });
    setPointSize = vi.fn();
    setGridVisible = vi.fn();
    setAxisGizmoVisible = vi.fn();
    setCameraDamping = vi.fn();
    setTransformHandler = vi.fn();
    setDecimateThreshold = vi.fn();
    clearPointCloud = vi.fn();
    setPointCloudVisible = vi.fn();
    setBoxes = vi.fn();
    attachTransform = vi.fn();
    detachTransform = vi.fn();
    setTransformMode = vi.fn();
    resize = vi.fn();
    dispose = vi.fn();

    constructor() {
      instances.push(this);
    }
  }
  return { instances, MockScene };
});

vi.mock("./PointCloudScene", () => ({ PointCloudScene: mockState.MockScene }));

import { usePointCloudScene } from "./usePointCloudScene";

const RUNTIME_VIEW: PointCloudViewState = {
  position: [7, -8, 9],
  target: [1, 2, 3],
  up: [0, 0, 1],
  mode: "orbit",
};
const ACCOUNT_VIEW: PointCloudViewState = {
  position: [0, 0, 40],
  target: [0, 0, 0],
  up: [0, 1, 0],
  mode: "bev",
};

describe("usePointCloudScene camera continuity", () => {
  beforeEach(() => {
    mockState.instances.length = 0;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  it("同 continuity key 重载时在 loadPcd 后恢复运行时视角", async () => {
    const container = document.createElement("div");
    const sceneRef = { current: null };
    const onWorkbenchLayoutChange = vi.fn();
    const onViewModeChange = vi.fn();
    let pointCloudUrl = "frame-1.pcd";
    let continuityKey = "scene-a";
    let persistCameraView = false;
    const render = renderHook(() =>
      usePointCloudScene({
        viewportRef: { current: container },
        sceneRef: sceneRef as never,
        pcdDecimate: 100,
        pointSize: 0.06,
        showGrid: true,
        showAxisGizmo: true,
        cameraDamping: 0.1,
        persistCameraView,
        pointCloudUrl,
        continuityKey,
        axisConvention: "iso_8855",
        boxes: [],
        selectedId: null,
        selectedPsrEditable: false,
        pointcloudCamera: ACCOUNT_VIEW,
        onWorkbenchLayoutChange,
        onViewModeChange,
        onTransformCommit: vi.fn(),
      }),
    );
    await waitFor(() => expect(render.result.current.stats?.totalPoints).toBe(10));
    const scene = mockState.instances[0];
    scene.currentView = RUNTIME_VIEW;

    pointCloudUrl = "frame-2.pcd";
    render.rerender();
    await waitFor(() => expect(scene.loadPcd).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(scene.applyViewState).toHaveBeenCalledWith(RUNTIME_VIEW));
    expect(scene.loadPcd.mock.invocationCallOrder[1]).toBeLessThan(
      scene.applyViewState.mock.invocationCallOrder[0],
    );
    expect(onWorkbenchLayoutChange).not.toHaveBeenCalled();

    continuityKey = "scene-b";
    pointCloudUrl = "scene-b-frame-1.pcd";
    render.rerender();
    await waitFor(() => expect(scene.loadPcd).toHaveBeenCalledTimes(3));
    expect(scene.applyViewState).toHaveBeenCalledTimes(1);

    persistCameraView = true;
    continuityKey = "scene-c";
    pointCloudUrl = "scene-c-frame-1.pcd";
    render.rerender();
    await waitFor(() => expect(scene.applyViewState).toHaveBeenLastCalledWith(ACCOUNT_VIEW));
    expect(onViewModeChange).toHaveBeenLastCalledWith("bev");
    expect(onWorkbenchLayoutChange).not.toHaveBeenCalled();

    render.unmount();
    const remountedSceneRef = { current: null };
    const remounted = renderHook(() =>
      usePointCloudScene({
        viewportRef: { current: container },
        sceneRef: remountedSceneRef as never,
        pcdDecimate: 100,
        pointSize: 0.06,
        showGrid: true,
        showAxisGizmo: true,
        cameraDamping: 0.1,
        persistCameraView: false,
        pointCloudUrl: "scene-c-frame-2.pcd",
        continuityKey: "scene-c",
        axisConvention: "iso_8855",
        boxes: [],
        selectedId: null,
        selectedPsrEditable: false,
        pointcloudCamera: null,
        onWorkbenchLayoutChange,
        onViewModeChange,
        onTransformCommit: vi.fn(),
      }),
    );
    const remountedScene = mockState.instances[1];
    await waitFor(() => expect(remountedScene.applyViewState).toHaveBeenCalledWith(ACCOUNT_VIEW));
    expect(onWorkbenchLayoutChange).not.toHaveBeenCalled();
    remounted.unmount();
  });

  it("换帧立即清掉旧点云，且过期加载不再具备提交资格", async () => {
    const container = document.createElement("div");
    const sceneRef = { current: null };
    let pointCloudUrl = "frame-1.pcd";
    const render = renderHook(() =>
      usePointCloudScene({
        viewportRef: { current: container },
        sceneRef: sceneRef as never,
        pcdDecimate: 100,
        pointSize: 0.06,
        showGrid: true,
        showAxisGizmo: true,
        cameraDamping: 0.1,
        persistCameraView: false,
        pointCloudUrl,
        continuityKey: "scene-a",
        axisConvention: "iso_8855",
        boxes: [],
        selectedId: null,
        selectedPsrEditable: false,
        pointcloudCamera: null,
        deferPointCloudDisplay: true,
        onWorkbenchLayoutChange: vi.fn(),
        onViewModeChange: vi.fn(),
        onTransformCommit: vi.fn(),
      }),
    );
    await waitFor(() => expect(render.result.current.loadedPointCloudUrl).toBe("frame-1.pcd"));
    const scene = mockState.instances[0];

    let finishFrame2!: (value: {
      totalPoints: number;
      renderedPoints: number;
      decimated: boolean;
      decimateStride: number;
    }) => void;
    scene.loadPcd.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFrame2 = resolve;
        }),
    );
    pointCloudUrl = "frame-2.pcd";
    render.rerender();

    await waitFor(() => expect(scene.loadPcd).toHaveBeenCalledTimes(2));
    expect(render.result.current.stats).toBeNull();
    expect(render.result.current.loadedPointCloudUrl).toBeNull();
    expect(render.result.current.isLoading).toBe(true);
    expect(scene.clearPointCloud).toHaveBeenCalled();
    const frame2Options = scene.loadPcd.mock.calls[1][2] as {
      shouldCommit: () => boolean;
      visible: boolean;
    };
    expect(frame2Options.shouldCommit()).toBe(true);
    expect(frame2Options.visible).toBe(false);

    pointCloudUrl = "frame-3.pcd";
    render.rerender();
    await waitFor(() => expect(scene.loadPcd).toHaveBeenCalledTimes(3));
    expect(frame2Options.shouldCommit()).toBe(false);

    finishFrame2({ totalPoints: 20, renderedPoints: 20, decimated: false, decimateStride: 1 });
    await waitFor(() => expect(render.result.current.loadedPointCloudUrl).toBe("frame-3.pcd"));
  });
});
