import type { RasterMaskWebGpuFallbackReason } from "./rasterMaskWorkerProtocol";

const PARAMS_BYTES = 16;
const GPU_BUFFER_COUNT = 3;

export type RasterMaskWebGpuState =
  | "idle"
  | "warming"
  | "ready"
  | "unavailable"
  | "lost"
  | "closed";

export interface RasterMaskWebGpuSnapshot {
  state: RasterMaskWebGpuState;
  allocatedBytes: number;
  capacityBytes: number;
  initAttempts: number;
  deviceLost: number;
  lastFailure: RasterMaskWebGpuFallbackReason | null;
}

export type RasterMaskWebGpuRunResult =
  | {
      ok: true;
      words: Uint32Array;
      wordsPerRow: number;
      computeMs: number;
      allocatedBytes: number;
    }
  | {
      ok: false;
      reason: RasterMaskWebGpuFallbackReason;
      attemptedGpu: boolean;
      allocatedBytes: number;
    };

interface RasterMaskWebGpuBuffers {
  source: GPUBuffer;
  target: GPUBuffer;
  readback: GPUBuffer;
  params: GPUBuffer;
  bindGroup: GPUBindGroup;
  capacityBytes: number;
}

interface RasterMaskWebGpuResources {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  buffers: RasterMaskWebGpuBuffers | null;
}

export function estimateRasterMaskWebGpuBytes(
  width: number,
  height: number,
): {
  packedBytes: number;
  requiredBytes: number;
} {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error("WebGPU Raster Mask dimensions must be positive integers");
  }
  const packedBytes = Math.ceil(width / 32) * height * 4;
  if (!Number.isSafeInteger(packedBytes)) {
    throw new Error("WebGPU Raster Mask packed plane exceeds the safe byte limit");
  }
  return {
    packedBytes,
    // JS source/output words + GPU source/target/readback + one uniform buffer.
    requiredBytes: packedBytes * 5 + PARAMS_BYTES,
  };
}

function nextBufferCapacity(requiredBytes: number): number {
  let capacity = 4;
  while (capacity < requiredBytes) capacity *= 2;
  return capacity;
}

function packRasterMaskRows(
  alpha: Uint8Array,
  width: number,
  height: number,
  wordsPerRow: number,
): Uint32Array {
  if (alpha.length !== width * height) {
    throw new Error("WebGPU Raster Mask alpha does not match its dimensions");
  }
  const words = new Uint32Array(wordsPerRow * height);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * width;
    const targetRow = y * wordsPerRow;
    for (let x = 0; x < width; x += 1) {
      if (alpha[sourceRow + x] !== 0) words[targetRow + (x >>> 5)] |= 1 << (x & 31);
    }
  }
  return words;
}

const SQUARE_DILATE_SHADER = `
struct Params {
  width: u32,
  height: u32,
  words_per_row: u32,
  radius: u32,
}

@group(0) @binding(0) var<storage, read> source: array<u32>;
@group(0) @binding(1) var<storage, read_write> target_words: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

fn source_word(y: i32, word_x: i32) -> u32 {
  if (y < 0 || y >= i32(params.height) || word_x < 0 || word_x >= i32(params.words_per_row)) {
    return 0u;
  }
  return source[u32(y) * params.words_per_row + u32(word_x)];
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.words_per_row || id.y >= params.height) {
    return;
  }
  var output_word = 0u;
  var dy = -i32(params.radius);
  loop {
    if (dy > i32(params.radius)) {
      break;
    }
    let word_x = i32(id.x);
    let center = source_word(i32(id.y) + dy, word_x);
    let previous = source_word(i32(id.y) + dy, word_x - 1);
    let next = source_word(i32(id.y) + dy, word_x + 1);
    var expanded = center;
    var shift = 1u;
    loop {
      if (shift > params.radius) {
        break;
      }
      expanded |= center << shift;
      expanded |= center >> shift;
      expanded |= previous >> (32u - shift);
      expanded |= next << (32u - shift);
      shift += 1u;
    }
    output_word |= expanded;
    dy += 1;
  }
  let remaining = params.width - id.x * 32u;
  if (remaining < 32u) {
    output_word &= (1u << remaining) - 1u;
  }
  target_words[id.y * params.words_per_row + id.x] = output_word;
}
`;

export class RasterMaskWebGpuProvider {
  private state: RasterMaskWebGpuState = "idle";
  private resources: RasterMaskWebGpuResources | null = null;
  private initPromise: Promise<void> | null = null;
  private initAttempts = 0;
  private deviceLost = 0;
  private lastFailure: RasterMaskWebGpuFallbackReason | null = null;
  private generation = 0;

  constructor(private readonly gpu: GPU | null = RasterMaskWebGpuProvider.navigatorGpu()) {}

  private static navigatorGpu(): GPU | null {
    if (!globalThis.isSecureContext) return null;
    return (globalThis.navigator as (Navigator & { gpu?: GPU }) | undefined)?.gpu ?? null;
  }

  snapshot(): RasterMaskWebGpuSnapshot {
    const capacityBytes = this.resources?.buffers?.capacityBytes ?? 0;
    return {
      state: this.state,
      allocatedBytes: capacityBytes === 0 ? 0 : capacityBytes * GPU_BUFFER_COUNT + PARAMS_BYTES,
      capacityBytes,
      initAttempts: this.initAttempts,
      deviceLost: this.deviceLost,
      lastFailure: this.lastFailure,
    };
  }

  warmup(): RasterMaskWebGpuState {
    if (this.state !== "idle") return this.state;
    if (!this.gpu) {
      this.state = "unavailable";
      this.lastFailure = "navigator-gpu-unavailable";
      return this.state;
    }
    this.state = "warming";
    this.initAttempts += 1;
    const generation = ++this.generation;
    this.initPromise = this.initialize(generation).finally(() => {
      if (this.generation === generation) this.initPromise = null;
    });
    return this.state;
  }

  async whenSettled(): Promise<RasterMaskWebGpuState> {
    await this.initPromise;
    return this.state;
  }

  async runSquareDilate(options: {
    alpha: Uint8Array;
    width: number;
    height: number;
    radius: number;
    budgetBytes: number;
  }): Promise<RasterMaskWebGpuRunResult> {
    if (!Number.isInteger(options.radius) || options.radius < 1 || options.radius > 31) {
      return this.unavailableResult("unsupported-operation", false);
    }
    if (!Number.isSafeInteger(options.budgetBytes) || options.budgetBytes <= 0) {
      return this.unavailableResult("budget-insufficient", false);
    }
    const estimate = estimateRasterMaskWebGpuBytes(options.width, options.height);
    if (estimate.requiredBytes > options.budgetBytes) {
      return this.unavailableResult("budget-insufficient", false);
    }
    if (this.state === "idle") {
      const warmupState = this.warmup();
      return this.unavailableResult(
        warmupState === "unavailable"
          ? (this.lastFailure ?? "initialization-failed")
          : "initializing",
        false,
      );
    }
    if (this.state === "warming") return this.unavailableResult("initializing", false);
    if (this.state === "lost") return this.unavailableResult("device-lost", false);
    if (this.state !== "ready" || !this.resources) {
      return this.unavailableResult(this.lastFailure ?? "initialization-failed", false);
    }

    try {
      const started = performance.now();
      const wordsPerRow = Math.ceil(options.width / 32);
      const packed = packRasterMaskRows(options.alpha, options.width, options.height, wordsPerRow);
      const buffers = this.ensureBuffers(packed.byteLength, options.budgetBytes);
      if (!buffers) return this.unavailableResult("budget-insufficient", false);
      const { device, pipeline } = this.resources;
      device.queue.writeBuffer(buffers.source, 0, packed);
      device.queue.writeBuffer(
        buffers.params,
        0,
        new Uint32Array([options.width, options.height, wordsPerRow, options.radius]),
      );
      const encoder = device.createCommandEncoder({ label: "Raster Mask square dilate encoder" });
      const pass = encoder.beginComputePass({ label: "Raster Mask square dilate pass" });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, buffers.bindGroup);
      pass.dispatchWorkgroups(Math.ceil(wordsPerRow / 16), Math.ceil(options.height / 16));
      pass.end();
      encoder.copyBufferToBuffer(buffers.target, 0, buffers.readback, 0, packed.byteLength);
      device.queue.submit([encoder.finish()]);
      await buffers.readback.mapAsync(GPUMapMode.READ, 0, packed.byteLength);
      let words: Uint32Array;
      try {
        words = new Uint32Array(buffers.readback.getMappedRange(0, packed.byteLength).slice(0));
      } finally {
        buffers.readback.unmap();
      }
      return {
        ok: true,
        words,
        wordsPerRow,
        computeMs: performance.now() - started,
        allocatedBytes: this.snapshot().allocatedBytes,
      };
    } catch {
      this.invalidate("gpu-runtime-failed", "unavailable");
      return this.unavailableResult("gpu-runtime-failed", true);
    }
  }

  dispose(): void {
    if (this.state === "closed") return;
    this.generation += 1;
    this.destroyResources(true);
    this.initPromise = null;
    this.state = "closed";
  }

  private async initialize(generation: number): Promise<void> {
    try {
      const adapter = await this.gpu!.requestAdapter({ powerPreference: "high-performance" });
      if (!this.isGenerationActive(generation)) return;
      if (!adapter) {
        this.state = "unavailable";
        this.lastFailure = "adapter-unavailable";
        return;
      }
      const device = await adapter.requestDevice();
      if (!this.isGenerationActive(generation)) {
        device.destroy();
        return;
      }
      const shader = device.createShaderModule({
        label: "Raster Mask packed square dilate",
        code: SQUARE_DILATE_SHADER,
      });
      const compilation = await shader.getCompilationInfo();
      if (compilation.messages.some((message) => message.type === "error")) {
        device.destroy();
        this.state = "unavailable";
        this.lastFailure = "initialization-failed";
        return;
      }
      const pipeline = await device.createComputePipelineAsync({
        label: "Raster Mask packed square dilate pipeline",
        layout: "auto",
        compute: { module: shader, entryPoint: "main" },
      });
      if (!this.isGenerationActive(generation)) {
        device.destroy();
        return;
      }
      this.resources = { device, pipeline, buffers: null };
      this.state = "ready";
      this.lastFailure = null;
      void device.lost.then(() => {
        if (!this.isGenerationActive(generation)) return;
        this.deviceLost += 1;
        this.invalidate("device-lost", "lost");
      });
    } catch {
      if (!this.isGenerationActive(generation)) return;
      this.invalidate("initialization-failed", "unavailable");
    }
  }

  private isGenerationActive(generation: number): boolean {
    return generation === this.generation && this.state !== "closed";
  }

  private ensureBuffers(
    requiredBytes: number,
    budgetBytes: number,
  ): RasterMaskWebGpuBuffers | null {
    const current = this.resources?.buffers;
    if (current && current.capacityBytes >= requiredBytes) return current;
    if (!this.resources) return null;
    const capacityBytes = nextBufferCapacity(requiredBytes);
    const allocatedBytes = capacityBytes * GPU_BUFFER_COUNT + PARAMS_BYTES;
    // Include both JS packed planes in admission, even though only GPU allocations persist.
    if (allocatedBytes + requiredBytes * 2 > budgetBytes) return null;
    current?.source.destroy();
    current?.target.destroy();
    current?.readback.destroy();
    current?.params.destroy();
    const { device, pipeline } = this.resources;
    const source = device.createBuffer({
      label: "Raster Mask WebGPU source",
      size: capacityBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const target = device.createBuffer({
      label: "Raster Mask WebGPU target",
      size: capacityBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const readback = device.createBuffer({
      label: "Raster Mask WebGPU readback",
      size: capacityBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const params = device.createBuffer({
      label: "Raster Mask WebGPU params",
      size: PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      label: "Raster Mask WebGPU bind group",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: source } },
        { binding: 1, resource: { buffer: target } },
        { binding: 2, resource: { buffer: params } },
      ],
    });
    const buffers = { source, target, readback, params, bindGroup, capacityBytes };
    this.resources.buffers = buffers;
    return buffers;
  }

  private unavailableResult(
    reason: RasterMaskWebGpuFallbackReason,
    attemptedGpu: boolean,
  ): RasterMaskWebGpuRunResult {
    return { ok: false, reason, attemptedGpu, allocatedBytes: this.snapshot().allocatedBytes };
  }

  private invalidate(
    reason: RasterMaskWebGpuFallbackReason,
    nextState: "unavailable" | "lost",
  ): void {
    this.generation += 1;
    this.initPromise = null;
    this.lastFailure = reason;
    this.destroyResources(true);
    this.state = nextState;
  }

  private destroyResources(destroyDevice: boolean): void {
    const resources = this.resources;
    this.resources = null;
    if (!resources) return;
    resources.buffers?.source.destroy();
    resources.buffers?.target.destroy();
    resources.buffers?.readback.destroy();
    resources.buffers?.params.destroy();
    if (destroyDevice) resources.device.destroy();
  }
}
