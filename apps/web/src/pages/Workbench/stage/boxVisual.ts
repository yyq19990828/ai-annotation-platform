export const BOX_LABEL_FONT_PX = 12;
export const BOX_LABEL_PAD_PX = 4;
/** 标牌底边与标注顶边之间的呼吸间隙(屏幕 px)。 */
export const BOX_LABEL_GAP_PX = 4;
export const BOX_HANDLE_SCREEN_PX = 8;

/**
 * 标签标牌锚点(左上角)相对标注顶边的向上偏移(世界坐标)。
 *
 * Label 锚点在左上角、标牌向下生长,高度 ≈ 字号 + 上下 padding;让偏移 = 标牌高 + 间隙,
 * 标牌底边便始终悬在标注顶边上方固定 GAP 处。偏移随字号自适应——字号调大时标牌也随之上移,
 * 不会插进标注框。(默认字号 12 + pad 4 + gap 4 = 24,与历史固定值一致,默认外观不变。)
 *
 * @param labelFontSizePx 配置字号(未除 scale 的原始屏幕 px)
 */
export function labelOffsetWorld(labelFontSizePx: number, scale: number): number {
  return (labelFontSizePx + 2 * BOX_LABEL_PAD_PX + BOX_LABEL_GAP_PX) / scale;
}

// Konva Text 走 canvas 2D 绘制,canvas 的 font 串无法解析 CSS var();传
// `var(--font-sans, …)` 会让整个 font 串非法被静默拒绝,字号永远回退到默认 10px
// (标签「字号」设置失效,字形不随设置变化)。故标签字体必须是字面字体栈,与
// 与全局 shadcn 字体 token 对齐。
export const BOX_LABEL_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
