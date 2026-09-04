import { describe, expect, it } from "vitest";
import {
  createWorkspacePreset,
  migrateLegacyWorkspace,
  WORKSPACE_PRESETS,
} from "./workbenchLayoutPresets";
import { PANEL_IDS, WORKSPACE_CONTEXTS, type WorkspaceNode } from "./workbenchLayoutSnapshot";

const groups = (node: WorkspaceNode): { id: string; views: string[] }[] =>
  node.type === "leaf" ? [node.data] : node.data.flatMap(groups);

describe("workspace presets", () => {
  it("provides all five panels once in every context without business params", () => {
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
