import { apiClient } from "./client";

export interface DatasetResponse {
  id: string;
  display_id: string;
  name: string;
  description: string;
  data_type: string;
  file_count: number;
  created_by: string;
  project_count: number;
  created_at: string;
  updated_at: string;
}

export interface DatasetItemResponse {
  id: string;
  dataset_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number | null;
  metadata: Record<string, unknown>;
  file_url: string | null;
  created_at: string;
}

export interface DatasetListResponse {
  items: DatasetResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface DatasetItemListResponse {
  items: DatasetItemResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface DatasetCreatePayload {
  name: string;
  description?: string;
  data_type?: string;
}

export interface DatasetUpdatePayload {
  name?: string;
  description?: string;
}

export const datasetsApi = {
  list: (params?: { search?: string; data_type?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.data_type) q.set("data_type", params.data_type);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return apiClient.get<DatasetListResponse>(`/datasets${qs ? `?${qs}` : ""}`);
  },

  get: (id: string) => apiClient.get<DatasetResponse>(`/datasets/${id}`),

  create: (payload: DatasetCreatePayload) =>
    apiClient.post<DatasetResponse>("/datasets", payload),

  update: (id: string, payload: DatasetUpdatePayload) =>
    apiClient.put<DatasetResponse>(`/datasets/${id}`, payload),

  delete: (id: string) => apiClient.delete<void>(`/datasets/${id}`),

  listItems: (id: string, params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return apiClient.get<DatasetItemListResponse>(`/datasets/${id}/items${qs ? `?${qs}` : ""}`);
  },

  uploadInit: (id: string, payload: { file_name: string; content_type?: string }) =>
    apiClient.post<{ item_id: string; upload_url: string; expires_in: number }>(
      `/datasets/${id}/items/upload-init`,
      payload,
    ),

  uploadComplete: (id: string, itemId: string) =>
    apiClient.post<{ status: string; item_id: string }>(
      `/datasets/${id}/items/upload-complete/${itemId}`,
    ),

  deleteItem: (id: string, itemId: string) =>
    apiClient.delete<void>(`/datasets/${id}/items/${itemId}`),

  linkProject: (id: string, projectId: string) =>
    apiClient.post<{ status: string; dataset_id: string; project_id: string }>(
      `/datasets/${id}/link`,
      { project_id: projectId },
    ),

  unlinkProject: (id: string, projectId: string) =>
    apiClient.delete<void>(`/datasets/${id}/link/${projectId}`),

  getLinkedProjects: (id: string) =>
    apiClient.get<import("./projects").ProjectResponse[]>(`/datasets/${id}/projects`),
};
