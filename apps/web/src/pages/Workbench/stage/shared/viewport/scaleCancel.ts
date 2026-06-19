/**
 * 公共 viewport 原语 · scale 抵消(纯计算)。
 *
 * Konva 形状节点活在「已被 Stage scale 放大的世界坐标系」里,要让线宽 / 字号 / 控制点 /
 * dash 等视觉量在**屏幕**上恒定(不随缩放变粗变大),就得把屏幕像素量除以当前 scale 换算成
 * 世界量再喂给节点——即图片侧遍布的 `px / scale`。
 *
 * v0.16.x 画布栈统一地基:抽成单一命名原语,供图片现在、视频 v0.16.2 复用。语义等价旧的
 * 内联 `px / scale`,值不变;给它一个名字是为了两栈调用同一概念、迁移时不再各写一遍。
 */

/** 屏幕像素量 → 世界量(scale 抵消)。等价旧内联 `px / scale`。 */
export function screenToWorld(px: number, scale: number): number {
  return px / scale;
}

/** dash 数组的逐项 scale 抵消(等价 `[a/scale, b/scale, …]`)。 */
export function dashToWorld(dash: number[], scale: number): number[] {
  return dash.map((d) => d / scale);
}
