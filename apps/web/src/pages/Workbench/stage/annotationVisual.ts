// v0.15.27 · 标注视觉规格(单一来源):图片(Konva)与视频(SVG/DOM)两条渲染栈共用。
// 纯函数,不依赖 settings store / React;接收已解析的 common 视觉配置 + 形状上下文,
// 返回绘制原语(线宽 / 填充 alpha / 标签文本 / 标签门控)。机制差异(图片 /scale、视频
// non-scaling)只体现在各调用点最后一步,逻辑 / 默认值 / 参数在此收口。
import type { LabelContentToken } from "@/api/auth";

export type { LabelContentToken };

export type LabelVisibility = "always" | "selected" | "none";

/** 默认值单一来源(= 统一后基准;后端 schema 默认与之对齐)。 */
export const VISUAL_DEFAULTS = {
  labelFontSize: 12,
  strokeWidth: 1.5,
  fillOpacity: 0.07,
  fillOpacitySelected: 0.12,
} as const;

/** 选中态线宽在基值上的加成(图片 / 视频一致)。 */
export const SELECTED_STROKE_BONUS = 0.5;

/** 本模块消费的视觉子集(从 common 偏好抽取)。 */
export interface AnnotationVisualConfig {
  labelFontSize: number;
  strokeWidth: number;
  fillOpacity: number;
  fillOpacitySelected: number;
  labelVisibility: LabelVisibility;
  labelContent: LabelContentToken[];
}

/** 默认视觉配置(= VISUAL_DEFAULTS + 标签默认);用于无 common 上下文的回退(如测试 / 独立渲染)。 */
export const DEFAULT_ANNOTATION_VISUAL: AnnotationVisualConfig = {
  labelFontSize: VISUAL_DEFAULTS.labelFontSize,
  strokeWidth: VISUAL_DEFAULTS.strokeWidth,
  fillOpacity: VISUAL_DEFAULTS.fillOpacity,
  fillOpacitySelected: VISUAL_DEFAULTS.fillOpacitySelected,
  labelVisibility: "always",
  labelContent: ["class", "score"],
};

/** 从 common 偏好抽取视觉子集;窄化对象供 React.memo 稳定比较。 */
export function resolveAnnotationVisual(common: AnnotationVisualConfig): AnnotationVisualConfig {
  return {
    labelFontSize: common.labelFontSize,
    strokeWidth: common.strokeWidth,
    fillOpacity: common.fillOpacity,
    fillOpacitySelected: common.fillOpacitySelected,
    labelVisibility: common.labelVisibility,
    labelContent: common.labelContent,
  };
}

/** 线宽基值:选中 = base + 0.5。图片侧再 /scale,视频侧原样(screen px)。 */
export function strokeWidthFor(selected: boolean, cfg: Pick<AnnotationVisualConfig, "strokeWidth">): number {
  return selected ? cfg.strokeWidth + SELECTED_STROKE_BONUS : cfg.strokeWidth;
}

/** 填充 alpha:选中走 fillOpacitySelected,否则 fillOpacity。闭合形状用类别色 + 此 alpha。 */
export function fillAlpha(
  selected: boolean,
  cfg: Pick<AnnotationVisualConfig, "fillOpacity" | "fillOpacitySelected">,
): number {
  return selected ? cfg.fillOpacitySelected : cfg.fillOpacity;
}

/** 标签是否渲染:always | (selected && visibility==="selected") | none→false。 */
export function shouldShowLabel(selected: boolean, visibility: LabelVisibility): boolean {
  if (visibility === "none") return false;
  if (visibility === "selected") return selected;
  return true; // always
}

export interface LabelTextInput {
  /** 已 display 解析的类别名(始终显示,min:1 锚点)。 */
  className: string;
  /** 实例 / 分组 id;勾选 id 且非空时显示为 #id。 */
  instanceId?: string | number | null;
  /** 置信度 0..1;勾选 score 且 isAi 时显示为百分比(人工框 conf 恒为 1 无意义,故 isAi 门控)。 */
  confidence?: number | null;
  /** 属性字典;勾选 attrs 时压缩为 k=v(bool 真值只显示键名)。 */
  attributes?: Record<string, unknown> | null;
  isAi: boolean;
  /** AI 固有前缀(如 "✦ 模型 "),始终拼在 AI 标签前,不受 labelContent 控制。 */
  aiPrefix?: string;
}

/** 按 labelContent 勾选项组装标签文本;类别名无条件保留(min:1 兜底)。 */
export function buildLabelText(input: LabelTextInput, content: readonly LabelContentToken[]): string {
  const tokens: string[] = [input.className];
  if (content.includes("id") && input.instanceId != null && input.instanceId !== "") {
    tokens.push(`#${input.instanceId}`);
  }
  if (content.includes("score") && input.isAi && typeof input.confidence === "number") {
    tokens.push(`${Math.round(input.confidence * 100)}%`);
  }
  if (content.includes("attrs")) {
    const attrs = formatAttributes(input.attributes);
    if (attrs) tokens.push(attrs);
  }
  const core = tokens.join(" ");
  return input.isAi && input.aiPrefix ? `${input.aiPrefix}${core}` : core;
}

/** 属性压缩:跳过空值;bool 真值只显示键名,假值跳过;其余渲染为 key=value。 */
function formatAttributes(attrs?: Record<string, unknown> | null): string {
  if (!attrs) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === "") continue;
    if (typeof v === "boolean") {
      if (v) parts.push(k);
      continue;
    }
    parts.push(`${k}=${String(v)}`);
  }
  return parts.join(" ");
}
