import type { Viewport } from "../../state/useViewportTransform";
import type { SamPolarity } from "../../state/useWorkbenchState";
import { BboxTool } from "./BboxTool";
import { HandTool } from "./HandTool";
import { PolygonTool } from "./PolygonTool";
import { CanvasTool } from "./CanvasTool";
import { SmartPointTool } from "./SmartPointTool";
import { SmartBoxTool } from "./SmartBoxTool";
import { TextPromptTool } from "./TextPromptTool";
import { ExemplarTool } from "./ExemplarTool";

// v0.10.2 · Prompt-first ToolDock 重构:
//   SAM 单工具拆为 4 个独立工具, 每个声明 requiredPrompt (point/bbox/text/exemplar) 由
//   useMLCapabilities 决定可用性. 旧 "sam" id 移除.
export type ToolId =
  | "box"
  | "hand"
  | "polygon"
  | "canvas"
  | "smart-point"
  | "smart-box"
  | "text-prompt"
  | "exemplar";

/** v0.10.2 · 后端 /setup.supported_prompts 字段对应的 prompt 类型集合. */
export type RequiredPrompt = "point" | "bbox" | "text" | "exemplar";

export interface ToolMeta {
  id: ToolId;
  hotkey: string;
  label: string;
  icon: string;
  cursor: "crosshair" | "grab" | "default";
}

/** Drag 初始化负载：仅 stage 空白处按下能产生的几种。 */
export type DragInit =
  | { kind: "draw"; sx: number; sy: number; cx: number; cy: number }
  /**
   * v0.9.2 · SAM 工具拖动负载.
   * v0.9.4 phase 2 · mode 由子工具决定, 不再按几何尺寸隐式分流.
   * v0.10.2 · 新增 "exemplar" 模式; ImageStage 在松手时按 mode 派发到 onSamPrompt.
   */
  | {
      kind: "samProbe";
      mode: "point" | "bbox" | "exemplar";
      sx: number;
      sy: number;
      cx: number;
      cy: number;
      alt: boolean;
    }
  | { kind: "pan"; sx: number; sy: number }
  | { kind: "canvasStroke"; points: number[] };

export interface PolygonDraftHandle {
  points: [number, number][];
  addPoint: (pt: [number, number]) => void;
  close: () => void;
  cancel: () => void;
}

export interface ToolPointerContext {
  pt: { x: number; y: number };
  evt: MouseEvent;
  vp: Viewport;
  activeClass: string;
  imgW: number;
  imgH: number;
  spacePan: boolean;
  readOnly: boolean;
  pendingDrawing: boolean;
  onClearSelection: () => void;
  /** 仅 PolygonTool 用. */
  polygonDraft?: PolygonDraftHandle;
  /** v0.10.2 · 仅 SmartPointTool 消费, "+/-" 极性 (与 Alt 修饰键合并). */
  samPolarity?: SamPolarity;
}

/** 画布工具接口。新增 polygon / keypoint 等类型时，实现此接口并注册到 TOOL_REGISTRY。 */
export interface CanvasTool extends ToolMeta {
  /**
   * v0.10.2 · 声明该工具需要的 backend prompt 能力 key.
   * 缺省 = 非 AI 工具, 永远可用; 否则按 useMLCapabilities.isPromptSupported 决定可用性.
   */
  requiredPrompt?: RequiredPrompt;
  onPointerDown?: (ctx: ToolPointerContext) => DragInit | null;
}

export const TOOL_REGISTRY: Record<ToolId, CanvasTool> = {
  box: BboxTool,
  hand: HandTool,
  polygon: PolygonTool,
  canvas: CanvasTool,
  "smart-point": SmartPointTool,
  "smart-box": SmartBoxTool,
  "text-prompt": TextPromptTool,
  exemplar: ExemplarTool,
};

/** v0.10.2 · ToolDock 渲染顺序:
 *   普通绘制 → 分隔 → AI 工具组 (按 prompt 范式排) → 分隔 → 视图工具.
 *   ToolDock 在 polygon/exemplar 后插入分组分隔; canvas 仅评论批注, 不入栏.
 */
export const ALL_TOOLS: CanvasTool[] = [
  BboxTool,
  PolygonTool,
  SmartPointTool,
  SmartBoxTool,
  TextPromptTool,
  ExemplarTool,
  HandTool,
];

/** v0.10.2 · 仅 AI 工具子集 (requiredPrompt 非空), 供 hotkey 循环和 AIToolDrawer 判定. */
export const AI_TOOLS: CanvasTool[] = ALL_TOOLS.filter((t) => !!t.requiredPrompt);
export const AI_TOOL_IDS: ToolId[] = AI_TOOLS.map((t) => t.id);

export function isAIToolId(id: ToolId): boolean {
  return AI_TOOL_IDS.includes(id);
}

export {
  BboxTool,
  HandTool,
  PolygonTool,
  CanvasTool,
  SmartPointTool,
  SmartBoxTool,
  TextPromptTool,
  ExemplarTool,
};
