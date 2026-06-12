import type { WorkbenchCommonPreferences } from "@/api/auth";

export type WorkbenchPerformanceTier = WorkbenchCommonPreferences["performanceTier"];

export interface WorkbenchPerformanceConfig {
  videoBitmapCache: number;
  videoDecoderCache: number;
  previewCache: number;
  prefetchHalfWindow: number;
  anchorPrefetch: number;
  pcdDecimate: number;
}

export const WORKBENCH_PERFORMANCE_TIERS: Record<WorkbenchPerformanceTier, WorkbenchPerformanceConfig> = {
  light: {
    videoBitmapCache: 24,
    videoDecoderCache: 24,
    previewCache: 60,
    prefetchHalfWindow: 1,
    anchorPrefetch: 4,
    pcdDecimate: 250_000,
  },
  standard: {
    videoBitmapCache: 48,
    videoDecoderCache: 48,
    previewCache: 120,
    prefetchHalfWindow: 3,
    anchorPrefetch: 8,
    pcdDecimate: 500_000,
  },
  aggressive: {
    videoBitmapCache: 96,
    videoDecoderCache: 96,
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
