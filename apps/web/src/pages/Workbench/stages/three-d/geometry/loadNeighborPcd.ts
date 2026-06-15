/**
 * v0.15.18 · 邻帧点云叠加:加载单个邻帧 PCD,下采样 + 轴系归一化为 ISO ego 系。
 *
 * 与 PointCloudScene.loadPcd 同口径(下采样 stride + applyConventionToPositions),
 * 但目标点数更激进(邻帧仅作参考,不参与标注精度),且不算地面/色带/取景。
 * 返回 ISO ego 系下的 positions;调用方再用 frameRelMatrix 把整个点云对齐到当前帧。
 */
import { PCDLoader } from "three/examples/jsm/loaders/PCDLoader.js";
import type * as THREE from "three";
import {
  applyConventionToPositions,
  type LidarAxisConvention,
} from "./axisConvention";

export async function loadNeighborPcdPositions(
  url: string,
  convention: LidarAxisConvention,
  targetCount: number,
): Promise<Float32Array> {
  const loader = new PCDLoader();
  const loaded = await loader.loadAsync(url);
  const srcGeom = loaded.geometry;
  const srcPos = srcGeom.getAttribute("position") as THREE.BufferAttribute;
  const total = srcPos.count;

  const stride = total > targetCount ? Math.ceil(total / targetCount) : 1;
  const rendered = stride > 1 ? Math.floor(total / stride) : total;
  const positions = new Float32Array(rendered * 3);
  for (let i = 0, j = 0; i < total && j < rendered; i += stride, j++) {
    positions[j * 3] = srcPos.getX(i);
    positions[j * 3 + 1] = srcPos.getY(i);
    positions[j * 3 + 2] = srcPos.getZ(i);
  }
  srcGeom.dispose();
  applyConventionToPositions(positions, convention);
  return positions;
}
