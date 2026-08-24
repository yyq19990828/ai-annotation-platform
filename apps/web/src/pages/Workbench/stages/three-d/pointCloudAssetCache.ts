import type { TaskPointCloudManifestResponse } from "@/api/generated";
import type { SensorCalibration } from "@/types";

import type { LidarAxisConvention } from "./geometry/axisConvention";
import type { GpuDepthRaster } from "./geometry/depthmap";
import {
  decodePointCloudFrameAsync,
  getPointCloudComputeSession,
} from "./geometry/pointCloudComputeSession";
import type { DecodedPointCloudFrame } from "./geometry/pointcloudFrame";
import { markPointCloudStage } from "./pointCloudTiming";

const POINT_CLOUD_CACHE_LIMIT = 3;
const DECODED_FRAME_CACHE_LIMIT = 3;
const CAMERA_ASSET_CACHE_LIMIT = 18;
const DEPTH_RASTER_CACHE_LIMIT = 8;
const DEPTH_RASTER_CACHE_BUDGET_BYTES = 8 * 1024 * 1024;

const pointCloudBuffers = new Map<string, Promise<ArrayBuffer>>();
const decodedFrames = new Map<string, Promise<DecodedPointCloudFrame>>();
const cameraBlobs = new Map<string, Promise<Blob>>();

interface DepthRasterCacheEntry {
  promise: Promise<GpuDepthRaster[]>;
  bytes: number;
}

const depthRasters = new Map<string, DepthRasterCacheEntry>();
let depthRasterCacheBytes = 0;

interface CameraBitmapEntry {
  promise: Promise<ImageBitmap>;
  bitmap: ImageBitmap | null;
  references: number;
}

const cameraBitmaps = new Map<string, CameraBitmapEntry>();

export interface PointCloudAssetCacheDiagnostics {
  pointCloudBuffers: number;
  decodedFrames: number;
  cameraBlobs: number;
  cameraBitmaps: number;
  cameraBitmapReferences: number;
  depthRasters: number;
  depthRasterBytes: number;
  depthRasterInFlight: number;
}

/** Read-only cache counters used by the local renderer benchmark. */
export function getPointCloudAssetCacheDiagnostics(): PointCloudAssetCacheDiagnostics {
  return {
    pointCloudBuffers: pointCloudBuffers.size,
    decodedFrames: decodedFrames.size,
    cameraBlobs: cameraBlobs.size,
    cameraBitmaps: cameraBitmaps.size,
    cameraBitmapReferences: [...cameraBitmaps.values()].reduce(
      (total, entry) => total + entry.references,
      0,
    ),
    depthRasters: depthRasters.size,
    depthRasterBytes: depthRasterCacheBytes,
    depthRasterInFlight: [...depthRasters.values()].filter((entry) => entry.bytes === 0).length,
  };
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (
    window as Window & {
      __pointCloudAssetCacheDiagnostics?: () => PointCloudAssetCacheDiagnostics;
    }
  ).__pointCloudAssetCacheDiagnostics = getPointCloudAssetCacheDiagnostics;
}

function touch<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
}

function trimOldest<T>(cache: Map<string, T>, limit: number): void {
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

function trimCameraBitmaps(): void {
  if (cameraBitmaps.size <= CAMERA_ASSET_CACHE_LIMIT) return;
  for (const [url, entry] of cameraBitmaps) {
    if (cameraBitmaps.size <= CAMERA_ASSET_CACHE_LIMIT) break;
    if (entry.references > 0 || !entry.bitmap) continue;
    cameraBitmaps.delete(url);
    entry.bitmap.close();
  }
}

function trimDepthRasters(): void {
  while (
    depthRasters.size > DEPTH_RASTER_CACHE_LIMIT ||
    depthRasterCacheBytes > DEPTH_RASTER_CACHE_BUDGET_BYTES
  ) {
    const oldest = depthRasters.entries().next().value;
    if (!oldest) return;
    const [key, entry] = oldest;
    depthRasters.delete(key);
    depthRasterCacheBytes = Math.max(0, depthRasterCacheBytes - entry.bytes);
  }
}

function depthRasterKey(
  pointCloudUrl: string,
  positions: Float32Array,
  cameras: readonly CameraDepthRasterInput[],
): string {
  return JSON.stringify([
    pointCloudUrl,
    positions.length,
    cameras.map((camera) => [
      camera.width,
      camera.height,
      camera.calibration.extrinsic,
      camera.calibration.intrinsic,
      camera.calibration.rect ?? null,
    ]),
  ]);
}

/** Shared in-flight/raw-byte cache used by active loads and timeline prefetch. */
export function loadPointCloudBuffer(url: string): Promise<ArrayBuffer> {
  const cached = pointCloudBuffers.get(url);
  if (cached) {
    touch(pointCloudBuffers, url, cached);
    return cached;
  }

  const request = fetch(url, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`点云资源加载失败: ${response.status}`);
      return response.arrayBuffer();
    })
    .catch((error) => {
      if (pointCloudBuffers.get(url) === request) pointCloudBuffers.delete(url);
      throw error;
    });
  pointCloudBuffers.set(url, request);
  trimOldest(pointCloudBuffers, POINT_CLOUD_CACHE_LIMIT);
  return request;
}

export async function prefetchPointCloudBuffer(url: string): Promise<void> {
  await loadPointCloudBuffer(url);
}

function decodedPointCloudFrameRequest(
  url: string,
  convention: LidarAxisConvention,
  decimateThreshold: number,
): { promise: Promise<DecodedPointCloudFrame>; cacheHit: boolean } {
  const key = `${url}\n${convention}\n${decimateThreshold}`;
  const cached = decodedFrames.get(key);
  if (cached) {
    touch(decodedFrames, key, cached);
    return { promise: cached, cacheHit: true };
  }
  const request = loadPointCloudBuffer(url)
    .then((buffer) => decodePointCloudFrameAsync(buffer, convention, decimateThreshold))
    .catch((error) => {
      if (decodedFrames.get(key) === request) decodedFrames.delete(key);
      throw error;
    });
  decodedFrames.set(key, request);
  trimOldest(decodedFrames, DECODED_FRAME_CACHE_LIMIT);
  return { promise: request, cacheHit: false };
}

export function loadDecodedPointCloudFrame(
  url: string,
  convention: LidarAxisConvention,
  decimateThreshold: number,
): Promise<DecodedPointCloudFrame> {
  return decodedPointCloudFrameRequest(url, convention, decimateThreshold).promise;
}

/** Active-scene load with one unambiguous cache/timing event for the benchmark trace. */
export async function loadTimedDecodedPointCloudFrame(
  url: string,
  convention: LidarAxisConvention,
  decimateThreshold: number,
): Promise<DecodedPointCloudFrame> {
  const startedAt = performance.now();
  const request = decodedPointCloudFrameRequest(url, convention, decimateThreshold);
  const frame = await request.promise;
  markPointCloudStage("pcd-frame-ready", url, startedAt, request.cacheHit);
  return frame;
}

function loadCameraBlob(url: string): Promise<Blob> {
  const cached = cameraBlobs.get(url);
  if (cached) {
    touch(cameraBlobs, url, cached);
    return cached;
  }
  const request = fetch(url, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`相机资源加载失败: ${response.status}`);
      return response.blob();
    })
    .catch((error) => {
      if (cameraBlobs.get(url) === request) cameraBlobs.delete(url);
      throw error;
    });
  cameraBlobs.set(url, request);
  trimOldest(cameraBlobs, CAMERA_ASSET_CACHE_LIMIT);
  return request;
}

function loadCameraBitmap(url: string): Promise<ImageBitmap> {
  const cached = cameraBitmaps.get(url);
  if (cached) {
    touch(cameraBitmaps, url, cached);
    return cached.promise;
  }
  if (typeof createImageBitmap === "undefined") {
    return Promise.reject(new Error("ImageBitmap decode is unavailable"));
  }
  const entry: CameraBitmapEntry = {
    bitmap: null,
    references: 0,
    promise: Promise.resolve(null as unknown as ImageBitmap),
  };
  entry.promise = loadCameraBlob(url)
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => {
      entry.bitmap = bitmap;
      trimCameraBitmaps();
      return bitmap;
    })
    .catch((error) => {
      if (cameraBitmaps.get(url) === entry) cameraBitmaps.delete(url);
      throw error;
    });
  cameraBitmaps.set(url, entry);
  trimCameraBitmaps();
  return entry.promise;
}

export interface AcquiredCameraBitmap {
  bitmap: ImageBitmap;
  cacheReady: boolean;
  release(): void;
}

/** Pins a decoded bitmap until the renderer releases its camera texture owner. */
export async function acquireCameraBitmap(url: string): Promise<AcquiredCameraBitmap> {
  const cached = cameraBitmaps.get(url);
  const cacheReady = cached?.bitmap != null;
  const promise = loadCameraBitmap(url);
  const entry = cameraBitmaps.get(url);
  if (!entry) throw new Error("Camera bitmap cache entry was not created");
  entry.references += 1;
  try {
    const bitmap = await promise;
    let released = false;
    return {
      bitmap,
      cacheReady,
      release() {
        if (released) return;
        released = true;
        entry.references = Math.max(0, entry.references - 1);
        trimCameraBitmaps();
      },
    };
  } catch (error) {
    entry.references = Math.max(0, entry.references - 1);
    throw error;
  }
}

export interface CameraDepthRasterInput {
  calibration: SensorCalibration;
  width: number;
  height: number;
}

export interface LoadedPointCloudDepthRasters {
  rasters: GpuDepthRaster[];
  cacheHit: boolean;
}

/** Share compact camera-depth rasters across prefetch and the active WebGPU frame. */
export function loadPointCloudDepthRasters(
  pointCloudUrl: string,
  positions: Float32Array,
  cameras: readonly CameraDepthRasterInput[],
): Promise<LoadedPointCloudDepthRasters> {
  const key = depthRasterKey(pointCloudUrl, positions, cameras);
  const cached = depthRasters.get(key);
  if (cached) {
    touch(depthRasters, key, cached);
    return cached.promise.then((rasters) => ({ rasters, cacheHit: true }));
  }

  const entry: DepthRasterCacheEntry = {
    promise: Promise.resolve([]),
    bytes: 0,
  };
  entry.promise = getPointCloudComputeSession()
    .buildDepthRasters(
      positions,
      cameras.map((camera) => ({
        calib: camera.calibration,
        width: camera.width,
        height: camera.height,
      })),
    )
    .then((rasters) => {
      if (depthRasters.get(key) === entry) {
        entry.bytes = rasters.reduce((total, raster) => total + raster.depth.byteLength, 0);
        depthRasterCacheBytes += entry.bytes;
        trimDepthRasters();
      }
      return rasters;
    })
    .catch((error) => {
      if (depthRasters.get(key) === entry) depthRasters.delete(key);
      throw error;
    });
  depthRasters.set(key, entry);
  trimDepthRasters();
  return entry.promise.then((rasters) => ({ rasters, cacheHit: false }));
}

export interface PointCloudFramePrefetchOptions {
  decimateThreshold?: number;
  depthRasters?: boolean;
}

/** Decode parsed PCD and camera bitmaps for an adjacent frame. */
export async function prefetchPointCloudFrameAssets(
  manifest: TaskPointCloudManifestResponse,
  options: PointCloudFramePrefetchOptions = {},
): Promise<void> {
  const decimateThreshold = options.decimateThreshold ?? 500_000;
  const convention = manifest.axis_convention ?? "iso_8855";
  const framePromise = loadDecodedPointCloudFrame(
    manifest.point_cloud_url,
    convention,
    decimateThreshold,
  ).catch(() => null);
  const cameraPromises = manifest.cameras
    .filter((camera) => !!camera.image_url)
    .map(async (camera) => {
      try {
        if (typeof createImageBitmap === "undefined") {
          await loadCameraBlob(camera.image_url);
          return null;
        }
        const bitmap = await loadCameraBitmap(camera.image_url);
        return camera.calibration ? { camera, bitmap } : null;
      } catch {
        return null;
      }
    });
  const [frame, cameraAssets] = await Promise.all([framePromise, Promise.all(cameraPromises)]);
  if (!options.depthRasters || !frame) return;
  const usableCameras = cameraAssets.filter(
    (
      asset,
    ): asset is {
      camera: (typeof manifest.cameras)[number] & { calibration: SensorCalibration };
      bitmap: ImageBitmap;
    } => asset !== null && !!asset.camera.calibration,
  );
  if (usableCameras.length === 0 || usableCameras.length > 6) return;
  void loadPointCloudDepthRasters(
    manifest.point_cloud_url,
    frame.positions,
    usableCameras.map(({ camera, bitmap }) => ({
      calibration: camera.calibration,
      width: bitmap.width,
      height: bitmap.height,
    })),
  ).catch(() => {});
}
