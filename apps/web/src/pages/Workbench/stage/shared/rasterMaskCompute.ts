import type { CocoRle } from "./geometry/maskRle";
import { decodeCocoRle } from "./geometry/maskRle";
import {
  applyMaskOperation,
  type MaskOperationResult,
  type MaskOperationSpec,
} from "./geometry/maskOperations";
import {
  applyMaskInstanceOperation,
  type MaskInstanceOperationPlan,
  type MaskInstanceOperationSpec,
} from "./geometry/maskInstanceOperations";
import { analyzeRasterMaskAlpha, type RasterMaskAnalysis } from "./rasterMaskRender";

export interface RasterMaskOperationContext {
  sessionId: string;
  generation: number;
  operationId: number;
}

type AnalysisWorkerRequest = { kind: "analyze"; id: number; rle: CocoRle };
type OperationWorkerRequest = {
  kind: "operation";
  id: number;
  rle: CocoRle;
  operation: MaskOperationSpec;
  context: RasterMaskOperationContext;
};
type InstanceOperationWorkerRequest = {
  kind: "instance_operation";
  id: number;
  rle: CocoRle;
  operation: MaskInstanceOperationSpec;
  context: RasterMaskOperationContext;
};
export type RasterMaskWorkerRequest =
  | AnalysisWorkerRequest
  | OperationWorkerRequest
  | InstanceOperationWorkerRequest;

type RasterMaskWorkerResponse =
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

type WorkerFactory = () => Worker;

export class RasterMaskWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RasterMaskWorkerError";
  }
}

export class RasterMaskWorkerCancelledError extends Error {
  constructor() {
    super("Raster Mask operation was cancelled");
    this.name = "RasterMaskWorkerCancelledError";
  }
}

function createDefaultWorker(): Worker {
  return new Worker(new URL("./rasterMask.worker.ts", import.meta.url), { type: "module" });
}

function analyzeSynchronously(rle: CocoRle): RasterMaskAnalysis {
  const [height, width] = rle.size;
  return analyzeRasterMaskAlpha(decodeCocoRle(rle), width, height);
}

/** Decode and analyze an RLE outside the UI thread. */
export function analyzeRasterMaskRleAsync(
  rle: CocoRle,
  options: { createWorker?: WorkerFactory | null } = {},
): Promise<RasterMaskAnalysis> {
  const explicitFallback = options.createWorker === null;
  if (
    explicitFallback
    || (typeof Worker === "undefined" && options.createWorker === undefined && import.meta.env.MODE === "test")
  ) {
    return Promise.resolve(analyzeSynchronously(rle));
  }
  if (typeof Worker === "undefined" && options.createWorker === undefined) {
    return Promise.reject(new RasterMaskWorkerError("Raster Mask Worker is unavailable"));
  }

  let worker: Worker;
  try {
    worker = (options.createWorker ?? createDefaultWorker)();
  } catch (error) {
    return Promise.reject(new RasterMaskWorkerError(String(error)));
  }
  const id = 1;
  return new Promise<RasterMaskAnalysis>((resolve, reject) => {
    const dispose = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<RasterMaskWorkerResponse>) => {
      if (event.data.id !== id || event.data.kind !== "analyze") return;
      dispose();
      if (event.data.ok) resolve(event.data.analysis);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      dispose();
      reject(new RasterMaskWorkerError(event.message || "Raster Mask Worker failed"));
    };
    const request: AnalysisWorkerRequest = { kind: "analyze", id, rle };
    try {
      worker.postMessage(request);
    } catch (error) {
      dispose();
      reject(new RasterMaskWorkerError(String(error)));
    }
  });
}

export function executeRasterMaskOperationAsync(
  rle: CocoRle,
  operation: MaskOperationSpec,
  context: RasterMaskOperationContext,
  options: { createWorker?: WorkerFactory | null; signal?: AbortSignal } = {},
): Promise<{ context: RasterMaskOperationContext; result: MaskOperationResult }> {
  if (options.signal?.aborted) return Promise.reject(new RasterMaskWorkerCancelledError());
  const explicitFallback = options.createWorker === null;
  if (
    explicitFallback
    || (typeof Worker === "undefined" && options.createWorker === undefined && import.meta.env.MODE === "test")
  ) {
    const [height, width] = rle.size;
    return Promise.resolve({
      context,
      result: applyMaskOperation(decodeCocoRle(rle), width, height, operation),
    });
  }
  if (typeof Worker === "undefined" && options.createWorker === undefined) {
    return Promise.reject(new RasterMaskWorkerError("Raster Mask Worker is unavailable"));
  }

  let worker: Worker;
  try {
    worker = (options.createWorker ?? createDefaultWorker)();
  } catch (error) {
    return Promise.reject(new RasterMaskWorkerError(String(error)));
  }
  const id = context.operationId;
  return new Promise((resolve, reject) => {
    let settled = false;
    const dispose = () => {
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      dispose();
      callback();
    };
    const abort = () => finish(() => reject(new RasterMaskWorkerCancelledError()));
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<RasterMaskWorkerResponse>) => {
      const response = event.data;
      if (response.id !== id || response.kind !== "operation") return;
      finish(() => {
        if (response.ok) resolve({ context: response.context, result: response.result });
        else reject(new Error(response.error));
      });
    };
    worker.onerror = (event) => {
      finish(() => reject(new RasterMaskWorkerError(event.message || "Raster Mask Worker failed")));
    };
    const request: OperationWorkerRequest = { kind: "operation", id, rle, operation, context };
    try {
      worker.postMessage(request);
    } catch (error) {
      finish(() => reject(new RasterMaskWorkerError(String(error))));
    }
  });
}

export function executeRasterMaskInstanceOperationAsync(
  rle: CocoRle,
  operation: MaskInstanceOperationSpec,
  context: RasterMaskOperationContext,
  options: { createWorker?: WorkerFactory | null; signal?: AbortSignal } = {},
): Promise<{ context: RasterMaskOperationContext; plan: MaskInstanceOperationPlan | null }> {
  if (options.signal?.aborted) return Promise.reject(new RasterMaskWorkerCancelledError());
  const explicitFallback = options.createWorker === null;
  if (
    explicitFallback
    || (typeof Worker === "undefined" && options.createWorker === undefined && import.meta.env.MODE === "test")
  ) {
    const [height, width] = rle.size;
    return Promise.resolve({
      context,
      plan: applyMaskInstanceOperation(decodeCocoRle(rle), width, height, operation),
    });
  }
  if (typeof Worker === "undefined" && options.createWorker === undefined) {
    return Promise.reject(new RasterMaskWorkerError("Raster Mask Worker is unavailable"));
  }

  let worker: Worker;
  try {
    worker = (options.createWorker ?? createDefaultWorker)();
  } catch (error) {
    return Promise.reject(new RasterMaskWorkerError(String(error)));
  }
  const id = context.operationId;
  return new Promise((resolve, reject) => {
    let settled = false;
    const dispose = () => {
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      dispose();
      callback();
    };
    const abort = () => finish(() => reject(new RasterMaskWorkerCancelledError()));
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<RasterMaskWorkerResponse>) => {
      const response = event.data;
      if (response.id !== id || response.kind !== "instance_operation") return;
      finish(() => {
        if (response.ok) resolve({ context: response.context, plan: response.plan });
        else reject(new Error(response.error));
      });
    };
    worker.onerror = (event) => {
      finish(() => reject(new RasterMaskWorkerError(event.message || "Raster Mask Worker failed")));
    };
    const request: InstanceOperationWorkerRequest = {
      kind: "instance_operation",
      id,
      rle,
      operation,
      context,
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      finish(() => reject(new RasterMaskWorkerError(String(error))));
    }
  });
}
