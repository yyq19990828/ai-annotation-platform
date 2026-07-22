import { decodeCocoRle } from "./geometry/maskRle";
import { applyMaskOperation } from "./geometry/maskOperations";
import { applyMaskInstanceOperation } from "./geometry/maskInstanceOperations";
import {
  analyzeRasterMaskAlpha,
  type RasterMaskAnalysis,
} from "./rasterMaskRender";
import type {
  RasterMaskOperationContext,
  RasterMaskWorkerRequest,
} from "./rasterMaskCompute";
import type { MaskOperationResult } from "./geometry/maskOperations";
import type { MaskInstanceOperationPlan } from "./geometry/maskInstanceOperations";

type WorkerResponse =
  | { kind: "analyze"; id: number; ok: true; analysis: RasterMaskAnalysis }
  | { kind: "operation"; id: number; ok: true; context: RasterMaskOperationContext; result: MaskOperationResult }
  | {
      kind: "instance_operation";
      id: number;
      ok: true;
      context: RasterMaskOperationContext;
      plan: MaskInstanceOperationPlan | null;
    }
  | { kind: "analyze" | "operation" | "instance_operation"; id: number; ok: false; error: string };

type WorkerScope = {
  onmessage: ((event: MessageEvent<RasterMaskWorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  const request = event.data;
  try {
    const [height, width] = request.rle.size;
    const alpha = decodeCocoRle(request.rle);
    if (request.kind === "analyze") {
      const analysis = analyzeRasterMaskAlpha(alpha, width, height);
      workerScope.postMessage(
        { kind: "analyze", id: request.id, ok: true, analysis },
        [analysis.crop.alpha.buffer],
      );
      return;
    }
    if (request.kind === "instance_operation") {
      const plan = applyMaskInstanceOperation(alpha, width, height, request.operation);
      const transfer = plan
        ? [plan.primary.buffer, plan.focusAlpha.buffer, ...plan.created.map((created) => created.buffer)]
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
