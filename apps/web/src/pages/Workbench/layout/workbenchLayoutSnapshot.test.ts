import { describe, expect, it } from "vitest";
import { createWorkspacePreset } from "./workbenchLayoutPresets";
import {
  PANEL_IDS,
  readWorkspaceEnvelope,
  sanitizeWorkspaceSnapshot,
  type WorkspaceNode,
  type WorkspaceSnapshot,
} from "./workbenchLayoutSnapshot";

function legacySnapshot(snapshot: WorkspaceSnapshot, version = 1): unknown {
  const legacy = structuredClone(snapshot);
  const removed =
    version >= 3
      ? ["tri-view", "camera-view"]
      : ["ai-task", "video-tracker", "tri-view", "camera-view"];
  for (const id of removed) {
    delete legacy.layout.panels[id];
    delete legacy.returns[id as keyof typeof legacy.returns];
  }
  delete (legacy as Partial<WorkspaceSnapshot>).cameraPresentation;
  if (version < 3) delete (legacy as Partial<WorkspaceSnapshot>).visibilityIntent;
  else {
    delete (legacy.visibilityIntent as Partial<WorkspaceSnapshot["visibilityIntent"]>)["tri-view"];
    delete (legacy.visibilityIntent as Partial<WorkspaceSnapshot["visibilityIntent"]>)[
      "camera-view"
    ];
  }
  const strip = (group: { views: string[]; activeView?: string }) => {
    group.views = group.views.filter((id) => !removed.includes(id));
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
  it("requires schema 5 presentation metadata and forbids native floating camera groups", () => {
    const snapshot = createWorkspacePreset("standard");
    expect(readWorkspaceEnvelope({ schemaVersion: 5, snapshot }).snapshot).toEqual(snapshot);
    const incomplete = structuredClone(snapshot);
    delete (incomplete as Partial<WorkspaceSnapshot>).cameraPresentation;
    expect(readWorkspaceEnvelope({ schemaVersion: 5, snapshot: incomplete }).readOnlyReason).toBe(
      "invalid",
    );
    const root = snapshot.layout.grid.root;
    if (root.type !== "branch") throw new Error("Expected columns");
    const parking = root.data.find((node) => node.type === "leaf" && node.data.id === "parking");
    if (parking?.type !== "leaf") throw new Error("Expected parking");
    parking.data.views = parking.data.views.filter((id) => id !== "camera-view");
    snapshot.cameraPresentation = "docked";
    snapshot.layout.floatingGroups = [
      {
        data: { id: "gallery", views: ["camera-view"] },
        position: { left: 0, top: 0, width: 400, height: 500 },
      },
    ];
    expect(() => sanitizeWorkspaceSnapshot(snapshot)).toThrow("Camera gallery must remain docked");
    snapshot.layout.floatingGroups[0].data!.views.unshift("tri-view");
    parking.data.views = parking.data.views.filter((id) => id !== "tri-view");
    expect(() => sanitizeWorkspaceSnapshot(snapshot)).toThrow("Camera gallery must remain docked");
  });
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
      expect(
        readWorkspaceEnvelope({ schemaVersion: 3, snapshot: legacySnapshot(clean, 3) }).snapshot,
      ).toEqual(clean);
      expect(
        readWorkspaceEnvelope({ schemaVersion: 4, snapshot: legacySnapshot(clean, 4) }).snapshot,
      ).toEqual(clean);
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
    expect(
      readWorkspaceEnvelope({ schemaVersion: 4, snapshot: legacySnapshot(snapshot, 4) }).snapshot,
    ).toEqual(snapshot);
    expect(
      readWorkspaceEnvelope({ schemaVersion: 3, snapshot: legacySnapshot(snapshot, 3) })
        .readOnlyReason,
    ).toBe("invalid");
    snapshot.layout.activeGroup = "task-queue";
    expect(() => sanitizeWorkspaceSnapshot(snapshot)).toThrow("Invalid active group");
  });

  it("does not interpret newer envelopes as v1", () => {
    for (const schemaVersion of [6, 7])
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

  it("enforces finite values, UTF-8 byte limit, tree depth and nine user groups", () => {
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
    for (let i = 0; i < 4; i++)
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
