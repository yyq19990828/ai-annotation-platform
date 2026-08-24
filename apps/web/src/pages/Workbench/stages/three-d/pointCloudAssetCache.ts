import type { TaskPointCloudManifestResponse } from "@/api/generated";

const POINT_CLOUD_CACHE_LIMIT = 3;
const CAMERA_ASSET_CACHE_LIMIT = 18;

const pointCloudBuffers = new Map<string, Promise<ArrayBuffer>>();
const cameraAssets = new Map<string, Promise<void>>();

function trimOldest<T>(cache: Map<string, T>, limit: number): void {
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

/**
 * Fetches PCD bytes through a small shared cache. Timeline prefetch and the active
 * scene therefore share the same in-flight request instead of downloading twice.
 */
export function loadPointCloudBuffer(url: string): Promise<ArrayBuffer> {
  const cached = pointCloudBuffers.get(url);
  if (cached) return cached;

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

function prefetchCameraAsset(url: string): Promise<void> {
  const cached = cameraAssets.get(url);
  if (cached) return cached;

  const request = fetch(url, { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`相机资源预取失败: ${response.status}`);
      await response.blob();
    })
    .catch((error) => {
      if (cameraAssets.get(url) === request) cameraAssets.delete(url);
      throw error;
    });
  cameraAssets.set(url, request);
  trimOldest(cameraAssets, CAMERA_ASSET_CACHE_LIMIT);
  return request;
}

/** Warm the next frame's PCD and compressed camera responses without decoding them. */
export async function prefetchPointCloudFrameAssets(
  manifest: TaskPointCloudManifestResponse,
): Promise<void> {
  await Promise.allSettled([
    prefetchPointCloudBuffer(manifest.point_cloud_url),
    ...manifest.cameras
      .filter((camera) => !!camera.image_url)
      .map((camera) => prefetchCameraAsset(camera.image_url)),
  ]);
}
