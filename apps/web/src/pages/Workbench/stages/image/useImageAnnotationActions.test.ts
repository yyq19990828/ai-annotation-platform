import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "@/types";
import {
  getBatchChangeTarget,
  hasUsableImageBounds,
  useImageAnnotationActions,
} from "./useImageAnnotationActions";

vi.mock("@/hooks/usePredictions", () => ({
  useAcceptPrediction: () => ({ mutate: vi.fn() }),
  useRejectPrediction: () => ({ mutate: vi.fn() }),
}));

vi.mock("../../state/useClipboard", () => ({
  useClipboard: () => ({ copy: vi.fn(), paste: vi.fn(), hasClipboard: false }),
}));

vi.mock("../../state/useWorkbenchAnnotationActions", () => ({
  useWorkbenchAnnotationActions: () => ({
    createBboxWithClass: vi.fn(),
    createRotatedBbox: vi.fn(),
    submitPolygon: vi.fn(),
  }),
}));

function box(id: string, cls = "Car"): Annotation {
  return {
    id,
    cls,
    x: 0.1,
    y: 0.2,
    w: 0.3,
    h: 0.4,
    source: "manual",
    conf: 1,
  };
}

describe("useImageAnnotationActions module", () => {
  it("exports the hook", () => {
    expect(typeof useImageAnnotationActions).toBe("function");
  });

  it("builds batch class-change target from current selection", () => {
    expect(getBatchChangeTarget(["b"], [box("a"), box("b", "Bike")])).toEqual({
      geom: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      className: "Bike",
      count: 1,
    });
  });

  it("rejects empty or non-finite class-picker image bounds", () => {
    expect(hasUsableImageBounds({ x: 0, y: 0, w: 0, h: 0 })).toBe(false);
    expect(hasUsableImageBounds({ x: Number.NaN, y: 0, w: 0.2, h: 0.3 })).toBe(false);
    expect(hasUsableImageBounds({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toBe(true);
  });

  it("取消图片 Mask 编辑后回到选择工具", () => {
    const cancel = vi.fn();
    const setTool = vi.fn();
    const s = {
      activeClass: "",
      clipboard: null,
      confThreshold: 0.5,
      editingClass: null,
      pendingDrawing: null,
      selectedId: null,
      selectedIds: [],
      tool: "mask",
      videoFrameIndex: 0,
      workbenchConfig: { image: { afterBoxCreate: "pick_class" } },
      replaceSelected: vi.fn(),
      setActiveClass: vi.fn(),
      setClipboard: vi.fn(),
      setEditingClass: vi.fn(),
      setPendingDrawing: vi.fn(),
      setSelectedId: vi.fn(),
      setTool,
    };
    const sam = {
      activeIdx: 0,
      canAcceptCandidates: false,
      candidates: [],
      isRunning: false,
      cancel: vi.fn(),
      consume: vi.fn(),
      cycle: vi.fn(),
    };
    const mutate = vi.fn();
    const view = renderHook(() =>
      useImageAnnotationActions({
        taskId: "task-1",
        projectId: "project-1",
        meUserId: "user-1",
        queryClient: {},
        history: { push: vi.fn(), pushBatch: vi.fn() },
        s,
        pushToast: vi.fn(),
        recordRecentClass: vi.fn(),
        annotationsData: [],
        annotationsRef: { current: [] },
        predictionsData: [],
        userBoxes: [],
        stageGeom: { imgW: 100, imgH: 100, vpSize: { w: 100, h: 100 } },
        iouDedupThreshold: 0.7,
        classes: [],
        sam,
        acceptNativeMask: vi.fn(),
        createAnnotationAsync: vi.fn(),
        updateAnnotationAsync: vi.fn(),
        mutations: {
          create: { mutate },
          update: { mutate },
          delete: { mutate },
        },
        enqueueOnError: vi.fn(),
        maskEditor: { cancel },
      } as never),
    );

    act(() => view.result.current.cancelMaskEdit());

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(setTool).toHaveBeenCalledWith("select");
  });
});
