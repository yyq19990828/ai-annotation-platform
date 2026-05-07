import type { Viewport } from "../../state/useViewportTransform";
import type { SamPolarity, SamSubTool } from "../../state/useWorkbenchState";
import { BboxTool } from "./BboxTool";
import { HandTool } from "./HandTool";
import { PolygonTool } from "./PolygonTool";
import { CanvasTool } from "./CanvasTool";
import { SamTool } from "./SamTool";

export type ToolId = "box" | "hand" | "polygon" | "canvas" | "sam";

export interface ToolMeta {
  id: ToolId;
  hotkey: string;
  label: string;
  icon: string;
  cursor: "crosshair" | "grab" | "default";
}

/** Drag 初始化负载：仅 stage 空白处按下能产生的几种。move / resize 由 KonvaBox 内部派生。 */
export type DragInit =
  | { kind: "draw"; sx: number; sy: number; cx: number; cy: number }
  /**
   * v0.9.2 · SAM 工具拖动负载.
   * v0.9.4 phase 2 · 加 mode 字段, 由子工具决定 (而非松手时按几何尺寸隐式分流).
   * mode="point": 单击产生 positive (alt=false) / negative (alt=true) point prompt.
   * mode="bbox":  拖框产生 bbox prompt (alt 无意义).
   */
  | {
      kind: "samProbe";
      mode: "point" | "bbox";
      sx: number;
      sy: number;
      cx: number;
      cy: number;
      alt: boolean;
    }
  | { kind: "pan"; sx: number; sy: number }
  | { kind: "canvasStroke"; points: number[] };

export interface PolygonDraftHandle {
  /** 当前草稿点（首次落点前为空数组）。 */
  points: [number, number][];
  /** 追加一个顶点。距离首点 <= closeDistance 时自动闭合提交。 */
  addPoint: (pt: [number, number]) => void;
  /** 闭合并提交 polygon（≥3 点；否则丢弃）。 */
  close: () => void;
  /** 取消当前草稿。 */
  cancel: () => void;
}

export interface ToolPointerContext {
  /** 已归一化到 [0,1] 的图像坐标。 */
  pt: { x: number; y: number };
  /** 原生 MouseEvent，用于读修饰键。 */
  evt: MouseEvent;
  vp: Viewport;
  activeClass: string;
  imgW: number;
  imgH: number;
  spacePan: boolean;
  readOnly: boolean;
  pendingDrawing: boolean;
  onClearSelection: () => void;
  /** 仅 PolygonTool 用：当前 polygon 绘制草稿。其它工具不消费此字段。 */
  polygonDraft?: PolygonDraftHandle;
  /** v0.9.4 phase 2 · 仅 SamTool 消费; 决定子工具 (point/bbox/text) 行为. */
  samSubTool?: SamSubTool;
  /** v0.9.4 phase 2 · 仅 SamTool 在 sam-point 子工具下消费. */
  samPolarity?: SamPolarity;
}

/** 画布工具接口。新增 polygon / keypoint 等类型时，实现此接口并注册到 TOOL_REGISTRY。 */
export interface CanvasTool extends ToolMeta {
  /** stage 空白处按下时调用；返回 DragInit 启动拖动，或 null 表示不处理。 */
  onPointerDown?: (ctx: ToolPointerContext) => DragInit | null;
}

export const TOOL_REGISTRY: Record<ToolId, CanvasTool> = {
  box: BboxTool,
  hand: HandTool,
  polygon: PolygonTool,
  canvas: CanvasTool,
  sam: SamTool,
};

// SAM 工具排在矩形 / polygon 之间，强调它是 AI 加速的"高级矩形"。canvas 仅用于评论批注，不放入 ToolDock。
export const ALL_TOOLS: CanvasTool[] = [BboxTool, SamTool, PolygonTool, HandTool];

export { BboxTool, HandTool, PolygonTool, CanvasTool, SamTool };
