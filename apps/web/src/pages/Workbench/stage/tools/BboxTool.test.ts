import { describe, expect, it, vi } from "vitest";
import { BboxTool } from "./BboxTool";
import { RotatedBboxTool } from "./RotatedBboxTool";
import type { ToolPointerContext } from "./index";

function context(overrides: Partial<ToolPointerContext> = {}): ToolPointerContext {
  return {
    pt: { x: 0.4, y: 0.6 },
    evt: new MouseEvent("mousedown"),
    vp: { tx: 0, ty: 0, scale: 1 },
    activeClass: "car",
    imgW: 1000,
    imgH: 800,
    spacePan: false,
    readOnly: false,
    pendingDrawing: false,
    onClearSelection: vi.fn(),
    ...overrides,
  };
}

describe("bbox creation origin", () => {
  it("defaults to corners and latches Alt or the session center option", () => {
    const normal = BboxTool.onPointerDown!(context());
    expect(normal).not.toHaveProperty("fromCenter");
    const alt = BboxTool.onPointerDown!(
      context({ evt: new MouseEvent("mousedown", { altKey: true }) }),
    );
    expect(alt).toMatchObject({ kind: "draw", fromCenter: true, sx: 0.4, sy: 0.6 });
    expect(BboxTool.onPointerDown!(context({ bboxCreationMode: "center" }))).toMatchObject({
      kind: "draw",
      fromCenter: true,
    });
    expect(
      RotatedBboxTool.onPointerDown!(
        context({ bboxCreationMode: "center", evt: new MouseEvent("mousedown", { altKey: true }) }),
      ),
    ).not.toHaveProperty("fromCenter");
  });

  it("rejects an outside center before clearing selection", () => {
    const input = context({ pt: { x: -0.1, y: 0.5 }, bboxCreationMode: "center" });
    expect(BboxTool.onPointerDown!(input)).toBeNull();
    expect(input.onClearSelection).not.toHaveBeenCalled();
  });

  it("keeps pending-draft and pan admission ahead of center creation", () => {
    expect(
      BboxTool.onPointerDown!(context({ bboxCreationMode: "center", pendingDrawing: true })),
    ).toBeNull();
    for (const flag of ["spacePan", "readOnly"] as const)
      expect(
        BboxTool.onPointerDown!(context({ bboxCreationMode: "center", [flag]: true })),
      ).toMatchObject({ kind: "pan" });
  });
});
