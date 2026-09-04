import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDockview, type DockviewApi } from "dockview-react";
import { createWorkbenchLayoutExecutor, getCanvasPlacement } from "./workbenchLayoutExecutor";
import { createWorkspacePreset, migrateLegacyWorkspace } from "./workbenchLayoutPresets";
import {
  PANEL_IDS,
  type WorkspaceBounds,
  type WorkspaceNode,
  type WorkspaceSnapshot,
} from "./workbenchLayoutSnapshot";
import { WORKBENCH_PANEL_REGISTRY } from "./workbenchPanelRegistry";

describe("workspace executor with Dockview 8", () => {
  let api: DockviewApi;
  let bounds: WorkspaceBounds;
  let element: HTMLDivElement;
  beforeEach(() => {
    bounds = { width: 1600, height: 900 };
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    element = document.createElement("div");
    document.body.append(element);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (
        this.classList.contains("dv-resize-container") ||
        this.classList.contains("dv-floating-overlay-host")
      )
        return new DOMRect(
          parseFloat(this.style.left || this.style.inset.split(/\s+/)[3]) || 0,
          parseFloat(this.style.top || this.style.inset.split(/\s+/)[0]) || 0,
          parseFloat(this.style.width) || 0,
          parseFloat(this.style.height) || 0,
        );
      if (
        this === element ||
        this.classList.contains("dv-dockview") ||
        this.firstElementChild?.classList.contains("dv-dockview") ||
        this.classList.contains("dv-shell")
      )
        return new DOMRect(0, 0, bounds.width, bounds.height);
      return new DOMRect();
    });
    api = createDockview(element, {
      createComponent: () => ({ element: document.createElement("div"), init: () => undefined }),
      disableAutoResizing: true,
    });
    api.layout(bounds.width, bounds.height);
    api.fromJSON(createWorkspacePreset("standard", bounds).layout);
  });
  afterEach(() => {
    api?.dispose();
    element?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("replays presets and compact mode without recreating any panel", () => {
    const controller = createWorkbenchLayoutExecutor(api, () => bounds);
    const identities = PANEL_IDS.map((id) => api.getPanel(id));
    const fromJSON = vi.spyOn(api, "fromJSON");
    const removePanel = vi.spyOn(api, "removePanel");
    const desktop = controller.capture();
    controller.applyPreset("review");
    expect(api.getPanel("task-queue")?.group.id).toBe("parking");
    controller.restore(desktop);
    controller.enterCompact();
    expect(controller.capture()).toEqual(desktop);
    controller.show("discussion");
    expect(api.getPanel("discussion")?.group.id).toBe("compact-overlay");
    controller.show("inspector");
    expect(api.getPanel("discussion")?.group.id).toBe("parking");
    controller.applyPreset("review");
    controller.dock("inspector", "below");
    expect(controller.exitCompact()).toBe(false);
    expect(PANEL_IDS.map((id) => api.getPanel(id))).toEqual(identities);
    expect(api.groups.some((group) => group.id === "compact-overlay")).toBe(false);
    expect(fromJSON).not.toHaveBeenCalled();
    expect(removePanel).not.toHaveBeenCalled();
  });

  it("restores hidden tabs to their index and falls back to the deterministic sibling", () => {
    const controller = createWorkbenchLayoutExecutor(api, () => bounds);
    const inspector = api.groups.find((group) => group.id === "inspector")!;
    api.getPanel("discussion")!.api.moveTo({ group: inspector, position: "center", index: 0 });
    controller.hide("discussion");
    controller.show("discussion");
    expect(inspector.panels.map((p) => p.id)).toEqual(["discussion", "inspector"]);
    controller.hide("discussion");
    controller.hide("inspector");
    controller.show("discussion");
    expect(api.getPanel("discussion")?.group.id).toBe("discussion");
    expect(api.getPanel("canvas")?.group.panels.map((p) => p.id)).toEqual(["canvas"]);
  });

  it("merges existing panels into tabs through the menu command and guards canvas and compact mode", () => {
    const controller = createWorkbenchLayoutExecutor(api, () => bounds);
    const discussion = api.getPanel("discussion"),
      inspector = api.getPanel("inspector");
    controller.hide("inspector");
    controller.hide("discussion");
    controller.tab("discussion", "inspector");
    expect(api.getPanel("discussion")).toBe(discussion);
    expect(api.getPanel("inspector")).toBe(inspector);
    expect(discussion?.group).toBe(inspector?.group);
    expect(discussion?.group.panels.map((p) => p.id)).toEqual(["inspector", "discussion"]);
    expect(discussion?.api.isActive).toBe(true);
    expect(discussion?.group.minimumWidth).toBeGreaterThanOrEqual(220);
    controller.tab("discussion", "canvas");
    controller.tab("canvas", "inspector");
    expect(api.getPanel("canvas")?.group.panels.map((p) => p.id)).toEqual(["canvas"]);
    controller.enterCompact();
    controller.tab("task-queue", "class-palette");
    expect(api.getPanel("task-queue")?.group.id).toBe("parking");
    expect(api.groups.some((group) => group.id === "compact-overlay")).toBe(false);
  });

  it("preserves nested splits, tab order, floats, hidden items and the seven-group limit", () => {
    const controller = createWorkbenchLayoutExecutor(api, () => bounds);
    controller.dock("class-palette", "below");
    const target = api.getPanel("class-palette")!.group;
    api.getPanel("task-queue")!.api.moveTo({ group: target, position: "center", index: 0 });
    controller.float("discussion");
    controller.hide("inspector");
    api.addGroup({ id: "empty-one", referenceGroup: "canvas", direction: "above" });
    api.addGroup({ id: "empty-two", referenceGroup: "canvas", direction: "left" });
    const golden = controller.capture();
    controller.enterCompact();
    controller.show("discussion");
    controller.hide("discussion");
    controller.exitCompact();
    const result = controller.capture();
    expect(result.returns).toEqual(golden.returns);
    expect(result.layout.floatingGroups).toEqual(golden.layout.floatingGroups);
    expect(api.getPanel("task-queue")?.group.panels.map((p) => p.id)).toEqual([
      "task-queue",
      "class-palette",
    ]);
    expect(api.getPanel("inspector")?.group.id).toBe("parking");
    expect(api.groups.some((g) => g.id === "empty-one")).toBe(true);
    expect(api.groups.some((g) => g.id === "empty-two")).toBe(true);
  });

  it("keeps focused canvas mounted while maximizing and restoring", () => {
    const controller = createWorkbenchLayoutExecutor(api, () => bounds);
    const canvas = api.getPanel("canvas");
    controller.applyPreset("focus");
    expect(api.hasMaximizedGroup()).toBe(true);
    controller.applyPreset("focus");
    expect(api.hasMaximizedGroup()).toBe(false);
    controller.applyPreset("focus");
    controller.show("inspector");
    expect(api.hasMaximizedGroup()).toBe(false);
    expect(api.getPanel("canvas")).toBe(canvas);
  });

  it("moves the existing canvas to every root edge and preserves that edge across presets", () => {
    const controller = createWorkbenchLayoutExecutor(api, () => bounds);
    const identities = PANEL_IDS.map((id) => api.getPanel(id));
    for (const position of ["left", "right", "above", "below"] as const) {
      controller.moveCanvas(position);
      const snapshot = controller.capture();
      expect(getCanvasPlacement(snapshot)).toBe(position);
      expect(api.getPanel("canvas")?.group.id).toBe("canvas");
      expect(api.getPanel("canvas")?.group.panels.map((panel) => panel.id)).toEqual(["canvas"]);
      expect(PANEL_IDS.map((id) => api.getPanel(id))).toEqual(identities);
    }
    controller.applyPreset("review");
    expect(getCanvasPlacement(controller.capture())).toBe("below");
    controller.toggleCanvasMaximized();
    expect(controller.isCanvasMaximized()).toBe(true);
    controller.toggleCanvasMaximized();
    expect(controller.isCanvasMaximized()).toBe(false);
  });

  it("clears a failed compact latch only through explicit read-only recovery", () => {
    const controller = createWorkbenchLayoutExecutor(api, () => bounds);
    controller.enterCompact();
    vi.spyOn(api, "addGroup").mockImplementationOnce(() => {
      throw new Error("restore failed");
    });
    expect(() => controller.exitCompact()).toThrow("restore failed");
    expect(controller.isCompact()).toBe(true);
    controller.recover(createWorkspacePreset("standard", bounds));
    expect(controller.isCompact()).toBe(false);
    expect(api.getPanel("canvas")?.group.id).toBe("canvas");
  });

  it("reports a write only for deferred visibility changes after compact replay", () => {
    const controller = createWorkbenchLayoutExecutor(api, () => bounds);
    controller.applyPreset("review");
    controller.enterCompact();
    controller.show("task-queue");
    expect(controller.exitCompact()).toBe(true);
    expect(api.getPanel("task-queue")?.group.id).toBe("task-queue");
    controller.enterCompact();
    controller.show("class-palette");
    controller.hide("class-palette");
    expect(controller.exitCompact()).toBe(false);
    expect(api.getPanel("class-palette")?.group.id).toBe("parking");
  });

  it("replays against the new host size before a delayed Dockview ResizeObserver", () => {
    const controller = createWorkbenchLayoutExecutor(api, () => bounds);
    controller.tab("discussion", "inspector");
    controller.float("class-palette");
    const originalCanvas = api.getPanel("canvas");
    bounds = { width: 1024, height: 900 };
    controller.enterCompact();
    api.layout(bounds.width, bounds.height);
    controller.show("task-queue");
    controller.show("discussion");

    // React observes the desktop media query before Dockview observes the resized element.
    bounds = { width: 1920, height: 1080 };
    expect(api.width).toBe(1024);
    expect(() => controller.exitCompact()).not.toThrow();
    expect(api.width).toBe(bounds.width);
    expect(api.height).toBe(bounds.height);
    expect(api.getPanel("canvas")).toBe(originalCanvas);
    expect(api.getPanel("discussion")?.group).toBe(api.getPanel("inspector")?.group);
    expect(api.getPanel("class-palette")?.api.location.type).toBe("floating");
    // The actual observer arriving afterwards must not disturb the completed replay.
    const restored = controller.capture();
    api.layout(bounds.width, bounds.height);
    const withoutSizes = (snapshot: WorkspaceSnapshot) => {
      const clone = structuredClone(snapshot);
      const sizes: number[] = [];
      const visit = (node: WorkspaceNode) => {
        if (node.size !== undefined) {
          sizes.push(node.size);
          delete node.size;
        }
        if (node.type === "branch") node.data.forEach(visit);
      };
      visit(clone.layout.grid.root);
      return { snapshot: clone, sizes };
    };
    const before = withoutSizes(restored),
      after = withoutSizes(controller.capture());
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.sizes).toHaveLength(before.sizes.length);
    after.sizes.forEach((size, index) =>
      expect(Math.abs(size - before.sizes[index])).toBeLessThanOrEqual(1),
    );
  });

  it("latches right-edge floating geometry before the host becomes compact", () => {
    bounds = { width: 1920, height: 1080 };
    api.layout(bounds.width, bounds.height);
    const seed = migrateLegacyWorkspace(
      { layout: { floatingClassPalette: { detached: true, x: 1500, y: 64, w: 360, h: 480 } } },
      bounds,
    );
    api.fromJSON(seed.layout);
    const controller = createWorkbenchLayoutExecutor(api, () => bounds);
    const before = controller.capture();
    expect(before.layout.floatingGroups?.[0].position).toEqual({
      left: 1500,
      top: 64,
      width: 360,
      height: 480,
    });

    bounds = { width: 1024, height: 1080 };
    expect(api.width).toBe(1920);
    controller.enterCompact();
    expect(controller.capture()).toEqual(before);
    api.layout(bounds.width, bounds.height);
    bounds = { width: 1920, height: 1080 };
    expect(controller.exitCompact()).toBe(false);
    expect(controller.capture().layout.floatingGroups).toEqual(before.layout.floatingGroups);
    controller.applyPreset("focus");
    expect(controller.capture().layout.grid.maximizedNode).toBeDefined();
  });

  it("replays four nested split levels within one pixel and reflows actual constraints", () => {
    const leaf = (id: (typeof PANEL_IDS)[number], size: number): WorkspaceNode => ({
      type: "leaf",
      size,
      data: {
        id,
        views: [id],
        activeView: id,
        ...(id === "canvas" ? { locked: true, hideHeader: true } : {}),
      },
    });
    const seed = createWorkspacePreset("standard", bounds);
    seed.layout.grid.root = {
      type: "branch",
      size: 900,
      data: [
        leaf("task-queue", 240),
        {
          type: "branch",
          size: 1360,
          data: [
            leaf("inspector", 200),
            {
              type: "branch",
              size: 700,
              data: [
                leaf("class-palette", 220),
                {
                  type: "branch",
                  size: 1140,
                  data: [leaf("canvas", 500), leaf("discussion", 200)],
                },
              ],
            },
          ],
        },
        {
          type: "leaf",
          size: 0,
          visible: false,
          data: {
            id: "parking",
            views: ["ai-task", "video-tracker"],
            activeView: "ai-task",
            locked: "no-drop-target",
            hideHeader: true,
          },
        },
      ],
    };
    api.fromJSON(seed.layout);
    for (const item of api.panels) {
      const spec = WORKBENCH_PANEL_REGISTRY[item.id as (typeof PANEL_IDS)[number]];
      item.api.setConstraints({ minimumWidth: spec.minWidth, minimumHeight: spec.minHeight });
    }
    const controller = createWorkbenchLayoutExecutor(api, () => bounds);
    const dimensions = new Map(
      api.groups
        .filter((g) => g.id !== "parking")
        .map((group) => [group.id, { width: group.api.width, height: group.api.height }]),
    );
    controller.enterCompact();
    controller.show("inspector");
    controller.exitCompact();
    for (const [id, expected] of dimensions) {
      const group = api.getGroup(id)!;
      expect(Math.abs(group.api.width - expected.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(group.api.height - expected.height)).toBeLessThanOrEqual(1);
    }
    controller.enterCompact();
    bounds = { width: 1280, height: 800 };
    api.layout(bounds.width, bounds.height);
    expect(() => controller.exitCompact()).not.toThrow();
    expect(api.getPanel("canvas")!.group.api.width).toBeGreaterThanOrEqual(480);
    expect(api.getPanel("canvas")!.group.api.height).toBeGreaterThanOrEqual(320);
  });
});
