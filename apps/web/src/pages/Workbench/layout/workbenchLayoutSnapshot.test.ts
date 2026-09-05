import { describe, expect, it } from "vitest";
import { createWorkspacePreset } from "./workbenchLayoutPresets";
import {
  PANEL_IDS,
  readWorkspaceEnvelope,
  sanitizeWorkspaceSnapshot,
  type WorkspaceNode,
  type WorkspaceSnapshot,
} from "./workbenchLayoutSnapshot";

function legacySnapshot(snapshot: WorkspaceSnapshot): unknown {
  const legacy = structuredClone(snapshot);
  delete legacy.layout.panels["ai-task"];
  delete legacy.layout.panels["video-tracker"];
  delete (legacy as Partial<WorkspaceSnapshot>).visibilityIntent;
  delete legacy.returns["ai-task"];
  delete legacy.returns["video-tracker"];
  const strip = (group: { views: string[]; activeView?: string }) => {
    group.views = group.views.filter((id) => id !== "ai-task" && id !== "video-tracker");
    if (group.activeView && !group.views.includes(group.activeView))
      group.activeView = group.views[0];
  };
  const visit = (node: WorkspaceNode) =>
    node.type === "branch" ? node.data.forEach(visit) : strip(node.data);
  visit(legacy.layout.grid.root);
  legacy.layout.floatingGroups?.forEach((group) => group.data && strip(group.data));
  return legacy;
}

function canvasNode(node: WorkspaceNode): WorkspaceNode {
  if (node.type === "leaf") return node;
  return node.data.find((n) => n.type === "leaf" && n.data.id === "canvas")!;
}

describe("workspace snapshot boundary", () => {
  it("round trips all presets and pins trusted renderer metadata", () => {
    for (const preset of ["standard", "focus", "review", "ai-review", "video-tracking"] as const) {
      const snapshot = createWorkspacePreset(preset);
      snapshot.layout.panels.canvas.params = { annotation: "private" };
      snapshot.layout.panels.canvas.contentComponent = "untrusted";
      snapshot.layout.panels.canvas.renderer = "onlyWhenVisible";
      snapshot.layout.popoutGroups = [];
      const clean = sanitizeWorkspaceSnapshot(snapshot);
      expect(clean.layout.panels.canvas).toEqual({
        id: "canvas",
        title: "画布",
        contentComponent: "workbench-panel",
        renderer: "always",
      });
      expect(clean.layout).not.toHaveProperty("popoutGroups");
      expect(readWorkspaceEnvelope({ schemaVersion: 3, snapshot: clean }).snapshot).toEqual(clean);
      expect(readWorkspaceEnvelope({ schemaVersion: 4, snapshot: clean }).snapshot).toEqual(clean);
      expect(Object.keys(clean.layout.panels)).toEqual(PANEL_IDS);
    }
    const standard = createWorkspacePreset("standard");
    expect(
      readWorkspaceEnvelope({ schemaVersion: 1, snapshot: legacySnapshot(standard) }).snapshot,
    ).toEqual(standard);
    expect(
      readWorkspaceEnvelope({ schemaVersion: 2, snapshot: legacySnapshot(standard) }).snapshot,
    ).toEqual(standard);
  });

  it("accepts collapsed sides only in schema 4 and rejects a hidden active group", () => {
    const snapshot = createWorkspacePreset("standard");
    const root = snapshot.layout.grid.root;
    if (root.type !== "branch") throw new Error("Expected columns");
    root.data[0].visible = false;
    snapshot.layout.activeGroup = "canvas";
    expect(readWorkspaceEnvelope({ schemaVersion: 4, snapshot }).snapshot).toEqual(snapshot);
    expect(readWorkspaceEnvelope({ schemaVersion: 3, snapshot }).readOnlyReason).toBe("invalid");
    snapshot.layout.activeGroup = "task-queue";
    expect(() => sanitizeWorkspaceSnapshot(snapshot)).toThrow("Invalid active group");
  });

  it("does not interpret newer envelopes as v1", () => {
    for (const schemaVersion of [5, 6])
      expect(readWorkspaceEnvelope({ schemaVersion, snapshot: {} })).toEqual({
        snapshot: null,
        readOnlyReason: "newer-schema",
      });
    expect(readWorkspaceEnvelope(undefined)).toEqual({ snapshot: null, readOnlyReason: null });
  });

  it("rejects duplicate, missing, hidden or tabbed canvas and transient groups", () => {
    const corrupt = [
      (snapshot: ReturnType<typeof createWorkspacePreset>) => {
        delete snapshot.layout.panels.canvas;
      },
      (snapshot: ReturnType<typeof createWorkspacePreset>) => {
        canvasNode(snapshot.layout.grid.root).visible = false;
      },
      (snapshot: ReturnType<typeof createWorkspacePreset>) => {
        const node = canvasNode(snapshot.layout.grid.root);
        if (node.type === "leaf") node.data.views.push("inspector");
      },
      (snapshot: ReturnType<typeof createWorkspacePreset>) => {
        const node = canvasNode(snapshot.layout.grid.root);
        if (node.type === "leaf") node.data.id = "compact-overlay";
      },
    ];
    for (const change of corrupt) {
      const snapshot = createWorkspacePreset("standard");
      change(snapshot);
      expect(() => sanitizeWorkspaceSnapshot(snapshot)).toThrow();
    }
  });

  it("enforces finite values, UTF-8 byte limit, tree depth and seven user groups", () => {
    const large = createWorkspacePreset("standard");
    large.layout.panels.canvas.params = { value: "汉".repeat(23_000) };
    expect(() => sanitizeWorkspaceSnapshot(large)).toThrow("64 KiB");
    const nonFinite = createWorkspacePreset("standard");
    nonFinite.layout.grid.width = Infinity;
    expect(() => sanitizeWorkspaceSnapshot(nonFinite)).toThrow();
    const deep = createWorkspacePreset("standard");
    for (let i = 0; i < 14; i++)
      deep.layout.grid.root = { type: "branch", data: [deep.layout.grid.root], size: 800 };
    expect(() => sanitizeWorkspaceSnapshot(deep)).toThrow();
    const limit = createWorkspacePreset("standard");
    if (limit.layout.grid.root.type !== "branch") throw new Error("Expected branch");
    for (let i = 0; i < 2; i++)
      limit.layout.grid.root.data.push({
        type: "leaf",
        data: { id: `empty-${i}`, views: [] },
        size: 100,
      });
    expect(() => sanitizeWorkspaceSnapshot(limit)).not.toThrow();
    limit.layout.grid.root.data.push({
      type: "leaf",
      data: { id: "too-many", views: [] },
      size: 100,
    });
    expect(() => sanitizeWorkspaceSnapshot(limit)).toThrow("Too many layout groups");
  });

  it("clamps floating and return rectangles and refuses reserved return targets", () => {
    const snapshot = createWorkspacePreset("standard");
    snapshot.returns.discussion = {
      group: "old-discussion",
      index: 0,
      position: { left: 9000, top: -50, width: 4000, height: 2 },
    };
    expect(
      sanitizeWorkspaceSnapshot(snapshot, { width: 1200, height: 700 }).returns.discussion
        ?.position,
    ).toEqual({ left: 480, top: 0, width: 720, height: 320 });
    snapshot.returns.discussion.group = "canvas";
    expect(() => sanitizeWorkspaceSnapshot(snapshot)).toThrow("Invalid return position");
  });
});
