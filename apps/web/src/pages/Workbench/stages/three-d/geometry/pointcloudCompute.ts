import { colorizePoints, type CameraSample } from "./colorize";
import { buildDepthRaster } from "./depthmap";

type PointcloudWorkerResponse =
  | { reqId: number; ok: true; colors: Float32Array }
  | { reqId: number; ok: false; error: string };

type PointcloudWorkerRequest = {
  reqId: number;
  kind: "colorize";
  positions: Float32Array;
  baseColors: Float32Array | null;
  samples: CameraSample[];
};

type WorkerFactory = () => Worker;

let nextReqId = 1;

function createDefaultWorker(): Worker {
  return new Worker(new URL("./pointcloud.worker.ts", import.meta.url), { type: "module" });
}

export function colorizePointsOnMainThread(
  positions: Float32Array,
  baseColors: Float32Array | null,
  samples: CameraSample[],
): Float32Array {
  const rasters = samples.map((s) => buildDepthRaster(positions, s.calib, s.width, s.height));
  return colorizePoints(positions, baseColors, samples, rasters);
}

function cloneSample(sample: CameraSample): CameraSample {
  return {
    ...sample,
    data: sample.data.slice(),
  };
}

function transferList(req: PointcloudWorkerRequest): Transferable[] {
  const transfers: Transferable[] = [req.positions.buffer];
  if (req.baseColors) transfers.push(req.baseColors.buffer);
  for (const sample of req.samples) transfers.push(sample.data.buffer);
  return transfers;
}

export async function colorizePointsAsync(
  positions: Float32Array,
  baseColors: Float32Array | null,
  samples: CameraSample[],
  opts: {
    createWorker?: WorkerFactory | null;
    timeoutMs?: number;
  } = {},
): Promise<Float32Array> {
  if (samples.length === 0) {
    return colorizePointsOnMainThread(positions, baseColors, samples);
  }
  if (typeof Worker === "undefined" && !opts.createWorker) {
    return colorizePointsOnMainThread(positions, baseColors, samples);
  }

  let worker: Worker;
  try {
    worker = (opts.createWorker ?? createDefaultWorker)();
  } catch (err) {
    console.warn("[pointcloud-worker] fallback to main thread", err);
    return colorizePointsOnMainThread(positions, baseColors, samples);
  }

  const reqId = nextReqId;
  nextReqId += 1;
  const req: PointcloudWorkerRequest = {
    reqId,
    kind: "colorize",
    positions: positions.slice(),
    baseColors: baseColors?.slice() ?? null,
    samples: samples.map(cloneSample),
  };

  return new Promise((resolve) => {
    let done = false;
    const finish = (colors: Float32Array) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      worker.terminate();
      resolve(colors);
    };
    const fallback = (err: unknown) => {
      if (done) return;
      console.warn("[pointcloud-worker] fallback to main thread", err);
      finish(colorizePointsOnMainThread(positions, baseColors, samples));
    };
    const timer = window.setTimeout(
      () => fallback(new Error("pointcloud worker timeout")),
      opts.timeoutMs ?? 10_000,
    );

    worker.onmessage = (event: MessageEvent<PointcloudWorkerResponse>) => {
      const msg = event.data;
      if (msg.reqId !== reqId) return;
      if (msg.ok) finish(msg.colors);
      else fallback(new Error(msg.error));
    };
    worker.onerror = (event) => fallback(event.error ?? event.message);

    try {
      worker.postMessage(req, transferList(req));
    } catch (err) {
      fallback(err);
    }
  });
}
