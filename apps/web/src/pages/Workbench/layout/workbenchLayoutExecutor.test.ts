import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDockview, type DockviewApi } from "dockview-react";
import { createWorkbenchLayoutExecutor } from "./workbenchLayoutExecutor";
import { createWorkspacePreset } from "./workbenchLayoutPresets";
import { PANEL_IDS, type WorkspaceBounds } from "./workbenchLayoutSnapshot";

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
      if (this.classList.contains("dv-resize-container"))
        return new DOMRect(
          parseFloat(this.style.left) || 0,
          parseFloat(this.style.top) || 0,
          parseFloat(this.style.width) || 0,
          parseFloat(this.style.height) || 0,
        );
      if (
        this === element ||
        this.classList.contains("dv-dockview") ||
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
    controller.exitCompact();
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
    controller.show("inspector");
    expect(api.hasMaximizedGroup()).toBe(false);
    expect(api.getPanel("canvas")).toBe(canvas);
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
});
