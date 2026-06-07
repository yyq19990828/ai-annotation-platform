import { colorizePoints, type CameraSample } from "./colorize";
import { buildDepthRaster } from "./depthmap";

type PointcloudWorkerRequest = {
  reqId: number;
  kind: "colorize";
  positions: Float32Array;
  baseColors: Float32Array | null;
  samples: CameraSample[];
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<PointcloudWorkerRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const ctx = self as unknown as WorkerScope;

ctx.onmessage = (event: MessageEvent<PointcloudWorkerRequest>) => {
  const msg = event.data;
  if (msg.kind !== "colorize") return;
  try {
    const rasters = msg.samples.map((s) =>
      buildDepthRaster(msg.positions, s.calib, s.width, s.height),
    );
    const colors = colorizePoints(msg.positions, msg.baseColors, msg.samples, rasters);
    ctx.postMessage({ reqId: msg.reqId, ok: true, colors }, [colors.buffer as Transferable]);
  } catch (err) {
    ctx.postMessage({
      reqId: msg.reqId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
