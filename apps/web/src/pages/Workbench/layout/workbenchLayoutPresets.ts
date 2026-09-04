import {
  PANEL_IDS,
  PANEL_TITLES,
  clampWorkspaceRect,
  sanitizeWorkspaceSnapshot,
  type PanelId,
  type WorkspaceBounds,
  type WorkspaceContext,
  type WorkspaceNode,
  type WorkspaceSnapshot,
} from "./workbenchLayoutSnapshot";

export const WORKSPACE_PRESETS = [
  { id: "standard", title: "标准标注" },
  { id: "focus", title: "专注画布" },
  { id: "review", title: "审核协作" },
] as const;
export type WorkspacePresetId = (typeof WORKSPACE_PRESETS)[number]["id"];
export const DEFAULT_WORKSPACE_BOUNDS: WorkspaceBounds = { width: 1440, height: 800 };
export const PANEL_DEFAULT_POSITION = {
  "task-queue": "left",
  "class-palette": "left",
  inspector: "right",
  discussion: "below",
} as const;

function leaf(id: string, views: PanelId[], size: number, hidden = false): WorkspaceNode {
  return {
    type: "leaf",
    data: { id, views, ...(views.length ? { activeView: views[0] } : {}) },
    size,
    ...(hidden ? { visible: false } : {}),
  };
}
function branch(data: WorkspaceNode[], size: number): WorkspaceNode {
  return { type: "branch", data, size };
}

export function createWorkspacePreset(
  preset: WorkspacePresetId,
  bounds: WorkspaceBounds = DEFAULT_WORKSPACE_BOUNDS,
  _context?: WorkspaceContext,
): WorkspaceSnapshot {
  const { width, height } = bounds;
  const parking = leaf(
    "parking",
    preset === "review" ? ["task-queue", "class-palette"] : [],
    0,
    true,
  );
  const root =
    preset === "review"
      ? branch(
          [
            branch(
              [
                leaf("canvas", ["canvas"], width * 0.65),
                leaf("inspector", ["inspector"], width * 0.35),
              ],
              height * 0.7,
            ),
            leaf("discussion", ["discussion"], height * 0.3),
            parking,
          ],
          width,
        )
      : branch(
          [
            branch(
              [
                leaf("task-queue", ["task-queue"], height * 0.55),
                leaf("class-palette", ["class-palette"], height * 0.45),
              ],
              width * 0.15,
            ),
            leaf("canvas", ["canvas"], width * 0.7),
            branch(
              [
                leaf("inspector", ["inspector"], Math.min(360, height * 0.65)),
                leaf("discussion", ["discussion"], Math.max(height - 360, height * 0.35)),
              ],
              width * 0.15,
            ),
            parking,
          ],
          height,
        );
  return sanitizeWorkspaceSnapshot(
    {
      layout: {
        grid: {
          root,
          width,
          height,
          orientation: preset === "review" ? "VERTICAL" : "HORIZONTAL",
          ...(preset === "focus" ? { maximizedNode: { location: [1] } } : {}),
        },
        panels: Object.fromEntries(PANEL_IDS.map((id) => [id, { id, title: PANEL_TITLES[id] }])),
        activeGroup: "canvas",
      },
      returns:
        preset === "review"
          ? {
              "task-queue": { group: "task-queue", index: 0 },
              "class-palette": { group: "class-palette", index: 0 },
            }
          : {},
    },
    bounds,
  );
}

interface LegacyFloatingPanel {
  detached?: boolean;
  x?: number | null;
  y?: number | null;
  w?: number | null;
  h?: number | null;
}
export interface LegacyWorkbenchLayout {
  layout?: {
    leftOpen?: boolean;
    rightOpen?: boolean;
    discussionCollapsed?: boolean;
    floatingTaskQueue?: LegacyFloatingPanel;
    floatingClassPalette?: LegacyFloatingPanel;
    floatingInspector?: LegacyFloatingPanel;
    floatingDiscussion?: LegacyFloatingPanel;
  };
  common?: { leftWidthPct?: number; rightWidthPct?: number };
  rightSplitTop?: number;
}

/** One-way migration; legacy preferences remain untouched for frontend rollback. */
export function migrateLegacyWorkspace(
  legacy: LegacyWorkbenchLayout,
  bounds: WorkspaceBounds = DEFAULT_WORKSPACE_BOUNDS,
): WorkspaceSnapshot {
  const snapshot = createWorkspacePreset("standard", bounds);
  const root = snapshot.layout.grid.root;
  if (root.type !== "branch") return snapshot;
  const finiteOr = (value: number | null | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const left = Math.min(35, Math.max(10, finiteOr(legacy.common?.leftWidthPct, 15)));
  const right = Math.min(35, Math.max(10, finiteOr(legacy.common?.rightWidthPct, 15)));
  root.data[0].size = (bounds.width * left) / 100;
  root.data[1].size = (bounds.width * (100 - left - right)) / 100;
  root.data[2].size = (bounds.width * right) / 100;
  if (root.data[2].type === "branch") {
    const top = Math.min(bounds.height - 160, Math.max(160, finiteOr(legacy.rightSplitTop, 360)));
    root.data[2].data[0].size = top;
    root.data[2].data[1].size = bounds.height - top;
  }
  const parking = root.data[3];
  const source = legacy.layout ?? {};
  const states: [Exclude<PanelId, "canvas">, LegacyFloatingPanel | undefined, boolean][] = [
    ["task-queue", source.floatingTaskQueue, source.leftOpen !== false],
    ["class-palette", source.floatingClassPalette, source.leftOpen !== false],
    ["inspector", source.floatingInspector, source.rightOpen !== false],
    [
      "discussion",
      source.floatingDiscussion,
      source.rightOpen !== false && source.discussionCollapsed !== true,
    ],
  ];
  function detach(node: WorkspaceNode, id: PanelId): WorkspaceNode | null {
    if (node.type === "leaf") return node.data.views.includes(id) ? null : node;
    const children = node.data
      .map((n) => detach(n, id))
      .filter((n): n is WorkspaceNode => n !== null);
    return children.length ? { ...node, data: children } : null;
  }
  for (const [id, floating, visible] of states) {
    if (!floating?.detached && visible) continue;
    const next = detach(snapshot.layout.grid.root, id);
    if (next) snapshot.layout.grid.root = next;
    if (floating?.detached) {
      const position = clampWorkspaceRect(
        {
          left: finiteOr(floating.x, 32),
          top: finiteOr(floating.y, 32),
          width: finiteOr(floating.w, 360),
          height: finiteOr(floating.h, 480),
        },
        bounds,
      );
      (snapshot.layout.floatingGroups ??= []).push({
        data: { id, views: [id], activeView: id },
        position,
      });
    } else if (parking.type === "leaf") {
      parking.data.views.push(id);
      parking.data.activeView ??= id;
      snapshot.returns[id] = { group: id, index: 0 };
    }
  }
  return sanitizeWorkspaceSnapshot(snapshot, bounds);
}
