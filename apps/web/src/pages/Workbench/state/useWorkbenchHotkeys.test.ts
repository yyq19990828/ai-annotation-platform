import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isWorkbenchInputFocused, useWorkbenchHotkeys } from "./useWorkbenchHotkeys";

function makeArgs(overrides: Partial<Parameters<typeof useWorkbenchHotkeys>[0]> = {}) {
  return {
    s: {
      tool: "select",
      selectedId: null,
      selectedIds: [],
      pendingDrawing: null,
      editingClass: null,
      setTool: vi.fn(),
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
    pushToast: vi.fn(),
    stageGeom: { imgW: 1, imgH: 1 },
    polygonDraftPoints: [],
    setPolygonDraftPoints: vi.fn(),
    submitPolygon: vi.fn(),
    submitPolyline: vi.fn(),
    updateMutation: { mutate: vi.fn() },
    taskId: undefined,
    ...overrides,
  } as unknown as Parameters<typeof useWorkbenchHotkeys>[0];
}

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
    const sceneTimeline = document.createElement("section");
    sceneTimeline.dataset.sceneTimeline = "";
    const playButton = document.createElement("button");
    sceneTimeline.append(playButton);
    expect(isWorkbenchInputFocused(playButton)).toBe(true);
  });

  it("does not send single-key annotation shortcuts from docking tabs or menus", () => {
    for (const role of ["tab", "menu", "menuitem"]) {
      const element = document.createElement("div");
      element.setAttribute("role", role);
      const child = document.createElement("span");
      element.append(child);
      expect(isWorkbenchInputFocused(child)).toBe(true);
    }
    const control = document.createElement("button");
    control.dataset.workbenchLayoutControl = "";
    expect(isWorkbenchInputFocused(control)).toBe(true);
  });

  it("blocks the Mask hotkey with the ToolDock reason", () => {
    const setTool = vi.fn();
    const pushToast = vi.fn();
    const args = makeArgs();
    args.s.setTool = setTool;
    const view = renderHook(() =>
      useWorkbenchHotkeys({ ...args, pushToast, maskToolDisabledReason: "图片超过 Mask 上限" }),
    );

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "m" })));

    expect(setTool).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith({ msg: "图片超过 Mask 上限", kind: "warning" });
    view.unmount();
  });

  it("disabling clears held space without toggling video playback on release", () => {
    const togglePlayback = vi.fn();
    const args = makeArgs({
      videoMode: true,
      videoControlsRef: { current: { togglePlayback } } as never,
    });
    const view = renderHook(({ disabled }) => useWorkbenchHotkeys({ ...args, disabled }), {
      initialProps: { disabled: false },
    });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: " " })));
    expect(view.result.current.spacePan).toBe(true);
    view.rerender({ disabled: true });
    expect(view.result.current.spacePan).toBe(false);
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: " " })));
    view.rerender({ disabled: false });
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: " " })));
    expect(togglePlayback).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: " " })));
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: " " })));
    expect(togglePlayback).toHaveBeenCalledTimes(1);
  });

  it("flushes an existing nudge once when disabled and restores hotkeys on close", () => {
    const args = makeArgs();
    args.s.selectedId = "box";
    args.s.selectedIds = ["box"];
    args.annotationsRef.current = [
      {
        id: "box",
        geometry: { type: "bbox", x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      },
    ] as never;
    args.stageGeom = { imgW: 100, imgH: 100 };
    const view = renderHook(({ disabled }) => useWorkbenchHotkeys({ ...args, disabled }), {
      initialProps: { disabled: false },
    });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
    expect(view.result.current.nudgeMap.get("box")?.x).toBeCloseTo(0.11);
    view.rerender({ disabled: true });
    expect(args.updateMutation.mutate).toHaveBeenCalledTimes(1);
    expect(args.history.pushBatch).toHaveBeenCalledTimes(1);
    expect(view.result.current.nudgeMap.size).toBe(0);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" })));
    expect(args.handleDeleteBox).not.toHaveBeenCalled();
    view.rerender({ disabled: false });
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" })));
    expect(args.updateMutation.mutate).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" })));
    expect(args.handleDeleteBox).toHaveBeenCalledWith("box");
  });

  it("settings button events reach the button without submitting a polygon", () => {
    const args = makeArgs({
      polygonDraftPoints: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    args.s.tool = "polygon";
    renderHook(() => useWorkbenchHotkeys(args));
    const settings = document.createElement("button");
    settings.dataset.workbenchSettings = "";
    settings.dataset.state = "open";
    document.body.append(settings);
    const buttonHandler = vi.fn();
    settings.addEventListener("keydown", buttonHandler);
    act(() =>
      settings.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(buttonHandler).toHaveBeenCalledTimes(1);
    expect(args.submitPolygon).not.toHaveBeenCalled();
    settings.remove();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })));
    expect(args.submitPolygon).toHaveBeenCalledTimes(1);
  });
});
