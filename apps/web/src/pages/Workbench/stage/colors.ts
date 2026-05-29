import type { ClassesConfig } from "@/api/projects";

/**
 * 当前项目的 classes_config（颜色覆盖 + 排序）。WorkbenchShell 初始化项目时调用
 * setActiveClassesConfig；切项目时清空。所有 classColor() 默认查阅这里，
 * 避免每个调用点都向下传 config prop。
 */
let _activeConfig: ClassesConfig | undefined;
export function setActiveClassesConfig(c: ClassesConfig | undefined): void {
  _activeConfig = c;
}

export const CLASS_COLORS: Record<string, string> = {
  商品: "oklch(0.62 0.18 252)",
  价签: "oklch(0.65 0.18 152)",
  标识牌: "oklch(0.68 0.16 75)",
  缺货位: "oklch(0.62 0.20 25)",
  促销贴: "oklch(0.60 0.20 295)",
};

// 用户画完未指定类别时落库的 sentinel 类名，渲染为灰色框；后续可改类别。
export const UNKNOWN_CLASS = "__unknown";
export const UNKNOWN_CLASS_LABEL = "未分类";
const UNKNOWN_COLOR = "oklch(0.65 0 0)";

/** 类名展示函数: 把 sentinel `__unknown` 换成中文标签 `未分类`, 其他原样返回. */
export function displayClassName(name: string): string {
  return name === UNKNOWN_CLASS ? UNKNOWN_CLASS_LABEL : name;
}

// Canvas(Konva) 用的颜色：通过浏览器 CSS 引擎把 oklch 转换成 hex，并缓存结果。
const _canvasCache = new Map<string, string>();
function colorToHex(cssColor: string): string {
  if (_canvasCache.has(cssColor)) return _canvasCache.get(cssColor)!;
  try {
    const cvs = document.createElement("canvas");
    cvs.width = cvs.height = 1;
    const ctx = cvs.getContext("2d")!;
    ctx.fillStyle = cssColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    _canvasCache.set(cssColor, hex);
    return hex;
  } catch {
    return "#888888";
  }
}

export function classColorForCanvas(name: string, config?: ClassesConfig): string {
  return colorToHex(classColor(name, config));
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// FNV-1a 32-bit；输入相同输出固定，跨会话一致。
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function mixHash(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function classColor(name: string, config?: ClassesConfig): string {
  if (name === UNKNOWN_CLASS) return UNKNOWN_COLOR;
  // 优先级：显式传入 config > 模块级 _activeConfig（项目当前） > 内置预设 > hash 派生
  const cfg = (config ?? _activeConfig)?.[name];
  if (cfg?.color) return cfg.color;
  if (CLASS_COLORS[name]) return CLASS_COLORS[name];
  const hue = hashString(name) % 360;
  return `oklch(0.62 0.18 ${hue})`;
}

/**
 * Track 选色调色板（会话级覆盖用）。沿用 CLASS_COLORS 的 oklch 表达，
 * 与画布/类别色同源；这些是数据域颜色而非组件 CSS，不走 tokens.css 规则。
 */
export const TRACK_COLOR_PALETTE: { label: string; value: string }[] = [
  { label: "蓝", value: "oklch(0.62 0.18 252)" },
  { label: "绿", value: "oklch(0.65 0.18 152)" },
  { label: "橙", value: "oklch(0.68 0.16 75)" },
  { label: "红", value: "oklch(0.62 0.20 25)" },
  { label: "紫", value: "oklch(0.60 0.20 295)" },
  { label: "青", value: "oklch(0.64 0.14 200)" },
  { label: "粉", value: "oklch(0.68 0.18 350)" },
  { label: "灰", value: "oklch(0.65 0 0)" },
];

const TRACK_LIGHTNESS_BANDS = [0.56, 0.62, 0.68, 0.74] as const;
const TRACK_CHROMA_BANDS = [0.23, 0.20, 0.17, 0.14] as const;

export function defaultTrackColor(trackId: string, className: string): string {
  if (!trackId) return classColor(className);
  const hash = mixHash(hashString(`track:${trackId}`));
  const hue = ((hash & 0xffff) / 0x10000) * 360;
  const lightness = TRACK_LIGHTNESS_BANDS[(hash >>> 16) % TRACK_LIGHTNESS_BANDS.length];
  const chroma = TRACK_CHROMA_BANDS[(hash >>> 19) % TRACK_CHROMA_BANDS.length];
  return `oklch(${lightness.toFixed(2)} ${chroma.toFixed(2)} ${hue.toFixed(2)})`;
}

/**
 * Track 显示色：命中 session 级覆盖则用覆盖色，否则按 trackId 派生稳定色。
 * overrides 以 trackId 为键，值为调色板中的 oklch 字符串。
 */
export function getTrackColor(
  trackId: string,
  className: string,
  overrides?: Record<string, string>,
): string {
  const override = overrides?.[trackId];
  if (override) return override;
  return defaultTrackColor(trackId, className);
}

/** 按 classes_config.order 升序排序类别名（无 order 的排末尾）。 */
export function sortClassesByConfig(classes: string[], config?: ClassesConfig): string[] {
  if (!config) return classes;
  return classes.slice().sort((a, b) => {
    const oa = config[a]?.order ?? Number.POSITIVE_INFINITY;
    const ob = config[b]?.order ?? Number.POSITIVE_INFINITY;
    if (oa !== ob) return oa - ob;
    return classes.indexOf(a) - classes.indexOf(b); // 同 order 时保留输入顺序
  });
}
