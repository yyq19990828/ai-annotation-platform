/**
 * v0.10.17 · 工作台 ToolId → ToolUnitId 映射.
 *
 * 与后端 ``app/schemas/_jsonb_types.py`` 中的 ToolUnitId Literal 严格对齐.
 * AI 交互工具集 (smart-* / magic-box) 共享 ai_interactive unit; 区域工具
 * (polygon / mask) 共享 region; bbox 单独. hand / canvas 是辅助工具不持有
 * 类别 (返回 bbox 占位用于 fallback).
 */

import type { ToolUnitId } from "@/constants/toolUnits";
import type { ToolId } from "./index";

export const TOOL_TO_UNIT: Record<ToolId, ToolUnitId> = {
  box: "bbox",
  polygon: "region",
  polyline: "polyline",
  mask: "region",
  "smart-point": "ai_interactive",
  "smart-box": "ai_interactive",
  "text-prompt": "ai_interactive",
  exemplar: "ai_interactive",
  // v0.10.17 · Magic Box 复用 SAM 链路, 与其它 AI 工具共享 ai_interactive 单位.
  "magic-box": "ai_interactive",
  // hand / canvas 是视图 / 批注工具, 不归任何 unit; 给个占位 (兜底 bbox)
  hand: "bbox",
  canvas: "bbox",
};

export function toolUnitForTool(toolId: ToolId): ToolUnitId {
  return TOOL_TO_UNIT[toolId] ?? "bbox";
}
