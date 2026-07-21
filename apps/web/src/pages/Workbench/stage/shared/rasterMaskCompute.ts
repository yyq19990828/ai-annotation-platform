import type { CocoRle } from "./geometry/maskRle";
import { decodeCocoRle } from "./geometry/maskRle";
import { analyzeRasterMaskAlpha, type RasterMaskAnalysis } from "./rasterMaskRender";

type WorkerRequest = { id: number; rle: CocoRle };
type WorkerResponse =
  | { id: number; ok: true; analysis: RasterMaskAnalysis }
  | { id: number; ok: false; error: string };

type WorkerFactory = () => Worker;

export class RasterMaskWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RasterMaskWorkerError";
  }
}

function createDefaultWorker(): Worker {
  return new Worker(new URL("./rasterMask.worker.ts", import.meta.url), { type: "module" });
}

function analyzeSynchronously(rle: CocoRle): RasterMaskAnalysis {
  const [height, width] = rle.size;
  return analyzeRasterMaskAlpha(decodeCocoRle(rle), width, height);
}

/**
 * Decode and analyze an RLE outside the UI thread. The synchronous path is
 * restricted to tests or an explicitly injected null worker factory.
 */
export function analyzeRasterMaskRleAsync(
  rle: CocoRle,
  options: { createWorker?: WorkerFactory | null } = {},
): Promise<RasterMaskAnalysis> {
  const explicitFallback = options.createWorker === null;
  if (explicitFallback || (typeof Worker === "undefined" && import.meta.env.MODE === "test")) {
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
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return;
      dispose();
      if (event.data.ok) resolve(event.data.analysis);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      dispose();
      reject(new RasterMaskWorkerError(event.message || "Raster Mask Worker failed"));
    };
    const request: WorkerRequest = { id, rle };
    try {
      worker.postMessage(request);
    } catch (error) {
      dispose();
      reject(new RasterMaskWorkerError(String(error)));
    }
  });
}
