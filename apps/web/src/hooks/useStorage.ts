import { useQuery } from "@tanstack/react-query";
import { storageApi } from "../api/storage";

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
