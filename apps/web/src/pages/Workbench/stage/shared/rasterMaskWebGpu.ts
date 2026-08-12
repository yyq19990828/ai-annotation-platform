import type {
  RasterMaskComputeFailureStage,
  RasterMaskWebGpuCircuitState,
  RasterMaskWebGpuFallbackReason,
} from "./rasterMaskWorkerProtocol";

const PARAMS_BYTES = 48;
const DEFAULT_COOLDOWN_MS = 30_000;

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
  sourceCapacityBytes: number;
  xorCapacityBytes: number;
  readbackCapacityBytes: number;
  initAttempts: number;
  deviceLost: number;
  lastFailure: RasterMaskWebGpuFallbackReason | null;
  lastFailureStage: RasterMaskComputeFailureStage | null;
  circuitState: RasterMaskWebGpuCircuitState;
  cooldownRemainingMs: number;
  consecutiveFailures: number;
}

export interface RasterMaskWebGpuRunMetrics {
  totalMs: number;
  uploadSubmitMs: number;
  readbackMs: number;
  gpuPassMs: number | null;
}

export type RasterMaskWebGpuRunResult =
  | {
      ok: true;
      xorWords: Uint32Array;
      xorWordsPerRow: number;
      metrics: RasterMaskWebGpuRunMetrics;
      snapshot: RasterMaskWebGpuSnapshot;
    }
  | {
      ok: false;
      reason: RasterMaskWebGpuFallbackReason;
      failureStage: RasterMaskComputeFailureStage | null;
      attemptedGpu: boolean;
      allocatedBytes: number;
    };

interface RasterMaskWebGpuBuffers {
  source: GPUBuffer;
  xorTarget: GPUBuffer;
  readback: GPUBuffer;
  params: GPUBuffer;
  bindGroup: GPUBindGroup;
  sourceCapacityBytes: number;
  xorCapacityBytes: number;
  readbackCapacityBytes: number;
}

interface RasterMaskWebGpuResources {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  buffers: RasterMaskWebGpuBuffers | null;
}

export interface RasterMaskWebGpuByteEstimate {
  sourcePackedBytes: number;
  xorPackedBytes: number;
  sourceCapacityBytes: number;
  xorCapacityBytes: number;
  readbackCapacityBytes: number;
  allocatedCapacityBytes: number;
  requiredBytes: number;
}

interface RasterMaskWebGpuShape {
  inputWidth: number;
  inputHeight: number;
  coreWidth: number;
  coreHeight: number;
  radius: number;
  budgetBytes: number;
}

export interface RasterMaskWebGpuRunOptions extends RasterMaskWebGpuShape {
  sourceWords: Uint32Array;
  sourceWordsPerRow: number;
  coreOffsetX: number;
  coreOffsetY: number;
}

export interface RasterMaskWebGpuProviderOptions {
  now?: () => number;
  cooldownMs?: number;
}

function checkedPackedBytes(width: number, height: number, label: string): number {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error(`WebGPU Raster Mask ${label} dimensions must be positive integers`);
  }
  const packedBytes = Math.ceil(width / 32) * height * 4;
  if (!Number.isSafeInteger(packedBytes) || packedBytes <= 0) {
    throw new Error(`WebGPU Raster Mask ${label} plane exceeds the safe byte limit`);
  }
  return packedBytes;
}

function nextBufferCapacity(requiredBytes: number): number {
  let capacity = 4;
  while (capacity < requiredBytes) {
    capacity *= 2;
    if (!Number.isSafeInteger(capacity)) {
      throw new Error("WebGPU Raster Mask buffer capacity exceeds the safe byte limit");
    }
  }
  return capacity;
}

export function estimateRasterMaskWebGpuBytes(
  inputWidth: number,
  inputHeight: number,
  coreWidth = inputWidth,
  coreHeight = inputHeight,
): RasterMaskWebGpuByteEstimate {
  const sourcePackedBytes = checkedPackedBytes(inputWidth, inputHeight, "input");
  const xorPackedBytes = checkedPackedBytes(coreWidth, coreHeight, "core");
  const sourceCapacityBytes = nextBufferCapacity(sourcePackedBytes);
  const xorCapacityBytes = nextBufferCapacity(xorPackedBytes);
  const readbackCapacityBytes = nextBufferCapacity(xorPackedBytes);
  const requiredBytes =
    sourcePackedBytes +
    xorPackedBytes +
    sourceCapacityBytes +
    xorCapacityBytes +
    readbackCapacityBytes +
    PARAMS_BYTES;
  const allocatedCapacityBytes =
    sourceCapacityBytes + xorCapacityBytes + readbackCapacityBytes + PARAMS_BYTES;
  if (!Number.isSafeInteger(requiredBytes)) {
    throw new Error("WebGPU Raster Mask compute bytes exceed the safe byte limit");
  }
  return {
    sourcePackedBytes,
    xorPackedBytes,
    sourceCapacityBytes,
    xorCapacityBytes,
    readbackCapacityBytes,
    allocatedCapacityBytes,
    requiredBytes,
  };
}

const SQUARE_DILATE_XOR_SHADER = `
struct Params {
  input_width: u32,
  input_height: u32,
  source_words_per_row: u32,
  core_offset_x: u32,
  core_offset_y: u32,
  core_width: u32,
  core_height: u32,
  xor_words_per_row: u32,
  radius: u32,
  _padding_0: u32,
  _padding_1: u32,
  _padding_2: u32,
}

@group(0) @binding(0) var<storage, read> source: array<u32>;
@group(0) @binding(1) var<storage, read_write> xor_words: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

fn source_word(y: i32, word_x: i32) -> u32 {
  if (y < 0 || y >= i32(params.input_height) || word_x < 0 || word_x >= i32(params.source_words_per_row)) {
    return 0u;
  }
  return source[u32(y) * params.source_words_per_row + u32(word_x)];
}

fn aligned_source_word(y: i32, bit_origin: i32) -> u32 {
  if (bit_origin <= -32) {
    return 0u;
  }
  if (bit_origin < 0) {
    return source_word(y, 0) << u32(-bit_origin);
  }
  let word_x = bit_origin / 32;
  let shift = u32(bit_origin % 32);
  let lower = source_word(y, word_x);
  if (shift == 0u) {
    return lower;
  }
  return (lower >> shift) | (source_word(y, word_x + 1) << (32u - shift));
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.xor_words_per_row || id.y >= params.core_height) {
    return;
  }
  let bit_origin = i32(params.core_offset_x + id.x * 32u);
  let source_y = i32(params.core_offset_y + id.y);
  let source_center = aligned_source_word(source_y, bit_origin);
  var dilated = 0u;
  var dy = -i32(params.radius);
  loop {
    if (dy > i32(params.radius)) {
      break;
    }
    let center = aligned_source_word(source_y + dy, bit_origin);
    let previous = aligned_source_word(source_y + dy, bit_origin - 32);
    let next = aligned_source_word(source_y + dy, bit_origin + 32);
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
    dilated |= expanded;
    dy += 1;
  }
  var xor_word = dilated ^ source_center;
  let remaining = params.core_width - id.x * 32u;
  if (remaining < 32u) {
    xor_word &= (1u << remaining) - 1u;
  }
  xor_words[id.y * params.xor_words_per_row + id.x] = xor_word;
}
`;

export class RasterMaskWebGpuProvider {
  private state: RasterMaskWebGpuState = "idle";
  private resources: RasterMaskWebGpuResources | null = null;
  private initPromise: Promise<void> | null = null;
  private initAttempts = 0;
  private deviceLost = 0;
  private lastFailure: RasterMaskWebGpuFallbackReason | null = null;
  private lastFailureStage: RasterMaskComputeFailureStage | null = null;
  private circuitState: RasterMaskWebGpuCircuitState = "eligible";
  private cooldownUntilMs = 0;
  private consecutiveFailures = 0;
  private generation = 0;
  private readonly now: () => number;
  private readonly cooldownMs: number;

  constructor(
    private readonly gpu: GPU | null = RasterMaskWebGpuProvider.navigatorGpu(),
    options: RasterMaskWebGpuProviderOptions = {},
  ) {
    this.now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.cooldownMs =
      Number.isFinite(options.cooldownMs) && options.cooldownMs! >= 0
        ? Math.floor(options.cooldownMs!)
        : DEFAULT_COOLDOWN_MS;
  }

  private static navigatorGpu(): GPU | null {
    if (!globalThis.isSecureContext) return null;
    return (globalThis.navigator as (Navigator & { gpu?: GPU }) | undefined)?.gpu ?? null;
  }

  snapshot(): RasterMaskWebGpuSnapshot {
    const buffers = this.resources?.buffers;
    const sourceCapacityBytes = buffers?.sourceCapacityBytes ?? 0;
    const xorCapacityBytes = buffers?.xorCapacityBytes ?? 0;
    const readbackCapacityBytes = buffers?.readbackCapacityBytes ?? 0;
    return {
      state: this.state,
      allocatedBytes:
        sourceCapacityBytes +
        xorCapacityBytes +
        readbackCapacityBytes +
        (buffers ? PARAMS_BYTES : 0),
      sourceCapacityBytes,
      xorCapacityBytes,
      readbackCapacityBytes,
      initAttempts: this.initAttempts,
      deviceLost: this.deviceLost,
      lastFailure: this.lastFailure,
      lastFailureStage: this.lastFailureStage,
      circuitState: this.circuitState,
      cooldownRemainingMs:
        this.circuitState === "cooldown"
          ? Math.max(0, Math.ceil(this.cooldownUntilMs - this.now()))
          : 0,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  warmup(): RasterMaskWebGpuState {
    this.prepareCooldownRetry();
    if (this.state !== "idle") return this.state;
    this.initAttempts += 1;
    if (!this.gpu) {
      this.recordFailure("navigator-gpu-unavailable", "adapter-request", "unavailable");
      return this.state;
    }
    this.state = "warming";
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

  preflightSquareDilateXor(options: RasterMaskWebGpuShape): RasterMaskWebGpuFallbackReason | null {
    if (!Number.isInteger(options.radius) || options.radius < 1 || options.radius > 31) {
      return "unsupported-operation";
    }
    if (!Number.isSafeInteger(options.budgetBytes) || options.budgetBytes <= 0) {
      return "budget-insufficient";
    }
    const estimate = estimateRasterMaskWebGpuBytes(
      options.inputWidth,
      options.inputHeight,
      options.coreWidth,
      options.coreHeight,
    );
    const current = this.resources?.buffers;
    const prospectiveAllocatedBytes =
      Math.max(current?.sourceCapacityBytes ?? 0, estimate.sourceCapacityBytes) +
      Math.max(current?.xorCapacityBytes ?? 0, estimate.xorCapacityBytes) +
      Math.max(current?.readbackCapacityBytes ?? 0, estimate.readbackCapacityBytes) +
      PARAMS_BYTES;
    if (prospectiveAllocatedBytes > options.budgetBytes) {
      return "budget-insufficient";
    }
    this.prepareCooldownRetry();
    if (this.state === "idle") {
      const warmupState = this.warmup();
      return warmupState === "unavailable"
        ? (this.lastFailure ?? "initialization-failed")
        : "initializing";
    }
    if (this.state === "warming") return "initializing";
    if (this.state === "lost") return "device-lost";
    if (this.state !== "ready" || !this.resources) {
      return this.lastFailure ?? "initialization-failed";
    }
    return null;
  }

  async runSquareDilateXor(
    options: RasterMaskWebGpuRunOptions,
  ): Promise<RasterMaskWebGpuRunResult> {
    const routeFailure = this.preflightSquareDilateXor(options);
    if (routeFailure) {
      const snapshot = this.snapshot();
      return this.unavailableResult(
        routeFailure,
        snapshot.lastFailure === routeFailure ? snapshot.lastFailureStage : null,
        false,
      );
    }
    const expectedSourceWordsPerRow = Math.ceil(options.inputWidth / 32);
    if (
      !(options.sourceWords instanceof Uint32Array) ||
      options.sourceWordsPerRow !== expectedSourceWordsPerRow ||
      options.sourceWords.length !== expectedSourceWordsPerRow * options.inputHeight ||
      !Number.isSafeInteger(options.coreOffsetX) ||
      !Number.isSafeInteger(options.coreOffsetY) ||
      options.coreOffsetX < 0 ||
      options.coreOffsetY < 0 ||
      options.coreOffsetX + options.coreWidth > options.inputWidth ||
      options.coreOffsetY + options.coreHeight > options.inputHeight
    ) {
      throw new Error("WebGPU Raster Mask packed source or core rectangle is invalid");
    }

    const totalStarted = this.now();
    const xorWordsPerRow = Math.ceil(options.coreWidth / 32);
    const sourceBytes = options.sourceWords.byteLength;
    const xorBytes = xorWordsPerRow * options.coreHeight * 4;
    let buffers: RasterMaskWebGpuBuffers | null;
    try {
      buffers = this.ensureBuffers(sourceBytes, xorBytes, options.budgetBytes);
    } catch {
      return this.runtimeFailure("buffer-create");
    }
    if (!buffers) return this.unavailableResult("budget-insufficient", null, false);
    const resources = this.resources!;
    const uploadStarted = this.now();
    try {
      resources.device.queue.writeBuffer(buffers.source, 0, options.sourceWords);
      resources.device.queue.writeBuffer(
        buffers.params,
        0,
        new Uint32Array([
          options.inputWidth,
          options.inputHeight,
          options.sourceWordsPerRow,
          options.coreOffsetX,
          options.coreOffsetY,
          options.coreWidth,
          options.coreHeight,
          xorWordsPerRow,
          options.radius,
          0,
          0,
          0,
        ]),
      );
    } catch {
      return this.runtimeFailure("queue-write");
    }
    let commandBuffer: GPUCommandBuffer;
    try {
      const encoder = resources.device.createCommandEncoder({
        label: "Raster Mask square dilate XOR encoder",
      });
      const pass = encoder.beginComputePass({ label: "Raster Mask square dilate XOR pass" });
      pass.setPipeline(resources.pipeline);
      pass.setBindGroup(0, buffers.bindGroup);
      pass.dispatchWorkgroups(Math.ceil(xorWordsPerRow / 16), Math.ceil(options.coreHeight / 16));
      pass.end();
      encoder.copyBufferToBuffer(buffers.xorTarget, 0, buffers.readback, 0, xorBytes);
      commandBuffer = encoder.finish();
    } catch {
      return this.runtimeFailure("encode");
    }
    try {
      resources.device.queue.submit([commandBuffer]);
    } catch {
      return this.runtimeFailure("submit");
    }
    const uploadSubmitMs = this.now() - uploadStarted;
    const readbackStarted = this.now();
    try {
      await buffers.readback.mapAsync(GPUMapMode.READ, 0, xorBytes);
    } catch {
      return this.runtimeFailure("map");
    }
    let xorWords: Uint32Array;
    try {
      xorWords = new Uint32Array(buffers.readback.getMappedRange(0, xorBytes).slice(0));
    } catch {
      return this.runtimeFailure("readback-validate");
    } finally {
      buffers.readback.unmap();
    }
    try {
      this.validateReadbackTail(xorWords, xorWordsPerRow, options.coreWidth, options.coreHeight);
    } catch {
      return this.runtimeFailure("readback-validate");
    }
    const readbackMs = this.now() - readbackStarted;
    this.recordSuccess();
    return {
      ok: true,
      xorWords,
      xorWordsPerRow,
      metrics: {
        totalMs: this.now() - totalStarted,
        uploadSubmitMs,
        readbackMs,
        gpuPassMs: null,
      },
      snapshot: this.snapshot(),
    };
  }

  dispose(): void {
    if (this.state === "closed") return;
    this.generation += 1;
    this.destroyResources(true);
    this.initPromise = null;
    this.state = "closed";
  }

  failAfterReadback(stage: "patch-build"): RasterMaskWebGpuRunResult {
    return this.runtimeFailure(stage);
  }

  private async initialize(generation: number): Promise<void> {
    let adapter: GPUAdapter | null;
    try {
      adapter = await this.gpu!.requestAdapter({ powerPreference: "high-performance" });
    } catch {
      if (this.isGenerationActive(generation)) {
        this.recordFailure("initialization-failed", "adapter-request", "unavailable");
      }
      return;
    }
    if (!this.isGenerationActive(generation)) return;
    if (!adapter) {
      this.recordFailure("adapter-unavailable", "adapter-request", "unavailable");
      return;
    }

    let device: GPUDevice;
    try {
      device = await adapter.requestDevice();
    } catch {
      if (this.isGenerationActive(generation)) {
        this.recordFailure("initialization-failed", "device-request", "unavailable");
      }
      return;
    }
    if (!this.isGenerationActive(generation)) {
      device.destroy();
      return;
    }

    let shader: GPUShaderModule | undefined;
    try {
      shader = device.createShaderModule({
        label: "Raster Mask packed square dilate XOR",
        code: SQUARE_DILATE_XOR_SHADER,
      });
      const compilation = await shader.getCompilationInfo();
      if (!this.isGenerationActive(generation)) {
        device.destroy();
        return;
      }
      if (compilation.messages.some((message) => message.type === "error")) {
        device.destroy();
        this.recordFailure("initialization-failed", "shader-compile", "unavailable");
        return;
      }
    } catch {
      device.destroy();
      if (this.isGenerationActive(generation)) {
        this.recordFailure("initialization-failed", "shader-compile", "unavailable");
      }
      return;
    }
    if (!shader) return;

    let pipeline: GPUComputePipeline;
    try {
      pipeline = await device.createComputePipelineAsync({
        label: "Raster Mask packed square dilate XOR pipeline",
        layout: "auto",
        compute: { module: shader, entryPoint: "main" },
      });
    } catch {
      device.destroy();
      if (this.isGenerationActive(generation)) {
        this.recordFailure("initialization-failed", "pipeline-create", "unavailable");
      }
      return;
    }
    if (!this.isGenerationActive(generation)) {
      device.destroy();
      return;
    }
    this.resources = { device, pipeline, buffers: null };
    this.state = "ready";
    this.recordSuccess();
    void device.lost.then(() => {
      if (!this.isGenerationActive(generation)) return;
      this.deviceLost += 1;
      this.recordFailure("device-lost", null, "lost");
    });
  }

  private isGenerationActive(generation: number): boolean {
    return generation === this.generation && this.state !== "closed";
  }

  private ensureBuffers(
    sourceBytes: number,
    xorBytes: number,
    budgetBytes: number,
  ): RasterMaskWebGpuBuffers | null {
    if (!this.resources) return null;
    const current = this.resources.buffers;
    const sourceCapacityBytes = Math.max(
      current?.sourceCapacityBytes ?? 0,
      nextBufferCapacity(sourceBytes),
    );
    const xorCapacityBytes = Math.max(current?.xorCapacityBytes ?? 0, nextBufferCapacity(xorBytes));
    const readbackCapacityBytes = Math.max(
      current?.readbackCapacityBytes ?? 0,
      nextBufferCapacity(xorBytes),
    );
    const allocatedBytes =
      sourceCapacityBytes + xorCapacityBytes + readbackCapacityBytes + PARAMS_BYTES;
    if (allocatedBytes > budgetBytes) return null;
    if (
      current &&
      current.sourceCapacityBytes >= sourceBytes &&
      current.xorCapacityBytes >= xorBytes &&
      current.readbackCapacityBytes >= xorBytes
    ) {
      return current;
    }

    this.resources.buffers = null;
    this.destroyBuffers(current);
    const { device, pipeline } = this.resources;
    let source: GPUBuffer | null = null;
    let xorTarget: GPUBuffer | null = null;
    let readback: GPUBuffer | null = null;
    let params: GPUBuffer | null = null;
    try {
      source = device.createBuffer({
        label: "Raster Mask WebGPU packed source",
        size: sourceCapacityBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      xorTarget = device.createBuffer({
        label: "Raster Mask WebGPU core XOR target",
        size: xorCapacityBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      readback = device.createBuffer({
        label: "Raster Mask WebGPU core XOR readback",
        size: readbackCapacityBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      params = device.createBuffer({
        label: "Raster Mask WebGPU params",
        size: PARAMS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const bindGroup = device.createBindGroup({
        label: "Raster Mask WebGPU bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: source } },
          { binding: 1, resource: { buffer: xorTarget } },
          { binding: 2, resource: { buffer: params } },
        ],
      });
      const buffers = {
        source,
        xorTarget,
        readback,
        params,
        bindGroup,
        sourceCapacityBytes,
        xorCapacityBytes,
        readbackCapacityBytes,
      };
      this.resources.buffers = buffers;
      return buffers;
    } catch (error) {
      source?.destroy();
      xorTarget?.destroy();
      readback?.destroy();
      params?.destroy();
      throw error;
    }
  }

  private unavailableResult(
    reason: RasterMaskWebGpuFallbackReason,
    failureStage: RasterMaskComputeFailureStage | null,
    attemptedGpu: boolean,
  ): RasterMaskWebGpuRunResult {
    return {
      ok: false,
      reason,
      failureStage,
      attemptedGpu,
      allocatedBytes: this.snapshot().allocatedBytes,
    };
  }

  private runtimeFailure(stage: RasterMaskComputeFailureStage): RasterMaskWebGpuRunResult {
    this.recordFailure("gpu-runtime-failed", stage, "unavailable");
    return this.unavailableResult("gpu-runtime-failed", stage, true);
  }

  private recordFailure(
    reason: RasterMaskWebGpuFallbackReason,
    failureStage: RasterMaskComputeFailureStage | null,
    nextState: "unavailable" | "lost",
  ): void {
    this.generation += 1;
    this.initPromise = null;
    this.lastFailure = reason;
    this.lastFailureStage = failureStage;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 2) {
      this.circuitState = "page-fixed";
      this.cooldownUntilMs = 0;
    } else {
      this.circuitState = "cooldown";
      this.cooldownUntilMs = this.now() + this.cooldownMs;
    }
    this.destroyResources(true);
    this.state = nextState;
  }

  private prepareCooldownRetry(): void {
    if (
      this.circuitState !== "cooldown" ||
      this.consecutiveFailures !== 1 ||
      this.now() < this.cooldownUntilMs
    ) {
      return;
    }
    this.circuitState = "eligible";
    this.cooldownUntilMs = 0;
    this.state = "idle";
  }

  private recordSuccess(): void {
    this.lastFailure = null;
    this.lastFailureStage = null;
    this.consecutiveFailures = 0;
    this.circuitState = "eligible";
    this.cooldownUntilMs = 0;
  }

  private validateReadbackTail(
    xorWords: Uint32Array,
    wordsPerRow: number,
    width: number,
    height: number,
  ): void {
    if (xorWords.length !== wordsPerRow * height) {
      throw new Error("WebGPU Raster Mask readback length is invalid");
    }
    const remaining = width % 32;
    if (remaining === 0) return;
    const validMask = 0xffffffff >>> (32 - remaining);
    for (let y = 0; y < height; y += 1) {
      if ((xorWords[y * wordsPerRow + wordsPerRow - 1]! & ~validMask) !== 0) {
        throw new Error("WebGPU Raster Mask readback contains non-zero tail bits");
      }
    }
  }

  private destroyBuffers(buffers: RasterMaskWebGpuBuffers | null | undefined): void {
    if (!buffers) return;
    buffers.source.destroy();
    buffers.xorTarget.destroy();
    buffers.readback.destroy();
    buffers.params.destroy();
  }

  private destroyResources(destroyDevice: boolean): void {
    const resources = this.resources;
    this.resources = null;
    if (!resources) return;
    this.destroyBuffers(resources.buffers);
    if (destroyDevice) resources.device.destroy();
  }
}
