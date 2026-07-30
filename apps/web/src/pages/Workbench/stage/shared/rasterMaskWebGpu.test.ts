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
        getMappedRange: vi.fn(() => new ArrayBuffer(size)),
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
      packedBytes: 524_288,
      requiredBytes: 2_621_456,
    });
    expect(estimateRasterMaskWebGpuBytes(33, 1)).toEqual({
      packedBytes: 8,
      requiredBytes: 56,
    });
    expect(() => estimateRasterMaskWebGpuBytes(0, 1)).toThrow(/positive integers/);
  });

  it("settles a missing navigator GPU once without allocating or retrying", async () => {
    const provider = new RasterMaskWebGpuProvider(null);
    expect(provider.snapshot()).toMatchObject({ state: "idle", initAttempts: 0 });
    expect(provider.warmup()).toBe("unavailable");
    expect(await provider.whenSettled()).toBe("unavailable");
    expect(
      await provider.runSquareDilate({
        alpha: new Uint8Array(32),
        width: 32,
        height: 1,
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
      provider.runSquareDilate({
        alpha: new Uint8Array(32),
        width: 32,
        height: 1,
        radius: 32,
        budgetBytes: 1024,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "unsupported-operation" });
    await expect(
      provider.runSquareDilate({
        alpha: new Uint8Array(2048 * 2048),
        width: 2048,
        height: 2048,
        radius: 1,
        budgetBytes: 1024,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "budget-insufficient" });
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
      provider.runSquareDilate({
        alpha: new Uint8Array(32),
        width: 32,
        height: 1,
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
