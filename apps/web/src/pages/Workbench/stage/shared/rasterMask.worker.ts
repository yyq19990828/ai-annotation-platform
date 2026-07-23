import { applyMaskInstanceOperation } from "./geometry/maskInstanceOperations";
import { applyMaskOperation } from "./geometry/maskOperations";
import { analyzeRasterMaskAlpha } from "./rasterMaskRender";
import type { RasterMaskWorkerRequest, RasterMaskWorkerResponse } from "./rasterMaskWorkerProtocol";
import {
  buildRasterMaskWorkerSession,
  compareRasterMaskSessionTile,
  compareRasterMaskSessionMetrics,
  decodeRasterMaskSessionTile,
  decodeRasterMaskTransferredRle,
  mergeRasterMaskSessionTiles,
  type RasterMaskWorkerSession,
} from "./rasterMaskWorkerRuntime";

type WorkerScope = {
  onmessage: ((event: MessageEvent<RasterMaskWorkerRequest>) => void) | null;
  postMessage: (message: RasterMaskWorkerResponse, transfer?: Transferable[]) => void;
};

const workerScope = self as unknown as WorkerScope;
const sessions = new Map<string, RasterMaskWorkerSession>();

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

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === "register_session") {
    sessions.set(request.sessionId, buildRasterMaskWorkerSession(request.sha256, request.rle));
    return;
  }
  if (request.kind === "release_session") {
    sessions.delete(request.sessionId);
    return;
  }

  try {
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
