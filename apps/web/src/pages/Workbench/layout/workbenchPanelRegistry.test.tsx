import { describe, expect, it } from "vitest";
import { PANEL_IDS } from "./workbenchLayoutSnapshot";
import { PERIPHERAL_PANELS, WORKBENCH_PANEL_REGISTRY } from "./workbenchPanelRegistry";

describe("workbench panel contract", () => {
  it("allows constrained canvas docking and keeps draft panels mounted in all six contexts", () => {
    expect(Object.keys(WORKBENCH_PANEL_REGISTRY)).toEqual(PANEL_IDS);
    expect(WORKBENCH_PANEL_REGISTRY.canvas.capabilities).toEqual({
      dock: true,
      tab: false,
      float: false,
      hide: false,
    });
    for (const id of ["canvas", "inspector", "discussion"] as const)
      expect(WORKBENCH_PANEL_REGISTRY[id].renderer).toBe("always");
    for (const id of PERIPHERAL_PANELS) {
      expect(WORKBENCH_PANEL_REGISTRY[id].capabilities.hide).toBe(true);
      expect(WORKBENCH_PANEL_REGISTRY[id].closable).toBe(false);
      expect(WORKBENCH_PANEL_REGISTRY[id].modes).toEqual(["annotate", "review"]);
      expect(WORKBENCH_PANEL_REGISTRY[id].stages).toEqual(["image", "video", "3d"]);
    }
  });
});
