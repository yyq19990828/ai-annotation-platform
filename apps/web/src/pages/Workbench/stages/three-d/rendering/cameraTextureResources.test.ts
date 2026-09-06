import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SensorCalibration } from "@/types";

import { prepareCameraTextureResources } from "./cameraTextureResources";

const { release, acquireCameraBitmap, loadPointCloudDepthRasters } = vi.hoisted(() => ({
  release: vi.fn(),
  acquireCameraBitmap: vi.fn(),
  loadPointCloudDepthRasters: vi.fn(),
}));

vi.mock("../pointCloudAssetCache", () => ({
  acquireCameraBitmap: (...args: unknown[]) => acquireCameraBitmap(...args),
  loadPointCloudDepthRasters: (...args: unknown[]) => loadPointCloudDepthRasters(...args),
}));

vi.mock("../pointCloudTiming", () => ({
  markPointCloudStage: vi.fn(),
}));

const calibration: SensorCalibration = {
  extrinsic: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  intrinsic: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};

describe("prepareCameraTextureResources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acquireCameraBitmap.mockResolvedValue({
      bitmap: { width: 8, height: 8 } as ImageBitmap,
      cacheReady: true,
      release,
    });
    loadPointCloudDepthRasters.mockResolvedValue({
      rasters: [{ cols: 2, rows: 2, depth: new Float32Array([1, 2, 3, 4]) }],
      cacheHit: false,
    });
  });

  it("releases the CPU depth payload when disposed", async () => {
    const resources = await prepareCameraTextureResources(
      "https://assets.test/frame.pcd",
      new Float32Array([0, 0, 1]),
      [{ imageUrl: "https://assets.test/camera.jpg", calibration }],
    );
    const depthTexture = resources.samples[0].depthTexture;
    const dispose = vi.spyOn(depthTexture, "dispose");

    expect(depthTexture.image.data).toBeInstanceOf(Float32Array);
    resources.dispose();

    expect(dispose).toHaveBeenCalledOnce();
    expect(depthTexture.image.data).toBeNull();
    expect(release).toHaveBeenCalledOnce();

    resources.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});
