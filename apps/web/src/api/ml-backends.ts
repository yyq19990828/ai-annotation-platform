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

// v0.10.26 · 模型市场单变体预热. 字段对应 grounded-sam2 /setup.params 的变体 enum.
export interface MLBackendVariant {
  sam_variant?: string;
  dino_variant?: string;
}

export interface MLBackendSupportedVariantOption {
  value: string;
  label?: string;
  vram_gb?: number;
  tier?: "fast" | "balanced" | "accurate" | string;
  recommended?: boolean;
  note?: string;
}

export interface MLBackendSupportedVariantGroup {
  key: string;
  title?: string;
  description?: string;
  variants?: MLBackendSupportedVariantOption[];
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
  // v0.10.36 · 支持的视频 tracker 列表 (如 ["sam2_video"]); 空/缺 = 不支持视频追踪.
  supported_trackers?: string[];
  // v0.10.40 · 变体富元数据; 缺失时前端回落 params.*_variant.enum.
  supported_variants?: MLBackendSupportedVariantGroup[];
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

  // v0.10.26 · 可选 variant body 预热指定变体 (模型市场单变体预热); 缺省回退默认变体.
  // v0.10.36 · 可选 taskType ("image" | "video"): "video" 预热独立 video tracker 池 (仅认 sam_variant, 无 dino).
  reload: (
    projectId: string,
    backendId: string,
    variant?: MLBackendVariant,
    taskType?: "image" | "video",
  ) =>
    apiClient.post<{
      ok: boolean;
      loaded: boolean;
      reloaded: boolean;
      sam_variant?: string;
      dino_variant?: string;
      task_type?: "image" | "video";
    }>(
      `/projects/${projectId}/ml-backends/${backendId}/reload`,
      variant || taskType
        ? { ...(variant ?? {}), ...(taskType ? { task_type: taskType } : {}) }
        : undefined,
    ),

  predictTest: (projectId: string, backendId: string, taskId: string) =>
    apiClient.post(`/projects/${projectId}/ml-backends/${backendId}/predict-test?task_id=${taskId}`),

  interactiveAnnotate: (projectId: string, backendId: string, payload: InteractiveRequest) =>
    apiClient.post<{ result: unknown[]; score: number | null; inference_time_ms: number | null }>(
      `/projects/${projectId}/ml-backends/${backendId}/interactive-annotating`,
      payload,
    ),
};
