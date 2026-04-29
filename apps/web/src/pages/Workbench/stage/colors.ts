export const CLASS_COLORS: Record<string, string> = {
  商品: "oklch(0.62 0.18 252)",
  价签: "oklch(0.65 0.18 152)",
  标识牌: "oklch(0.68 0.16 75)",
  缺货位: "oklch(0.62 0.20 25)",
  促销贴: "oklch(0.60 0.20 295)",
};

// Canvas(Konva) 用的颜色：通过浏览器 CSS 引擎把 oklch 转换成 hex，并缓存结果。
const _canvasCache = new Map<string, string>();
function oklchToHex(cssColor: string): string {
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

export function classColorForCanvas(name: string): string {
  return oklchToHex(classColor(name));
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

export function classColor(name: string): string {
  if (CLASS_COLORS[name]) return CLASS_COLORS[name];
  // 项目类别 > 5 时按名称 hash 落到 OKLCH 色环；同名跨会话稳定。
  const hue = hashString(name) % 360;
  return `oklch(0.62 0.18 ${hue})`;
}
