import { applyMaskInstanceOperation } from "./geometry/maskInstanceOperations";
import { applyMaskMorphology, applyMaskOperation } from "./geometry/maskOperations";
import { analyzeRasterMaskAlpha } from "./rasterMaskRender";
import type { RasterMaskWorkerRequest, RasterMaskWorkerResponse } from "./rasterMaskWorkerProtocol";
import {
  buildRasterMaskWorkerSession,
  compareRasterMaskSessionTile,
  compareRasterMaskSessionMetrics,
  decodeRasterMaskSessionTile,
  decodeRasterMaskTransferredRle,
  diffRasterMaskMorphologyRoi,
  mergeRasterMaskSessionTiles,
  prepareRasterMaskMorphologyRoi,
  type RasterMaskWorkerSession,
} from "./rasterMaskWorkerRuntime";
import type {
  RasterMaskMorphologyRoiRequest,
  RasterMaskMorphologyRoiResponse,
  RasterMaskWebGpuWorkerSnapshot,
} from "./rasterMaskWorkerProtocol";
import type { RasterMaskWebGpuProvider } from "./rasterMaskWebGpu";

type WorkerScope = {
  onmessage: ((event: MessageEvent<RasterMaskWorkerRequest>) => void) | null;
  postMessage: (message: RasterMaskWorkerResponse, transfer?: Transferable[]) => void;
};

const workerScope = self as unknown as WorkerScope;
const sessions = new Map<string, RasterMaskWorkerSession>();
const webGpuGateEnabled = import.meta.env.VITE_EXPERIMENTAL_RASTER_MASK_WEBGPU === "true";
let webGpuProviderPromise: Promise<RasterMaskWebGpuProvider> | null = null;

function disabledWebGpuSnapshot(): RasterMaskWebGpuWorkerSnapshot {
  return {
    state: "disabled",
    allocatedBytes: 0,
    capacityBytes: 0,
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
  prepared: ReturnType<typeof prepareRasterMaskMorphologyRoi>,
  totalStarted: number,
  fallbackReason: RasterMaskMorphologyRoiResponse["fallbackReason"],
  backend: "cpu" | "cpu-fallback" = "cpu",
  allocatedGpuBytes = 0,
): Omit<RasterMaskMorphologyRoiResponse, "kind" | "id" | "ok" | "sessionId" | "sha256"> {
  const computeStarted = performance.now();
  const after = applyMaskMorphology(
    prepared.source,
    request.input.width,
    request.input.height,
    request.operation,
  ).alpha;
  const computeMs = performance.now() - computeStarted;
  const diff = diffRasterMaskMorphologyRoi(
    session,
    request,
    prepared.source,
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
      materializeMs: prepared.materializeMs,
      computeMs,
      diffMs: diff.diffMs,
      allocatedGpuBytes,
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
  const packedBytes = Math.ceil(request.input.width / 32) * request.input.height * 4;
  if (packedBytes * 5 + 16 > request.computeBudgetBytes) return "budget-insufficient";
  return null;
}

async function runMorphologyRoi(
  request: RasterMaskMorphologyRoiRequest,
): Promise<Omit<RasterMaskMorphologyRoiResponse, "kind" | "id" | "ok" | "sessionId" | "sha256">> {
  const totalStarted = performance.now();
  const session = sessionFor(request.sessionId, request.sha256);
  const prepared = prepareRasterMaskMorphologyRoi(session, request);
  const routeFailure = webGpuRouteFailure(request);
  if (routeFailure) {
    return cpuMorphologyResult(session, request, prepared, totalStarted, routeFailure);
  }

  let provider: RasterMaskWebGpuProvider;
  try {
    provider = await webGpuProvider()!;
  } catch {
    return cpuMorphologyResult(session, request, prepared, totalStarted, "initialization-failed");
  }
  const gpu = await provider.runSquareDilate({
    alpha: prepared.source,
    width: request.input.width,
    height: request.input.height,
    radius: request.operation.radius,
    budgetBytes: request.computeBudgetBytes,
  });
  if (!gpu.ok) {
    return cpuMorphologyResult(
      session,
      request,
      prepared,
      totalStarted,
      gpu.reason,
      gpu.attemptedGpu ? "cpu-fallback" : "cpu",
      gpu.allocatedBytes,
    );
  }
  const diff = diffRasterMaskMorphologyRoi(
    session,
    request,
    prepared.source,
    (_inputIndex, localX, localY) =>
      ((gpu.words[localY * gpu.wordsPerRow + (localX >>> 5)] >>> (localX & 31)) & 1) === 1,
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
      materializeMs: prepared.materializeMs,
      computeMs: gpu.computeMs,
      diffMs: diff.diffMs,
      allocatedGpuBytes: gpu.allocatedBytes,
    },
  };
}

workerScope.onmessage = async (event) => {
  const request = event.data;
  if (request.kind === "register_session") {
    sessions.set(request.sessionId, buildRasterMaskWorkerSession(request.sha256, request.rle));
    return;
  }
  if (request.kind === "release_session") {
    sessions.delete(request.sessionId);
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
