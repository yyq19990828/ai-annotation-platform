import type { ReactNode } from "react";
import type { PanelId } from "./workbenchLayoutSnapshot";

export type WorkbenchPanelSlots = Record<PanelId, ReactNode>;
export interface WorkbenchWorkspaceCommands {
  show(id: PanelId): void;
  hide(id: PanelId): void;
  toggle(id: PanelId): void;
}
export interface WorkbenchWorkspaceState {
  taskQueueVisible: boolean;
  inspectorVisible: boolean;
  taskQueueWidth: number;
  inspectorWidth: number;
  disabled: boolean;
}

const PANEL_SCOPE = { modes: ["annotate", "review"], stages: ["image", "video", "3d"] } as const;
const SIDE_CAPABILITIES = { dock: true, tab: true, float: true, hide: true } as const;

export const WORKBENCH_PANEL_REGISTRY = {
  canvas: {
    ...PANEL_SCOPE,
    capabilities: { dock: false, tab: false, float: false, hide: false },
    id: "canvas",
    title: "画布",
    renderer: "always",
    defaultPosition: "center",
    minWidth: 480,
    minHeight: 320,
    width: 800,
    height: 600,
    closable: false,
  },
  "task-queue": {
    ...PANEL_SCOPE,
    capabilities: SIDE_CAPABILITIES,
    id: "task-queue",
    title: "任务队列",
    renderer: "onlyWhenVisible",
    defaultPosition: "left",
    minWidth: 180,
    minHeight: 120,
    width: 220,
    height: 360,
    closable: false,
  },
  "class-palette": {
    ...PANEL_SCOPE,
    capabilities: SIDE_CAPABILITIES,
    id: "class-palette",
    title: "类别面板",
    renderer: "onlyWhenVisible",
    defaultPosition: "left",
    minWidth: 180,
    minHeight: 120,
    width: 220,
    height: 240,
    closable: false,
  },
  inspector: {
    ...PANEL_SCOPE,
    capabilities: SIDE_CAPABILITIES,
    id: "inspector",
    title: "标注详情",
    renderer: "always",
    defaultPosition: "right",
    minWidth: 220,
    minHeight: 160,
    width: 260,
    height: 360,
    closable: false,
  },
  discussion: {
    ...PANEL_SCOPE,
    capabilities: SIDE_CAPABILITIES,
    id: "discussion",
    title: "讨论 / Issue",
    renderer: "always",
    defaultPosition: "below",
    minWidth: 220,
    minHeight: 160,
    width: 260,
    height: 240,
    closable: false,
  },
} as const satisfies Record<
  PanelId,
  {
    id: PanelId;
    title: string;
    renderer: "always" | "onlyWhenVisible";
    defaultPosition: string;
    minWidth: number;
    minHeight: number;
    width: number;
    height: number;
    closable: false;
    modes: readonly string[];
    stages: readonly string[];
    capabilities: { dock: boolean; tab: boolean; float: boolean; hide: boolean };
  }
>;

export const PERIPHERAL_PANELS = [
  "task-queue",
  "class-palette",
  "inspector",
  "discussion",
] as const;
