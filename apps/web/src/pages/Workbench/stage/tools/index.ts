import type { KonvaEventObject } from "konva/lib/Node";
import type { Viewport } from "../../state/useViewportTransform";

export type ToolId = "box" | "hand";

export interface ToolContext {
  /** 从 client 坐标换算到图像归一化坐标。 */
  toImg: (clientX: number, clientY: number) => { x: number; y: number } | null;
  vp: Viewport;
  activeClass: string;
  imgW: number;
  imgH: number;
}

/** 画布工具接口。新增 polygon / keypoint 等类型时，实现此接口并注册，无需修改 ImageStage 外壳。 */
export interface CanvasTool {
  id: ToolId;
  /** 热键标识（供 HotkeyCheatSheet 使用）。 */
  hotkey: string;
  onMouseDown?: (e: KonvaEventObject<MouseEvent>, ctx: ToolContext) => void;
  onMouseMove?: (e: KonvaEventObject<MouseEvent>, ctx: ToolContext) => void;
  onMouseUp?: (e: KonvaEventObject<MouseEvent>, ctx: ToolContext) => void;
}

// ── BboxTool ─────────────────────────────────────────────────────────────────
// 当前 ImageStage 内联了 bbox 和 hand 的逻辑（v0.5.0 行为兼容保持简单）。
// v0.5.1 新增 polygon 工具时，将 bbox/hand 的逻辑迁移到这里，
// ImageStage 改为从注册表读取 activeTool。

export const BBOX_TOOL: CanvasTool = {
  id: "box",
  hotkey: "B",
};

export const HAND_TOOL: CanvasTool = {
  id: "hand",
  hotkey: "V",
};

export const ALL_TOOLS: CanvasTool[] = [BBOX_TOOL, HAND_TOOL];
