import { apiClient } from "./client";

export interface StorageHealthResponse {
  status: string;
  bucket: string;
}

export const storageApi = {
  health: () => apiClient.get<StorageHealthResponse>("/storage/health"),
};
