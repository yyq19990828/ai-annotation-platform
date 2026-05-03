import { apiClient } from "./client";
import type { ExportFormat } from "./projects";

export interface BatchResponse {
  id: string;
  project_id: string;
  dataset_id: string | null;
  display_id: string;
  name: string;
  description: string;
  status: string;
  priority: number;
  deadline: string | null;
  assigned_user_ids: string[];
  total_tasks: number;
  completed_tasks: number;
  review_tasks: number;
  approved_tasks: number;
  rejected_tasks: number;
  progress_pct: number;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  review_feedback: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface BatchCreatePayload {
  name: string;
  description?: string;
  dataset_id?: string;
  priority?: number;
  deadline?: string;
  assigned_user_ids?: string[];
}

export interface BatchUpdatePayload {
  name?: string;
  description?: string;
  priority?: number;
  deadline?: string;
  assigned_user_ids?: string[];
}

export interface BatchSplitPayload {
  strategy: "metadata" | "id_range" | "random";
  metadata_key?: string;
  metadata_value?: string;
  item_ids?: string[];
  n_batches?: number;
  name_prefix?: string;
  priority?: number;
  deadline?: string;
  assigned_user_ids?: string[];
}

export const batchesApi = {
  list: (projectId: string, status?: string) => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    const qs = q.toString();
    return apiClient.get<BatchResponse[]>(
      `/projects/${projectId}/batches${qs ? `?${qs}` : ""}`,
    );
  },

  get: (projectId: string, batchId: string) =>
    apiClient.get<BatchResponse>(`/projects/${projectId}/batches/${batchId}`),

  create: (projectId: string, payload: BatchCreatePayload) =>
    apiClient.post<BatchResponse>(`/projects/${projectId}/batches`, payload),

  update: (projectId: string, batchId: string, payload: BatchUpdatePayload) =>
    apiClient.patch<BatchResponse>(
      `/projects/${projectId}/batches/${batchId}`,
      payload,
    ),

  remove: (projectId: string, batchId: string) =>
    apiClient.delete<void>(`/projects/${projectId}/batches/${batchId}`),

  transition: (projectId: string, batchId: string, targetStatus: string) =>
    apiClient.post<BatchResponse>(
      `/projects/${projectId}/batches/${batchId}/transition`,
      { target_status: targetStatus },
    ),

  split: (projectId: string, payload: BatchSplitPayload) =>
    apiClient.post<BatchResponse[]>(
      `/projects/${projectId}/batches/split`,
      payload,
    ),

  reject: (projectId: string, batchId: string, feedback: string) =>
    apiClient.post<BatchResponse>(
      `/projects/${projectId}/batches/${batchId}/reject`,
      { feedback },
    ),

  exportBatch: async (projectId: string, batchId: string, format: ExportFormat) => {
    const resp = await fetch(
      `/api/v1/projects/${projectId}/batches/${batchId}/export?format=${format}`,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      },
    );
    if (!resp.ok) throw new Error("Export failed");
    const blob = await resp.blob();
    const cd = resp.headers.get("content-disposition") ?? "";
    const fname = cd.match(/filename=(.+)/)?.[1] ?? `batch_export.${format === "coco" ? "json" : "zip"}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
  },
};
