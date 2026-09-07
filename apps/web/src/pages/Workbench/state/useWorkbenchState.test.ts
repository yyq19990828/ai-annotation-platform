import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { videoToolScopeForTool, type VideoToolSelection } from "../stage/videoToolUnits";
import { useWorkbenchState } from "./useWorkbenchState";

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
