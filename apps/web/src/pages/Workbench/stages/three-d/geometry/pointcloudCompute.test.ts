import { describe, expect, it, vi } from "vitest";

import type { SensorCalibration } from "@/types";
import type { CameraSample } from "./colorize";
import { colorizePointsAsync, colorizePointsOnMainThread } from "./pointcloudCompute";

const calib: SensorCalibration = {
  extrinsic: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  intrinsic: [10, 0, 1, 0, 10, 1, 0, 0, 1],
};

function sample(): CameraSample {
  return {
    calib,
    width: 3,
    height: 3,
    data: new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 20, 40, 60, 255, 0, 255,
      255, 255, 255, 0, 255, 255, 128, 128, 128, 255, 255, 255, 255, 255,
    ]),
  };
}

describe("colorizePointsAsync", () => {
  it("falls back to the synchronous implementation when workers are unavailable", async () => {
    const positions = new Float32Array([0, 0, 1, 0.1, 0, 1]);
    const base = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);

    const out = await colorizePointsAsync(positions, base, [sample()], { createWorker: null });
    const expected = colorizePointsOnMainThread(positions, base, [sample()]);

    expect(Array.from(out)).toEqual(Array.from(expected));
  });

  it("falls back when worker construction fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const positions = new Float32Array([0, 0, 1]);
    const out = await colorizePointsAsync(positions, null, [sample()], {
      createWorker: () => {
        throw new Error("blocked");
      },
    });
    const expected = colorizePointsOnMainThread(positions, null, [sample()]);

    expect(Array.from(out)).toEqual(Array.from(expected));
    expect(warn).toHaveBeenCalledWith(
      "[pointcloud-worker] fallback to main thread",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
