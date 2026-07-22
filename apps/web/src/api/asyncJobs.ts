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
  | "video_correction"
  | "audit_archive"
  | "predictions_import"
  | "prediction_retry"
  | "dataset_import"
  | "create_tasks"
  | string;

export interface AsyncJob {
  id: string;
  kind: AsyncJobKind;
  project_id: string | null;
  user_id: string | null;
  project_display_id: string | null;
  project_name: string | null;
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

export type AsyncJobOut = AsyncJob;

export interface AsyncJobListResponse {
  items: AsyncJob[];
  total: number;
}

export interface AsyncJobRetryFailedResponse {
  status: "queued";
  job_id: string;
  queued: number;
  skipped: number;
}

export interface AsyncJobListParams {
  kind?: string | string[];
  status?: AsyncJobStatus | AsyncJobStatus[];
  project_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export const asyncJobsApi = {
  list: (params: AsyncJobListParams = {}) => {
    const q = new URLSearchParams();
    const statuses = Array.isArray(params.status)
      ? params.status
      : params.status
        ? [params.status]
        : [];
    statuses.forEach((status) => q.append("status", status));
    const kinds = Array.isArray(params.kind)
      ? params.kind
      : params.kind
        ? [params.kind]
        : [];
    kinds.forEach((kind) => q.append("kind", kind));
    if (params.project_id) q.set("project_id", params.project_id);
    if (params.search) q.set("search", params.search);
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
  retryFailed: (id: string) =>
    apiClient.post<AsyncJobRetryFailedResponse>(
      `/async-jobs/${id}/retry-failed`,
    ),
};
