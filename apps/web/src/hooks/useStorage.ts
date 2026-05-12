import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { storageApi } from "../api/storage";
import type { VideoAssetRetryPayload } from "../api/storage";

export function useStorageHealth() {
  return useQuery({
    queryKey: ["storage-health"],
    queryFn: storageApi.health,
    retry: false,
  });
}

export function useStorageBuckets() {
  return useQuery({
    queryKey: ["storage-buckets"],
    queryFn: storageApi.buckets,
    retry: false,
  });
}

export function useVideoAssetFailures(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ["storage-video-asset-failures", limit, offset],
    queryFn: () => storageApi.videoAssetFailures(limit, offset),
    retry: false,
  });
}

export function useRetryVideoAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: VideoAssetRetryPayload) => storageApi.retryVideoAsset(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storage-video-asset-failures"] });
    },
  });
}
