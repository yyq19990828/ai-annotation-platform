/**
 * 视频 VideoTool → 工具单位 / 单帧·轨迹变体 的集中映射 (对齐图片 stage/tools/toolUnits.ts)。
 *
 * 纠偏后视频每个几何是独立工具单位 (各自类别/属性 schema):
 *   矩形框 → bbox, 多边形 → region, 折线 → polyline。
 * 每单位的 `video_modes:{box(单帧), track}` 决定单帧/轨迹变体是否可用 (复刻 bbox 现有模式)。
 * 工具可用 ⇔ 单位已启用 且 该变体开关开 (video_modes 为 null 时两者均可用, 兼容老项目)。
 */

import type { ToolUnitId } from "@/constants/toolUnits";
import type { ToolBindings } from "@/api/projects";
import type { VideoTool } from "../state/useWorkbenchState";

/** box = 单帧几何, track = 轨迹几何 (跨帧关键帧)。 */
export type VideoVariant = "box" | "track";

export const VIDEO_TOOL_TARGET: Partial<
  Record<VideoTool, { unit: ToolUnitId; variant: VideoVariant }>
> = {
  box: { unit: "bbox", variant: "box" },
  track: { unit: "bbox", variant: "track" },
  polygon: { unit: "region", variant: "box" },
  "polygon-track": { unit: "region", variant: "track" },
  polyline: { unit: "polyline", variant: "box" },
  "polyline-track": { unit: "polyline", variant: "track" },
  // v0.21.23 · 交互式 SAM 工具按**产出几何**归属单位 (对齐图片侧 TOOL_TO_UNIT):
  // smart-point / smart-box 的候选采纳后落单帧 video_polygon → region 单位、box 变体。
  // **新增 AI 工具必须在此登记**, 否则 videoToolEnabled 的「未知工具 → true」(见下)
  // 会静默放行、绕过全部 tool_bindings 门控, 且 videoToolUnit 返回 null 会污染类选择器。
  "smart-point": { unit: "region", variant: "box" },
  "smart-box": { unit: "region", variant: "box" },
  exemplar: { unit: "region", variant: "box" },
};

/** 该视频工具落在哪个工具单位; select 等非几何工具返回 null。 */
export function videoToolUnit(t: VideoTool): ToolUnitId | null {
  return VIDEO_TOOL_TARGET[t]?.unit ?? null;
}

/**
 * 视频工具在给定 tool_bindings 下是否可用。
 * select 恒可用; 几何工具需其单位已启用且该变体 (单帧/轨迹) 开关开。
 * tool_bindings 为空 (老项目未 backfill) 时保守放行, 交由工作台其它兜底。
 */
export function videoToolEnabled(
  t: VideoTool,
  tb: ToolBindings | null | undefined,
): boolean {
  const target = VIDEO_TOOL_TARGET[t];
  if (!target) return true; // select / 未知工具
  if (!tb || Object.keys(tb).length === 0) return true; // 老项目兜底
  const binding = tb[target.unit];
  if (!binding?.enabled) return false;
  const vm = binding.video_modes;
  if (!vm) return true; // null = 单帧/轨迹均可用
  return target.variant === "box" ? (vm.box ?? true) : (vm.track ?? true);
}
