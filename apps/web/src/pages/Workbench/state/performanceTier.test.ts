import { describe, expect, it } from "vitest";

import { resolveWorkbenchPerformanceTier, WORKBENCH_PERFORMANCE_TIERS } from "./performanceTier";

describe("workbench performance tiers", () => {
  it("keeps standard equal to the previous hardcoded cache and decimation defaults", () => {
    expect(WORKBENCH_PERFORMANCE_TIERS.standard).toEqual({
      videoBitmapCache: 48,
      videoDecoderCache: 48,
      previewCache: 120,
      prefetchHalfWindow: 3,
      anchorPrefetch: 8,
      pcdDecimate: 500_000,
    });
  });

  it("falls back to standard for empty input", () => {
    expect(resolveWorkbenchPerformanceTier(null)).toBe(WORKBENCH_PERFORMANCE_TIERS.standard);
  });
});
