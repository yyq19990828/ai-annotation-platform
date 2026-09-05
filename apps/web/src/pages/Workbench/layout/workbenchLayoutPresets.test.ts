import { describe, expect, it } from "vitest";
import {
  createWorkspacePreset,
  migrateLegacyWorkspace,
  migrateThreeDWorkspace,
  presetSupportsContext,
  WORKSPACE_PRESETS,
} from "./workbenchLayoutPresets";
import { PANEL_IDS, WORKSPACE_CONTEXTS, type WorkspaceNode } from "./workbenchLayoutSnapshot";

const groups = (node: WorkspaceNode): { id: string; views: string[] }[] =>
  node.type === "leaf" ? [node.data] : node.data.flatMap(groups);

describe("workspace presets", () => {
  it("migrates 3D visibility while preserving existing panels, widths and legacy coordinates", () => {
    const before = createWorkspacePreset("standard", { width: 1600, height: 900 });
    const legacy = { layout: { triViewFloat: { collapsed: false, x: 4000, y: -20 } } };
    const snapshot = migrateThreeDWorkspace(before, legacy, "annotate:3d");
    expect(snapshot.cameraPresentation).toBe("floating");
    expect(snapshot.visibilityIntent["camera-view"]).toBe("shown");
    expect(snapshot.visibilityIntent["tri-view"]).toBe("shown");
    const root = snapshot.layout.grid.root;
    if (root.type !== "branch" || before.layout.grid.root.type !== "branch")
      throw new Error("Expected columns");
    expect(root.data[0]).toEqual(before.layout.grid.root.data[0]);
    expect(root.data[3]).toEqual(before.layout.grid.root.data[2]);
    expect(root.data[2].size).toBe(240);
    expect(groups(root).find((g) => g.id === "parking")?.views).toContain("camera-view");
    expect(migrateThreeDWorkspace(before, legacy, "annotate:image")).toEqual(before);
    expect(
      migrateThreeDWorkspace(before, { layout: { triViewFloat: { collapsed: true } } }, "review:3d")
        .visibilityIntent["tri-view"],
    ).toBe("hidden");
    expect(legacy.layout.triViewFloat.x).toBe(4000);
  });
  it("provides all nine panels once in every context without business params", () => {
    for (const context of WORKSPACE_CONTEXTS)
      for (const preset of WORKSPACE_PRESETS) {
        const snapshot = createWorkspacePreset(preset.id, { width: 1600, height: 900 }, context);
        expect(
          groups(snapshot.layout.grid.root)
            .flatMap((g) => g.views)
            .sort(),
        ).toEqual([...PANEL_IDS].sort());
        expect(
          Object.values(snapshot.layout.panels).every((panel) => panel.params === undefined),
        ).toBe(true);
      }
  });

  it("offers tool presets only in their supported annotate context", () => {
    expect(presetSupportsContext("ai-review", "annotate:image")).toBe(true);
    expect(presetSupportsContext("ai-review", "review:image")).toBe(false);
    expect(presetSupportsContext("video-tracking", "annotate:video")).toBe(true);
    expect(presetSupportsContext("video-tracking", "review:video")).toBe(false);
  });

  it("uses maximize for focus and preserves a full desktop tree", () => {
    const focused = createWorkspacePreset("focus");
    expect(focused.layout.grid.maximizedNode).toEqual({ location: [1] });
    expect(focused.layout.grid.root).toEqual(createWorkspacePreset("standard").layout.grid.root);
  });

  it("migrates legacy widths, hidden panels, detached panels and split height once", () => {
    const legacy = {
      layout: {
        leftOpen: false,
        rightOpen: true,
        floatingInspector: { detached: true, x: 40, y: 50, w: 400, h: 500 },
      },
      common: { leftWidthPct: 20, rightWidthPct: 25 },
      rightSplitTop: 400,
    };
    const previous = structuredClone(legacy);
    const snapshot = migrateLegacyWorkspace(legacy, { width: 1600, height: 900 });
    expect(groups(snapshot.layout.grid.root).find((g) => g.id === "parking")?.views).toEqual([
      "ai-task",
      "video-tracker",
      "tri-view",
      "camera-view",
      "task-queue",
      "class-palette",
    ]);
    expect(snapshot.layout.floatingGroups?.[0]).toEqual({
      data: { id: "inspector", views: ["inspector"], activeView: "inspector" },
      position: { left: 40, top: 50, width: 400, height: 500 },
    });
    expect(snapshot.returns["task-queue"]).toEqual({ group: "task-queue", index: 0 });
    expect(legacy).toEqual(previous);
  });
});
