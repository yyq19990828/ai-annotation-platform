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

// v0.10.1 · /setup 协议自描述响应 (与后端 sam3/grounded-sam2 main.py 同构).
// `params` 为 JSON Schema (Draft-07 子集), M2 schema-form 据此渲染参数面板.
export interface MLBackendCapability {
  name: string;
  version?: string;
  model_version?: string;
  is_interactive?: boolean;
  labels?: string[];
  supported_prompts: string[];
  supported_text_outputs?: string[];
  supported_geometric_outputs?: string[];
  params?: {
    type?: string;
    properties?: Record<string, unknown>;
  };
}

export const mlBackendsApi = {
  list: (projectId: string) =>
    apiClient.get<MLBackendResponse[]>(`/projects/${projectId}/ml-backends`),

  setup: (projectId: string, backendId: string) =>
    apiClient.get<MLBackendCapability>(`/projects/${projectId}/ml-backends/${backendId}/setup`),

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

  unload: (projectId: string, backendId: string) =>
    apiClient.post<{ ok: boolean; unloaded: boolean; loaded: boolean }>(
      `/projects/${projectId}/ml-backends/${backendId}/unload`,
    ),

  reload: (projectId: string, backendId: string) =>
    apiClient.post<{ ok: boolean; loaded: boolean; reloaded: boolean }>(
      `/projects/${projectId}/ml-backends/${backendId}/reload`,
    ),

  predictTest: (projectId: string, backendId: string, taskId: string) =>
    apiClient.post(`/projects/${projectId}/ml-backends/${backendId}/predict-test?task_id=${taskId}`),

  interactiveAnnotate: (projectId: string, backendId: string, payload: InteractiveRequest) =>
    apiClient.post<{ result: unknown[]; score: number | null; inference_time_ms: number | null }>(
      `/projects/${projectId}/ml-backends/${backendId}/interactive-annotating`,
      payload,
    ),
};
