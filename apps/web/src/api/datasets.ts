import { apiClient } from "./client";
import type { DatasetOut } from "./generated/types.gen";

export type DatasetResponse = DatasetOut;

export interface DatasetItemResponse {
  id: string;
  dataset_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number | null;
  content_hash: string | null;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
  file_url: string | null;
  thumbnail_url: string | null;
  blurhash: string | null;
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

  /**
   * 上传 ZIP 包到后端，由服务端解压并入库；最大 200MB。
   * 返回 { added, skipped, errors, total_in_zip }。
   */
  uploadZip: (
    id: string,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<{ added: number; skipped: number; errors: Array<{ name: string; error: string }>; total_in_zip: number }> => {
    return new Promise((resolve, reject) => {
      const token = localStorage.getItem("token");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/v1/datasets/${id}/items/upload-zip`);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            reject(new Error("响应解析失败"));
          }
        } else {
          let detail = `上传失败 (HTTP ${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText);
            if (body.detail) detail = body.detail;
          } catch {
            // ignore
          }
          reject(new Error(detail));
        }
      };
      xhr.onerror = () => reject(new Error("网络错误"));
      const fd = new FormData();
      fd.append("file", file);
      xhr.send(fd);
    });
  },

  scanItems: (id: string) =>
    apiClient.post<{ status: string; new_items: number }>(`/datasets/${id}/items/scan`),

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
