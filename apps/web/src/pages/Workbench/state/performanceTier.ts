import type { WorkbenchCommonPreferences } from "@/api/auth";

export type WorkbenchPerformanceTier = WorkbenchCommonPreferences["performanceTier"];

export interface WorkbenchPerformanceConfig {
  videoBitmapCache: number;
  /**
   * WebCodecs 精确帧已解码 bitmap 的字节预算上限(不预分配,仅作准入/淘汰阈值)。
   * 单张 bitmap 按 codedWidth*codedHeight*4(RGBA)估算占用。
   */
  videoDecoderBitmapCacheBytes: number;
  /** chunk 原始字节缓存的字节预算上限(按 ArrayBuffer.byteLength 计)。 */
  videoChunkByteCacheBytes: number;
  /** 暂停态同 GOP 方向感知预取帧数;0 表示不预取。 */
  videoDecodePrefetchFrames: number;
  previewCache: number;
  prefetchHalfWindow: number;
  anchorPrefetch: number;
  pcdDecimate: number;
}

const MIB = 1024 * 1024;

export const WORKBENCH_PERFORMANCE_TIERS: Record<
  WorkbenchPerformanceTier,
  WorkbenchPerformanceConfig
> = {
  light: {
    videoBitmapCache: 24,
    videoDecoderBitmapCacheBytes: 96 * MIB,
    videoChunkByteCacheBytes: 32 * MIB,
    videoDecodePrefetchFrames: 0,
    previewCache: 60,
    prefetchHalfWindow: 1,
    anchorPrefetch: 4,
    pcdDecimate: 250_000,
  },
  standard: {
    videoBitmapCache: 48,
    videoDecoderBitmapCacheBytes: 256 * MIB,
    videoChunkByteCacheBytes: 96 * MIB,
    videoDecodePrefetchFrames: 2,
    previewCache: 120,
    prefetchHalfWindow: 3,
    anchorPrefetch: 8,
    pcdDecimate: 500_000,
  },
  aggressive: {
    videoBitmapCache: 96,
    videoDecoderBitmapCacheBytes: 512 * MIB,
    videoChunkByteCacheBytes: 192 * MIB,
    videoDecodePrefetchFrames: 4,
    previewCache: 240,
    prefetchHalfWindow: 6,
    anchorPrefetch: 16,
    pcdDecimate: 1_000_000,
  },
};

export function resolveWorkbenchPerformanceTier(
  tier: WorkbenchPerformanceTier | null | undefined,
): WorkbenchPerformanceConfig {
  return WORKBENCH_PERFORMANCE_TIERS[tier ?? "standard"] ?? WORKBENCH_PERFORMANCE_TIERS.standard;
}
