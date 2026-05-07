import { apiClient } from "./client";
import type { MLBackendResponse } from "@/types";

export interface MLBackendCreatePayload {
  name: string;
  url: string;
  is_interactive?: boolean;
  auth_method?: string;
  auth_token?: string;
  extra_params?: Record<string, unknown>;
}

export type MLBackendUpdatePayload = Partial<MLBackendCreatePayload>;

export interface InteractiveRequest {
  task_id: string;
  context: Record<string, unknown>;
}

export const mlBackendsApi = {
  list: (projectId: string) =>
    apiClient.get<MLBackendResponse[]>(`/projects/${projectId}/ml-backends`),

  create: (projectId: string, payload: MLBackendCreatePayload) =>
    apiClient.post<MLBackendResponse>(`/projects/${projectId}/ml-backends`, payload),

  get: (projectId: string, backendId: string) =>
    apiClient.get<MLBackendResponse>(`/projects/${projectId}/ml-backends/${backendId}`),

  update: (projectId: string, backendId: string, payload: MLBackendUpdatePayload) =>
    apiClient.put<MLBackendResponse>(`/projects/${projectId}/ml-backends/${backendId}`, payload),

  delete: (projectId: string, backendId: string) =>
    apiClient.delete(`/projects/${projectId}/ml-backends/${backendId}`),

  health: (projectId: string, backendId: string) =>
    apiClient.post<{ status: string; backend_id: string; backend_name: string }>(
      `/projects/${projectId}/ml-backends/${backendId}/health`,
    ),

  predictTest: (projectId: string, backendId: string, taskId: string) =>
    apiClient.post(`/projects/${projectId}/ml-backends/${backendId}/predict-test?task_id=${taskId}`),

  interactiveAnnotate: (projectId: string, backendId: string, payload: InteractiveRequest) =>
    apiClient.post<{ result: unknown[]; score: number | null; inference_time_ms: number | null }>(
      `/projects/${projectId}/ml-backends/${backendId}/interactive-annotating`,
      payload,
    ),
};
