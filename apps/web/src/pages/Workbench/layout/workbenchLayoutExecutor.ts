import type { DockviewApi, DockviewGroupPanel } from "dockview-react";
import { WORKBENCH_PANEL_REGISTRY } from "./workbenchPanelRegistry";
import {
  createWorkspacePreset,
  PANEL_DEFAULT_POSITION,
  type WorkspacePresetId,
} from "./workbenchLayoutPresets";
import {
  PANEL_IDS,
  clampWorkspaceRect,
  sanitizeWorkspaceSnapshot,
  type PanelId,
  type PanelReturn,
  type WorkspaceBounds,
  type WorkspaceGroup,
  type WorkspaceNode,
  type WorkspaceRect,
  type WorkspaceSnapshot,
} from "./workbenchLayoutSnapshot";

type SidePanelId = Exclude<PanelId, "canvas">;
type DockPosition = "left" | "right" | "above" | "below";
type Axis = "HORIZONTAL" | "VERTICAL";
type Tree =
  | { group: WorkspaceGroup; size: number }
  | { axis: Axis; children: Tree[]; size: number };
const opposite = (axis: Axis): Axis => (axis === "HORIZONTAL" ? "VERTICAL" : "HORIZONTAL");

/** Hidden parking takes no space; unary engine wrappers do not change a layout. */
function treeFromNode(node: WorkspaceNode, axis: Axis): Tree | null {
  if (node.type === "leaf")
    return node.data.id === "parking" ? null : { group: node.data, size: node.size ?? 1 };
  const children = node.data
    .map((child) => treeFromNode(child, opposite(axis)))
    .filter((child): child is Tree => child !== null);
  if (!children.length) return null;
  if (children.length === 1) return { ...children[0], size: node.size ?? children[0].size };
  return { axis, children, size: node.size ?? 1 };
}
function shape(tree: Tree): unknown {
  return "group" in tree
    ? { id: tree.group.id, views: tree.group.views, activeView: tree.group.activeView }
    : { axis: tree.axis, children: tree.children.map(shape) };
}
function groupsIn(node: WorkspaceNode): WorkspaceGroup[] {
  return node.type === "leaf" ? [node.data] : node.data.flatMap(groupsIn);
}
function insertionSteps(tree: Tree): { id: string; reference: string; direction: DockPosition }[] {
  const steps: { id: string; reference: string; direction: DockPosition }[] = [];
  function peel(current: Tree): Tree {
    if ("group" in current) return current;
    const nested = current.children.findIndex((child) => !("group" in child));
    if (nested !== -1) current.children[nested] = peel(current.children[nested]);
    else {
      const index = current.children.findIndex(
        (child) => "group" in child && child.group.id !== "canvas",
      );
      const referenceIndex = index === 0 ? 1 : index - 1;
      const child = current.children[index],
        reference = current.children[referenceIndex];
      if (!("group" in child) || !("group" in reference)) throw new Error("Invalid replay tree");
      steps.push({
        id: child.group.id,
        reference: reference.group.id,
        direction:
          current.axis === "HORIZONTAL"
            ? index < referenceIndex
              ? "left"
              : "right"
            : index < referenceIndex
              ? "above"
              : "below",
      });
      current.children.splice(index, 1);
    }
    return current.children.length === 1 ? { ...current.children[0], size: current.size } : current;
  }
  let remaining = structuredClone(tree);
  while (!("group" in remaining)) remaining = peel(remaining);
  if (remaining.group.id !== "canvas") throw new Error("Replay requires canvas anchor");
  return steps.reverse();
}

export interface WorkbenchLayoutExecutor {
  capture(): WorkspaceSnapshot;
  restore(snapshot: WorkspaceSnapshot): void;
  recover(snapshot: WorkspaceSnapshot): void;
  setReturns(returns: WorkspaceSnapshot["returns"]): void;
  show(id: PanelId): void;
  hide(id: PanelId): void;
  dock(id: PanelId, position: "left" | "right" | "below"): void;
  tab(id: PanelId, target: PanelId): void;
  float(id: PanelId): void;
  applyPreset(preset: WorkspacePresetId): void;
  enterCompact(): void;
  exitCompact(): boolean;
  resizeCompact(): void;
  isCompact(): boolean;
  isVisible(id: PanelId): boolean;
}

/** The only runtime layout controller. No panel is closed, removed or recreated. */
export function createWorkbenchLayoutExecutor(
  api: DockviewApi,
  getBounds: () => WorkspaceBounds,
): WorkbenchLayoutExecutor {
  let returns: WorkspaceSnapshot["returns"] = {};
  let desktop: WorkspaceSnapshot | null = null;
  const pendingShows = new Set<SidePanelId>();
  const getGroup = (id: string) => api.groups.find((group) => group.id === id);
  const canvas = () => {
    const group = getGroup("canvas");
    if (
      !group ||
      group.panels.length !== 1 ||
      group.panels[0].id !== "canvas" ||
      group.api.location.type !== "grid"
    )
      throw new Error("Canvas anchor is unavailable");
    return group;
  };
  const panel = (id: PanelId) => {
    const value = api.getPanel(id);
    if (!value) throw new Error(`Missing workspace panel: ${id}`);
    return value;
  };
  function ensureParking() {
    const group =
      getGroup("parking") ??
      api.addGroup({
        id: "parking",
        direction: "right",
        skipSetActive: true,
        hideHeader: true,
        locked: "no-drop-target",
      });
    group.api.locked = "no-drop-target";
    group.header.hidden = true;
    group.api.setVisible(false);
    return group;
  }
  function ensureGroup(id: string, reference = "canvas", direction: DockPosition = "right") {
    return (
      getGroup(id) ??
      api.addGroup({ id, referenceGroup: reference, direction, skipSetActive: true })
    );
  }
  function move(id: PanelId, group: DockviewGroupPanel, index?: number) {
    if (id === "canvas") throw new Error("Canvas cannot move");
    const item = panel(id);
    if (item.group === group && (index === undefined || group.panels.indexOf(item) === index))
      return;
    item.api.moveTo({ group, position: "center", index, skipSetActive: true });
  }
  function removeEmptyGroups(except: string[] = []) {
    for (const group of [...api.groups])
      if (!group.panels.length && !except.includes(group.id) && group.id !== "canvas")
        api.removeGroup(group);
  }
  function rawSnapshot(bounds: WorkspaceBounds = getBounds()): WorkspaceSnapshot {
    const layout = api.toJSON();
    if (layout.activeGroup === "parking") layout.activeGroup = "canvas";
    return sanitizeWorkspaceSnapshot({ layout, returns }, bounds);
  }
  function remember(id: SidePanelId) {
    const item = panel(id),
      group = item.group;
    if (["parking", "compact-overlay"].includes(group.id)) return;
    const entry: PanelReturn = { group: group.id, index: group.panels.indexOf(item) };
    if (group.api.location.type === "floating") {
      const floating = api.toJSON().floatingGroups?.find((f) => f.data?.id === group.id);
      if (floating) {
        const bounds = getBounds(),
          p = floating.position;
        entry.position = clampWorkspaceRect(
          {
            left: "left" in p ? p.left : bounds.width - p.right - p.width,
            top: "top" in p ? p.top : bounds.height - p.bottom - p.height,
            width: p.width,
            height: p.height,
          },
          bounds,
        );
      }
    }
    returns[id] = entry;
  }
  function hide(id: PanelId) {
    if (id === "canvas") return;
    if (desktop) pendingShows.delete(id);
    else remember(id);
    move(id, ensureParking());
    ensureParking();
    canvas().api.setActive();
    removeEmptyGroups(["parking"]);
  }
  function defaultGroup(id: SidePanelId) {
    const existing = getGroup(id);
    const group =
      existing && existing.id !== "canvas"
        ? existing
        : ensureGroup(id, "canvas", PANEL_DEFAULT_POSITION[id]);
    const spec = WORKBENCH_PANEL_REGISTRY[id];
    group.api.moveTo({
      group: canvas(),
      position: spec.defaultPosition === "below" ? "bottom" : spec.defaultPosition,
      skipSetActive: true,
    });
    group.api.setVisible(true);
    group.api.setSize({
      width: spec.width,
      ...(id === "discussion" ? { height: spec.height } : {}),
    });
    return group;
  }
  function setFloat(group: DockviewGroupPanel, position: WorkspaceRect) {
    if (group.id === "canvas" || group.id === "parking")
      throw new Error("Reserved group cannot float");
    if (group.id !== "compact-overlay")
      group.api.setConstraints({
        minimumWidth: Math.min(320, getBounds().width),
        minimumHeight: Math.min(320, getBounds().height),
        maximumWidth: 720,
        maximumHeight: 900,
      });
    if (group.api.location.type === "floating")
      group.api.moveTo({ group: canvas(), position: "right", skipSetActive: true });
    api.addFloatingGroup(group, {
      x: position.left,
      y: position.top,
      width: position.width,
      height: position.height,
      position: { left: position.left, top: position.top },
    });
  }
  function compactShow(id: SidePanelId) {
    for (const other of PANEL_IDS)
      if (other !== "canvas" && other !== id && panel(other).group.id !== "parking")
        move(other, ensureParking());
    const group = ensureGroup("compact-overlay");
    move(id, group);
    const position = clampWorkspaceRect(
      { left: 16, top: 16, width: 360, height: 480 },
      getBounds(),
      true,
    );
    group.api.locked = "no-drop-target";
    group.api.setConstraints({
      minimumWidth: position.width,
      maximumWidth: position.width,
      minimumHeight: position.height,
      maximumHeight: position.height,
    });
    setFloat(group, position);
    group.api.setVisible(true);
    panel(id).api.setActive();
    ensureParking();
  }
  function show(id: PanelId) {
    if (id === "canvas") {
      canvas().api.setActive();
      return;
    }
    if (desktop) {
      if (
        groupsIn(desktop.layout.grid.root)
          .find((g) => g.id === "parking")
          ?.views.includes(id)
      )
        pendingShows.add(id);
      compactShow(id);
      return;
    }
    api.exitMaximizedGroup();
    const item = panel(id);
    if (item.group.id === "parking") {
      const saved = returns[id];
      const existing = saved && getGroup(saved.group);
      if (existing && !["canvas", "parking", "compact-overlay"].includes(existing.id)) {
        existing.api.setVisible(true);
        move(id, existing, saved.index);
      } else if (saved?.position) {
        const target = ensureGroup(saved.group);
        move(id, target, saved.index);
        setFloat(target, clampWorkspaceRect(saved.position, getBounds()));
      } else move(id, defaultGroup(id));
    }
    item.api.setActive();
    ensureParking();
  }
  function float(id: PanelId) {
    if (desktop || id === "canvas") return;
    api.exitMaximizedGroup();
    const group = ensureGroup(`float-${id}`);
    move(id, group);
    setFloat(
      group,
      clampWorkspaceRect({ left: 32, top: 32, width: 360, height: 480 }, getBounds()),
    );
    panel(id).api.setActive();
    ensureParking();
  }
  function dock(id: PanelId, position: "left" | "right" | "below") {
    if (desktop || id === "canvas") return;
    api.exitMaximizedGroup();
    const group = ensureGroup(`dock-${id}`, "canvas", position);
    move(id, group);
    group.api.moveTo({
      group: canvas(),
      position: position === "below" ? "bottom" : position,
      skipSetActive: true,
    });
    group.api.setVisible(true);
    group.api.setSize(position === "below" ? { height: 260 } : { width: 300 });
    panel(id).api.setActive();
    ensureParking();
  }
  function tab(id: PanelId, target: PanelId) {
    if (desktop || id === "canvas" || target === "canvas") return;
    show(target);
    const group = panel(target).group;
    move(id, group);
    group.api.setVisible(true);
    const minimumWidth = Math.max(
      ...group.panels.map((p) => WORKBENCH_PANEL_REGISTRY[p.id as PanelId].minWidth),
    );
    const minimumHeight = Math.max(
      ...group.panels.map((p) => WORKBENCH_PANEL_REGISTRY[p.id as PanelId].minHeight),
    );
    group.api.setConstraints({
      minimumWidth: Math.max(minimumWidth, group.api.location.type === "floating" ? 320 : 0),
      minimumHeight: Math.max(minimumHeight, group.api.location.type === "floating" ? 320 : 0),
    });
    panel(id).api.setActive();
    ensureParking();
  }
  function replay(input: WorkspaceSnapshot) {
    const bounds = getBounds();
    const snapshot = sanitizeWorkspaceSnapshot(input, bounds);
    const tree = treeFromNode(snapshot.layout.grid.root, snapshot.layout.grid.orientation);
    if (!tree) throw new Error("Empty workspace tree");
    api.exitMaximizedGroup();
    // Media-query layout effects can run before Dockview's ResizeObserver.
    // Release temporary replay constraints against the current host, not its old compact size.
    api.layout(bounds.width, bounds.height);
    for (const id of PANEL_IDS) if (id !== "canvas") move(id, ensureParking());
    removeEmptyGroups(["parking"]);
    for (const step of insertionSteps(tree)) ensureGroup(step.id, step.reference, step.direction);
    const docked = groupsIn(snapshot.layout.grid.root);
    for (const group of docked) {
      if (group.id === "canvas" || group.id === "parking") continue;
      const target = getGroup(group.id);
      if (!target) throw new Error("Replay group is missing");
      group.views.forEach((id, index) => move(id, target, index));
      target.api.setVisible(true);
    }
    for (const floating of snapshot.layout.floatingGroups ?? []) {
      if (!floating.data) throw new Error("Invalid floating group");
      const target = ensureGroup(floating.data.id);
      floating.data.views.forEach((id, index) => move(id as PanelId, target, index));
      setFloat(target, floating.position as WorkspaceRect);
    }
    const parking = ensureParking();
    docked
      .find((group) => group.id === "parking")
      ?.views.forEach((id, index) => move(id, parking, index));
    returns = structuredClone(snapshot.returns);
    for (const group of [
      ...docked,
      ...(snapshot.layout.floatingGroups ?? []).flatMap((f) => (f.data ? [f.data] : [])),
    ]) {
      if (group.activeView && group.id !== "parking")
        api.getPanel(group.activeView)?.api.setActive();
    }
    getGroup(snapshot.layout.activeGroup ?? "canvas")?.api.setActive();
    sizeTree(tree, bounds);
    if (snapshot.layout.grid.maximizedNode) canvas().api.maximize();
    const actual = rawSnapshot();
    const actualTree = treeFromNode(actual.layout.grid.root, actual.layout.grid.orientation);
    if (!actualTree || JSON.stringify(shape(actualTree)) !== JSON.stringify(shape(tree)))
      throw new Error("Workspace replay changed the group tree");
    const expectedParking = docked.find((g) => g.id === "parking")?.views ?? [];
    if (
      JSON.stringify(getGroup("parking")?.panels.map((p) => p.id) ?? []) !==
      JSON.stringify(expectedParking)
    )
      throw new Error("Workspace replay changed hidden panels");
    const actualFloats = api.toJSON().floatingGroups ?? [];
    const expectedFloats = snapshot.layout.floatingGroups ?? [];
    if (actualFloats.length !== expectedFloats.length)
      throw new Error("Workspace replay changed floating groups");
    for (const expected of expectedFloats) {
      const actualFloat = actualFloats.find((f) => f.data?.id === expected.data?.id);
      if (
        !actualFloat?.data ||
        JSON.stringify(actualFloat.data.views) !== JSON.stringify(expected.data?.views) ||
        actualFloat.data.activeView !== expected.data?.activeView
      )
        throw new Error("Workspace replay changed floating tabs");
      const p = actualFloat.position,
        expectedPosition = expected.position as WorkspaceRect;
      const measured: WorkspaceRect = {
        width: p.width,
        height: p.height,
        left: "left" in p ? p.left : getBounds().width - p.right - p.width,
        top: "top" in p ? p.top : getBounds().height - p.bottom - p.height,
      };
      if (
        (["left", "top", "width", "height"] as const).some(
          (key) => Math.abs(measured[key] - expectedPosition[key]) > 1,
        )
      )
        throw new Error("Workspace floating replay exceeded one pixel tolerance");
    }
  }
  function sizeTree(tree: Tree, bounds: WorkspaceBounds) {
    const sizes = new Map<string, WorkspaceRect>();
    const limits = (node: Tree, dimension: "Width" | "Height", maximum = false): number => {
      if ("group" in node) {
        const group = getGroup(node.group.id)!;
        return maximum ? group[`maximum${dimension}`] : group[`minimum${dimension}`];
      }
      const values = node.children.map((child) => limits(child, dimension, maximum));
      const alongAxis = (node.axis === "HORIZONTAL") === (dimension === "Width");
      return alongAxis
        ? values.reduce((sum, size) => sum + size, 0)
        : maximum
          ? Math.min(...values)
          : Math.max(...values);
    };
    function measure(node: Tree, box: WorkspaceRect) {
      if ("group" in node) {
        sizes.set(node.group.id, box);
        return;
      }
      const dimension = node.axis === "HORIZONTAL" ? "Width" : "Height";
      const axis = node.axis === "HORIZONTAL" ? "width" : "height";
      const coordinate = node.axis === "HORIZONTAL" ? "left" : "top";
      const minimum = node.children.map((child) => limits(child, dimension));
      const maximum = node.children.map((child) => limits(child, dimension, true));
      let available = Math.max(
        box[axis],
        minimum.reduce((sum, size) => sum + size, 0),
      );
      const fixed = new Map<number, number>();
      // Redistribute only space left after a child hits its registry constraint.
      while (fixed.size < node.children.length) {
        const weight = node.children.reduce(
          (sum, child, index) => sum + (fixed.has(index) ? 0 : child.size || 1),
          0,
        );
        const unclamped = available;
        let changed = false;
        node.children.forEach((child, index) => {
          if (fixed.has(index)) return;
          const requested = (unclamped * (child.size || 1)) / weight;
          if (requested < minimum[index] || requested > maximum[index]) {
            const size = Math.min(maximum[index], Math.max(minimum[index], requested));
            fixed.set(index, size);
            available -= size;
            changed = true;
          }
        });
        if (!changed) {
          node.children.forEach((child, index) => {
            if (!fixed.has(index)) fixed.set(index, (available * (child.size || 1)) / weight);
          });
        }
      }
      let offset = box[coordinate];
      node.children.forEach((child, index) => {
        const size = fixed.get(index)!;
        measure(child, { ...box, [coordinate]: offset, [axis]: size });
        offset += size;
      });
    }
    measure(tree, { ...bounds, left: 0, top: 0 });
    const constraints = [...sizes].map(([id, rect]) => {
      const group = getGroup(id)!;
      return {
        group,
        rect,
        previous: {
          minimumWidth: group.minimumWidth,
          maximumWidth: group.maximumWidth,
          minimumHeight: group.minimumHeight,
          maximumHeight: group.maximumHeight,
        },
      };
    });
    // A leaf setSize only bubbles two levels in Dockview. Fixed leaf constraints
    // aggregate through every ancestor, so deep splits restore without private APIs.
    try {
      for (const { group, rect } of constraints) {
        group.api.setConstraints({
          minimumWidth: rect.width,
          maximumWidth: rect.width,
          minimumHeight: rect.height,
          maximumHeight: rect.height,
        });
        group.api.setSize({ width: rect.width, height: rect.height });
      }
    } finally {
      for (const { group, previous } of constraints) group.api.setConstraints(previous);
    }
    for (const { group, rect } of constraints) {
      if (
        Math.abs(group.api.width - rect.width) > 1 ||
        Math.abs(group.api.height - rect.height) > 1
      )
        throw new Error("Workspace replay exceeded one pixel tolerance");
      const actual = group.api.boundingBox;
      // jsdom has no client rectangles; the real browser gate also checks position.
      if (
        actual &&
        actual.width > 0 &&
        actual.height > 0 &&
        (Math.abs(actual.left - rect.left) > 1 || Math.abs(actual.top - rect.top) > 1)
      )
        throw new Error("Workspace replay changed group position");
    }
  }

  return {
    capture() {
      if (desktop) return structuredClone(desktop);
      return rawSnapshot();
    },
    restore(snapshot) {
      if (desktop) throw new Error("Desktop restore is disabled in compact mode");
      replay(snapshot);
    },
    recover(snapshot) {
      desktop = null;
      pendingShows.clear();
      replay(snapshot);
    },
    setReturns(value) {
      returns = structuredClone(value);
    },
    show,
    hide,
    dock,
    tab,
    float,
    applyPreset(preset) {
      if (desktop) return;
      if (preset === "focus") {
        if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
        else canvas().api.maximize();
      } else replay(createWorkspacePreset(preset, getBounds()));
    },
    enterCompact() {
      if (desktop) return;
      // The host may already be narrow while Dockview still contains the desktop tree.
      // Latch floating/return rectangles in that tree's coordinate space before projecting it.
      desktop = rawSnapshot({ width: api.width, height: api.height });
      pendingShows.clear();
      api.exitMaximizedGroup();
      for (const id of PANEL_IDS) if (id !== "canvas") move(id, ensureParking());
      ensureParking();
      canvas().api.setActive();
    },
    exitCompact() {
      if (!desktop) return false;
      const saved = desktop;
      // Keep the latch if replay throws: the caller enters read-only recovery and never writes the projection.
      replay(saved);
      desktop = null;
      const changed = pendingShows.size > 0;
      for (const id of pendingShows) show(id);
      pendingShows.clear();
      return changed;
    },
    resizeCompact() {
      const active = getGroup("compact-overlay")?.activePanel?.id;
      if (desktop && active && active !== "canvas") compactShow(active as SidePanelId);
    },
    isCompact: () => desktop !== null,
    isVisible: (id) => panel(id).group.id !== "parking" && panel(id).group.api.isVisible,
  };
}
