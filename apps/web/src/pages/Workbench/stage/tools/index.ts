import type { Viewport } from "../../state/useViewportTransform";
import { BboxTool } from "./BboxTool";
import { HandTool } from "./HandTool";
import { PolygonTool } from "./PolygonTool";

export type ToolId = "box" | "hand" | "polygon";

export interface ToolMeta {
  id: ToolId;
  hotkey: string;
  label: string;
  icon: string;
  cursor: "crosshair" | "grab" | "default";
}

/** Drag 初始化负载：仅 stage 空白处按下能产生的两种。move / resize 由 KonvaBox 内部派生。 */
export type DragInit =
  | { kind: "draw"; sx: number; sy: number; cx: number; cy: number }
  | { kind: "pan"; sx: number; sy: number };

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
};

export const ALL_TOOLS: CanvasTool[] = [BboxTool, PolygonTool, HandTool];

export { BboxTool, HandTool, PolygonTool };
