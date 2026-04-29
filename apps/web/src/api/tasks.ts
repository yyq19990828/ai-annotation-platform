import { apiClient } from "./client";
import type {
  TaskResponse,
  AnnotationResponse,
  TaskLockResponse,
} from "@/types";

export interface TaskListResponse {
  items: TaskResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface TaskListParams {
  status?: string;
  assignee_id?: string;
  limit?: number;
  offset?: number;
}

export interface AnnotationPayload {
  annotation_type?: string;
  class_name: string;
  geometry: { x: number; y: number; w: number; h: number };
  confidence?: number;
  parent_prediction_id?: string;
  lead_time?: number;
}

export interface AnnotationUpdatePayload {
  geometry?: { x: number; y: number; w: number; h: number };
  class_name?: string;
  confidence?: number;
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
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    return apiClient.get<TaskListResponse>(`/tasks?${q}`);
  },

  getNext: (projectId: string) =>
    apiClient.get<TaskResponse | null>(`/tasks/next?project_id=${projectId}`),

  get: (id: string) => apiClient.get<TaskResponse>(`/tasks/${id}`),

  getAnnotations: (id: string) =>
    apiClient.get<AnnotationResponse[]>(`/tasks/${id}/annotations`),

  createAnnotation: (id: string, payload: AnnotationPayload) =>
    apiClient.post<AnnotationResponse>(`/tasks/${id}/annotations`, payload),

  updateAnnotation: (taskId: string, annotationId: string, payload: AnnotationUpdatePayload) =>
    apiClient.patch<AnnotationResponse>(`/tasks/${taskId}/annotations/${annotationId}`, payload),

  deleteAnnotation: (taskId: string, annotationId: string) =>
    apiClient.delete<void>(`/tasks/${taskId}/annotations/${annotationId}`),

  submit: (id: string) =>
    apiClient.post<SubmitResponse>(`/tasks/${id}/submit`),

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
};
