import { describe, expect, it } from "vitest";
import { resolveContextToolbar } from "./workbenchContextToolbar";

const idle = {
  maskActive: false,
  interactiveActive: false,
  seedCollecting: false,
  editingPending: false,
  trackerReviewAvailable: false,
  secondaryAvailable: false,
  capabilityRecovery: false,
};

describe("context toolbar eligibility", () => {
  it("keeps background tracker results behind active Mask and AI tools", () => {
    expect(resolveContextToolbar({ ...idle, trackerReviewAvailable: true, maskActive: true })).toBe(
      "mask",
    );
    expect(
      resolveContextToolbar({ ...idle, trackerReviewAvailable: true, interactiveActive: true }),
    ).toBe("interactive");
  });
  it("does not show tracker decisions over a pending draft, candidate or class picker", () => {
    expect(
      resolveContextToolbar({ ...idle, trackerReviewAvailable: true, editingPending: true }),
    ).toBeNull();
    expect(resolveContextToolbar({ ...idle, trackerReviewAvailable: true })).toBe("tracker");
  });
  it("preserves seed collection without another AI or tracker toolbar", () => {
    expect(
      resolveContextToolbar({
        ...idle,
        seedCollecting: true,
        interactiveActive: true,
        trackerReviewAvailable: true,
        capabilityRecovery: true,
      }),
    ).toBeNull();
  });
  it("shows one usable secondary entry instead of capability recovery, but never over Mask", () => {
    expect(
      resolveContextToolbar({ ...idle, secondaryAvailable: true, capabilityRecovery: true }),
    ).toBe("secondary");
    expect(resolveContextToolbar({ ...idle, secondaryAvailable: true, maskActive: true })).toBe(
      "mask",
    );
    expect(resolveContextToolbar({ ...idle, capabilityRecovery: true })).toBe("recovery");
  });
});
