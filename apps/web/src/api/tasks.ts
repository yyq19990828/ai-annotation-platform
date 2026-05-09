import { apiClient } from "./client";
import type {
  TaskResponse,
  AnnotationResponse,
  TaskLockResponse,
  ReviewClaimResponse,
  Geometry,
} from "@/types";

export interface TaskListResponse {
  items: TaskResponse[];
  total: number;
  limit: number;
  offset: number;
  next_cursor?: string | null;
}

export interface TaskListParams {
  status?: string;
  assignee_id?: string;
  batch_id?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface AnnotationPayload {
  annotation_type?: string;
  class_name: string;
  geometry: Geometry;
  confidence?: number;
  parent_prediction_id?: string;
  lead_time?: number;
  attributes?: Record<string, unknown>;
}

export interface AnnotationUpdatePayload {
  geometry?: Geometry;
  class_name?: string;
  confidence?: number;
  attributes?: Record<string, unknown>;
}

export interface SubmitResponse {
  status: string;
  task_id: string;
}

export const tasksApi = {
  listByProject: (projectId: string, params?: TaskListParams) => {
    const q = new URLSearchParams({ project_id: projectId });
    if (params?.status) q.set("status", params.status);
    if (params?.assignee_id) q.set("assignee_id", params.assignee_id);
    if (params?.batch_id) q.set("batch_id", params.batch_id);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    if (params?.cursor) q.set("cursor", params.cursor);
    return apiClient.get<TaskListResponse>(`/tasks?${q}`);
  },

  getNext: (projectId: string, batchId?: string) => {
    const q = new URLSearchParams({ project_id: projectId });
    if (batchId) q.set("batch_id", batchId);
    return apiClient.get<TaskResponse | null>(`/tasks/next?${q}`);
  },

  get: (id: string) => apiClient.get<TaskResponse>(`/tasks/${id}`),

  getAnnotations: (id: string) =>
    apiClient.get<AnnotationResponse[]>(`/tasks/${id}/annotations`),

  createAnnotation: (id: string, payload: AnnotationPayload) =>
    apiClient.post<AnnotationResponse>(`/tasks/${id}/annotations`, payload),

  updateAnnotation: (taskId: string, annotationId: string, payload: AnnotationUpdatePayload, etag?: string) =>
    apiClient.patch<AnnotationResponse>(
      `/tasks/${taskId}/annotations/${annotationId}`,
      payload,
      etag ? { headers: { "If-Match": etag } } : undefined,
    ),

  deleteAnnotation: (taskId: string, annotationId: string) =>
    apiClient.delete<void>(`/tasks/${taskId}/annotations/${annotationId}`),

  submit: (id: string) =>
    apiClient.post<SubmitResponse>(`/tasks/${id}/submit`),

  // v0.8.7 F7 · 任务跳过
  skip: (
    id: string,
    body: {
      reason: "image_corrupt" | "no_target" | "unclear" | "other";
      note?: string;
    },
  ) =>
    apiClient.post<{
      status: "skipped";
      task_id: string;
      skip_reason: string;
    }>(`/tasks/${id}/skip`, body),

  withdraw: (id: string) =>
    apiClient.post<SubmitResponse>(`/tasks/${id}/withdraw`),

  reopen: (id: string) =>
    apiClient.post<SubmitResponse & { reopened_count: number }>(`/tasks/${id}/reopen`),

  acceptRejection: (id: string) =>
    apiClient.post<SubmitResponse>(`/tasks/${id}/accept-rejection`),

  reviewClaim: (id: string) =>
    apiClient.post<ReviewClaimResponse>(`/tasks/${id}/review/claim`),

  approve: (id: string) =>
    apiClient.post<{ status: string; task_id: string }>(`/tasks/${id}/review/approve`),

  reject: (id: string, reason?: string) =>
    apiClient.post<{ status: string; task_id: string; reason: string | null }>(
      `/tasks/${id}/review/reject`,
      reason ? { reason } : undefined,
    ),

  acquireLock: (taskId: string) =>
    apiClient.post<TaskLockResponse>(`/tasks/${taskId}/lock`),

  heartbeatLock: (taskId: string) =>
    apiClient.post<{ status: string }>(`/tasks/${taskId}/lock/heartbeat`),

  releaseLock: (taskId: string) =>
    apiClient.delete<void>(`/tasks/${taskId}/lock`),

  /**
   * v0.6.7 B-13：unmount / 页面跳转期间 release 必须在请求被取消前送达。
   * 用 fetch keepalive 而非常规 client（client 走 fetch 但未开 keepalive，浏览器会在 unload 时取消）。
   * sendBeacon 不支持 Bearer header，所以走 keepalive。
   */
  releaseLockKeepalive: (taskId: string) => {
    const token = localStorage.getItem("token");
    return fetch(`/api/v1/tasks/${taskId}/lock`, {
      method: "DELETE",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }).catch(() => {});
  },
};
