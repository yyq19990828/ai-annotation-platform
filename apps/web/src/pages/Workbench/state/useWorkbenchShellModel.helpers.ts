// v0.16.10 · 从 useWorkbenchShellModel.tsx 抽出的模块级纯函数(无 React hook、无闭包),
// 逐字搬运,行为零变化。主 hook 文件 import 回这些函数使用。
import { VARIANT_FIELD_KEYS } from "../components/SchemaForm";
import { TOOL_REGISTRY, type ToolId } from "../stage/tools";
import type { InteractivePrompt } from "./useBackendRouting";
import type { FloatingPanelRect } from "../shell/FloatingPanelShell";
import {
  FLOATING_SELECTION_MAX_SIZE,
  FLOATING_SELECTION_MIN_SIZE,
  SIDE_FLOATING_PANEL_MAX_SIZE,
  SIDE_FLOATING_PANEL_MIN_SIZE,
} from "../shell/floatingPanelSizing";
import type { FloatingPanelState, FloatingSelectionState } from "@/api/auth";

export const VARIANT_FIELD_SET = new Set<string>(VARIANT_FIELD_KEYS);

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export function omitVariantFields(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!value) return out;
  for (const [key, v] of Object.entries(value)) {
    if (!VARIANT_FIELD_SET.has(key)) out[key] = v;
  }
  return out;
}

export function buildPredictParams(
  params: Record<string, unknown> | undefined,
  modelVariants: Record<string, string>,
): Record<string, unknown> | undefined {
  const out = omitVariantFields(params);
  if (Object.keys(modelVariants).length > 0) {
    out.model_variants = modelVariants;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function resolveFloatingPanelRect(
  state: FloatingPanelState,
  defaults: {
    w: number;
    h: number;
    x: (viewportW: number, w: number) => number;
    y: (viewportH: number, h: number) => number;
  },
): FloatingPanelRect {
  const w = Math.max(
    SIDE_FLOATING_PANEL_MIN_SIZE.w,
    Math.min(SIDE_FLOATING_PANEL_MAX_SIZE.w, state.w ?? defaults.w),
  );
  const h = Math.max(
    SIDE_FLOATING_PANEL_MIN_SIZE.h,
    Math.min(SIDE_FLOATING_PANEL_MAX_SIZE.h, state.h ?? defaults.h),
  );
  const viewportW = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 800 : window.innerHeight;
  return {
    x: state.x ?? Math.max(24, defaults.x(viewportW, w)),
    y: state.y ?? Math.max(24, defaults.y(viewportH, h)),
    w,
    h,
  };
}

export function resolveFloatingTaskQueueRect(state: FloatingPanelState): FloatingPanelRect {
  return resolveFloatingPanelRect(state, {
    w: 320,
    h: 620,
    x: () => 24,
    y: () => 72,
  });
}

export function resolveFloatingClassPaletteRect(state: FloatingPanelState): FloatingPanelRect {
  return resolveFloatingPanelRect(state, {
    w: 320,
    h: 420,
    x: () => 24,
    y: (viewportH, h) => viewportH - h - 40,
  });
}

export function resolveFloatingInspectorRect(state: FloatingPanelState): FloatingPanelRect {
  return resolveFloatingPanelRect(state, {
    w: 360,
    h: 600,
    x: (viewportW, w) => viewportW - w - 40,
    y: (viewportH, h) => Math.min(80, viewportH - h - 24),
  });
}

export function resolveFloatingDiscussionRect(state: FloatingPanelState): FloatingPanelRect {
  return resolveFloatingPanelRect(state, {
    w: 420,
    h: 560,
    x: (viewportW, w) => viewportW - w - 40,
    y: (viewportH, h) => Math.min(260, viewportH - h - 40),
  });
}

// v0.16.8 · 选中标注浮动信息卡:默认贴画布右上(避开右栏);clamp 用选中卡专属尺寸界。
export function resolveFloatingSelectionRect(state: FloatingSelectionState): FloatingPanelRect {
  const w = Math.max(
    FLOATING_SELECTION_MIN_SIZE.w,
    Math.min(FLOATING_SELECTION_MAX_SIZE.w, state.w ?? 340),
  );
  const h = Math.max(
    FLOATING_SELECTION_MIN_SIZE.h,
    Math.min(FLOATING_SELECTION_MAX_SIZE.h, state.h ?? 440),
  );
  const viewportW = typeof window === "undefined" ? 1280 : window.innerWidth;
  return {
    x: state.x ?? Math.max(24, viewportW - w - 40),
    y: state.y ?? 88,
    w,
    h,
  };
}

// v0.14.18 · 工具 → 交互 prompt (text 已归批量线, 映射为 null = 非交互)。供交互后端路由解析。
export function promptOfTool(tool: ToolId): InteractivePrompt | null {
  const rp = TOOL_REGISTRY[tool]?.requiredPrompt;
  return rp && rp !== "text" ? rp : null;
}
