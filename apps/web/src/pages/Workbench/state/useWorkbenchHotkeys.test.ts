// v0.6.4 · useWorkbenchHotkeys smoke 测试。
//
// 同 AnnotationActions：项目目前不依赖 @testing-library/react，
// 完整 keyboard event 单测留作后续 P2，这里仅做模块导出测试。

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isWorkbenchInputFocused, useWorkbenchHotkeys } from "./useWorkbenchHotkeys";

describe("useWorkbenchHotkeys module", () => {
  it("exports the hook", () => {
    expect(typeof useWorkbenchHotkeys).toBe("function");
  });

  it("does not block hotkeys while the video timeline range is focused", () => {
    const timeline = document.createElement("input");
    timeline.type = "range";
    timeline.className = "video-timeline-range";

    const textInput = document.createElement("input");
    textInput.type = "text";

    expect(isWorkbenchInputFocused(timeline)).toBe(false);
    expect(isWorkbenchInputFocused(textInput)).toBe(true);
  });

  it("blocks the Mask hotkey with the ToolDock reason", () => {
    const setTool = vi.fn();
    const pushToast = vi.fn();
    const view = renderHook(() =>
      useWorkbenchHotkeys({
        s: {
          tool: "select",
          selectedId: null,
          selectedIds: [],
          pendingDrawing: null,
          editingClass: null,
          setTool,
        },
        history: { pushBatch: vi.fn(), undo: vi.fn(), redo: vi.fn() },
        classes: [],
        currentProject: null,
        annotationsRef: { current: [] },
        batchChanging: false,
        setBatchChanging: vi.fn(),
        showHotkeys: false,
        navigateTask: vi.fn(),
        smartNext: vi.fn(),
        setFitTick: vi.fn(),
        recordRecentClass: vi.fn(),
        handleDeleteBox: vi.fn(),
        handleBatchDelete: vi.fn(),
        handleStartChangeClass: vi.fn(),
        handleStartBatchChangeClass: vi.fn(),
        handleSubmitTask: vi.fn(),
        handleAcceptPrediction: vi.fn(),
        handleUpdateAttributes: vi.fn(),
        aiBoxes: [],
        setShowHotkeys: vi.fn(),
        clipboard: {
          hasClipboard: false,
          copySelection: vi.fn(),
          paste: vi.fn(),
          duplicateSelection: vi.fn(),
        },
        pushToast,
        stageGeom: { imgW: 1, imgH: 1 },
        polygonDraftPoints: [],
        setPolygonDraftPoints: vi.fn(),
        submitPolygon: vi.fn(),
        submitPolyline: vi.fn(),
        updateMutation: { mutate: vi.fn() },
        taskId: undefined,
        maskToolDisabledReason: "图片超过 Mask 上限",
      } as unknown as Parameters<typeof useWorkbenchHotkeys>[0]),
    );

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "m" })));

    expect(setTool).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith({ msg: "图片超过 Mask 上限", kind: "warning" });
    view.unmount();
  });
});
