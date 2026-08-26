/**
 * 邻帧点云与当前帧共用 persistent worker + decoded-frame cache，只采用更激进的目标点数。
 * 返回 ISO ego 系 positions；调用方再用 frameRelMatrix 对齐到当前帧。
 */
import { loadDecodedPointCloudFrame } from "../pointCloudAssetCache";
import type { LidarAxisConvention } from "./axisConvention";

export async function loadNeighborPcdPositions(
  url: string,
  convention: LidarAxisConvention,
  targetCount: number,
  signal?: AbortSignal,
): Promise<Float32Array> {
  return (await loadDecodedPointCloudFrame(url, convention, targetCount, { signal })).positions;
}
