import { applyMaskInstanceOperation } from "./geometry/maskInstanceOperations";
import { applyMaskMorphology, applyMaskOperation } from "./geometry/maskOperations";
import { analyzeRasterMaskAlpha } from "./rasterMaskRender";
import type { RasterMaskWorkerRequest, RasterMaskWorkerResponse } from "./rasterMaskWorkerProtocol";
import {
  buildRasterMaskWorkerSession,
  buildRasterMaskMorphologyPatchesFromXorWords,
  compareRasterMaskSessionTile,
  compareRasterMaskSessionMetrics,
  decodeRasterMaskSessionTile,
  decodeRasterMaskTransferredRle,
  diffRasterMaskMorphologyRoi,
  estimateRasterMaskDenseCpuBytes,
  mergeRasterMaskSessionTiles,
  preparePackedRasterMaskMorphologyRoi,
  prepareRasterMaskMorphologyRoi,
  type RasterMaskWorkerSession,
  validateRasterMaskMorphologyRoiRequest,
} from "./rasterMaskWorkerRuntime";
import {
  estimateRasterMaskPackedCpuBytes,
  squareDilatePackedXorSeparable,
} from "./rasterMaskPackedMorphology";
import type {
  RasterMaskComputeFailureStage,
  RasterMaskMorphologyRoiRequest,
  RasterMaskMorphologyRoiResponse,
  RasterMaskWebGpuWorkerSnapshot,
} from "./rasterMaskWorkerProtocol";
import {
  rasterMaskPackedBaseCacheCapBytes,
  RasterMaskPackedBaseCache,
} from "./rasterMaskPackedBaseCache";
import type { RasterMaskWebGpuProvider } from "./rasterMaskWebGpu";

type WorkerScope = {
  onmessage: ((event: MessageEvent<RasterMaskWorkerRequest>) => void) | null;
  postMessage: (message: RasterMaskWorkerResponse, transfer?: Transferable[]) => void;
};

const workerScope = self as unknown as WorkerScope;
const sessions = new Map<string, RasterMaskWorkerSession>();
const packedBaseCache = new RasterMaskPackedBaseCache();
const webGpuGateEnabled = import.meta.env.VITE_EXPERIMENTAL_RASTER_MASK_WEBGPU !== "false";
let webGpuProviderPromise: Promise<RasterMaskWebGpuProvider> | null = null;

function disabledWebGpuSnapshot(): RasterMaskWebGpuWorkerSnapshot {
  return {
    state: "disabled",
    allocatedBytes: 0,
    sourceCapacityBytes: 0,
    xorCapacityBytes: 0,
    readbackCapacityBytes: 0,
    initAttempts: 0,
    deviceLost: 0,
    lastFailure: "gate-disabled",
    lastFailureStage: null,
    circuitState: "eligible",
    cooldownRemainingMs: 0,
    consecutiveFailures: 0,
  };
}

function webGpuProvider(): Promise<RasterMaskWebGpuProvider> | null {
  if (!webGpuGateEnabled) return null;
  webGpuProviderPromise ??= import("./rasterMaskWebGpu").then(
    ({ RasterMaskWebGpuProvider }) => new RasterMaskWebGpuProvider(),
  );
  return webGpuProviderPromise;
}

async function resetWebGpuProvider(): Promise<void> {
  const pending = webGpuProviderPromise;
  webGpuProviderPromise = null;
  (await pending?.catch(() => null))?.dispose();
}

function sessionFor(sessionId: string, sha256: string): RasterMaskWorkerSession {
  const session = sessions.get(sessionId);
  if (!session || session.sha256 !== sha256) {
    throw new Error("Raster Mask Worker session is missing or stale");
  }
  return session;
}

function uniqueBuffers(buffers: ArrayBufferLike[]): Transferable[] {
  return [...new Set(buffers)].filter(
    (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
  );
}

function denseCpuMorphologyResult(
  session: RasterMaskWorkerSession,
  request: RasterMaskMorphologyRoiRequest,
  totalStarted: number,
  fallbackReason: RasterMaskMorphologyRoiResponse["fallbackReason"],
  failureStage: RasterMaskComputeFailureStage | null = null,
  gpuSnapshot: RasterMaskWebGpuWorkerSnapshot | null = null,
): Omit<RasterMaskMorphologyRoiResponse, "kind" | "id" | "ok" | "sessionId" | "sha256"> {
  const estimate = estimateRasterMaskDenseCpuBytes(request);
  if (estimate.requiredBytes > request.cpuComputeBudgetBytes) {
    throw new Error("Raster Mask CPU compute budget is insufficient");
  }
  const dense = prepareRasterMaskMorphologyRoi(session, request);
  const computeStarted = performance.now();
  const after = applyMaskMorphology(
    dense.source,
    request.input.width,
    request.input.height,
    request.operation,
  ).alpha;
  const computeMs = performance.now() - computeStarted;
  const diff = diffRasterMaskMorphologyRoi(
    session,
    request,
    dense.source,
    (inputIndex) => after[inputIndex] !== 0,
  );
  return {
    sourceRevision: request.sourceRevision,
    backend: "cpu",
    fallbackReason,
    changedPixels: diff.changedPixels,
    changedBounds: diff.changedBounds,
    patches: diff.patches,
    metrics: {
      totalMs: performance.now() - totalStarted,
      cpuStrategy: "dense",
      failureStage,
      inputPixels: request.input.width * request.input.height,
      corePixels: request.core.width * request.core.height,
      backendPrepareMs: dense.materializeMs,
      prepareStrategy: "dense-cpu",
      directRleScanMs: 0,
      baseCacheFillMs: 0,
      packedAssembleMs: 0,
      dirtyOverlayMs: 0,
      baseCacheHitTiles: 0,
      baseCacheMissTiles: 0,
      baseCacheEvictedTiles: 0,
      baseCacheRetainedBytes: 0,
      sourceScratchCapacityBytes: 0,
      computeMs,
      diffOrPatchMs: diff.diffMs,
      xorOutputStrategy: "cpu-dense",
      xorTotalWords: 0,
      xorNonZeroWords: 0,
      xorWordDensity: 0,
      xorChangedPixels: diff.changedPixels,
      xorTouchedTiles: diff.patches.length,
      xorScanMs: 0,
      xorPatchAllocateMs: 0,
      xorPatchScatterMs: 0,
      wordPatchBuildMs: 0,
      gpuUploadSubmitMs: null,
      gpuReadbackMs: null,
      gpuPassMs: null,
      fallbackMaterializeMs: null,
      cpuBudgetBytes: request.cpuComputeBudgetBytes,
      gpuBudgetBytes: request.gpuBufferBudgetBytes,
      cpuTransientBytes: estimate.requiredBytes,
      denseTransientBytes: estimate.requiredBytes,
      packedIntermediateBytes: 0,
      patchUpperBoundBytes: estimate.patchUpperBoundBytes,
      inputAlphaBytes: dense.source.byteLength,
      packedSourceBytes: 0,
      xorReadbackBytes: 0,
      allocatedGpuBytes: 0,
      gpuSourceCapacityBytes: 0,
      gpuXorCapacityBytes: 0,
      gpuReadbackCapacityBytes: 0,
      webGpuCircuitState: gpuSnapshot?.circuitState ?? "eligible",
      webGpuCooldownRemainingMs: gpuSnapshot?.cooldownRemainingMs ?? 0,
      webGpuConsecutiveFailures: gpuSnapshot?.consecutiveFailures ?? 0,
      webGpuDeviceLost: gpuSnapshot?.deviceLost ?? 0,
    },
  };
}

function packedCpuEligible(request: RasterMaskMorphologyRoiRequest): boolean {
  return (
    request.operation.operation === "dilate" &&
    request.operation.kernelShape === "square" &&
    request.operation.radius <= 31 &&
    request.input.width * request.input.height >= 4_194_304
  );
}

function packedCpuEstimate(
  request: RasterMaskMorphologyRoiRequest,
  sourceChargeBytes?: number,
  baseCacheRetainedBytes?: number,
) {
  return estimateRasterMaskPackedCpuBytes({
    inputWidth: request.input.width,
    inputHeight: request.input.height,
    coreWidth: request.core.width,
    coreHeight: request.core.height,
    ...(sourceChargeBytes === undefined ? {} : { sourceChargeBytes }),
    ...(baseCacheRetainedBytes === undefined ? {} : { baseCacheRetainedBytes }),
  });
}

function preparePackedCpuSource(
  session: RasterMaskWorkerSession,
  request: RasterMaskMorphologyRoiRequest,
): ReturnType<typeof preparePackedRasterMaskMorphologyRoi> | null {
  if (!packedCpuEligible(request)) return null;
  const directEstimate = packedCpuEstimate(request);
  if (directEstimate.requiredBytes > request.cpuComputeBudgetBytes) return null;

  const packedSourceBytes = Math.ceil(request.input.width / 32) * request.input.height * 4;
  const cacheCapBytes = rasterMaskPackedBaseCacheCapBytes(request.cpuComputeBudgetBytes);
  const prospectiveScratchCapacityBytes =
    packedBaseCache.prospectiveScratchCapacityBytes(packedSourceBytes);
  const cacheEstimate = packedCpuEstimate(request, prospectiveScratchCapacityBytes, cacheCapBytes);
  let packed: ReturnType<typeof preparePackedRasterMaskMorphologyRoi>;
  if (cacheCapBytes > 0 && cacheEstimate.requiredBytes <= request.cpuComputeBudgetBytes) {
    try {
      packed = packedBaseCache.prepare(request.sessionId, session, request, cacheCapBytes);
    } catch {
      packedBaseCache.clear();
      packed = preparePackedRasterMaskMorphologyRoi(session, request);
    }
  } else {
    packedBaseCache.clear();
    packed = preparePackedRasterMaskMorphologyRoi(session, request);
  }
  const actualEstimate = packedCpuEstimate(
    request,
    packed.sourceScratchCapacityBytes || packed.sourceWords.byteLength,
    packed.baseCacheRetainedBytes,
  );
  if (actualEstimate.requiredBytes <= request.cpuComputeBudgetBytes) return packed;

  packedBaseCache.clear();
  packed = preparePackedRasterMaskMorphologyRoi(session, request);
  return packedCpuEstimate(request, packed.sourceWords.byteLength, 0).requiredBytes <=
    request.cpuComputeBudgetBytes
    ? packed
    : null;
}

function packedCpuMorphologyResult(
  session: RasterMaskWorkerSession,
  request: RasterMaskMorphologyRoiRequest,
  packed: ReturnType<typeof preparePackedRasterMaskMorphologyRoi>,
  totalStarted: number,
  fallbackReason: RasterMaskMorphologyRoiResponse["fallbackReason"],
  backend: "cpu" | "cpu-fallback",
  failureStage: RasterMaskComputeFailureStage | null = null,
  gpuSnapshot: RasterMaskWebGpuWorkerSnapshot | null = null,
): Omit<RasterMaskMorphologyRoiResponse, "kind" | "id" | "ok" | "sessionId" | "sha256"> {
  const estimate = packedCpuEstimate(
    request,
    packed.sourceScratchCapacityBytes || packed.sourceWords.byteLength,
    packed.baseCacheRetainedBytes,
  );
  if (estimate.requiredBytes > request.cpuComputeBudgetBytes) {
    throw new Error("Raster Mask CPU compute budget is insufficient");
  }
  const computeStarted = performance.now();
  const cpu = squareDilatePackedXorSeparable({
    sourceWords: packed.sourceWords,
    sourceWordsPerRow: packed.wordsPerRow,
    inputWidth: request.input.width,
    inputHeight: request.input.height,
    coreOffsetX: request.core.x - request.input.x,
    coreOffsetY: request.core.y - request.input.y,
    coreWidth: request.core.width,
    coreHeight: request.core.height,
    radius: request.operation.radius,
  });
  const computeMs = performance.now() - computeStarted;
  const diff = buildRasterMaskMorphologyPatchesFromXorWords(
    session,
    request,
    cpu.xorWords,
    cpu.xorWordsPerRow,
  );
  return {
    sourceRevision: request.sourceRevision,
    backend,
    fallbackReason,
    changedPixels: diff.changedPixels,
    changedBounds: diff.changedBounds,
    patches: diff.patches,
    metrics: {
      totalMs: performance.now() - totalStarted,
      cpuStrategy: "packed-separable",
      failureStage,
      inputPixels: request.input.width * request.input.height,
      corePixels: request.core.width * request.core.height,
      backendPrepareMs: packed.packedPrepareMs,
      prepareStrategy: packed.prepareStrategy,
      directRleScanMs: packed.directRleScanMs,
      baseCacheFillMs: packed.baseCacheFillMs,
      packedAssembleMs: packed.packedAssembleMs,
      dirtyOverlayMs: packed.dirtyOverlayMs,
      baseCacheHitTiles: packed.baseCacheHitTiles,
      baseCacheMissTiles: packed.baseCacheMissTiles,
      baseCacheEvictedTiles: packed.baseCacheEvictedTiles,
      baseCacheRetainedBytes: packed.baseCacheRetainedBytes,
      sourceScratchCapacityBytes: packed.sourceScratchCapacityBytes,
      computeMs,
      diffOrPatchMs: diff.diffMs,
      xorOutputStrategy: "dense-word-scatter",
      xorTotalWords: diff.xorTotalWords ?? 0,
      xorNonZeroWords: diff.xorNonZeroWords ?? 0,
      xorWordDensity: diff.xorWordDensity ?? 0,
      xorChangedPixels: diff.changedPixels,
      xorTouchedTiles: diff.xorTouchedTiles ?? diff.patches.length,
      xorScanMs: diff.xorScanMs ?? 0,
      xorPatchAllocateMs: diff.xorPatchAllocateMs ?? 0,
      xorPatchScatterMs: diff.xorPatchScatterMs ?? 0,
      wordPatchBuildMs: diff.wordPatchBuildMs ?? 0,
      gpuUploadSubmitMs: null,
      gpuReadbackMs: null,
      gpuPassMs: null,
      fallbackMaterializeMs: null,
      cpuBudgetBytes: request.cpuComputeBudgetBytes,
      gpuBudgetBytes: request.gpuBufferBudgetBytes,
      cpuTransientBytes: estimate.requiredBytes,
      denseTransientBytes: 0,
      packedIntermediateBytes: cpu.intermediateBytes,
      patchUpperBoundBytes: estimate.patchUpperBoundBytes,
      inputAlphaBytes: 0,
      packedSourceBytes: packed.sourceWords.byteLength,
      xorReadbackBytes: cpu.xorWords.byteLength,
      allocatedGpuBytes: gpuSnapshot?.allocatedBytes ?? 0,
      gpuSourceCapacityBytes: gpuSnapshot?.sourceCapacityBytes ?? 0,
      gpuXorCapacityBytes: gpuSnapshot?.xorCapacityBytes ?? 0,
      gpuReadbackCapacityBytes: gpuSnapshot?.readbackCapacityBytes ?? 0,
      webGpuCircuitState: gpuSnapshot?.circuitState ?? "eligible",
      webGpuCooldownRemainingMs: gpuSnapshot?.cooldownRemainingMs ?? 0,
      webGpuConsecutiveFailures: gpuSnapshot?.consecutiveFailures ?? 0,
      webGpuDeviceLost: gpuSnapshot?.deviceLost ?? 0,
    },
  };
}

function webGpuRouteFailure(
  request: RasterMaskMorphologyRoiRequest,
): RasterMaskMorphologyRoiResponse["fallbackReason"] {
  if (!webGpuGateEnabled || request.backendPolicy === "cpu") return "gate-disabled";
  if (
    request.operation.operation !== "dilate" ||
    request.operation.kernelShape !== "square" ||
    request.operation.radius > 31
  ) {
    return "unsupported-operation";
  }
  const pixels = request.input.width * request.input.height;
  if (pixels < 4_194_304) return "below-pixel-threshold";
  if (request.gpuBufferBudgetBytes <= 0) return "budget-insufficient";
  return null;
}

async function runMorphologyRoi(
  request: RasterMaskMorphologyRoiRequest,
): Promise<Omit<RasterMaskMorphologyRoiResponse, "kind" | "id" | "ok" | "sessionId" | "sha256">> {
  const totalStarted = performance.now();
  const session = sessionFor(request.sessionId, request.sha256);
  validateRasterMaskMorphologyRoiRequest(session, request);
  const routeFailure = webGpuRouteFailure(request);
  const packed = preparePackedCpuSource(session, request);
  if (routeFailure) {
    return packed
      ? packedCpuMorphologyResult(session, request, packed, totalStarted, routeFailure, "cpu")
      : denseCpuMorphologyResult(session, request, totalStarted, routeFailure);
  }

  let provider: RasterMaskWebGpuProvider;
  try {
    provider = await webGpuProvider()!;
  } catch {
    return packed
      ? packedCpuMorphologyResult(
          session,
          request,
          packed,
          totalStarted,
          "initialization-failed",
          "cpu",
          "device-request",
        )
      : denseCpuMorphologyResult(
          session,
          request,
          totalStarted,
          "initialization-failed",
          "device-request",
        );
  }
  const shape = {
    inputWidth: request.input.width,
    inputHeight: request.input.height,
    coreWidth: request.core.width,
    coreHeight: request.core.height,
    radius: request.operation.radius,
    budgetBytes: request.gpuBufferBudgetBytes,
  };
  const preflightFailure = provider.preflightSquareDilateXor(shape);
  if (preflightFailure) {
    return packed
      ? packedCpuMorphologyResult(
          session,
          request,
          packed,
          totalStarted,
          preflightFailure,
          "cpu",
          provider.snapshot().lastFailureStage,
          provider.snapshot(),
        )
      : denseCpuMorphologyResult(
          session,
          request,
          totalStarted,
          preflightFailure,
          provider.snapshot().lastFailureStage,
          provider.snapshot(),
        );
  }
  if (!packed) {
    return denseCpuMorphologyResult(session, request, totalStarted, "budget-insufficient");
  }
  const gpu = await provider.runSquareDilateXor({
    ...shape,
    sourceWords: packed.sourceWords,
    sourceWordsPerRow: packed.wordsPerRow,
    coreOffsetX: request.core.x - request.input.x,
    coreOffsetY: request.core.y - request.input.y,
  });
  if (!gpu.ok) {
    return packedCpuMorphologyResult(
      session,
      request,
      packed,
      totalStarted,
      gpu.reason,
      gpu.attemptedGpu ? "cpu-fallback" : "cpu",
      gpu.failureStage,
      provider.snapshot(),
    );
  }
  let diff: ReturnType<typeof buildRasterMaskMorphologyPatchesFromXorWords>;
  try {
    diff = buildRasterMaskMorphologyPatchesFromXorWords(
      session,
      request,
      gpu.xorWords,
      gpu.xorWordsPerRow,
    );
  } catch {
    provider.failAfterReadback("patch-build");
    return packedCpuMorphologyResult(
      session,
      request,
      packed,
      totalStarted,
      "gpu-runtime-failed",
      "cpu-fallback",
      "patch-build",
      provider.snapshot(),
    );
  }
  return {
    sourceRevision: request.sourceRevision,
    backend: "webgpu",
    fallbackReason: null,
    changedPixels: diff.changedPixels,
    changedBounds: diff.changedBounds,
    patches: diff.patches,
    metrics: {
      totalMs: performance.now() - totalStarted,
      cpuStrategy: "not-run",
      failureStage: null,
      inputPixels: request.input.width * request.input.height,
      corePixels: request.core.width * request.core.height,
      backendPrepareMs: packed.packedPrepareMs,
      prepareStrategy: packed.prepareStrategy,
      directRleScanMs: packed.directRleScanMs,
      baseCacheFillMs: packed.baseCacheFillMs,
      packedAssembleMs: packed.packedAssembleMs,
      dirtyOverlayMs: packed.dirtyOverlayMs,
      baseCacheHitTiles: packed.baseCacheHitTiles,
      baseCacheMissTiles: packed.baseCacheMissTiles,
      baseCacheEvictedTiles: packed.baseCacheEvictedTiles,
      baseCacheRetainedBytes: packed.baseCacheRetainedBytes,
      sourceScratchCapacityBytes: packed.sourceScratchCapacityBytes,
      computeMs: gpu.metrics.totalMs,
      diffOrPatchMs: diff.diffMs,
      xorOutputStrategy: diff.xorOutputStrategy ?? "dense-word-scatter",
      xorTotalWords: diff.xorTotalWords ?? 0,
      xorNonZeroWords: diff.xorNonZeroWords ?? 0,
      xorWordDensity: diff.xorWordDensity ?? 0,
      xorChangedPixels: diff.changedPixels,
      xorTouchedTiles: diff.xorTouchedTiles ?? diff.patches.length,
      xorScanMs: diff.xorScanMs ?? 0,
      xorPatchAllocateMs: diff.xorPatchAllocateMs ?? 0,
      xorPatchScatterMs: diff.xorPatchScatterMs ?? 0,
      wordPatchBuildMs: diff.wordPatchBuildMs ?? 0,
      gpuUploadSubmitMs: gpu.metrics.uploadSubmitMs,
      gpuReadbackMs: gpu.metrics.readbackMs,
      gpuPassMs: gpu.metrics.gpuPassMs,
      fallbackMaterializeMs: null,
      cpuBudgetBytes: request.cpuComputeBudgetBytes,
      gpuBudgetBytes: request.gpuBufferBudgetBytes,
      cpuTransientBytes: (() => {
        const estimate = packedCpuEstimate(
          request,
          packed.sourceScratchCapacityBytes || packed.sourceWords.byteLength,
          packed.baseCacheRetainedBytes,
        );
        return estimate.requiredBytes - estimate.horizontalIntermediateBytes;
      })(),
      denseTransientBytes: 0,
      packedIntermediateBytes: 0,
      patchUpperBoundBytes: Math.ceil((request.core.width * request.core.height) / 8),
      inputAlphaBytes: 0,
      packedSourceBytes: packed.sourceWords.byteLength,
      xorReadbackBytes: gpu.xorWords.byteLength,
      allocatedGpuBytes: gpu.snapshot.allocatedBytes,
      gpuSourceCapacityBytes: gpu.snapshot.sourceCapacityBytes,
      gpuXorCapacityBytes: gpu.snapshot.xorCapacityBytes,
      gpuReadbackCapacityBytes: gpu.snapshot.readbackCapacityBytes,
      webGpuCircuitState: gpu.snapshot.circuitState,
      webGpuCooldownRemainingMs: gpu.snapshot.cooldownRemainingMs,
      webGpuConsecutiveFailures: gpu.snapshot.consecutiveFailures,
      webGpuDeviceLost: gpu.snapshot.deviceLost,
    },
  };
}

workerScope.onmessage = async (event) => {
  const request = event.data;
  if (request.kind === "register_session") {
    packedBaseCache.releaseSession(request.sessionId);
    sessions.set(request.sessionId, buildRasterMaskWorkerSession(request.sha256, request.rle));
    return;
  }
  if (request.kind === "release_session") {
    sessions.delete(request.sessionId);
    packedBaseCache.releaseSession(request.sessionId);
    if (sessions.size === 0) packedBaseCache.clear();
    return;
  }
  if (request.kind === "reset_webgpu") {
    await resetWebGpuProvider();
    return;
  }
  if (request.kind === "release_compute") {
    packedBaseCache.clear();
    await resetWebGpuProvider();
    return;
  }

  try {
    if (request.kind === "webgpu_warmup") {
      const providerPromise = webGpuProvider();
      let snapshot = disabledWebGpuSnapshot();
      if (providerPromise) {
        const provider = await providerPromise;
        provider.warmup();
        snapshot = provider.snapshot();
      }
      workerScope.postMessage({
        kind: "webgpu_warmup",
        id: request.id,
        ok: true,
        snapshot,
      });
      return;
    }
    if (request.kind === "tile_decode") {
      const alpha = decodeRasterMaskSessionTile(
        sessionFor(request.sessionId, request.sha256),
        request.rect,
      );
      workerScope.postMessage(
        {
          kind: "tile_decode",
          id: request.id,
          ok: true,
          sessionId: request.sessionId,
          sha256: request.sha256,
          rect: request.rect,
          alpha,
        },
        [alpha.buffer],
      );
      return;
    }
    if (request.kind === "tile_merge") {
      const rle = mergeRasterMaskSessionTiles(
        sessionFor(request.sessionId, request.sha256),
        request.tiles,
      );
      workerScope.postMessage(
        {
          kind: "tile_merge",
          id: request.id,
          ok: true,
          sessionId: request.sessionId,
          sha256: request.sha256,
          rle,
        },
        [rle.counts.buffer],
      );
      return;
    }
    if (request.kind === "morphology_roi") {
      const result = await runMorphologyRoi(request);
      workerScope.postMessage(
        {
          kind: "morphology_roi",
          id: request.id,
          ok: true,
          sessionId: request.sessionId,
          sha256: request.sha256,
          ...result,
        },
        result.patches.map((patch) => patch.xorBits.buffer),
      );
      return;
    }
    if (request.kind === "compare_tile") {
      const codes = compareRasterMaskSessionTile(
        sessionFor(request.current.sessionId, request.current.sha256),
        sessionFor(request.baseline.sessionId, request.baseline.sha256),
        request.rect,
        request.mode,
        request.sampleStep,
      );
      workerScope.postMessage(
        {
          kind: "compare_tile",
          id: request.id,
          ok: true,
          current: request.current,
          baseline: request.baseline,
          rect: request.rect,
          mode: request.mode,
          sampleStep: request.sampleStep,
          codes,
        },
        [codes.buffer],
      );
      return;
    }
    if (request.kind === "compare_metrics") {
      const metrics = compareRasterMaskSessionMetrics(
        sessionFor(request.current.sessionId, request.current.sha256),
        sessionFor(request.baseline.sessionId, request.baseline.sha256),
      );
      workerScope.postMessage({
        kind: "compare_metrics",
        id: request.id,
        ok: true,
        current: request.current,
        baseline: request.baseline,
        metrics,
      });
      return;
    }

    const [height, width] = request.rle.size;
    const alpha = decodeRasterMaskTransferredRle(request.rle);
    if (request.kind === "analyze") {
      const analysis = analyzeRasterMaskAlpha(alpha, width, height);
      workerScope.postMessage({ kind: "analyze", id: request.id, ok: true, analysis }, [
        analysis.crop.alpha.buffer,
      ]);
      return;
    }
    if (request.kind === "instance_operation") {
      const plan = applyMaskInstanceOperation(alpha, width, height, request.operation);
      const transfer = plan
        ? uniqueBuffers([
            plan.primary.buffer,
            plan.focusAlpha.buffer,
            ...plan.created.map((created) => created.buffer),
          ])
        : [];
      workerScope.postMessage(
        { kind: "instance_operation", id: request.id, ok: true, context: request.context, plan },
        transfer,
      );
      return;
    }
    const result = applyMaskOperation(alpha, width, height, request.operation);
    workerScope.postMessage(
      { kind: "operation", id: request.id, ok: true, context: request.context, result },
      result.alpha.buffer instanceof ArrayBuffer ? [result.alpha.buffer] : [],
    );
  } catch (error) {
    workerScope.postMessage({
      kind: request.kind,
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
