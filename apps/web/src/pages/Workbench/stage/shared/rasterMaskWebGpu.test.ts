import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateRasterMaskWebGpuBytes, RasterMaskWebGpuProvider } from "./rasterMaskWebGpu";

function createFakeGpu() {
  let resolveLost!: (info: GPUDeviceLostInfo) => void;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveLost = resolve;
  });
  let failWrites = false;
  const destroyedBuffers: Array<ReturnType<typeof vi.fn>> = [];
  const device = {
    queue: {
      writeBuffer: vi.fn(() => {
        if (failWrites) throw new Error("injected write failure");
      }),
      submit: vi.fn(),
    },
    lost,
    destroy: vi.fn(),
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: vi.fn(async () => ({ messages: [] })),
    })),
    createComputePipelineAsync: vi.fn(async () => ({
      getBindGroupLayout: vi.fn(() => ({})),
    })),
    createBuffer: vi.fn(({ size }: { size: number }) => {
      const destroy = vi.fn();
      destroyedBuffers.push(destroy);
      return {
        destroy,
        mapAsync: vi.fn(async () => undefined),
        getMappedRange: vi.fn((_offset = 0, rangeSize = size) => new ArrayBuffer(rangeSize)),
        unmap: vi.fn(),
      };
    }),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      })),
      copyBufferToBuffer: vi.fn(),
      finish: vi.fn(() => ({})),
    })),
  };
  const gpu = {
    requestAdapter: vi.fn(async () => ({ requestDevice: vi.fn(async () => device) })),
  } as unknown as GPU;
  return {
    gpu,
    device,
    destroyedBuffers,
    loseDevice: () =>
      resolveLost({ reason: "destroyed", message: "injected loss" } as GPUDeviceLostInfo),
    failWrites: () => {
      failWrites = true;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RasterMaskWebGpuProvider", () => {
  it("accounts for both JS packed planes and all persistent GPU buffers", () => {
    expect(estimateRasterMaskWebGpuBytes(2048, 2048)).toEqual({
      sourcePackedBytes: 524_288,
      xorPackedBytes: 524_288,
      sourceCapacityBytes: 524_288,
      xorCapacityBytes: 524_288,
      readbackCapacityBytes: 524_288,
      requiredBytes: 2_621_488,
    });
    expect(estimateRasterMaskWebGpuBytes(33, 1)).toEqual({
      sourcePackedBytes: 8,
      xorPackedBytes: 8,
      sourceCapacityBytes: 8,
      xorCapacityBytes: 8,
      readbackCapacityBytes: 8,
      requiredBytes: 88,
    });
    expect(() => estimateRasterMaskWebGpuBytes(0, 1)).toThrow(/positive integers/);
  });

  it("settles a missing navigator GPU once without allocating or retrying", async () => {
    const provider = new RasterMaskWebGpuProvider(null);
    expect(provider.snapshot()).toMatchObject({ state: "idle", initAttempts: 0 });
    expect(provider.warmup()).toBe("unavailable");
    expect(await provider.whenSettled()).toBe("unavailable");
    expect(
      await provider.runSquareDilateXor({
        sourceWords: new Uint32Array(1),
        sourceWordsPerRow: 1,
        inputWidth: 32,
        inputHeight: 1,
        coreOffsetX: 0,
        coreOffsetY: 0,
        coreWidth: 32,
        coreHeight: 1,
        radius: 1,
        budgetBytes: 1024,
      }),
    ).toEqual({
      ok: false,
      reason: "navigator-gpu-unavailable",
      attemptedGpu: false,
      allocatedBytes: 0,
    });
    expect(provider.snapshot()).toMatchObject({
      state: "unavailable",
      allocatedBytes: 0,
      initAttempts: 0,
      lastFailure: "navigator-gpu-unavailable",
    });
    provider.dispose();
    provider.dispose();
    expect(provider.snapshot()).toMatchObject({ state: "closed", allocatedBytes: 0 });
  });

  it("rejects unsupported kernels and byte budgets before initialization", async () => {
    const provider = new RasterMaskWebGpuProvider(null);
    await expect(
      provider.runSquareDilateXor({
        sourceWords: new Uint32Array(1),
        sourceWordsPerRow: 1,
        inputWidth: 32,
        inputHeight: 1,
        coreOffsetX: 0,
        coreOffsetY: 0,
        coreWidth: 32,
        coreHeight: 1,
        radius: 32,
        budgetBytes: 1024,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "unsupported-operation" });
    await expect(
      provider.runSquareDilateXor({
        sourceWords: new Uint32Array((2048 / 32) * 2048),
        sourceWordsPerRow: 2048 / 32,
        inputWidth: 2048,
        inputHeight: 2048,
        coreOffsetX: 0,
        coreOffsetY: 0,
        coreWidth: 2048,
        coreHeight: 2048,
        radius: 1,
        budgetBytes: 1024,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "budget-insufficient" });
    expect(provider.snapshot()).toMatchObject({ state: "idle", initAttempts: 0 });

    const exact = estimateRasterMaskWebGpuBytes(64, 8, 17, 3);
    expect(
      provider.preflightSquareDilateXor({
        inputWidth: 64,
        inputHeight: 8,
        coreWidth: 17,
        coreHeight: 3,
        radius: 1,
        budgetBytes: exact.requiredBytes - 1,
      }),
    ).toBe("budget-insufficient");
    expect(provider.snapshot()).toMatchObject({ state: "idle", initAttempts: 0 });
  });

  it("releases resources and enters a stable lost state when the device is lost", async () => {
    const fake = createFakeGpu();
    const provider = new RasterMaskWebGpuProvider(fake.gpu);
    expect(provider.warmup()).toBe("warming");
    expect(await provider.whenSettled()).toBe("ready");

    fake.loseDevice();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(provider.snapshot()).toMatchObject({
      state: "lost",
      allocatedBytes: 0,
      deviceLost: 1,
      lastFailure: "device-lost",
    });
    expect(fake.device.destroy).toHaveBeenCalledOnce();
  });

  it("uses independent source and core XOR capacities and reports stage metrics", async () => {
    vi.stubGlobal("GPUBufferUsage", {
      STORAGE: 1,
      COPY_DST: 2,
      COPY_SRC: 4,
      MAP_READ: 8,
      UNIFORM: 16,
    });
    vi.stubGlobal("GPUMapMode", { READ: 1 });
    const fake = createFakeGpu();
    const provider = new RasterMaskWebGpuProvider(fake.gpu);
    provider.warmup();
    expect(await provider.whenSettled()).toBe("ready");

    const result = await provider.runSquareDilateXor({
      sourceWords: new Uint32Array(16),
      sourceWordsPerRow: 2,
      inputWidth: 64,
      inputHeight: 8,
      coreOffsetX: 16,
      coreOffsetY: 2,
      coreWidth: 17,
      coreHeight: 3,
      radius: 1,
      budgetBytes: 1024,
    });

    expect(result).toMatchObject({
      ok: true,
      xorWordsPerRow: 1,
      snapshot: {
        sourceCapacityBytes: 64,
        xorCapacityBytes: 16,
        readbackCapacityBytes: 16,
        allocatedBytes: 144,
      },
      metrics: { gpuPassMs: null },
    });
    expect(fake.device.queue.writeBuffer).toHaveBeenCalledTimes(2);
    expect(fake.device.queue.submit).toHaveBeenCalledOnce();
    const buffersCreated = fake.device.createBuffer.mock.calls.length;
    await provider.runSquareDilateXor({
      sourceWords: new Uint32Array(16),
      sourceWordsPerRow: 2,
      inputWidth: 64,
      inputHeight: 8,
      coreOffsetX: 16,
      coreOffsetY: 2,
      coreWidth: 17,
      coreHeight: 3,
      radius: 1,
      budgetBytes: 1024,
    });
    expect(fake.device.createBuffer).toHaveBeenCalledTimes(buffersCreated);
    provider.dispose();
    expect(provider.snapshot()).toMatchObject({ state: "closed", allocatedBytes: 0 });
  });

  it("does not relabel an injected runtime failure as device loss", async () => {
    vi.stubGlobal("GPUBufferUsage", {
      STORAGE: 1,
      COPY_DST: 2,
      COPY_SRC: 4,
      MAP_READ: 8,
      UNIFORM: 16,
    });
    vi.stubGlobal("GPUMapMode", { READ: 1 });
    const fake = createFakeGpu();
    const provider = new RasterMaskWebGpuProvider(fake.gpu);
    provider.warmup();
    expect(await provider.whenSettled()).toBe("ready");
    fake.failWrites();

    await expect(
      provider.runSquareDilateXor({
        sourceWords: new Uint32Array(1),
        sourceWordsPerRow: 1,
        inputWidth: 32,
        inputHeight: 1,
        coreOffsetX: 0,
        coreOffsetY: 0,
        coreWidth: 32,
        coreHeight: 1,
        radius: 1,
        budgetBytes: 1024,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "gpu-runtime-failed",
      attemptedGpu: true,
      allocatedBytes: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(provider.snapshot()).toMatchObject({
      state: "unavailable",
      allocatedBytes: 0,
      deviceLost: 0,
      lastFailure: "gpu-runtime-failed",
    });
    expect(fake.destroyedBuffers).toHaveLength(4);
    expect(fake.destroyedBuffers.every((destroy) => destroy.mock.calls.length === 1)).toBe(true);
  });
});
