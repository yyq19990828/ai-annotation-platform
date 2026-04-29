import { apiClient } from "./client";

export interface StorageHealthResponse {
  status: string;
  bucket: string;
}

export interface BucketSummary {
  name: string;
  status: "ok" | "error";
  object_count: number;
  total_size_bytes: number;
  error?: string;
  role: "annotations" | "datasets" | string;
}

export interface BucketsResponse {
  items: BucketSummary[];
  total_object_count: number;
  total_size_bytes: number;
}

export const storageApi = {
  health: () => apiClient.get<StorageHealthResponse>("/storage/health"),
  buckets: () => apiClient.get<BucketsResponse>("/storage/buckets"),
};
