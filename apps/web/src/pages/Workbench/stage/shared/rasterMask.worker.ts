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
  mergeRasterMaskSessionTiles,
  preparePackedRasterMaskMorphologyRoi,
  prepareRasterMaskMorphologyRoi,
  type RasterMaskWorkerSession,
  validateRasterMaskMorphologyRoiRequest,
} from "./rasterMaskWorkerRuntime";
import type {
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

function uniqueBuffers(buffers: ArrayBuffer[]): Transferable[] {
  return [...new Set(buffers)] as Transferable[];
}

function cpuMorphologyResult(
  session: RasterMaskWorkerSession,
  request: RasterMaskMorphologyRoiRequest,
  prepared: ReturnType<typeof prepareRasterMaskMorphologyRoi> | null,
  totalStarted: number,
  fallbackReason: RasterMaskMorphologyRoiResponse["fallbackReason"],
  backend: "cpu" | "cpu-fallback" = "cpu",
  allocatedGpuBytes = 0,
  priorPacked: ReturnType<typeof preparePackedRasterMaskMorphologyRoi> | null = null,
): Omit<RasterMaskMorphologyRoiResponse, "kind" | "id" | "ok" | "sessionId" | "sha256"> {
  const dense = prepared ?? prepareRasterMaskMorphologyRoi(session, request);
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
    backend,
    fallbackReason,
    changedPixels: diff.changedPixels,
    changedBounds: diff.changedBounds,
    patches: diff.patches,
    metrics: {
      totalMs: performance.now() - totalStarted,
      backendPrepareMs: (priorPacked?.packedPrepareMs ?? 0) + dense.materializeMs,
      prepareStrategy: priorPacked?.prepareStrategy ?? "dense-cpu",
      directRleScanMs: priorPacked?.directRleScanMs ?? 0,
      baseCacheFillMs: priorPacked?.baseCacheFillMs ?? 0,
      packedAssembleMs: priorPacked?.packedAssembleMs ?? 0,
      dirtyOverlayMs: priorPacked?.dirtyOverlayMs ?? 0,
      baseCacheHitTiles: priorPacked?.baseCacheHitTiles ?? 0,
      baseCacheMissTiles: priorPacked?.baseCacheMissTiles ?? 0,
      baseCacheEvictedTiles: priorPacked?.baseCacheEvictedTiles ?? 0,
      baseCacheRetainedBytes: priorPacked?.baseCacheRetainedBytes ?? 0,
      sourceScratchCapacityBytes: priorPacked?.sourceScratchCapacityBytes ?? 0,
      computeMs,
      diffOrPatchMs: diff.diffMs,
      xorOutputStrategy: backend === "cpu-fallback" ? "cpu-after-gpu-failure" : "cpu-dense",
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
      fallbackMaterializeMs: backend === "cpu-fallback" ? dense.materializeMs : null,
      inputAlphaBytes: dense.source.byteLength,
      packedSourceBytes: priorPacked?.sourceWords.byteLength ?? 0,
      xorReadbackBytes: 0,
      allocatedGpuBytes,
      gpuSourceCapacityBytes: 0,
      gpuXorCapacityBytes: 0,
      gpuReadbackCapacityBytes: 0,
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
  if (
    request.computeBudgetBytes <= 0 ||
    (request.computeBudgetBytes <= 64 * 1024 * 1024 &&
      (request.input.width > 2_112 || request.input.height > 2_112))
  ) {
    return "budget-insufficient";
  }
  return null;
}

async function runMorphologyRoi(
  request: RasterMaskMorphologyRoiRequest,
): Promise<Omit<RasterMaskMorphologyRoiResponse, "kind" | "id" | "ok" | "sessionId" | "sha256">> {
  const totalStarted = performance.now();
  const session = sessionFor(request.sessionId, request.sha256);
  validateRasterMaskMorphologyRoiRequest(session, request);
  const routeFailure = webGpuRouteFailure(request);
  if (routeFailure) {
    return cpuMorphologyResult(session, request, null, totalStarted, routeFailure);
  }

  let provider: RasterMaskWebGpuProvider;
  try {
    provider = await webGpuProvider()!;
  } catch {
    return cpuMorphologyResult(session, request, null, totalStarted, "initialization-failed");
  }
  const shape = {
    inputWidth: request.input.width,
    inputHeight: request.input.height,
    coreWidth: request.core.width,
    coreHeight: request.core.height,
    radius: request.operation.radius,
    budgetBytes: request.computeBudgetBytes,
  };
  const preflightFailure = provider.preflightSquareDilateXor(shape);
  if (preflightFailure) {
    return cpuMorphologyResult(session, request, null, totalStarted, preflightFailure);
  }
  const packedSourceBytes = Math.ceil(request.input.width / 32) * request.input.height * 4;
  const cacheCapBytes = rasterMaskPackedBaseCacheCapBytes(request.computeBudgetBytes);
  const prospectiveScratchCapacityBytes =
    packedBaseCache.prospectiveScratchCapacityBytes(packedSourceBytes);
  const cacheReservationBytes =
    cacheCapBytes + Math.max(0, prospectiveScratchCapacityBytes - packedSourceBytes);
  const cacheBudgetFailure = provider.preflightSquareDilateXor({
    ...shape,
    reservedBytes: cacheReservationBytes,
  });
  let packed: ReturnType<typeof preparePackedRasterMaskMorphologyRoi>;
  if (cacheBudgetFailure === null && cacheCapBytes > 0) {
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
  const reservedBytes =
    packed.baseCacheRetainedBytes +
    Math.max(0, packed.sourceScratchCapacityBytes - packed.sourceWords.byteLength);
  const gpu = await provider.runSquareDilateXor({
    ...shape,
    reservedBytes,
    sourceWords: packed.sourceWords,
    sourceWordsPerRow: packed.wordsPerRow,
    coreOffsetX: request.core.x - request.input.x,
    coreOffsetY: request.core.y - request.input.y,
  });
  if (!gpu.ok) {
    return cpuMorphologyResult(
      session,
      request,
      null,
      totalStarted,
      gpu.reason,
      gpu.attemptedGpu ? "cpu-fallback" : "cpu",
      gpu.allocatedBytes,
      packed,
    );
  }
  const diff = buildRasterMaskMorphologyPatchesFromXorWords(
    session,
    request,
    gpu.xorWords,
    gpu.xorWordsPerRow,
    request.benchmarkXorPatchStrategy ?? "dense-word-scatter",
  );
  return {
    sourceRevision: request.sourceRevision,
    backend: "webgpu",
    fallbackReason: null,
    changedPixels: diff.changedPixels,
    changedBounds: diff.changedBounds,
    patches: diff.patches,
    metrics: {
      totalMs: performance.now() - totalStarted,
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
      inputAlphaBytes: 0,
      packedSourceBytes: packed.sourceWords.byteLength,
      xorReadbackBytes: gpu.xorWords.byteLength,
      allocatedGpuBytes: gpu.snapshot.allocatedBytes,
      gpuSourceCapacityBytes: gpu.snapshot.sourceCapacityBytes,
      gpuXorCapacityBytes: gpu.snapshot.xorCapacityBytes,
      gpuReadbackCapacityBytes: gpu.snapshot.readbackCapacityBytes,
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
      [result.alpha.buffer],
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
