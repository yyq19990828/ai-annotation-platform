import { describe, expect, it } from "vitest";
import { PANEL_IDS } from "./workbenchLayoutSnapshot";
import {
  PERIPHERAL_PANELS,
  WORKBENCH_PANEL_REGISTRY,
  panelSupportsContext,
} from "./workbenchPanelRegistry";

describe("workbench panel contract", () => {
  it("allows constrained canvas docking and keeps draft panels mounted in all six contexts", () => {
    expect(Object.keys(WORKBENCH_PANEL_REGISTRY)).toEqual(PANEL_IDS);
    expect(WORKBENCH_PANEL_REGISTRY.canvas.capabilities).toEqual({
      dock: true,
      tab: false,
      float: false,
      hide: false,
    });
    for (const id of ["canvas", "inspector", "discussion", "ai-task", "video-tracker"] as const)
      expect(WORKBENCH_PANEL_REGISTRY[id].renderer).toBe("always");
    for (const id of PERIPHERAL_PANELS) {
      expect(WORKBENCH_PANEL_REGISTRY[id].capabilities.hide).toBe(true);
      expect(WORKBENCH_PANEL_REGISTRY[id].closable).toBe(false);
    }
    expect(WORKBENCH_PANEL_REGISTRY["ai-task"].modes).toEqual(["annotate"]);
    expect(WORKBENCH_PANEL_REGISTRY["ai-task"].stages).toEqual(["image", "video"]);
    expect(WORKBENCH_PANEL_REGISTRY["video-tracker"].stages).toEqual(["video"]);
    expect(panelSupportsContext("ai-task", "annotate:image")).toBe(true);
    expect(panelSupportsContext("ai-task", "review:image")).toBe(false);
    expect(panelSupportsContext("video-tracker", "annotate:video")).toBe(true);
    expect(panelSupportsContext("video-tracker", "annotate:image")).toBe(false);
    for (const id of ["tri-view", "camera-view"] as const) {
      expect(WORKBENCH_PANEL_REGISTRY[id].renderer).toBe("always");
      expect(panelSupportsContext(id, "annotate:3d")).toBe(true);
      expect(panelSupportsContext(id, "review:3d")).toBe(true);
      expect(panelSupportsContext(id, "annotate:image")).toBe(false);
    }
    expect(WORKBENCH_PANEL_REGISTRY["camera-view"].capabilities.float).toBe(false);
  });
});
