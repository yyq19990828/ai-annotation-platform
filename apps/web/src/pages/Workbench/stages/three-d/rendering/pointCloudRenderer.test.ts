import { beforeEach, describe, expect, it } from "vitest";

import {
  POINT_CLOUD_WEBGPU_STORAGE_KEY,
  pointCloudRendererModeFromExperiment,
  readPointCloudWebGpuExperiment,
  writePointCloudWebGpuExperiment,
} from "./pointCloudRenderer";

describe("pointCloudRenderer experiment flag", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to legacy", () => {
    expect(readPointCloudWebGpuExperiment()).toBe(false);
    expect(pointCloudRendererModeFromExperiment(false)).toBe("legacy");
  });

  it("round-trips the local experimental flag", () => {
    writePointCloudWebGpuExperiment(true);
    expect(window.localStorage.getItem(POINT_CLOUD_WEBGPU_STORAGE_KEY)).toBe("1");
    expect(readPointCloudWebGpuExperiment()).toBe(true);
    expect(pointCloudRendererModeFromExperiment(true)).toBe("webgpu-experimental");

    writePointCloudWebGpuExperiment(false);
    expect(readPointCloudWebGpuExperiment()).toBe(false);
  });
});
