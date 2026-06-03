/**
 * v0.13.5 · 三正交视图框精修的纯几何 (与 WebGL / renderer 无关, jsdom 可单测)。
 *
 * 三视图各对齐框 local 轴, 屏幕 (u, v) 映射两个 local 轴, 法线轴是第三个:
 *   - top   俯视 (看 -Z): u=X(length) v=Y(width)  方向线绕 Z → yaw   (rotation[2])
 *   - side  侧视 (看 -Y): u=X(length) v=Z(height) 方向线绕 Y → pitch (rotation[1])
 *   - front 正视 (看 -X): u=Y(width)  v=Z(height) 方向线绕 X → roll  (rotation[0])
 *
 * 口径: PSR 的 size 是 **全边长** (与 box3d.ts 一致, 非 SUSTechPOINTS 的半边长)。
 * 拖边改全边长 + 中心沿世界轴移半程; 拖角 = 两轴各拖一边; 方向线 = 绕 box-local 轴
 * 增量旋转 (四元数复合后分解回 XYZ 欧拉, 避免多轴耦合串轴)。
 */
import * as THREE from "three";

import { boxAxisWorldDir } from "./box3d";

type Vec3 = readonly [number, number, number];

export interface Psr {
  center: Vec3;
  size: Vec3;
  rotation: Vec3;
}

export type TriView = "top" | "side" | "front";

/** 每视图: 屏幕 u/v 映射的 box-local 轴 index, 法线(旋转)轴 index。 */
export const VIEW_AXES: Record<
  TriView,
  { u: 0 | 1 | 2; v: 0 | 1 | 2; normal: 0 | 1 | 2 }
> = {
  top: { u: 0, v: 1, normal: 2 },
  side: { u: 0, v: 2, normal: 1 },
  front: { u: 1, v: 2, normal: 0 },
};

/** 全边长下限 (米): 避免拖穿 / 负尺寸 (呼应渲染层的负 size 兜底)。 */
export const MIN_SIZE = 0.05;

function toVec3(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

/**
 * 拖一条边 (对侧固定)。
 * @param axis   box-local 轴 (0=X / 1=Y / 2=Z)
 * @param dir    拖的是 +axis 侧 (+1) 还是 -axis 侧 (-1)
 * @param dMeter 该边沿 local **+axis 世界方向** 的带符号位移 (米); 由上层把屏幕 delta / 缩放投到 +axis 得到
 *
 * 全边长 size[axis] += dir*dMeter (clamp 到 MIN_SIZE); 中心沿世界 +axis 方向移 dir*applied/2。
 */
export function dragEdge(
  psr: Psr,
  axis: 0 | 1 | 2,
  dir: 1 | -1,
  dMeter: number,
): Psr {
  const newSize = Math.max(MIN_SIZE, psr.size[axis] + dir * dMeter);
  const applied = newSize - psr.size[axis];
  const w = boxAxisWorldDir(psr.rotation, axis);
  const c = new THREE.Vector3(
    psr.center[0],
    psr.center[1],
    psr.center[2],
  ).addScaledVector(w, (dir * applied) / 2);
  const size: [number, number, number] = [
    psr.size[0],
    psr.size[1],
    psr.size[2],
  ];
  size[axis] = newSize;
  return { center: toVec3(c), size, rotation: psr.rotation };
}

/** 拖一个角 = u 轴 + v 轴各拖一条边 (中心矢量叠加, size 改两分量, 互不干扰)。 */
export function dragCorner(
  psr: Psr,
  axisU: 0 | 1 | 2,
  dirU: 1 | -1,
  dMeterU: number,
  axisV: 0 | 1 | 2,
  dirV: 1 | -1,
  dMeterV: number,
): Psr {
  return dragEdge(dragEdge(psr, axisU, dirU, dMeterU), axisV, dirV, dMeterV);
}

/**
 * 拖方向线: 绕该视图法线对应的 box-local 轴增量旋转 deltaTheta (弧度)。
 * 增量 → 四元数 local-space 复合 (右乘) → 分解回 XYZ 欧拉。纯 yaw 时退化为 rotation[2]+=dθ。
 */
export function dragRotation(psr: Psr, view: TriView, deltaTheta: number): Psr {
  const axis = VIEW_AXES[view].normal;
  const qOld = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(psr.rotation[0], psr.rotation[1], psr.rotation[2], "XYZ"),
  );
  const e = new THREE.Vector3(
    axis === 0 ? 1 : 0,
    axis === 1 ? 1 : 0,
    axis === 2 ? 1 : 0,
  );
  const qDelta = new THREE.Quaternion().setFromAxisAngle(e, deltaTheta);
  const qNew = qOld.multiply(qDelta); // local-space 复合 (右乘): 绕框自身轴转
  const euler = new THREE.Euler().setFromQuaternion(qNew, "XYZ");
  return {
    center: psr.center,
    size: psr.size,
    rotation: [euler.x, euler.y, euler.z],
  };
}
