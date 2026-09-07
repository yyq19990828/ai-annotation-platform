import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Annotation } from "@/types";
import {
  getBatchChangeTarget,
  hasUsableImageBounds,
  useImageAnnotationActions,
} from "./useImageAnnotationActions";

const predictionMutations = vi.hoisted(() => ({ accept: vi.fn(), reject: vi.fn() }));
vi.mock("@/hooks/usePredictions", () => ({
  useAcceptPrediction: () => ({ mutate: vi.fn(), mutateAsync: predictionMutations.accept }),
  useRejectPrediction: () => ({ mutate: vi.fn(), mutateAsync: predictionMutations.reject }),
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

function decisionHarness() {
  const s = {
    activeClass: "Car",
    confThreshold: 0,
    selectedId: "pred-p-0",
    selectedIds: ["pred-p-0"],
    videoFrameIndex: 0,
    editingClass: null,
    pendingDrawing: null,
    tool: "select",
    workbenchConfig: {
      common: { autoAdvanceOnDecide: true },
      image: { afterBoxCreate: "pick_class" },
    },
    setSelectedId: vi.fn(),
    setEditingClass: vi.fn(),
    setActiveClass: vi.fn(),
    setClipboard: vi.fn(),
    replaceSelected: vi.fn(),
    setPendingDrawing: vi.fn(),
  };
  const shapes = [0, 0, 10].map((frame_index) => ({
    geometry: { type: "video_bbox", frame_index, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    class_name: "Car",
    confidence: 0.9,
  }));
  const args = {
    taskId: "task-1",
    projectId: "project-1",
    s,
    queryClient: {},
    history: { push: vi.fn(), pushBatch: vi.fn() },
    pushToast: vi.fn(),
    recordRecentClass: vi.fn(),
    annotationsData: [],
    annotationsRef: { current: [] },
    predictionsData: [{ id: "p", result: shapes }],
    userBoxes: [],
    stageGeom: { imgW: 100, imgH: 100, vpSize: { w: 100, h: 100 } },
    iouDedupThreshold: 0.7,
    classes: ["Car"],
    sam: { candidates: [], cancel: vi.fn(), cycle: vi.fn() },
    acceptNativeMask: vi.fn(),
    createAnnotationAsync: vi.fn(),
    updateAnnotationAsync: vi.fn(),
    mutations: {
      create: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
    },
    enqueueOnError: vi.fn(),
  };
  const view = renderHook(() => useImageAnnotationActions(args as never));
  return { ...view, args, s };
}

describe("ordinary prediction decisions", () => {
  beforeEach(() => {
    predictionMutations.accept.mockReset();
    predictionMutations.reject.mockReset();
  });

  it("等待成功才推进同帧选择，并合并同一候选的在途决策", async () => {
    let complete!: (value: unknown[]) => void;
    predictionMutations.accept.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const view = decisionHarness();
    const candidate = view.result.current.aiBoxes[0];
    expect(candidate).toBeDefined();
    let first: unknown;
    act(() => {
      first = view.result.current.handleAcceptPrediction(candidate);
      void view.result.current.handleAcceptPrediction(candidate);
      void view.result.current.handleRejectPrediction(candidate);
    });
    expect(predictionMutations.accept).toHaveBeenCalledTimes(1);
    expect(predictionMutations.reject).not.toHaveBeenCalled();
    expect(view.s.setSelectedId).not.toHaveBeenCalled();
    await act(async () => {
      complete([{ id: "created" }]);
      await first;
    });
    expect(view.s.setSelectedId).toHaveBeenCalledWith("pred-p-1");
    expect(view.args.history.push).toHaveBeenCalledTimes(1);
    // A stale prediction query must not permit a second write after the response.
    await act(async () => {
      await view.result.current.handleAcceptPrediction(candidate);
    });
    expect(predictionMutations.accept).toHaveBeenCalledTimes(1);
  });

  it("拒绝失败保留候选与选择，允许重试", async () => {
    predictionMutations.reject
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({});
    const view = decisionHarness();
    const candidate = view.result.current.aiBoxes[0];
    await act(async () => {
      expect(await view.result.current.handleRejectPrediction(candidate)).toEqual({
        status: "failed",
      });
    });
    expect(view.s.setSelectedId).not.toHaveBeenCalled();
    expect(view.result.current.aiBoxes.some((b) => b.id === candidate.id)).toBe(true);
    await act(async () => {
      await view.result.current.handleRejectPrediction(candidate);
    });
    expect(predictionMutations.reject).toHaveBeenCalledTimes(2);
    expect(view.s.setSelectedId).toHaveBeenCalledWith("pred-p-1");
  });

  it("422 补选延续原决定并保留属性，只在最终成功后推进", async () => {
    predictionMutations.accept
      .mockRejectedValueOnce({ status: 422 })
      .mockResolvedValueOnce([{ id: "created" }]);
    const view = decisionHarness();
    const candidate = view.result.current.aiBoxes[0];
    await act(async () => {
      expect(
        await view.result.current.handleAcceptPrediction(candidate, { reviewed: true }),
      ).toEqual({ status: "awaiting-class" });
    });
    expect(view.s.setSelectedId).not.toHaveBeenCalled();
    // A mutation notification can commit a render before the picker state update.
    view.rerender();
    view.s.editingClass = view.s.setEditingClass.mock.calls[0][0];
    view.rerender();
    await act(async () => {
      await view.result.current.handleCommitChangeClass("Car");
    });
    expect(predictionMutations.accept).toHaveBeenLastCalledWith({
      predictionId: "p",
      shapeIndex: 0,
      attributeOverrides: { reviewed: true },
      overrideClassName: "Car",
    });
    expect(view.s.setSelectedId).toHaveBeenCalledWith("pred-p-1");
    expect(view.args.history.push).toHaveBeenCalledTimes(1);
  });

  it.each(["task", "frame", "selection"])("迟到成功不能改变新的 %s 上下文", async (change) => {
    let complete!: (value: unknown[]) => void;
    predictionMutations.accept.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const view = decisionHarness();
    let pending: unknown;
    act(() => {
      pending = view.result.current.handleAcceptPrediction(view.result.current.aiBoxes[0]);
    });
    if (change === "task") view.args.taskId = "task-2";
    if (change === "frame") view.s.videoFrameIndex = 10;
    if (change === "selection") view.s.selectedId = "manual";
    view.rerender();
    await act(async () => {
      complete([{ id: "created" }]);
      await pending;
    });
    expect(view.s.setSelectedId).not.toHaveBeenCalled();
    if (change === "task") expect(view.args.history.push).not.toHaveBeenCalled();
  });

  it("来源/阈值隐藏不能解除成功防重；真实接受记录出现后撤销可重新接受", async () => {
    predictionMutations.accept.mockResolvedValue([{ id: "created" }]);
    const view = decisionHarness();
    const candidate = view.result.current.aiBoxes[0];
    await act(async () => {
      await view.result.current.handleAcceptPrediction(candidate);
    });
    view.s.confThreshold = 1;
    view.rerender();
    view.s.confThreshold = 0;
    view.rerender();
    await act(async () => {
      await view.result.current.handleAcceptPrediction(candidate);
    });
    expect(predictionMutations.accept).toHaveBeenCalledTimes(1);
    view.args.annotationsData = [
      { id: "created", parent_prediction_id: "p", attributes: { _shape_index: 0 } },
    ] as never;
    view.rerender();
    expect(view.result.current.aiBoxes.some((box) => box.id === candidate.id)).toBe(false);
    view.args.annotationsData = [];
    view.rerender();
    await act(async () => {
      await view.result.current.handleAcceptPrediction(view.result.current.aiBoxes[0]);
    });
    expect(predictionMutations.accept).toHaveBeenCalledTimes(2);
  });

  it("批量与单项共享在途保护，批量保留跨帧原有范围", async () => {
    let complete!: (value: unknown[]) => void;
    predictionMutations.accept.mockImplementation(({ shapeIndex }) =>
      shapeIndex === 0
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve([{ id: `created-${shapeIndex}` }]),
    );
    const view = decisionHarness();
    let single: unknown;
    let bulk: unknown;
    act(() => {
      single = view.result.current.handleAcceptPrediction(view.result.current.aiBoxes[0]);
      bulk = view.result.current.handleAcceptAll();
    });
    expect(predictionMutations.accept).toHaveBeenCalledTimes(3);
    await act(async () => {
      complete([{ id: "created" }]);
      await single;
      await bulk;
    });
    expect(view.args.history.push).toHaveBeenCalledTimes(3);
  });

  it.each(["task", "frame"])("补选弹层随所属 %s 退出，不能在新上下文重试", async (change) => {
    predictionMutations.accept.mockRejectedValue({ status: 422 });
    const view = decisionHarness();
    await act(async () => {
      await view.result.current.handleAcceptPrediction(view.result.current.aiBoxes[0]);
    });
    view.s.editingClass = view.s.setEditingClass.mock.calls[0][0];
    view.rerender();
    view.s.setEditingClass.mockClear();
    if (change === "task") view.args.taskId = "task-2";
    else view.s.videoFrameIndex = 10;
    view.rerender();
    expect(view.s.setEditingClass).toHaveBeenCalledWith(null);
    await act(async () => {
      await view.result.current.handleCommitChangeClass("Car");
    });
    expect(predictionMutations.accept).toHaveBeenCalledTimes(1);
  });

  it("取消补选释放决定，下一次接受可以再次补选", async () => {
    predictionMutations.accept.mockRejectedValue({ status: 422 });
    const view = decisionHarness();
    const candidate = view.result.current.aiBoxes[0];
    await act(async () => {
      await view.result.current.handleAcceptPrediction(candidate);
    });
    view.s.editingClass = view.s.setEditingClass.mock.calls[0][0];
    view.rerender();
    act(() => view.result.current.handleCancelChangeClass());
    view.s.editingClass = null;
    view.rerender();
    await act(async () => {
      await view.result.current.handleAcceptPrediction(candidate);
    });
    expect(predictionMutations.accept).toHaveBeenCalledTimes(2);
    expect(view.s.setSelectedId).not.toHaveBeenCalled();
  });

  it("请求未返回时离开再回到同题，同一候选仍只有一次写入", async () => {
    let complete!: (value: unknown[]) => void;
    predictionMutations.accept.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const view = decisionHarness();
    const candidate = view.result.current.aiBoxes[0];
    let pending: unknown;
    act(() => {
      pending = view.result.current.handleAcceptPrediction(candidate);
    });
    view.args.taskId = "task-2";
    view.rerender();
    view.args.taskId = "task-1";
    view.rerender();
    act(() => {
      void view.result.current.handleAcceptPrediction(view.result.current.aiBoxes[0]);
    });
    expect(predictionMutations.accept).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete([{ id: "created" }]);
      await pending;
    });
    expect(view.s.setSelectedId).not.toHaveBeenCalled();
    await act(async () => {
      await view.result.current.handleAcceptPrediction(candidate);
    });
    expect(predictionMutations.accept).toHaveBeenCalledTimes(1);
    view.args.annotationsData = [
      { id: "created", parent_prediction_id: "p", attributes: { _shape_index: 0 } },
    ] as never;
    view.rerender();
    view.args.annotationsData = [];
    view.rerender();
    act(() => {
      void view.result.current.handleAcceptPrediction(view.result.current.aiBoxes[0]);
    });
    expect(predictionMutations.accept).toHaveBeenCalledTimes(2);
  });

  it("全部帧列表的显式按钮保留操作范围，但不推进当前帧选择", async () => {
    predictionMutations.accept.mockResolvedValue([{ id: "created" }]);
    const view = decisionHarness();
    const offFrame = view.result.current.aiBoxes[2];
    view.s.selectedId = offFrame.id;
    view.rerender();
    await act(async () => {
      expect(await view.result.current.handleAcceptPrediction(offFrame)).toEqual({
        status: "success",
      });
    });
    expect(predictionMutations.accept).toHaveBeenCalledWith(
      expect.objectContaining({ shapeIndex: 2 }),
    );
    expect(view.s.setSelectedId).not.toHaveBeenCalled();
  });
});

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

  it("取消 Mask 回选择，设置窗口内的候选键不影响背景 SAM", () => {
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

    Object.assign(s, { tool: "smart-point" });
    Object.assign(sam, {
      canAcceptCandidates: true,
      candidates: [
        {
          type: "polygonlabels",
          points: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        },
      ],
    });
    view.rerender();
    const settings = document.createElement("button");
    settings.dataset.workbenchSettings = "";
    settings.dataset.state = "open";
    document.body.append(settings);
    act(() => {
      for (const key of ["Enter", "Escape", "Tab", "r"]) {
        settings.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      }
    });
    expect(view.result.current.samPendingGeom).toBeNull();
    expect(sam.cancel).not.toHaveBeenCalled();
    expect(sam.cycle).not.toHaveBeenCalled();
    settings.remove();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(sam.cancel).toHaveBeenCalledTimes(1);
  });
});
