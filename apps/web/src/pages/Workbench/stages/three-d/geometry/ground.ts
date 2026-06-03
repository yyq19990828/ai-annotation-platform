/**
 * v0.13.8.1 · 点云地面高度估计(纯函数,jsdom 可单测)。
 *
 * 历史:v0.13.3 用 z 直方图 1% 分位估地面,初衷是「对少量离群低点鲁棒」;
 * 实测在车顶 lidar 数据集偏低(零星远处雷达回波 / 反射噪声把分位拉到真地面以下),
 * 放新框 fallback 到地面平面时框总埋地下(用户报告 v0.13.8 实测)。
 *
 * 改用 z **中位数(50% 分位)**:对低端噪声极度鲁棒,只要"地面 + 物体"两类点云大致分布
 * 在 z 上半 / 下半即可工作;车顶 lidar 缺自车下方点云时,中位数大致落在车体中部高度,
 * 配合 v0.13.8.1 「射线优先打点云」(PointCloudScene.placeOnGround),fallback 路径
 * 仅在点击空地时触发,中位数偏高也比 1% 分位偏低更安全(框漂浮 < 框埋地下,
 * 都能用 Q 一键贴合纠正)。
 *
 * 实现:128 bin 直方图(避免排序 O(N log N)),累计到 count*0.5 的 bin 中心。
 */

/** 估计点云地面高度(米)。空输入返回 0。同高度集合返回该高度。 */
export function estimateGroundZ(positions: Float32Array, count: number): number {
  if (count === 0) return 0;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < count; i++) {
    const z = positions[i * 3 + 2];
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const span = zMax - zMin;
  if (span <= 0) return zMin;
  const BINS = 128;
  const hist = new Int32Array(BINS);
  for (let i = 0; i < count; i++) {
    const t = (positions[i * 3 + 2] - zMin) / span;
    const b = Math.min(BINS - 1, Math.floor(t * BINS));
    hist[b]++;
  }
  const target = count * 0.5;
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= target) return zMin + ((b + 0.5) / BINS) * span;
  }
  return zMin;
}
