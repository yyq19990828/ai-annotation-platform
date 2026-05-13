import { describe, expect, it } from "vitest";
import { getVideoStageModeGuard, modeFromDrag } from "./videoStageMode";

describe("videoStageMode", () => {
  it("derives mode from active drag state", () => {
    expect(modeFromDrag(null)).toBe("idle");
    expect(modeFromDrag({ kind: "draw", start: { x: 0, y: 0 }, current: { x: 1, y: 1 } })).toBe("draw");
    expect(modeFromDrag({
      kind: "move",
      id: "a1",
      start: { x: 0, y: 0 },
      origin: { x: 0, y: 0, w: 0.1, h: 0.1 },
      current: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    })).toBe("drag");
  });

  it("blocks frame setup while editing geometry", () => {
    expect(getVideoStageModeGuard("idle").canSetupFrame).toBe(true);
    expect(getVideoStageModeGuard("draw").canSetupFrame).toBe(false);
    expect(getVideoStageModeGuard("drag").canSetupFrame).toBe(false);
    expect(getVideoStageModeGuard("resize").canSetupFrame).toBe(false);
  });
});
