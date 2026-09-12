import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { videoToolScopeForTool, type VideoToolSelection } from "../stage/videoToolUnits";
import { useWorkbenchState } from "./useWorkbenchState";
import type { DiscussionOrigin } from "./discussionTypes";

const config = vi.hoisted(() => ({
  config: {},
  layout: {
    leftOpen: true,
    rightOpen: true,
    attrPanelCollapsed: false,
    aiSectionCollapsed: false,
    manualSectionCollapsed: false,
    trackSectionCollapsed: false,
    discussionCollapsed: false,
  },
  loaded: true,
  update: vi.fn(),
  setFields: vi.fn(),
  setLayout: vi.fn(),
}));

vi.mock("./useWorkbenchConfig", () => ({ useWorkbenchConfig: () => config }));

const selection = (state: ReturnType<typeof useWorkbenchState>): VideoToolSelection => ({
  tool: state.videoTool,
  scope: state.videoToolScope,
});

describe("useWorkbenchState video tool scope", () => {
  it("updates a creating tool and its scope together while select retains recent intent", () => {
    const { result } = renderHook(() => useWorkbenchState());
    expect(selection(result.current)).toEqual({ tool: "select", scope: "frame" });
    act(() => result.current.setVideoTool("track"));
    expect(selection(result.current)).toEqual({ tool: "track", scope: "track" });
    act(() => result.current.setVideoTool("select"));
    expect(selection(result.current)).toEqual({ tool: "select", scope: "track" });
    act(() => result.current.setVideoTool("polygon"));
    expect(selection(result.current)).toEqual({ tool: "polygon", scope: "frame" });
    act(() => result.current.setVideoTool("select"));
    expect(selection(result.current)).toEqual({ tool: "select", scope: "frame" });
  });

  it("normalizes admitted selections without rendering a mismatched creating scope", () => {
    const renders: VideoToolSelection[] = [];
    const { result } = renderHook(() => {
      const state = useWorkbenchState();
      renders.push(selection(state));
      return state;
    });
    act(() => result.current.setVideoToolSelection({ tool: "select", scope: "track" }));
    expect(selection(result.current)).toEqual({ tool: "select", scope: "track" });
    act(() => result.current.setVideoToolSelection({ tool: "polyline-track", scope: "frame" }));
    expect(selection(result.current)).toEqual({ tool: "polyline-track", scope: "track" });
    act(() => result.current.setVideoToolSelection({ tool: "mask", scope: "track" }));
    expect(selection(result.current)).toEqual({ tool: "mask", scope: "frame" });
    for (const value of renders) {
      if (value.tool !== "select") expect(value.scope).toBe(videoToolScopeForTool(value.tool));
    }
  });

  it("keeps Dispatch updater semantics across queued atomic changes", () => {
    const { result } = renderHook(() => useWorkbenchState());
    const setter = result.current.setVideoTool;
    act(() => {
      result.current.setVideoToolSelection({ tool: "select", scope: "track" });
      setter((current) => (current === "select" ? "polygon-track" : "box"));
      setter((current) => (current === "polygon-track" ? "select" : "box"));
    });
    expect(selection(result.current)).toEqual({ tool: "select", scope: "track" });
    expect(result.current.setVideoTool).toBe(setter);
  });

  it("keeps a later explicit frame tool through selection, frame and task state updates", () => {
    const { result, rerender } = renderHook(() => useWorkbenchState());
    act(() => {
      result.current.setSelectedId("selected-track");
      result.current.setVideoToolSelection({ tool: "mask-track", scope: "track" });
    });
    act(() => result.current.setVideoTool("box"));
    act(() => {
      result.current.setVideoFrameIndex(17);
      result.current.setCurrentTaskId("refreshed-task");
      result.current.setSelectedId("selected-track");
      result.current.setActiveClass("车辆");
    });
    rerender();
    expect(selection(result.current)).toEqual({ tool: "box", scope: "frame" });
    act(() => result.current.setSelectedId(null));
    expect(selection(result.current)).toEqual({ tool: "box", scope: "frame" });
    expect(config.update).not.toHaveBeenCalled();
    expect(config.setFields).not.toHaveBeenCalled();
    expect(config.setLayout).not.toHaveBeenCalled();
  });
});

describe("useWorkbenchState discussion drawing ownership", () => {
  const origin: DiscussionOrigin = {
    owner: { sessionId: "session-a", userId: "user-a" },
    target: { projectId: "p", taskId: "t", kind: "annotation", annotationId: "annotation-a" },
    requestId: "drawing-a",
  };
  const drawing = { shapes: [{ type: "line" as const, points: [0, 0, 0.2, 0.2] }] };

  it("keeps its originating annotation after selection changes and requires a matching result", () => {
    const { result } = renderHook(() => useWorkbenchState());
    act(() => result.current.beginCanvasDraft("annotation-a", drawing, origin));
    act(() => result.current.setSelectedId("annotation-b"));
    act(() => result.current.endCanvasDraft());
    const resultId = result.current.canvasDraft.resultId!;
    expect(result.current.canvasDraft.origin).toEqual(origin);
    expect(result.current.canvasDraft.pendingResult).toEqual(drawing);
    act(() => result.current.consumeCanvasResult());
    expect(result.current.canvasDraft.pendingResult).toEqual(drawing);
    act(() => result.current.consumeCanvasResult("different-completion"));
    expect(result.current.canvasDraft.pendingResult).toEqual(drawing);
    act(() => result.current.consumeCanvasResult(resultId));
    expect(result.current.canvasDraft.pendingResult).toBeNull();
    expect(result.current.canvasDraft.origin).toBeNull();
  });

  it("rejects mismatched targets and ignores an old acknowledgement after a new drawing starts", () => {
    const { result } = renderHook(() => useWorkbenchState());
    act(() => result.current.beginCanvasDraft("annotation-b", drawing, origin));
    expect(result.current.canvasDraft.active).toBe(false);
    act(() => result.current.beginCanvasDraft("annotation-a", drawing, origin));
    act(() => result.current.endCanvasDraft());
    const staleId = result.current.canvasDraft.resultId!;
    act(() =>
      result.current.beginCanvasDraft("annotation-a", drawing, {
        ...origin,
        requestId: "drawing-b",
      }),
    );
    act(() => result.current.endCanvasDraft());
    act(() => result.current.consumeCanvasResult(staleId));
    expect(result.current.canvasDraft.pendingResult).toEqual(drawing);
    expect(result.current.canvasDraft.origin?.requestId).toBe("drawing-b");
  });

  it("accepts a task-origin drawing only with a null annotation selection", () => {
    const { result } = renderHook(() => useWorkbenchState());
    const taskOrigin: DiscussionOrigin = {
      owner: { sessionId: "session-a", userId: "user-a" },
      target: { projectId: "p", taskId: "t", kind: "task" },
      requestId: "task-drawing",
    };
    act(() => result.current.beginCanvasDraft(null, drawing, taskOrigin));
    expect(result.current.canvasDraft.active).toBe(true);
    expect(result.current.canvasDraft.annotationId).toBeNull();
    act(() => result.current.releaseCanvasDraft());
    act(() => result.current.beginCanvasDraft("annotation-a", drawing, taskOrigin));
    expect(result.current.canvasDraft.active).toBe(false);
  });

  it("does not resurrect shapes or produce another completion after leaving drawing mode", () => {
    const { result } = renderHook(() => useWorkbenchState());
    act(() => result.current.beginCanvasDraft("annotation-a", drawing, origin));
    act(() => result.current.endCanvasDraft());
    const resultId = result.current.canvasDraft.resultId;
    act(() => result.current.endCanvasDraft());
    act(() => result.current.appendCanvasShape(drawing.shapes[0]));
    expect(result.current.canvasDraft.resultId).toBe(resultId);
    expect(result.current.canvasDraft.shapes).toEqual([]);
  });

  it("cancelling owned canvas editing restores its original attachment, while suspension does not complete it", () => {
    const { result } = renderHook(() => useWorkbenchState());
    act(() => result.current.beginCanvasDraft("annotation-a", drawing, origin));
    act(() => result.current.appendCanvasShape({ type: "line", points: [0.1, 0.1, 0.7, 0.7] }));
    act(() => result.current.cancelCanvasDraft());
    expect(result.current.canvasDraft.pendingResult).toEqual(drawing);
    expect(result.current.canvasDraft.origin).toEqual(origin);
    act(() => result.current.beginCanvasDraft("annotation-a", drawing, origin));
    act(() => result.current.releaseCanvasDraft());
    expect(result.current.canvasDraft.active).toBe(false);
    expect(result.current.canvasDraft.pendingResult).toBeNull();
    expect(result.current.canvasDraft.origin).toBeNull();
  });
});
