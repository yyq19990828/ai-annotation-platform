export const CLASS_COLORS: Record<string, string> = {
  商品: "oklch(0.62 0.18 252)",
  价签: "oklch(0.65 0.18 152)",
  标识牌: "oklch(0.68 0.16 75)",
  缺货位: "oklch(0.62 0.20 25)",
  促销贴: "oklch(0.60 0.20 295)",
};

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
