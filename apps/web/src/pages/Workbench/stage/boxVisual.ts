export const BOX_LABEL_FONT_PX = 12;
export const BOX_LABEL_PAD_PX = 4;
export const BOX_LABEL_OFFSET_PX = 24;
export const BOX_HANDLE_SCREEN_PX = 8;

// Konva Text 走 canvas 2D 绘制,canvas 的 font 串无法解析 CSS var();传
// `var(--font-sans, …)` 会让整个 font 串非法被静默拒绝,字号永远回退到默认 10px
// (标签「字号」设置失效,字形不随设置变化)。故标签字体必须是字面字体栈,与
// tokens.css 的 `--font` 对齐。
export const BOX_LABEL_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';

export const VIDEO_HANDLE_SIZE = 0.0065;
export const VIDEO_HANDLE_HIT_SIZE = VIDEO_HANDLE_SIZE * 1.1;
export const VIDEO_LABEL_WIDTH = 0.46;
export const VIDEO_LABEL_HEIGHT = 0.07;
export const VIDEO_LABEL_OFFSET = 0.043;
