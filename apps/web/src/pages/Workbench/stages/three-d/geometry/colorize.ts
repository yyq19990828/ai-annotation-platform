/**
 * v0.13.6 · 点云 RGB 上色纯函数:把相机像素颜色「喷」到点云。
 *
 * 对每个点投影到各标定相机像面(与 projection.ts 同口径:行主序 extrinsic·[x,y,z,1]
 * → 可选 rect → intrinsic·xyz → 透视除法),落在图内且在相机前方(depth>0)即候选;
 * 多候选取**归一化图像中心距最小**者(最居中 = 镜头畸变最小、最可靠,且不同分辨率可比),
 * 采样该像素 RGB。无任何相机覆盖的点 → 保留原色(高度色带或灰)。
 *
 * MVP **不做遮挡**(无 per-camera z-buffer):背景点可能投到前景同一像素被染成前景色。
 * 投影单点内联展开(不走 projection.ts 的数组版),避开 1e6 点逐点建数组的分配开销。
 */
import type { SensorCalibration } from "@/types";

/** 一个相机的采样输入:标定 + 原图分辨率 + RGBA 像素 buffer(来自 canvas.getImageData)。 */
export interface CameraSample {
  calib: SensorCalibration;
  /** 原图宽高(像素);intrinsic 基于原图分辨率。 */
  width: number;
  height: number;
  /** RGBA,长度 = width*height*4(行主序,原点左上)。 */
  data: Uint8ClampedArray;
}

/** 单点投影到相机:返回像素 (u,v) 与相机系深度(intrinsic 末行 [0,0,1] ⇒ w=z)。 */
function projectOne(
  x: number,
  y: number,
  z: number,
  calib: SensorCalibration,
): { u: number; v: number; depth: number } {
  const { extrinsic: e, intrinsic: k, rect } = calib;
  // extrinsic 4x4 · [x,y,z,1](末行 [0,0,0,1] ⇒ 齐次 w=1,无需再除)。
  let c0 = e[0] * x + e[1] * y + e[2] * z + e[3];
  let c1 = e[4] * x + e[5] * y + e[6] * z + e[7];
  let c2 = e[8] * x + e[9] * y + e[10] * z + e[11];
  if (rect) {
    const r0 = rect[0] * c0 + rect[1] * c1 + rect[2] * c2 + rect[3];
    const r1 = rect[4] * c0 + rect[5] * c1 + rect[6] * c2 + rect[7];
    const r2 = rect[8] * c0 + rect[9] * c1 + rect[10] * c2 + rect[11];
    c0 = r0;
    c1 = r1;
    c2 = r2;
  }
  // intrinsic 3x3 · [c0,c1,c2] → [u,v,w]。
  const uu = k[0] * c0 + k[1] * c1 + k[2] * c2;
  const vv = k[3] * c0 + k[4] * c1 + k[5] * c2;
  const ww = k[6] * c0 + k[7] * c1 + k[8] * c2;
  if (ww === 0) return { u: NaN, v: NaN, depth: 0 };
  return { u: uu / ww, v: vv / ww, depth: ww };
}

/**
 * 逐点上色。返回与 positions 等长(N*3)的 RGB Float32Array(0..1)。
 * @param positions  点坐标 Float32Array(N*3,lidar/world 系,与标定同系)。
 * @param originalColors  原色(N*3),无相机覆盖的点回退到它;null 则回退中性灰。
 * @param cameras  有标定的相机采样集(空 → 全部点取原色)。
 */
export function colorizePoints(
  positions: Float32Array,
  originalColors: Float32Array | null,
  cameras: CameraSample[],
): Float32Array {
  const n = (positions.length / 3) | 0;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i];
    const y = positions[3 * i + 1];
    const z = positions[3 * i + 2];

    let best = -1;
    let bestU = 0;
    let bestV = 0;
    let bestScore = Infinity;
    for (let c = 0; c < cameras.length; c++) {
      const cam = cameras[c];
      const { u, v, depth } = projectOne(x, y, z, cam.calib);
      if (depth <= 0) continue; // 相机后方
      if (u < 0 || u >= cam.width || v < 0 || v >= cam.height) continue; // 出框
      const du = (u - cam.width / 2) / cam.width;
      const dv = (v - cam.height / 2) / cam.height;
      const score = du * du + dv * dv; // 归一化中心距²
      if (score < bestScore) {
        bestScore = score;
        best = c;
        bestU = u;
        bestV = v;
      }
    }

    if (best >= 0) {
      const cam = cameras[best];
      const px = Math.min(cam.width - 1, Math.max(0, Math.round(bestU)));
      const py = Math.min(cam.height - 1, Math.max(0, Math.round(bestV)));
      const idx = (py * cam.width + px) * 4;
      out[3 * i] = cam.data[idx] / 255;
      out[3 * i + 1] = cam.data[idx + 1] / 255;
      out[3 * i + 2] = cam.data[idx + 2] / 255;
    } else if (originalColors) {
      out[3 * i] = originalColors[3 * i];
      out[3 * i + 1] = originalColors[3 * i + 1];
      out[3 * i + 2] = originalColors[3 * i + 2];
    } else {
      out[3 * i] = 0.5;
      out[3 * i + 1] = 0.5;
      out[3 * i + 2] = 0.5;
    }
  }
  return out;
}
