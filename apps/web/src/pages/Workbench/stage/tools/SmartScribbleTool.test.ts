import { describe, expect, it, vi } from "vitest";

import { SmartScribbleTool } from "./SmartScribbleTool";
import type { ToolPointerContext } from "./index";

function context(overrides: Partial<ToolPointerContext> = {}): ToolPointerContext {
  return {
    pt: { x: 0.25, y: 0.5 },
    evt: new MouseEvent("pointerdown"),
    vp: { scale: 1, tx: 0, ty: 0 },
    activeClass: "car",
    imgW: 100,
    imgH: 100,
    spacePan: false,
    readOnly: false,
    pendingDrawing: false,
    onClearSelection: vi.fn(),
    ...overrides,
  };
}

describe("SmartScribbleTool", () => {
  it("仅在已鉴权 Mask 选中态下开始笔迹，且不清选中", () => {
    const onClearSelection = vi.fn();
    const result = SmartScribbleTool.onPointerDown?.(context({
      preserveSelectionForPrompt: true,
      onClearSelection,
    }));
    expect(result).toEqual({ kind: "samScribble", points: [[0.25, 0.5]], alt: false });
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it("Alt 或负极性产生负向 scribble，无 Mask 选中则不起笔", () => {
    expect(SmartScribbleTool.onPointerDown?.(context())).toBeNull();
    const altEvent = new MouseEvent("pointerdown", { altKey: true });
    expect(SmartScribbleTool.onPointerDown?.(context({
      evt: altEvent,
      preserveSelectionForPrompt: true,
    }))).toMatchObject({ kind: "samScribble", alt: true });
    expect(SmartScribbleTool.onPointerDown?.(context({
      preserveSelectionForPrompt: true,
      samPolarity: "negative",
    }))).toMatchObject({ kind: "samScribble", alt: true });
  });
});
