// v0.10.8 · MaskTool 单测：onPointerDown 返回 maskBrush DragInit + 自动 beginBlank。

import { describe, expect, it, vi } from "vitest";
import { MaskTool } from "./MaskTool";
import type { ToolPointerContext, DragInit } from "./index";
import type { UseMaskEditorReturn } from "../../state/useMaskEditor";

function fakeMaskEditor(active: boolean): UseMaskEditorReturn {
  return {
    active,
    mode: "brush",
    radius: 16,
    dirty: false,
    buffer: null,
    revision: 0,
    canUndo: false,
    canRedo: false,
    beginBlank: vi.fn(),
    initFromPolygon: vi.fn(),
    initFromRle: vi.fn(),
    paintAt: vi.fn(),
    beginStroke: vi.fn(),
    endStroke: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    setMode: vi.fn(),
    setRadius: vi.fn(),
    cancel: vi.fn(),
    commitToPolygon: vi.fn(() => null),
    commitToRle: vi.fn(() => null),
  };
}

function baseCtx(maskEditor: UseMaskEditorReturn | undefined, readOnly = false): ToolPointerContext {
  return {
    pt: { x: 0.5, y: 0.5 },
    evt: {} as unknown as MouseEvent,
    vp: { scale: 1, tx: 0, ty: 0 },
    activeClass: "",
    imgW: 800,
    imgH: 600,
    spacePan: false,
    readOnly,
    pendingDrawing: false,
    onClearSelection: () => {},
    maskEditor,
  };
}

describe("MaskTool", () => {
  it("readOnly 时返回 null", () => {
    const me = fakeMaskEditor(false);
    expect(MaskTool.onPointerDown!(baseCtx(me, true))).toBeNull();
    expect(me.beginBlank).not.toHaveBeenCalled();
  });

  it("没有 maskEditor 时返回 null", () => {
    expect(MaskTool.onPointerDown!(baseCtx(undefined))).toBeNull();
  });

  it("未激活 → beginBlank + paintAt + 返回 maskBrush", () => {
    const me = fakeMaskEditor(false);
    const init = MaskTool.onPointerDown!(baseCtx(me)) as Extract<DragInit, { kind: "maskBrush" }>;
    expect(me.beginBlank).toHaveBeenCalledTimes(1);
    expect(me.paintAt).toHaveBeenCalledWith(0.5 * 800, 0.5 * 600);
    expect(init.kind).toBe("maskBrush");
    expect(init.lastX).toBe(400);
    expect(init.lastY).toBe(300);
  });

  it("已激活 → 不再 beginBlank, 直接 paintAt 一次", () => {
    const me = fakeMaskEditor(true);
    const init = MaskTool.onPointerDown!(baseCtx(me)) as Extract<DragInit, { kind: "maskBrush" }>;
    expect(me.beginBlank).not.toHaveBeenCalled();
    expect(me.paintAt).toHaveBeenCalledTimes(1);
    expect(init.kind).toBe("maskBrush");
  });
});
