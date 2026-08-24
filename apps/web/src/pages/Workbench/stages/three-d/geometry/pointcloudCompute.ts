import { colorizePoints, type CameraSample } from "./colorize";
import { buildDepthRaster } from "./depthmap";
import { getPointCloudComputeSession, PointCloudComputeSession } from "./pointCloudComputeSession";

type WorkerFactory = () => Worker;

export function colorizePointsOnMainThread(
  positions: Float32Array,
  baseColors: Float32Array | null,
  samples: CameraSample[],
): Float32Array {
  const rasters = samples.map((sample) =>
    buildDepthRaster(positions, sample.calib, sample.width, sample.height),
  );
  return colorizePoints(positions, baseColors, samples, rasters);
}

export async function colorizePointsAsync(
  positions: Float32Array,
  baseColors: Float32Array | null,
  samples: CameraSample[],
  options: {
    createWorker?: WorkerFactory | null;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<Float32Array> {
  if (options.signal?.aborted) {
    throw new DOMException("Point-cloud colorization aborted", "AbortError");
  }
  if (
    samples.length === 0 ||
    options.createWorker === null ||
    (typeof Worker === "undefined" && !options.createWorker)
  ) {
    return colorizePointsOnMainThread(positions, baseColors, samples);
  }

  const customSession = options.createWorker
    ? new PointCloudComputeSession(options.createWorker)
    : null;
  const session = customSession ?? getPointCloudComputeSession();
  try {
    return await session.colorize(positions, baseColors, samples, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn("[pointcloud-worker] fallback to main thread", error);
    return colorizePointsOnMainThread(positions, baseColors, samples);
  } finally {
    customSession?.dispose();
  }
}
