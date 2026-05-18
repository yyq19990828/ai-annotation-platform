// v0.10.16 · async_jobs API client (ROADMAP §1.7)

import { apiClient } from "./client";

export type AsyncJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AsyncJobKind =
  | "batch_predict"
  | "video_tracker"
  | "audit_archive"
  | "predictions_import"
  | string;

export interface AsyncJob {
  id: string;
  kind: AsyncJobKind;
  project_id: string | null;
  user_id: string | null;
  status: AsyncJobStatus;
  progress_pct: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error_message: string | null;
  celery_task_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AsyncJobListResponse {
  items: AsyncJob[];
  total: number;
}

export const asyncJobsApi = {
  list: (params: { status?: AsyncJobStatus; kind?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.kind) q.set("kind", params.kind);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return apiClient.get<AsyncJobListResponse>(
      `/async-jobs${qs ? `?${qs}` : ""}`,
    );
  },
  get: (id: string) => apiClient.get<AsyncJob>(`/async-jobs/${id}`),
  cancel: (id: string) =>
    apiClient.post<{ status: string; id: string }>(`/async-jobs/${id}/cancel`),
};
