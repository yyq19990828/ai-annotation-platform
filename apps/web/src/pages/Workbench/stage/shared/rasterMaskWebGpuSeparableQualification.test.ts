import { describe, expect, it } from "vitest";
import {
  estimateRasterMaskWebGpuSeparableBytes,
  RasterMaskWebGpuSeparableQualificationProvider,
} from "./rasterMaskWebGpuSeparableQualification";

describe("RasterMaskWebGpuSeparableQualificationProvider", () => {
  it("accounts for the horizontal intermediate and every persistent buffer", () => {
    expect(estimateRasterMaskWebGpuSeparableBytes(2048, 2048)).toEqual({
      sourcePackedBytes: 524_288,
      xorPackedBytes: 524_288,
      intermediateLogicalBytes: 524_288,
      sourceCapacityBytes: 524_288,
      xorCapacityBytes: 524_288,
      readbackCapacityBytes: 524_288,
      intermediateCapacityBytes: 524_288,
      allocatedCapacityBytes: 2_097_200,
      requiredBytes: 3_670_064,
    });
    expect(estimateRasterMaskWebGpuSeparableBytes(65, 3, 33, 2)).toEqual({
      sourcePackedBytes: 36,
      xorPackedBytes: 16,
      intermediateLogicalBytes: 24,
      sourceCapacityBytes: 64,
      xorCapacityBytes: 16,
      readbackCapacityBytes: 16,
      intermediateCapacityBytes: 32,
      allocatedCapacityBytes: 176,
      requiredBytes: 252,
    });
    expect(() => estimateRasterMaskWebGpuSeparableBytes(0, 1)).toThrow(/positive integers/);
  });

  it("fails closed without navigator.gpu and remains allocation-free", async () => {
    const provider = new RasterMaskWebGpuSeparableQualificationProvider(null);
    await provider.initialize();
    expect(provider.snapshot()).toEqual({
      state: "unavailable",
      allocatedBytes: 0,
      sourceCapacityBytes: 0,
      xorCapacityBytes: 0,
      readbackCapacityBytes: 0,
      intermediateCapacityBytes: 0,
      failure: "navigator.gpu unavailable",
    });
    provider.dispose();
    expect(provider.snapshot()).toMatchObject({ state: "closed", allocatedBytes: 0 });
  });
});
